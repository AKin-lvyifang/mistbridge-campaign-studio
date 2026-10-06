# SLD static decoder: source, license and validation boundary

Implemented and checked on 2026-10-05. No original game or third-party mod
resources were accessed, downloaded, embedded or redistributed. All SLD test
data is constructed programmatically from tiny synthetic BC1 blocks.

## Provenance and license

`server/sld_preview.py` is a modified, deliberately reduced pure-Python
implementation informed by the openage SLD parser and reverse-engineered
format documentation. Its control flow, bounded-reader checks, data classes,
Pillow output and tests were written for this application; it is not the
upstream Cython decoder, nor a drop-in replacement for it.

Upstream source copyright: **Copyright 2022-2026 the openage authors**.
Upstream is GPL-3.0-or-later. This modified implementation and its new material
are distributed under **GPL-3.0-only**, exercising upstream's GPL version 3
option to match this repository. The full GPL version 3 text is in `LICENSE`.
Copyright 2026 AoE2 Campaign Studio contributors applies to the modifications.
This notice and the source header must accompany the modified decoder.

The exact upstream revision used is
`3da21ab486154432a459db1a10534cc0e344db95` (2026-10-03):

- [SLD parser](https://github.com/SFTtech/openage/blob/3da21ab486154432a459db1a10534cc0e344db95/openage/convert/value_object/read/media/sld.pyx)
- [SLD format documentation](https://github.com/SFTtech/openage/blob/3da21ab486154432a459db1a10534cc0e344db95/doc/media/sld-files.md)
- [Upstream licensing and author information](https://github.com/SFTtech/openage/blob/3da21ab486154432a459db1a10534cc0e344db95/copying.md)

Verified upstream SHA-256 values:

- `sld.pyx`: `e495fe5e7befe65455173ccf98fe6a15a187a0626353b34f73d294077390dd6a`
- `sld-files.md`: `275bbc8907b65fdcfdccee462eee136d9b59509648f36533586dd09f37de0967`
- `copying.md`: `a78445a8dd1ec08393d3d27a71fc0e2fcba746916fa99e67606233bf1c0100dd`

Upstream source, rather than the older format table alone, establishes that
the unsigned 16-bit field at byte 10 is the first frame's offset. It also
establishes the 0x01/02/04/08/10 layer bits and alignment relative to that
offset. The frame hotspot is read as signed 16-bit per the format's field
description. BC1 RGB565 endpoints use bit replication to span 0–255 instead
of upstream's simple multiply-by-8/multiply-by-4 expansion.

## Exact supported scope

- `SLDX`, version 4; an explicit bounded initial-frame header offset.
- First frame only, with stored index 0, decoded into a full-canvas RGBA image.
- Main-layer BC1 blocks, block skip/draw commands, layer offsets and signed
  canvas hotspot coordinates. BC1 transparent pixels and skipped areas stay
  transparent. Unmentioned trailing blocks are transparent.
- Main-layer widths and heights must be positive multiples of four and must
  fit within the canvas. Canvas dimensions themselves need not be multiples
  of four. Unknown layout or main-layer flag bits produce errors.
- A first-frame 0x80 reuse flag is allowed, as in upstream: there is no prior
  frame to copy from, so skipped blocks are transparent. This does not mean
  later-frame dependencies are supported.

## Explicitly unsupported

Animation, later-frame selection or reuse, angle selection, mirroring,
shadow compositing/BC4, outlines, damage, and player-color rendering are not
implemented. Present omitted layers are listed in result metadata. Unknown
SLD versions or unsupported layouts are refused rather than guessed.

All declared frame and layer envelopes, including alignment padding, are
bounds-checked. Later frame pixels and unsupported layer payloads are not
decoded or semantically validated. A successful first-frame preview must not
be described as a full-file compatibility test or game-exact rendering.

## Resource limits and tests

Default limits are 64 MiB file size, 4,096 pixels per dimension, 4,194,304
canvas pixels, 4,096 frames, 4 KiB header, 32 MiB per layer and 65,535 main
commands. File, dimensions, layer envelopes and command spans are validated
before allocating pixel output. Draw/skip commands cannot address outside
the main image. Decoding work is bounded by main image blocks; no previous
frames are allocated. Callers must bound their file reads and run decoding
in an isolated worker with a wall-clock limit and a total cache budget.

Run the synthetic suite with:

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_sld_preview.py' -v
```

Tests cover BC1's two modes, selector order, transparency, offsets, signed
anchors, block-row transitions, explicit omissions, header variations,
declared later frames, prefix truncations, corrupted length/command fields,
all budgets, and deterministic bounded corruption fuzzing. They establish
parser behavior on these fixtures only. Actual game and licensed mod samples
remain necessary for visual compatibility verification.
