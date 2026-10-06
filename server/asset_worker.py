"""One-shot bounded asset decoders. Inputs are private snapshots, never game paths."""
from __future__ import annotations
import hashlib
import io
import json
import math
import os
from pathlib import Path
import struct
import sys
import zlib

MAX_FILE = 64 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024
MAX_PIXELS = 16 * 1024 * 1024
# Enum members include older layouts that the dependency does not promise to parse.
SUPPORTED_DAT_VERSIONS = {'VER 7.7', 'VER 7.8', 'VER 8.4', 'VER 8.8', 'VER 8.9'}


def decode_dds(data: bytes):
    from PIL import Image
    if len(data) < 128 or data[:4] != b'DDS ' or struct.unpack_from('<I', data, 4)[0] != 124:
        raise ValueError('Invalid or truncated DDS header.')
    height, width = struct.unpack_from('<II', data, 12)
    if not width or not height or width > 8192 or height > 8192 or width * height > MAX_PIXELS:
        raise ValueError('DDS dimensions exceed the preview limit (8192 per side, 16M pixels).')
    # Cubemaps/volume textures are not a flat terrain image.
    if struct.unpack_from('<I', data, 112)[0] & 0x20FE00:
        raise ValueError('DDS cubemaps and volumes are not supported.')
    if data[84:88] == b'DX10':
        if len(data) < 148:
            raise ValueError('Truncated DDS DX10 header.')
        _, dimension, misc, array_size, _ = struct.unpack_from('<5I', data, 128)
        if dimension != 3 or array_size != 1 or misc & 4:
            raise ValueError('Only a single 2D DDS texture is supported.')
    with Image.open(io.BytesIO(data), formats=['DDS']) as source:
        image = source.convert('RGBA')
    return image, {'kind': 'dds', 'width': width, 'height': height, 'hotspot': [0, 0],
                   'frameCount': 1, 'limitations': ['flat-texture-only', 'no-terrain-blending', 'no-water-animation']}


def bounded_dat(data: bytes):
    decoder = zlib.decompressobj(-15)
    raw = decoder.decompress(data, MAX_EXPANDED + 1)
    if len(raw) > MAX_EXPANDED or decoder.unconsumed_tail:
        raise ValueError('DAT expands beyond the 256 MiB limit.')
    if not decoder.eof or decoder.unused_data:
        raise ValueError('Truncated or trailing DAT compression stream.')
    version = raw[:8].rstrip(b'\0').decode('ascii', errors='replace')
    if version not in SUPPORTED_DAT_VERSIONS:
        raise ValueError('Unsupported DAT version. genieutils-py 0.1.2 supports this preview allowlist: VER 7.7, 7.8, 8.4, 8.8 and 8.9.')
    from genieutils.common import ByteHandler
    from genieutils.datfile import DatFile

    class CheckedHandler(ByteHandler):
        budget = 800000
        def consume_range(self, length):
            if not isinstance(length, int) or length < 0 or self.offset + length > len(self.content):
                raise ValueError('DAT structure is truncated or invalid.')
            return super().consume_range(length)
        def check(self, size):
            if not isinstance(size, int) or not 0 <= size <= 65536:
                raise ValueError('DAT array exceeds the supported count.')
            self.budget -= size
            if self.budget < 0:
                raise ValueError('DAT structure exceeds the preview budget.')
        def read_class_array(self, cls, size):
            self.check(size)
            return super().read_class_array(cls, size)
        def read_class_array_with_pointers(self, cls, size, pointers):
            self.check(size)
            return super().read_class_array_with_pointers(cls, size, pointers)
        def read_class_array_with_param(self, cls, size, count):
            self.check(size)
            return super().read_class_array_with_param(cls, size, count)
        def read_int_8_array(self, size):
            self.check(size)
            return super().read_int_8_array(size)
        def read_int_16_array(self, size):
            self.check(size)
            return super().read_int_16_array(size)
        def read_int_32_array(self, size):
            self.check(size)
            return super().read_int_32_array(size)
        def read_float_array(self, size):
            self.check(size)
            return super().read_float_array(size)
    handler = CheckedHandler(memoryview(raw))
    dat = DatFile.from_bytes(handler)
    if handler.offset != len(raw):
        raise ValueError('DAT contains unparsed trailing fields; this build is not supported.')
    return dat


def summarize_dat(dat):
    def finite(n, default=1):
        return round(n, 5) if isinstance(n, (int, float)) and math.isfinite(n) and abs(n) <= 100000 else default
    return {
        'version': dat.version,
        'tileWidth': max(1, dat.terrain_block.tile_width),
        'civilizations': [{'id': i, 'name': civ.name[:100], 'units': {
            str(j): {'graphicId': unit.standing_graphic[0], 'name': unit.name[:100],
                     'footprint': [finite(unit.collision_size_x * 2), finite(unit.collision_size_y * 2)]}
            for j, unit in enumerate(civ.units) if unit is not None}}
            for i, civ in enumerate(dat.civs)],
        'graphics': {str(i): {'filename': graphic.file_name[:240], 'frameCount': graphic.frame_count,
                            'angleCount': graphic.angle_count, 'childGraphics': len(graphic.deltas)}
                     for i, graphic in enumerate(dat.graphics) if graphic is not None},
        'terrains': [{'id': i, 'name': t.name[:100], 'textureName': t.name_2[:240],
                      'replacementId': t.terrain_to_draw, 'blendPriority': t.blend_priority,
                      'blendType': t.blend_type, 'overlayMask': t.overlay_mask_name[:240]}
                     for i, t in enumerate(dat.terrain_block.terrains)]}


def work(request):
    path = Path(request['source'])
    if path.stat().st_size > MAX_FILE:
        raise ValueError('Asset exceeds the 64 MiB file limit.')
    data = path.read_bytes()
    if len(data) > MAX_FILE:
        raise ValueError('Asset exceeds the 64 MiB file limit.')
    if request['kind'] == 'dat':
        result = summarize_dat(bounded_dat(data))
    elif request['kind'] == 'dds':
        image, result = decode_dds(data)
        image.save(request['target'], 'PNG')
    elif request['kind'] == 'sld':
        from server.sld_preview import decode_sld
        preview = decode_sld(data)
        preview.image.save(request['target'], 'PNG')
        result = {'kind': 'sld', 'width': preview.image.width, 'height': preview.image.height,
                  'hotspot': list(preview.hotspot), 'frameCount': preview.frame_count,
                  'limitations': list(preview.limitations), 'frameIndex': 0}
    else:
        raise ValueError('This format is indexed but not decoded. Supported: DDS, SLD frame 0, DE DAT.')
    result['sha256'] = hashlib.sha256(data).hexdigest()
    return result


def main():
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024 * 1024,) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, (40, 45))
        resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024,) * 2)
    except ImportError:
        pass  # Windows uses the parent deadline and parser/image allocation bounds.
    response = Path(sys.argv[2])
    try:
        request = json.loads(Path(sys.argv[1]).read_text('utf-8'))
        result = {'ok': True, 'result': work(request)}
    except (ValueError, NotImplementedError) as exc:
        # Decoder errors contain only our known format fields, never source paths.
        result = {'ok': False, 'error': str(exc)[:350]}
    except Exception:
        result = {'ok': False, 'error': 'Asset decoding failed. This file or format variant is unsupported.'}
    response.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), 'utf-8')

if __name__ == '__main__':
    main()
