"""Session-only local asset catalog. No arbitrary renderer paths, uploads or exports."""
from __future__ import annotations
from collections import OrderedDict
import hashlib
from contextlib import contextmanager
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import threading
import time
import uuid
from server.private_assets import PrivateTemporaryDirectory, protect_file

MAX_FILE = 64 * 1024 * 1024
MAX_CACHE = 128 * 1024 * 1024
MAX_ENTRIES = 60000
FORMATS = {'sld', 'dds', 'dat', 'smx', 'slp', 'drs'}
ROOT = Path(__file__).resolve().parent.parent

class AssetError(ValueError):
    pass


def unsafe_link(info):
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, 'st_file_attributes', 0) & 0x400)


def open_root_fd(root: Path):
    # O_NOFOLLOW on one absolute path misses ancestor substitutions. Walk every
    # component from the filesystem root using pinned directory descriptors.
    fd = os.open(root.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in root.parts[1:]:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        return fd
    except BaseException:
        os.close(fd)
        raise


def open_windows_file(root: Path, candidate: Path):
    """Validate the final opened handle, closing the lstat/resolve-to-open gap."""
    import ctypes
    from ctypes import wintypes
    import msvcrt
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    create = kernel.CreateFileW
    create.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    create.restype = wintypes.HANDLE
    final = kernel.GetFinalPathNameByHandleW
    final.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
    final.restype = wintypes.DWORD
    close = kernel.CloseHandle
    close.argtypes = [wintypes.HANDLE]
    handle = create(str(candidate), 0x80000000, 7, None, 3, 0x00200000, None)
    if handle == wintypes.HANDLE(-1).value:
        raise OSError('Cannot open selected asset.')
    try:
        buffer = ctypes.create_unicode_buffer(32768)
        length = final(handle, buffer, len(buffer), 0)
        if not length or length >= len(buffer):
            raise AssetError('Cannot verify the opened asset location.')
        opened = buffer.value
        if opened.startswith('\\\\?\\UNC\\'):
            opened = '\\\\' + opened[8:]
        elif opened.startswith('\\\\?\\'):
            opened = opened[4:]
        if not Path(opened).is_relative_to(root):
            raise AssetError('Opened asset moved outside the selected directory.')
        descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        handle = None
        return descriptor
    finally:
        if handle is not None:
            close(handle)


@contextmanager
def scan_directory(root: Path, directory: Path):
    """Do not follow directories swapped for links between discovery and scanning."""
    if os.name == 'posix':
        fd = open_root_fd(root)
        try:
            for part in directory.relative_to(root).parts:
                nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = nxt
            with os.scandir(fd) as children:
                yield children
        finally:
            os.close(fd)
    else:
        candidate = root
        for part in directory.relative_to(root).parts:
            candidate /= part
            if unsafe_link(candidate.lstat()):
                raise OSError('Reparse point rejected.')
        if not directory.resolve().is_relative_to(root):
            raise OSError('Directory moved outside selected root.')
        with os.scandir(directory) as children:
            yield children


def read_selected(root: Path, relative: str) -> bytes:
    parts = Path(relative).parts
    if not parts or Path(relative).is_absolute() or any(p in {'..', '.', ''} for p in parts):
        raise AssetError('Invalid asset reference.')
    if os.name == 'posix':
        fd = open_root_fd(root)
        try:
            for part in parts[:-1]:
                nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = nxt
            file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        finally:
            os.close(fd)
    else:
        candidate = root
        for part in parts:
            candidate /= part
            if unsafe_link(candidate.lstat()):
                raise AssetError('Symbolic links and reparse points are not read.')
        if not candidate.resolve().is_relative_to(root):
            raise AssetError('Asset is outside the selected directory.')
        file_fd = open_windows_file(root, candidate)
    with os.fdopen(file_fd, 'rb') as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_FILE:
            raise AssetError('Asset must be a regular file between 1 byte and 64 MiB.')
        data = file.read(MAX_FILE + 1)
        after = os.fstat(file.fileno())
        if len(data) > MAX_FILE or info.st_mtime_ns != after.st_mtime_ns or info.st_size != after.st_size:
            raise AssetError('Asset changed during reading. Please retry.')
        return data


def run_asset_worker(data: bytes, kind: str, directory: Path) -> tuple[dict, Path]:
    token = uuid.uuid4().hex
    source = directory / f'{token}.input'
    request = directory / f'{token}.json'
    output = directory / f'{token}.response'
    target = directory / f'{token}.png'
    command = [sys.executable, '--asset-worker'] if getattr(sys, 'frozen', False) else [sys.executable, '-m', 'server.asset_worker']
    environment = os.environ.copy()
    environment['PYTHONPATH'] = str(ROOT)
    environment['PYTHONDONTWRITEBYTECODE'] = '1'
    try:
        source.write_bytes(data)
        protect_file(source)
        request.write_text(json.dumps({'kind': kind, 'source': str(source), 'target': str(target)}))
        protect_file(request)
        result = subprocess.run([*command, str(request), str(output)], cwd=directory, env=environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=45 if kind == 'dat' else 15, check=False,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        if result.returncode or not output.is_file() or output.stat().st_size > 32 * 1024 * 1024:
            raise AssetError(f'Decoder stopped or exceeded its resource limit (exit {result.returncode}).')
        value = json.loads(output.read_text('utf-8'))
        if not value.get('ok'):
            raise AssetError(value.get('error', 'Unsupported asset.'))
        if target.is_file():
            protect_file(target)
        return value['result'], target
    except subprocess.TimeoutExpired:
        raise AssetError('Asset decoding exceeded its time limit.') from None
    finally:
        for file in (source, request, output):
            file.unlink(missing_ok=True)
        # Failure paths must not leave partial image buffers in the private cache.
        if sys.exc_info()[0] is not None:
            target.unlink(missing_ok=True)


class NativeAssetStore:
    def __init__(self):
        self.lock = threading.RLock()
        self.directory = PrivateTemporaryDirectory(prefix='mistbridge-assets-')
        self.cache_dir = Path(self.directory.name)
        self.root: Path | None = None
        self.entries: dict[str, dict] = {}
        self.cache: OrderedDict[str, dict] = OrderedDict()
        self.dat = None
        self.dat_id = None
        self.revision = uuid.uuid4().hex
        self.skipped = 0
        self.truncated = False

    def clear(self):
        with self.lock:
            for cached in self.cache.values():
                cached['path'].unlink(missing_ok=True)
            self.cache.clear()
            self.root = None
            self.entries = {}
            self.dat = None
            self.dat_id = None
            self.revision = uuid.uuid4().hex
            self.skipped = 0
            self.truncated = False
            return self.status()

    def mount(self, selected: str):
        with self.lock:
            root = Path(selected)
            try:
                if not root.is_absolute() or unsafe_link(root.lstat()) or not root.is_dir():
                    raise AssetError('Choose a regular directory, not a link or reparse point.')
                root = root.resolve(strict=True)
            except OSError:
                raise AssetError('The selected directory is unavailable.') from None
            entries = {}
            skipped = 0
            walked = 0
            truncated = False
            start = time.monotonic()
            stack = [(root, 0)]
            while stack:
                directory, depth = stack.pop()
                try:
                    with scan_directory(root, directory) as children:
                        for child in children:
                            walked += 1
                            if walked > 120000 or len(entries) >= MAX_ENTRIES or time.monotonic() - start > 15:
                                truncated = True
                                break
                            try:
                                info = child.stat(follow_symlinks=False)
                                if unsafe_link(info):
                                    skipped += 1
                                    continue
                                if stat.S_ISDIR(info.st_mode):
                                    if depth < 12:
                                        stack.append((directory / child.name, depth + 1))
                                    else:
                                        skipped += 1
                                elif stat.S_ISREG(info.st_mode):
                                    suffix = Path(child.name).suffix.lower().lstrip('.')
                                    if suffix not in FORMATS:
                                        continue
                                    if not 0 < info.st_size <= MAX_FILE:
                                        skipped += 1
                                        continue
                                    key = uuid.uuid4().hex
                                    relative = (directory / child.name).relative_to(root).as_posix()
                                    entries[key] = {'id': key, 'relativePath': relative, 'name': child.name,
                                                    'kind': suffix, 'bytes': info.st_size,
                                                    'previewable': suffix in {'dds', 'sld'}}
                            except OSError:
                                skipped += 1
                except OSError:
                    skipped += 1
                if truncated:
                    break
            # Replace atomically only after a successful scan. Cancelled selection never gets here.
            self.clear()
            self.root, self.entries, self.skipped, self.truncated = root, entries, skipped, truncated
            return self.status()

    def status(self):
        with self.lock:
            return self._status()

    def _status(self):
        counts = {kind: sum(e['kind'] == kind for e in self.entries.values()) for kind in sorted(FORMATS)}
        return {'mounted': self.root is not None, 'revision': self.revision, 'counts': counts,
                'total': len(self.entries), 'skipped': self.skipped, 'truncated': self.truncated,
                'layout': 'aoe2de-candidate' if any(e['relativePath'].lower().endswith('resources/_common/dat/empires2_x2_p1.dat') for e in self.entries.values()) else 'selected-resource-folder',
                'dat': None if self.dat is None else {'id': self.dat_id, 'version': self.dat['version'],
                    'sha256': self.dat['sha256'], 'civilizations': [{'id': c['id'], 'name': c['name']} for c in self.dat['civilizations']]},
                'storage': 'private-session-cache', 'gameTested': False, 'cacheBytes': sum(c['bytes'] for c in self.cache.values())}

    def catalog(self, query='', kind='', offset=0):
        with self.lock:
            return self._catalog(query, kind, offset)

    def _catalog(self, query='', kind='', offset=0):
        values = sorted((e for e in self.entries.values() if (not kind or e['kind'] == kind) and query.lower() in e['relativePath'].lower()), key=lambda e: e['relativePath'].lower())
        return {'revision': self.revision, 'total': len(values), 'offset': offset, 'entries': values[offset:offset + 100]}

    def _read(self, key):
        if not self.root or key not in self.entries:
            raise AssetError('This asset reference has expired. Select the directory again.')
        entry = self.entries[key]
        try:
            data = read_selected(self.root, entry['relativePath'])
        except OSError:
            raise AssetError('The file is missing, unreadable, or is now a link. Select the directory again.') from None
        return entry, data

    def decode(self, key):
        with self.lock:
            entry, data = self._read(key)
            if entry['kind'] not in {'dds', 'sld'}:
                raise AssetError('This format is indexed only. Choose a DDS texture or an SLD sprite.')
            digest = hashlib.sha256(data).hexdigest()
            cache_key = digest + '-' + entry['kind'] + '-v1'
            if cache_key in self.cache:
                value = self.cache.pop(cache_key)
                self.cache[cache_key] = value
            else:
                meta, target = run_asset_worker(data, entry['kind'], self.cache_dir)
                size = target.stat().st_size
                if size > MAX_CACHE:
                    target.unlink(missing_ok=True)
                    raise AssetError('Decoded image exceeds cache size.')
                while self.cache and sum(c['bytes'] for c in self.cache.values()) + size > MAX_CACHE:
                    _, stale = self.cache.popitem(last=False)
                    stale['path'].unlink(missing_ok=True)
                value = {'path': target, 'bytes': size, 'meta': meta, 'token': uuid.uuid4().hex}
                self.cache[cache_key] = value
            return {**value['meta'], 'assetId': key, 'imageUrl': '/api/assets/image/' + value['token'], 'revision': self.revision}

    def image(self, token):
        with self.lock:
            for cached in self.cache.values():
                if cached['token'] == token:
                    # Return bytes under lock so an eviction cannot race FileResponse.
                    return cached['path'].read_bytes()
            raise AssetError('Preview expired. Decode the asset again.')

    def load_dat(self, key):
        with self.lock:
            entry, data = self._read(key)
            if entry['kind'] != 'dat':
                raise AssetError('Choose a DE DAT file.')
            self.dat, _ = run_asset_worker(data, 'dat', self.cache_dir)
            self.dat_id = key
            return self.status()

    def bindings(self, civilization, ids):
        with self.lock:
            if self.dat is None:
                raise AssetError('Read a supported DAT before resolving unit graphics.')
            civ = next((c for c in self.dat['civilizations'] if c['id'] == civilization), None)
            if not civ:
                raise AssetError('Unknown civilization in this DAT.')
            by_name = {}
            for entry in self.entries.values():
                if entry['kind'] == 'sld':
                    by_name.setdefault(entry['name'].casefold(), []).append(entry)
            bindings = []
            for unit_id in ids:
                unit = civ['units'].get(str(unit_id))
                graphic = self.dat['graphics'].get(str(unit['graphicId'])) if unit else None
                result = {'unitId': unit_id, 'civilizationId': civilization, 'resolved': False}
                if not unit or not graphic:
                    result['reason'] = 'DAT has no standing graphic for this civilization and unit.'
                else:
                    filename = graphic['filename']
                    candidates = by_name.get((filename if filename.lower().endswith('.sld') else filename + '.sld').casefold(), []) if '/' not in filename and '\\' not in filename else []
                    result.update({'graphicId': unit['graphicId'], 'filename': filename, 'footprint': unit['footprint'], 'frameCount': graphic['frameCount'], 'angleCount': graphic['angleCount'], 'childGraphics': graphic['childGraphics'], 'tileWidth': self.dat['tileWidth']})
                    if len(candidates) == 1:
                        result.update({'resolved': True, 'assetId': candidates[0]['id']})
                    else:
                        result['reason'] = 'Multiple matching graphics; choose a single resource root.' if candidates else 'Referenced SLD file was not found in this directory.'
                bindings.append(result)
            return {'revision': self.revision, 'bindings': bindings,
                    'limitations': ['standing-graphic-frame-0', 'manual-preview-civilization', 'no-age-upgrades', 'no-child-graphics', 'no-direction-selection']}
