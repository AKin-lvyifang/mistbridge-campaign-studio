"""End-to-end original SLD + DAT bytes through real isolated asset workers.

Fixtures come exclusively from programmatic synthetic builders, not game files.
No decoder, subprocess, DAT parser or filesystem reader is mocked.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from server.app import app
from server.entrypoint import DesktopGuard
from server.native_assets import AssetError, NativeAssetStore
from test_asset_dat import compressed, synthetic_dat
from test_sld_preview import bc1, frame, main_layer, sld


class AssetPipelineTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="synthetic-asset-pipeline-")
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name) / "original synthetic resource pack"
        self.graphics = self.root / "resources/_common/drs/graphics"
        self.dat_directory = self.root / "resources/_common/dat"
        self.graphics.mkdir(parents=True)
        self.dat_directory.mkdir(parents=True)
        self.dat_path = self.dat_directory / "empires2_x2_p1.dat"
        self.sld_path = self.graphics / "fixture_acorn_marker.sld"
        self.dat_bytes = compressed(synthetic_dat().to_bytes())
        self.sld_bytes = sld(frame(hotspot=(-3, 9), layers=[
            (1, main_layer(blocks=bc1(0, 0xFFFF, [0, 1, 2, 3] * 4))),
            (4, b"synthetic unsupported outline"),
            (16, b"synthetic unsupported playercolor"),
        ]))
        self.dat_path.write_bytes(self.dat_bytes)
        self.sld_path.write_bytes(self.sld_bytes)
        self.store = NativeAssetStore()
        self.addCleanup(self.store.directory.cleanup)
        self.addCleanup(self.store.clear)
        self.store.mount(str(self.root))
        self.dat_id = self.store.catalog(kind="dat")["entries"][0]["id"]
        self.sld_id = self.store.catalog(kind="sld")["entries"][0]["id"]

    def assert_png_matches_fixture(self, data):
        with Image.open(io.BytesIO(data)) as image:
            self.assertEqual(image.format, "PNG")
            self.assertEqual(image.size, (12, 12))
            pixels = image.convert("RGBA")
            self.assertEqual(pixels.getpixel((4, 4)), (0, 0, 0, 255))
            self.assertEqual(pixels.getpixel((5, 4)), (255, 255, 255, 255))
            self.assertEqual(pixels.getpixel((6, 4)), (127, 127, 127, 255))
            self.assertEqual(pixels.getpixel((7, 4)), (0, 0, 0, 0))
            self.assertEqual(pixels.getpixel((0, 0)), (0, 0, 0, 0))

    def test_full_store_pipeline_has_real_dat_mapping_and_sld_pixels(self):
        status = self.store.load_dat(self.dat_id)
        self.assertEqual(status["layout"], "aoe2de-candidate")
        self.assertEqual(status["dat"]["version"], "VER 8.9")
        self.assertEqual(status["dat"]["sha256"], hashlib.sha256(self.dat_bytes).hexdigest())
        self.assertFalse(status["gameTested"])
        self.assertEqual(status["dat"]["civilizations"][1],
                         {"id": 1, "name": "Synthetic Civilization"})

        result = self.store.bindings(1, [7, 1])
        mapped, missing = result["bindings"]
        self.assertTrue(mapped["resolved"])
        self.assertEqual(mapped["unitId"], 7)
        self.assertEqual(mapped["graphicId"], 1)
        self.assertEqual(mapped["filename"], "fixture_acorn_marker")
        self.assertEqual(mapped["assetId"], self.sld_id)
        self.assertEqual(mapped["footprint"], [1.5, 2.5])
        self.assertEqual(mapped["frameCount"], 3)  # Declared DAT animation metadata.
        self.assertEqual(mapped["angleCount"], 8)
        self.assertEqual(mapped["tileWidth"], 96)
        self.assertFalse(missing["resolved"])

        preview = self.store.decode(mapped["assetId"])
        self.assertEqual(preview["kind"], "sld")
        self.assertEqual(preview["sha256"], hashlib.sha256(self.sld_bytes).hexdigest())
        self.assertEqual(preview["hotspot"], [-3, 9])
        self.assertEqual(preview["frameIndex"], 0)
        self.assertEqual(preview["frameCount"], 1)  # Actual SLD file, never guessed from DAT.
        self.assertTrue(any("player" in item for item in preview["limitations"]))
        self.assertTrue(any("outline" in item for item in preview["limitations"]))
        self.assert_png_matches_fixture(self.store.image(preview["imageUrl"].rsplit("/", 1)[1]))
        self.assertEqual(preview["revision"], result["revision"])
        self.assertNotIn(str(self.root), json.dumps([status, result, preview]))
        self.assertNotIn(str(self.store.cache_dir), json.dumps([status, result, preview]))
        self.assertEqual([path.suffix for path in self.store.cache_dir.iterdir()], [".png"])

    def test_actual_dat_civilization_and_missing_file_are_not_guessed(self):
        self.store.load_dat(self.dat_id)
        self.assertFalse(self.store.bindings(0, [7])["bindings"][0]["resolved"])
        with self.assertRaisesRegex(AssetError, "Unknown civilization"):
            self.store.bindings(99, [7])
        self.sld_path.unlink()
        self.store.mount(str(self.root))
        self.store.load_dat(self.store.catalog(kind="dat")["entries"][0]["id"])
        missing = self.store.bindings(1, [7])["bindings"][0]
        self.assertFalse(missing["resolved"])
        self.assertIn("not found", missing["reason"])

    def test_duplicate_real_sld_names_remain_ambiguous_after_actual_dat_parse(self):
        (self.root / "fixture_acorn_marker.sld").write_bytes(self.sld_bytes)
        self.store.mount(str(self.root))
        self.store.load_dat(self.store.catalog(kind="dat")["entries"][0]["id"])
        mapped = self.store.bindings(1, [7])["bindings"][0]
        self.assertFalse(mapped["resolved"])
        self.assertIn("Multiple", mapped["reason"])
        self.assertNotIn("assetId", mapped)

    def test_unsafe_filename_from_actual_dat_cannot_address_outside_root(self):
        dat = synthetic_dat()
        dat.graphics[1].file_name = "../fixture_acorn_marker"
        self.dat_path.write_bytes(compressed(dat.to_bytes()))
        self.store.load_dat(self.dat_id)
        mapped = self.store.bindings(1, [7])["bindings"][0]
        self.assertFalse(mapped["resolved"])
        self.assertNotIn("assetId", mapped)
        self.assertEqual(list(self.store.cache_dir.iterdir()), [])

    def test_source_change_redecodes_actual_sld_and_clear_expires_dat_mapping(self):
        self.store.load_dat(self.dat_id)
        first = self.store.decode(self.sld_id)
        self.sld_path.write_bytes(sld())  # Original solid red fixture.
        second = self.store.decode(self.sld_id)
        self.assertNotEqual(first["sha256"], second["sha256"])
        self.assertNotEqual(first["imageUrl"], second["imageUrl"])
        token = second["imageUrl"].rsplit("/", 1)[1]
        with Image.open(io.BytesIO(self.store.image(token))) as image:
            self.assertEqual(image.getpixel((4, 4)), (255, 0, 0, 255))
        self.store.clear()
        self.assertIsNone(self.store.status()["dat"])
        with self.assertRaises(AssetError):
            self.store.bindings(1, [7])
        with self.assertRaises(AssetError):
            self.store.image(token)
        self.assertEqual(list(self.store.cache_dir.iterdir()), [])

    def test_resolved_mapping_does_not_turn_bad_sld_into_a_fake_preview(self):
        self.store.load_dat(self.dat_id)
        self.sld_path.write_bytes(sld(version=5))
        mapped = self.store.bindings(1, [7])["bindings"][0]
        self.assertTrue(mapped["resolved"])  # Existence only, decoding is a separate check.
        with self.assertRaisesRegex(AssetError, "Unsupported SLD version"):
            self.store.decode(mapped["assetId"])
        self.assertEqual(list(self.store.cache_dir.iterdir()), [])

    def test_owned_http_pipeline_dat_bindings_decode_image(self):
        from server import asset_routes
        token = "d" * 64
        with patch.object(asset_routes, "store", self.store):
            with TestClient(DesktopGuard(app, token), base_url="http://127.0.0.1",
                            headers={"x-studio-instance": token}) as client:
                response = client.post("/api/assets/dat", json={"assetId": self.dat_id})
                self.assertEqual(response.status_code, 200, response.text)
                result = client.post("/api/assets/bindings", json={"civilization": 1, "unitIds": [7]})
                self.assertEqual(result.status_code, 200, result.text)
                asset_id = result.json()["bindings"][0]["assetId"]
                response = client.post("/api/assets/decode", json={"assetId": asset_id})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertNotIn(str(self.root), response.text)
                image = client.get(response.json()["imageUrl"])
                self.assertEqual(image.status_code, 200)
                self.assertEqual(image.headers["content-type"], "image/png")
                self.assertEqual(image.headers["cache-control"], "no-store")
                self.assert_png_matches_fixture(image.content)

    @unittest.skipUnless(os.name == "posix", "POSIX nofollow/dirfd regression")
    def test_replaced_root_ancestor_cannot_redirect_an_existing_asset_handle(self):
        sandbox = Path(self.folder.name)
        ancestor = sandbox / "replaceable ancestor"
        selected = ancestor / "selected"
        selected.mkdir(parents=True)
        (selected / "sprite.sld").write_bytes(sld())
        outside_parent = sandbox / "outside selection"
        outside = outside_parent / "selected"
        outside.mkdir(parents=True)
        (outside / "sprite.sld").write_bytes(self.sld_bytes)
        self.store.mount(str(selected))
        original_handle = self.store.catalog(kind="sld")["entries"][0]["id"]
        ancestor.rename(sandbox / "old selected ancestor")
        ancestor.symlink_to(outside_parent, target_is_directory=True)
        with self.assertRaises(AssetError):
            self.store.decode(original_handle)
        self.assertEqual(list(self.store.cache_dir.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
