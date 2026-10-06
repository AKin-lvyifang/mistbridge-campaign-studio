# SPDX-License-Identifier: GPL-3.0-only
# Copyright 2022-2026 the openage authors. See docs/SLD-DECODER-NOTICE.md.
# Copyright 2026 AoE2 Campaign Studio contributors.
# Modified implementation: bounded pure-Python first-frame preview, 2026-10-05.
"""A deliberately limited SLD v4 main-layer decoder.

The format and command layout follow the openage SLD reader/documentation;
this is not a complete port. Only the first frame's BC1 main image is decoded.
Other layer payloads are bounded and skipped, never presented as supported.
No game data is included. See docs/SLD-DECODER-NOTICE.md for provenance.

Callers must bound file reads before creating ``data``, and should run asset
decoding in their isolated worker with a wall-clock limit. This module opens
no files and performs no network access.
"""
from __future__ import annotations

from dataclasses import dataclass, fields
from struct import Struct

from PIL import Image


DECODER_VERSION = "sld-static-bc1-v1"
_HEADER = Struct("<4s5H")
_FRAME = Struct("<HHhhBBH")  # Canvas anchors are signed, unlike the dimensions.
_LENGTH = Struct("<I")
_GRAPHICS = Struct("<4H2B")
_COUNT = Struct("<H")
_BC1 = Struct("<HHI")
_LAYERS = ((0x01, "main"), (0x02, "shadow"), (0x04, "outline"),
           (0x08, "damage"), (0x10, "playercolor"))


class SldDecodeError(ValueError):
    """Invalid, over-budget, or intentionally unsupported SLD input."""

    def __init__(self, message: str, *, code: str = "invalid_sld") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class SldLimits:
    """Budgets checked before allocations or data-dependent decoding loops."""

    max_file_bytes: int = 64 * 1024 * 1024
    max_dimension: int = 4096
    max_pixels: int = 4 * 1024 * 1024
    max_frames: int = 4096
    max_header_bytes: int = 4096
    max_layer_bytes: int = 32 * 1024 * 1024
    max_commands: int = 65535

    def __post_init__(self) -> None:
        for field in fields(self):
            value = getattr(self, field.name)
            if type(value) is not int or value <= 0:
                raise ValueError(f"{field.name} must be a positive integer")


@dataclass(frozen=True)
class SldPreview:
    image: Image.Image
    hotspot: tuple[int, int]
    source_canvas_size: tuple[int, int]
    frame_index: int
    frame_count: int
    layer_types: tuple[str, ...]
    unsupported_layers: tuple[str, ...]
    limitations: tuple[str, ...]
    decoder_version: str = DECODER_VERSION


def _require(data: bytes, offset: int, count: int, end: int, label: str) -> None:
    # All bounds are checked explicitly rather than exposing struct/index errors.
    if offset < 0 or count < 0 or end > len(data) or offset > end - count:
        raise SldDecodeError(f"Truncated SLD {label}", code="truncated")


def _dimensions(width: int, height: int, limits: SldLimits) -> None:
    if width <= 0 or height <= 0:
        raise SldDecodeError("SLD canvas dimensions must be positive")
    if width > limits.max_dimension or height > limits.max_dimension:
        raise SldDecodeError("SLD dimension limit exceeded", code="limit_exceeded")
    if width * height > limits.max_pixels:
        raise SldDecodeError("SLD pixel limit exceeded", code="limit_exceeded")


def _rgb565(color: int) -> tuple[int, int, int]:
    # Replicate high bits to use the complete 8-bit range (white maps to 255).
    r, g, b = (color >> 11) & 31, (color >> 5) & 63, color & 31
    return (r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)


