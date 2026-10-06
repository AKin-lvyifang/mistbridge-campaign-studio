"""Synthetic SLD v4 regressions. These fixtures contain no game resources."""
from __future__ import annotations

from dataclasses import replace
import random
import struct
import unittest
from unittest.mock import patch

from server.sld_preview import SldDecodeError, SldLimits, decode_sld


def bc1(color0=0xF800, color1=0x001F, selectors=None):
    selectors = [0] * 16 if selectors is None else selectors
    return struct.pack("<HHI", color0, color1,
                       sum(value << (index * 2) for index, value in enumerate(selectors)))


def main_layer(bounds=(4, 4, 8, 8), commands=((0, 1),), blocks=None, flags=0):
    blocks = bc1() if blocks is None else blocks
    return (struct.pack("<4HBBH", *bounds, flags, 1, len(commands))
            + bytes(value for command in commands for value in command) + blocks)


def frame(*, canvas=(12, 12), hotspot=(-3, 9), layers=None, stored_index=0):
    layers = [(1, main_layer())] if layers is None else layers
    result = struct.pack("<HHhhBBH", *canvas, *hotspot,
                         sum(bit for bit, _ in layers), 1, stored_index)
    for _, body in layers:
        length = len(body) + 4
        result += struct.pack("<I", length) + body + b"\0" * (-length % 4)
    return result


def sld(*frames, header_size=16, version=4):
    frames = frames or (frame(),)
    # Standard v4 header, optionally with an independently constructed extension.
    return (struct.pack("<4s5H", b"SLDX", version, len(frames), 0, header_size, 0)
            + b"\0" * (header_size - 14) + b"".join(frames))


def change(data, offset, fmt, *values):
    result = bytearray(data)
    struct.pack_into(fmt, result, offset, *values)
    return bytes(result)


