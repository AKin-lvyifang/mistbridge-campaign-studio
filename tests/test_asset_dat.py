"""Real DAT binary roundtrips generated entirely from synthetic dataclasses.

No proprietary game file is used. These tests exercise the installed pinned
genieutils-py serializer, raw DEFLATE stream, bounded parser and mapping output.
They establish this synthetic v8.9 shape only, not all installed game builds.
"""
from __future__ import annotations

from dataclasses import fields, is_dataclass
import math
import struct
import types
import unittest
from unittest.mock import patch
from typing import get_args, get_origin
import zlib

from genieutils.datfile import DatFile
from genieutils.civ import Civ
from genieutils.graphic import Graphic
from genieutils.unit import Unit, UnitType
from genieutils.terrainblock import (
    FrameData, Terrain, TileSize, TERRAIN_COUNT, TERRAIN_UNITS_SIZE, TILE_TYPE_COUNT,
)

from server.asset_worker import bounded_dat, summarize_dat


def zero_value(annotation):
    """Build only the public dataclass shape, with explicit fixed arrays below."""
    origin = get_origin(annotation)
    if annotation is int:
        return 0
    if annotation is float:
        return 0.0
    if annotation is str:
        return ""
    if origin is list:
        return []
    if origin is tuple:
        return tuple(zero_value(item) for item in get_args(annotation))
    if origin is types.UnionType and type(None) in get_args(annotation):
        return None
    if is_dataclass(annotation):
        return annotation(**{field.name: zero_value(field.type) for field in fields(annotation)})
    raise TypeError(f"Synthetic builder does not recognize {annotation!r}")


def synthetic_dat() -> DatFile:
    """A v8.9 DAT with two civilizations and an original unit/graphic mapping."""
    dat = zero_value(DatFile)
    dat.version = "VER 8.9"
    dat.terrain_block.tile_sizes = [zero_value(TileSize) for _ in range(TILE_TYPE_COUNT)]
    dat.terrain_block.tile_width = 96
    dat.terrain_block.tile_height = 48
    dat.terrain_block.tile_half_width = 48
    dat.terrain_block.tile_half_height = 24
    dat.terrain_block.terrains_used_2 = 2
    for index in range(TERRAIN_COUNT):
        terrain = zero_value(Terrain)
        terrain.frame_data = [zero_value(FrameData) for _ in range(TILE_TYPE_COUNT)]
        terrain.terrain_unit_masked_density = [0] * TERRAIN_UNITS_SIZE
        terrain.terrain_unit_id = [-1] * TERRAIN_UNITS_SIZE
        terrain.terrain_unit_density = [0] * TERRAIN_UNITS_SIZE
        terrain.terrain_unit_centering = [0] * TERRAIN_UNITS_SIZE
        terrain.terrain_to_draw = -1
        if index < 2:
            terrain.enabled = 1
            terrain.name = f"Synthetic terrain {index}"
            terrain.name_2 = f"fixture_texture_{index}"
            terrain.blend_priority = 10 + index
            terrain.blend_type = 20 + index
            terrain.overlay_mask_name = f"fixture_mask_{index}"
        dat.terrain_block.terrains.append(terrain)
    dat.terrain_block.terrains[1].terrain_to_draw = 0

    graphic = zero_value(Graphic)
    graphic.id = 1
    graphic.name = "Synthetic acorn marker"
    graphic.file_name = "fixture_acorn_marker"
    graphic.frame_count = 3
    graphic.angle_count = 8
    graphic.player_color = -1
    dat.graphics = [None, graphic]

    unit = zero_value(Unit)
    unit.type = UnitType.EyeCandy
    unit.id = 7
    unit.name = "Synthetic marker unit"
    unit.standing_graphic = (1, -1)
    unit.collision_size_x = 0.75
    unit.collision_size_y = 1.25
    unit.enabled = 1
    gaia = zero_value(Civ)
    gaia.name = "Synthetic Gaia"
    civ = zero_value(Civ)
    civ.name = "Synthetic Civilization"
    civ.units = [None] * 7 + [unit]
    dat.civs = [gaia, civ]
    return dat


def compressed(raw: bytes) -> bytes:
    return zlib.compress(raw, level=6, wbits=-15)


class AssetDatTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = synthetic_dat()
        cls.raw = cls.original.to_bytes()
        cls.binary = compressed(cls.raw)

    def test_genuine_synthetic_dat_serialize_deflate_parse_roundtrip(self):
        self.assertTrue(self.raw.startswith(b"VER 8.9\0"))
        decoded = bounded_dat(self.binary)
        self.assertIsInstance(decoded, DatFile)
        self.assertEqual(decoded.version, "VER 8.9")
        self.assertEqual(decoded.to_bytes(), self.raw)
        self.assertEqual(decoded.graphics[1].file_name, "fixture_acorn_marker")
        self.assertEqual(decoded.civs[1].units[7].standing_graphic, (1, -1))

    def test_summary_resolves_civ_unit_graphic_filename_without_id_guessing(self):
        result = summarize_dat(bounded_dat(self.binary))
        self.assertEqual(result["version"], "VER 8.9")
        self.assertEqual(result["tileWidth"], 96)
        self.assertEqual(result["civilizations"][0],
                         {"id": 0, "name": "Synthetic Gaia", "units": {}})
        civ = result["civilizations"][1]
        self.assertEqual(civ["id"], 1)
        self.assertEqual(list(civ["units"]), ["7"])
        self.assertEqual(civ["units"]["7"], {"graphicId": 1, "name": "Synthetic marker unit",
                                                 "footprint": [1.5, 2.5]})
        self.assertEqual(result["graphics"], {"1": {"filename": "fixture_acorn_marker",
                                                   "frameCount": 3, "angleCount": 8,
                                                   "childGraphics": 0}})
        self.assertNotEqual(str(civ["units"]["7"]["graphicId"]), "7")

    def test_summary_preserves_terrain_blend_and_replacement_metadata(self):
        result = summarize_dat(bounded_dat(self.binary))
        self.assertEqual(len(result["terrains"]), TERRAIN_COUNT)
        self.assertEqual(result["terrains"][1],
                         {"id": 1, "name": "Synthetic terrain 1",
                          "textureName": "fixture_texture_1", "replacementId": 0,
                          "blendPriority": 11, "blendType": 21,
                          "overlayMask": "fixture_mask_1"})

    def test_all_compressed_prefix_truncations_are_rejected(self):
        for length in range(len(self.binary)):
            with self.subTest(length=length), self.assertRaises((ValueError, zlib.error)):
                bounded_dat(self.binary[:length])

    def test_compressed_trailing_data_and_concatenated_streams_are_rejected(self):
        for suffix in (b"trailer", compressed(b"more")):
            with self.subTest(suffix=suffix), self.assertRaisesRegex(ValueError, "trailing"):
                bounded_dat(self.binary + suffix)

    def test_structurally_truncated_but_complete_deflate_stream_is_rejected(self):
        for length in (8, 12, 32, len(self.raw) // 2, len(self.raw) - 1):
            with self.subTest(length=length), self.assertRaises(ValueError):
                bounded_dat(compressed(self.raw[:length]))

    def test_unparsed_trailing_dat_fields_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "unparsed trailing"):
            bounded_dat(compressed(self.raw + b"new unknown fields"))

    def test_unknown_dat_versions_are_rejected(self):
        for version in (b"VER 9.9\0", b"NOTDAT!!", b"\xff" * 8):
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, "Unsupported DAT version"):
                bounded_dat(compressed(version + self.raw[8:]))

    def test_earlier_enum_versions_are_rejected_before_dependency_parsing(self):
        # Upstream's metadata supports FileVersion 7.7+, despite older enum members.
        from genieutils.versions import Version
        for minor in range(1, 7):
            version = f"VER 7.{minor}"
            self.assertEqual(Version(version).value, version)
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, "Unsupported DAT version"):
                bounded_dat(compressed(version.encode("ascii") + b"\0" + self.raw[8:]))

    def test_expanded_byte_budget_is_enforced_before_parser(self):
        with patch("server.asset_worker.MAX_EXPANDED", 64):
            with self.assertRaisesRegex(ValueError, "expands beyond"):
                bounded_dat(self.binary)

    def test_negative_array_count_is_rejected(self):
        raw = bytearray(self.raw)
        struct.pack_into("<h", raw, 8, -1)  # terrain restriction count
        with self.assertRaisesRegex(ValueError, "array exceeds"):
            bounded_dat(compressed(bytes(raw)))

    def test_summary_bounds_names_and_nonfinite_footprints(self):
        dat = synthetic_dat()
        dat.civs[1].name = "c" * 200
        dat.civs[1].units[7].name = "u" * 200
        dat.civs[1].units[7].collision_size_x = math.nan
        dat.civs[1].units[7].collision_size_y = math.inf
        dat.graphics[1].file_name = "g" * 400
        dat.terrain_block.tile_width = 0
        result = summarize_dat(dat)
        self.assertEqual(result["civilizations"][1]["name"], "c" * 100)
        self.assertEqual(result["civilizations"][1]["units"]["7"]["name"], "u" * 100)
        self.assertEqual(result["civilizations"][1]["units"]["7"]["footprint"], [1, 1])
        self.assertEqual(result["graphics"]["1"]["filename"], "g" * 240)
        self.assertEqual(result["tileWidth"], 1)


if __name__ == "__main__":
    unittest.main()