def _bc1_rows(data: bytes, offset: int) -> tuple[bytes, ...]:
    c0, c1, indices = _BC1.unpack_from(data, offset)
    rgb0, rgb1 = _rgb565(c0), _rgb565(c1)
    palette = [bytes((*rgb0, 255)), bytes((*rgb1, 255))]
    if c0 > c1:
        palette.append(bytes((*((2 * a + b) // 3 for a, b in zip(rgb0, rgb1)), 255)))
        palette.append(bytes((*((a + 2 * b) // 3 for a, b in zip(rgb0, rgb1)), 255)))
    else:
        palette.append(bytes((*((a + b) // 2 for a, b in zip(rgb0, rgb1)), 255)))
        palette.append(b"\x00\x00\x00\x00")
    return tuple(b"".join(palette[(indices >> (2 * (row * 4 + col))) & 3]
                          for col in range(4)) for row in range(4))


def _decode_main(data: bytes, start: int, end: int, canvas: tuple[int, int],
                 limits: SldLimits) -> Image.Image:
    cursor = start + _LENGTH.size
    _require(data, cursor, _GRAPHICS.size + _COUNT.size, end, "main layer header")
    x1, y1, x2, y2, flags, _ = _GRAPHICS.unpack_from(data, cursor)
    cursor += _GRAPHICS.size
    width, height = x2 - x1, y2 - y1
    if width <= 0 or height <= 0 or x2 > canvas[0] or y2 > canvas[1]:
        raise SldDecodeError("SLD main layer bounds are outside the canvas")
    if width % 4 or height % 4:
        raise SldDecodeError("SLD non-4x4-aligned main layers are unsupported",
                             code="unsupported_layout")
    if flags & ~0x80:
        raise SldDecodeError("SLD main layer has unsupported flags", code="unsupported_flags")
    # 0x80 is permitted on frame zero: there is no preceding frame, so skipped
    # blocks are transparent. Later frame requests are rejected by decode_sld.
    commands = _COUNT.unpack_from(data, cursor)[0]
    cursor += _COUNT.size
    if commands > limits.max_commands:
        raise SldDecodeError("SLD command limit exceeded", code="limit_exceeded")
    _require(data, cursor, commands * 2, end, "command array")
    command_start = cursor
    block_start = cursor + commands * 2
    block_capacity = (width // 4) * (height // 4)
    block_count = drawn = 0
    for index in range(commands):
        skip, draw = data[cursor + index * 2:cursor + index * 2 + 2]
        block_count += skip + draw
        drawn += draw
        if block_count > block_capacity:
            raise SldDecodeError("SLD commands exceed main layer block bounds")
    _require(data, block_start, drawn * _BC1.size, end, "BC1 block array")
    if block_start + drawn * _BC1.size != end:
        raise SldDecodeError("SLD main layer length does not match its command data")

    # One bounded allocation, with transparent skipped and unmentioned blocks.
    rgba = bytearray(canvas[0] * canvas[1] * 4)
    stride = canvas[0] * 4
    blocks_per_row = width // 4
    block_index = 0
    compressed_offset = block_start
    for index in range(commands):
        skip, draw = data[command_start + index * 2:command_start + index * 2 + 2]
        block_index += skip
        for _ in range(draw):
            target_x = x1 + (block_index % blocks_per_row) * 4
            target_y = y1 + (block_index // blocks_per_row) * 4
            for row, pixels in enumerate(_bc1_rows(data, compressed_offset)):
                target = (target_y + row) * stride + target_x * 4
                rgba[target:target + 16] = pixels
            compressed_offset += _BC1.size
            block_index += 1
    return Image.frombytes("RGBA", canvas, bytes(rgba))


def decode_sld(data: bytes, *, frame_index: int = 0,
               limits: SldLimits | None = None) -> SldPreview:
    """Decode the first main BC1 frame to a full-canvas RGBA Pillow image.

    All declared frame/layer envelopes are checked so a missing later frame or
    truncated skipped layer cannot make a malformed file appear fully valid.
    Later pixel commands and unsupported layer contents are *not* validated.
    Their decoding, animation, frame reuse, and game-exact rendering remain
    unsupported. Negative/outside-canvas hotspots are retained, not clamped.
    """
    limits = limits if limits is not None else SldLimits()
    if type(data) is not bytes:
        raise SldDecodeError("SLD input must be immutable bytes", code="invalid_input")
    if type(frame_index) is not int or frame_index != 0:
        raise SldDecodeError("Only SLD frame 0 is supported; frame reuse is not decoded",
                             code="unsupported_frame")
    if len(data) > limits.max_file_bytes:
        raise SldDecodeError("SLD file byte limit exceeded", code="limit_exceeded")
    _require(data, 0, _HEADER.size, len(data), "file header")
    signature, version, frame_count, _, header_size, _ = _HEADER.unpack_from(data)
    if signature != b"SLDX":
        raise SldDecodeError("SLD signature must be SLDX", code="invalid_signature")
    if version != 4:
        raise SldDecodeError(f"Unsupported SLD version {version}; expected 4",
                             code="unsupported_version")
    if not frame_count or frame_count > limits.max_frames:
        raise SldDecodeError("SLD frame count is zero or exceeds the limit",
                             code="limit_exceeded")
    if header_size < _HEADER.size or header_size > limits.max_header_bytes:
        raise SldDecodeError("SLD header offset is invalid or exceeds the limit")
    _require(data, 0, header_size, len(data), "extended header")
    cursor = header_size
    first_main: tuple[int, int] | None = None
    canvas = hotspot = (0, 0)
    first_layers: tuple[str, ...] = ()
    # This loop is bounded by max_frames, with at most five layer reads per frame.
    for ordinal in range(frame_count):
        _require(data, cursor, _FRAME.size, len(data), "frame header")
        width, height, hx, hy, frame_type, _, stored_index = _FRAME.unpack_from(data, cursor)
        cursor += _FRAME.size
        _dimensions(width, height, limits)
        if frame_type & ~0x1F or not frame_type:
            raise SldDecodeError("SLD frame has unknown or empty layer flags",
                                 code="unsupported_flags")
        if ordinal == 0:
            if stored_index != 0:
                raise SldDecodeError("SLD initial frame is not frame 0; dependencies are unsupported",
                                     code="unsupported_frame")
            if not frame_type & 0x01:
                raise SldDecodeError("SLD first frame has no main graphics layer")
            canvas, hotspot = (width, height), (hx, hy)
            first_layers = tuple(name for bit, name in _LAYERS if frame_type & bit)
        for bit, name in _LAYERS:
            if not frame_type & bit:
                continue
            _require(data, cursor, _LENGTH.size, len(data), f"{name} layer length")
            length = _LENGTH.unpack_from(data, cursor)[0]
            if length < _LENGTH.size:
                raise SldDecodeError(f"SLD {name} layer length is smaller than its header")
            if length > limits.max_layer_bytes:
                raise SldDecodeError("SLD layer byte limit exceeded", code="limit_exceeded")
            _require(data, cursor, length, len(data), f"{name} layer")
            end = cursor + length
            if ordinal == 0 and name == "main":
                first_main = (cursor, end)
            # Alignment is relative to the first frame header, even if an
            # extended file header itself does not end on a four-byte boundary.
            padded_end = end + (-(end - header_size) % 4)
            _require(data, end, padded_end - end, len(data), "layer alignment padding")
            if any(data[end:padded_end]):
                raise SldDecodeError("SLD layer alignment padding must be zero")
            cursor = padded_end
    if cursor != len(data):
        raise SldDecodeError("SLD has unexpected bytes after its declared frames")
    if first_main is None:  # Defensive: the frame flag check above requires it.
        raise SldDecodeError("SLD first frame has no decodable main graphics")
    image = _decode_main(data, *first_main, canvas, limits)
    unsupported = tuple(name for name in first_layers if name != "main")
    limitations = (
        "Static frame 0 main BC1 image only; animation and frame reuse are unsupported.",
        "Shadow, outline, damage and player-color rendering are unsupported.",
        "Skipped layers and later frames are checked for boundaries, not decoded.",
        "Synthetic fixtures verified; actual game-resource appearance is unverified.",
    )
    if unsupported:
        limitations += ("Present layers omitted: " + ", ".join(unsupported) + ".",)
    return SldPreview(image=image, hotspot=hotspot, source_canvas_size=canvas,
                      frame_index=0, frame_count=frame_count, layer_types=first_layers,
                      unsupported_layers=unsupported, limitations=limitations)