class SldPreviewTests(unittest.TestCase):
    def test_real_sld_layout_main_canvas_offset_and_signed_anchor(self):
        preview = decode_sld(sld())
        self.assertEqual(preview.image.mode, "RGBA")
        self.assertEqual(preview.image.size, (12, 12))
        self.assertEqual(preview.source_canvas_size, (12, 12))
        self.assertEqual(preview.hotspot, (-3, 9))
        self.assertEqual(preview.frame_index, 0)
        self.assertEqual(preview.frame_count, 1)
        self.assertEqual(preview.layer_types, ("main",))
        self.assertEqual(preview.unsupported_layers, ())
        self.assertEqual(preview.image.getpixel((4, 4)), (255, 0, 0, 255))
        self.assertEqual(preview.image.getpixel((7, 7)), (255, 0, 0, 255))
        for point in ((0, 0), (3, 4), (8, 7), (11, 11)):
            self.assertEqual(preview.image.getpixel(point), (0, 0, 0, 0))

    def test_both_anchor_components_remain_signed_and_unclamped(self):
        preview = decode_sld(sld(frame(hotspot=(-32768, -32767))))
        self.assertEqual(preview.hotspot, (-32768, -32767))
        preview = decode_sld(sld(frame(hotspot=(32767, 32000))))
        self.assertEqual(preview.hotspot, (32767, 32000))

    def test_bc1_four_color_mode_and_little_endian_selector_order(self):
        block = bc1(selectors=[0, 1, 2, 3] * 4)
        image = decode_sld(sld(frame(layers=[(1, main_layer(blocks=block))]))).image
        expected = [(255, 0, 0, 255), (0, 0, 255, 255),
                    (170, 0, 85, 255), (85, 0, 170, 255)]
        for y in range(4, 8):
            self.assertEqual([image.getpixel((x, y)) for x in range(4, 8)], expected)

    def test_bc1_three_color_mode_has_per_pixel_transparency(self):
        block = bc1(0, 0xFFFF, [0, 1, 2, 3] * 4)
        image = decode_sld(sld(frame(layers=[(1, main_layer(blocks=block))]))).image
        self.assertEqual([image.getpixel((x, 4)) for x in range(4, 8)],
                         [(0, 0, 0, 255), (255, 255, 255, 255),
                          (127, 127, 127, 255), (0, 0, 0, 0)])

    def test_bc1_equal_endpoints_also_allow_transparency(self):
        block = bc1(0x07E0, 0x07E0, [3] * 16)
        image = decode_sld(sld(frame(layers=[(1, main_layer(blocks=block))]))).image
        self.assertIsNone(image.getbbox())

    def test_skip_and_draw_commands_cross_block_row_boundaries(self):
        body = main_layer(bounds=(0, 0, 12, 8), commands=((1, 2), (1, 1), (1, 0)),
                          blocks=bc1() + bc1(0x07E0, 0) + bc1(0x001F, 0))
        image = decode_sld(sld(frame(canvas=(12, 8), layers=[(1, body)]))).image
        self.assertEqual(image.getpixel((0, 0)), (0, 0, 0, 0))
        self.assertEqual(image.getpixel((4, 0)), (255, 0, 0, 255))
        self.assertEqual(image.getpixel((8, 0)), (0, 255, 0, 255))
        self.assertEqual(image.getpixel((0, 4)), (0, 0, 0, 0))
        self.assertEqual(image.getpixel((4, 4)), (0, 0, 255, 255))
        self.assertEqual(image.getpixel((8, 4)), (0, 0, 0, 0))

    def test_unmentioned_tail_blocks_remain_transparent(self):
        body = main_layer(bounds=(0, 0, 8, 4), blocks=bc1())
        image = decode_sld(sld(frame(layers=[(1, body)]))).image
        self.assertEqual(image.getpixel((0, 0)), (255, 0, 0, 255))
        self.assertEqual(image.getpixel((4, 0)), (0, 0, 0, 0))

    def test_empty_command_array_produces_transparent_canvas(self):
        image = decode_sld(sld(frame(layers=[(1, main_layer(commands=(), blocks=b""))]))).image
        self.assertIsNone(image.getbbox())

    def test_reuse_flag_in_initial_frame_has_no_previous_dependency(self):
        body = main_layer(bounds=(0, 0, 8, 4), commands=((1, 1),), flags=0x80)
        preview = decode_sld(sld(frame(layers=[(1, body)])))
        self.assertEqual(preview.image.getpixel((0, 0)), (0, 0, 0, 0))
        self.assertEqual(preview.image.getpixel((4, 0)), (255, 0, 0, 255))
        self.assertTrue(any("frame reuse" in text for text in preview.limitations))

    def test_skipped_layers_are_explicitly_reported_as_unsupported(self):
        layers = [(1, main_layer()), (2, b"opaque shadow"), (4, b"outline"),
                  (8, b"damage"), (16, b"playercolor")]
        preview = decode_sld(sld(frame(layers=layers)))
        self.assertEqual(preview.unsupported_layers, ("shadow", "outline", "damage", "playercolor"))
        self.assertEqual(preview.image.getpixel((4, 4)), (255, 0, 0, 255))
        self.assertTrue(any("Present layers omitted" in text for text in preview.limitations))

    def test_extended_headers_and_alignment_relative_to_frame_start(self):
        for header_size in (14, 16, 18, 35, 256):
            with self.subTest(header_size=header_size):
                image = decode_sld(sld(header_size=header_size)).image
                self.assertEqual(image.getpixel((4, 4)), (255, 0, 0, 255))

    def test_later_frames_are_bounded_but_not_decoded(self):
        # Unknown later pixel bytes are deliberately not interpreted or exported.
        later = frame(stored_index=1, layers=[(1, b"opaque later frame")])
        preview = decode_sld(sld(frame(), later))
        self.assertEqual(preview.frame_count, 2)
        self.assertEqual(preview.image.getpixel((4, 4)), (255, 0, 0, 255))

    def test_later_frame_requests_are_rejected(self):
        for requested in (-1, 1, 2, 0.0, True):
            with self.subTest(requested=requested), self.assertRaises(SldDecodeError) as error:
                decode_sld(sld(), frame_index=requested)
            self.assertEqual(error.exception.code, "unsupported_frame")

    def test_initial_frame_with_nonzero_index_is_not_guessed(self):
        with self.assertRaisesRegex(SldDecodeError, "dependencies are unsupported"):
            decode_sld(sld(frame(stored_index=1)))

    def test_all_prefix_truncations_fail_with_decoder_error(self):
        fixture = sld(frame(layers=[(1, main_layer()), (4, b"opaque outline")]),
                      frame(stored_index=1))
        for length in range(len(fixture)):
            with self.subTest(length=length), self.assertRaises(SldDecodeError):
                decode_sld(fixture[:length])

    def test_signature_and_version_rejected(self):
        with self.assertRaisesRegex(SldDecodeError, "signature"):
            decode_sld(b"SMX!" + sld()[4:])
        with self.assertRaisesRegex(SldDecodeError, "version"):
            decode_sld(sld(version=5))

    def test_zero_or_excessive_declared_frames_fail(self):
        for count in (0, 4097, 65535):
            with self.subTest(count=count), self.assertRaises(SldDecodeError):
                decode_sld(change(sld(), 6, "<H", count))

    def test_absent_declared_later_frame_fails(self):
        with self.assertRaisesRegex(SldDecodeError, "frame header"):
            decode_sld(change(sld(), 6, "<H", 2))

    def test_invalid_header_offsets_fail(self):
        for offset in (0, 12, 13, 65535):
            with self.subTest(offset=offset), self.assertRaises(SldDecodeError):
                decode_sld(change(sld(), 10, "<H", offset))

    def test_unknown_and_empty_frame_flags_fail(self):
        for flags in (0, 0x20, 0x21, 0x81):
            with self.subTest(flags=flags), self.assertRaises(SldDecodeError):
                decode_sld(change(sld(), 24, "<B", flags))

    def test_first_frame_needs_a_main_layer(self):
        with self.assertRaisesRegex(SldDecodeError, "no main"):
            decode_sld(sld(frame(layers=[(4, b"outline")])) )

    def test_invalid_canvas_dimensions_fail_before_decoding(self):
        for canvas in ((0, 12), (12, 0), (65535, 12), (4096, 4096)):
            with self.subTest(canvas=canvas), patch("server.sld_preview._decode_main") as decode:
                with self.assertRaises(SldDecodeError):
                    decode_sld(sld(frame(canvas=canvas)))
                decode.assert_not_called()

    def test_layer_extents_must_fit_the_canvas(self):
        for bounds in ((0, 0, 0, 4), (8, 0, 4, 4), (0, 0, 16, 4), (0, 0, 4, 16)):
            with self.subTest(bounds=bounds), self.assertRaisesRegex(SldDecodeError, "bounds"):
                decode_sld(sld(frame(layers=[(1, main_layer(bounds=bounds))])))

    def test_non_aligned_layers_are_explicitly_unsupported(self):
        with self.assertRaisesRegex(SldDecodeError, "non-4x4-aligned"):
            decode_sld(sld(frame(layers=[(1, main_layer(bounds=(0, 0, 5, 4)))])))

    def test_unknown_main_flags_are_not_silently_ignored(self):
        with self.assertRaisesRegex(SldDecodeError, "unsupported flags"):
            decode_sld(sld(frame(layers=[(1, main_layer(flags=1))])))

    def test_skip_and_draw_overflow_fails_before_pixel_allocation(self):
        for commands in (((2, 0),), ((0, 2),), ((1, 1),), ((255, 255),)):
            with self.subTest(commands=commands), patch("server.sld_preview._bc1_rows") as decode:
                with self.assertRaisesRegex(SldDecodeError, "block bounds"):
                    decode_sld(sld(frame(layers=[(1, main_layer(commands=commands))])))
                decode.assert_not_called()

    def test_truncated_command_array_fails(self):
        # command_count is at standard header 16 + frame 12 + length 4 + graphics 10.
        with self.assertRaisesRegex(SldDecodeError, "command array"):
            decode_sld(change(sld(), 42, "<H", 100))

    def test_missing_compressed_blocks_fail(self):
        with self.assertRaisesRegex(SldDecodeError, "BC1 block array"):
            decode_sld(sld(frame(layers=[(1, main_layer(blocks=b""))])))

    def test_extra_compressed_blocks_fail(self):
        with self.assertRaisesRegex(SldDecodeError, "length does not match"):
            decode_sld(sld(frame(layers=[(1, main_layer(blocks=bc1() * 2))])))

    def test_invalid_layer_lengths_fail(self):
        for length in (0, 1, 3, 0xFFFFFFFF):
            with self.subTest(length=length), self.assertRaises(SldDecodeError):
                decode_sld(change(sld(), 28, "<I", length))

    def test_main_layer_header_cannot_read_into_following_layer(self):
        with self.assertRaisesRegex(SldDecodeError, "main layer header"):
            decode_sld(sld(frame(layers=[(1, b""), (4, b"\0" * 100)])))

    def test_nonzero_padding_and_trailing_garbage_fail(self):
        fixture = sld()
        with self.assertRaisesRegex(SldDecodeError, "padding"):
            decode_sld(fixture[:-1] + b"\x01")
        with self.assertRaisesRegex(SldDecodeError, "unexpected bytes"):
            decode_sld(fixture + b"junk")

    def test_all_configurable_budgets_are_enforced(self):
        fixtures = {
            "max_file_bytes": (sld(), len(sld()) - 1),
            "max_dimension": (sld(), 11),
            "max_pixels": (sld(), 143),
            "max_frames": (sld(frame(), frame(stored_index=1)), 1),
            "max_header_bytes": (sld(), 15),
            "max_layer_bytes": (sld(), 25),
            "max_commands": (sld(frame(layers=[(1, main_layer(commands=((0, 0), (0, 1))))])), 1),
        }
        for field, (fixture, maximum) in fixtures.items():
            with self.subTest(field=field), self.assertRaises(SldDecodeError):
                decode_sld(fixture, limits=replace(SldLimits(), **{field: maximum}))

    def test_limits_reject_nonpositive_or_noninteger_values(self):
        for value in (0, -1, 0.5, True, "100"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                SldLimits(max_pixels=value)

    def test_mutable_or_nonbyte_input_is_rejected(self):
        for value in (bytearray(sld()), memoryview(sld()), "SLDX", None):
            with self.subTest(type=type(value)), self.assertRaises(SldDecodeError):
                decode_sld(value)

    def test_deterministic_small_corruption_fuzz_has_no_unhandled_errors(self):
        rng = random.Random(20261005)
        fixture = sld()
        for _ in range(500):
            data = bytearray(fixture)
            for _ in range(rng.randint(1, 3)):
                data[rng.randrange(len(data))] = rng.randrange(256)
            try:
                result = decode_sld(bytes(data), limits=SldLimits(max_dimension=128, max_pixels=16384))
            except SldDecodeError:
                continue
            self.assertEqual(result.image.mode, "RGBA")
            self.assertLessEqual(result.image.width * result.image.height, 16384)


if __name__ == "__main__":
    unittest.main()
