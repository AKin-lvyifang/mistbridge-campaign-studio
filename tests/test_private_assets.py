"""Permission tests use mode bits on POSIX and the stored DACL on Windows."""
import ctypes
import gc
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
from types import SimpleNamespace

import pytest

from server import private_assets as private


USER = 'S-1-5-21-1-2-3-1001'
SYSTEM = 'S-1-5-18'
FULL = 0x001F01FF
DIRECTORY_ACES = ((0, 3, FULL, USER), (0, 3, FULL, SYSTEM))


def test_private_directory_and_files_cleanup(tmp_path):
    directory = private.PrivateTemporaryDirectory(dir=tmp_path)
    path = Path(directory.name)
    private.assert_private_directory(path)
    image = path / 'synthetic.png'
    image.write_bytes(b'synthetic pixels only')
    private.protect_file(image)
    private.assert_private_file(image)
    assert image.read_bytes() == b'synthetic pixels only'
    directory.cleanup()
    directory.cleanup()
    assert not path.exists()


def test_context_and_finalizer_cleanup(tmp_path):
    with private.PrivateTemporaryDirectory(dir=tmp_path) as name:
        assert Path(name).is_dir()
    assert not Path(name).exists()
    directory = private.PrivateTemporaryDirectory(dir=tmp_path)
    name = directory.name
    del directory
    gc.collect()
    assert not Path(name).exists()


@pytest.mark.parametrize('prefix', ['', '../escape', 'nested/path', 'nested\\path', '\0'])
def test_prefix_cannot_escape_cache_parent(tmp_path, prefix):
    with pytest.raises(ValueError):
        private.PrivateTemporaryDirectory(prefix=prefix, dir=tmp_path)
    assert list(tmp_path.iterdir()) == []


@pytest.mark.skipif(os.name != 'posix', reason='POSIX modes, Windows covered by real DACL tests')
def test_posix_permissions_do_not_depend_on_umask(tmp_path):
    previous = os.umask(0)
    try:
        with private.PrivateTemporaryDirectory(dir=tmp_path) as name:
            path = Path(name)
            assert stat.S_IMODE(path.stat().st_mode) == 0o700
            file = path / 'input'
            file.write_bytes(b'synthetic input')
            private.protect_file(file)
            assert stat.S_IMODE(file.stat().st_mode) == 0o600
    finally:
        os.umask(previous)


@pytest.mark.skipif(os.name != 'posix', reason='Symlink creation requires extra Windows privilege')
def test_permission_helpers_refuse_symlinks(tmp_path):
    source = tmp_path / 'source'
    source.write_bytes(b'do not touch')
    source.chmod(0o640)
    link = tmp_path / 'link'
    link.symlink_to(source)
    with pytest.raises(PermissionError, match='links'):
        private.protect_file(link)
    assert stat.S_IMODE(source.stat().st_mode) == 0o640


def test_windows_sddl_is_protected_and_has_only_user_and_system():
    assert private._private_sddl(USER) == f'O:{USER}D:P(A;OICI;FA;;;{SYSTEM})(A;OICI;FA;;;{USER})'
    assert private._private_sddl(SYSTEM) == f'O:{SYSTEM}D:P(A;OICI;FA;;;{SYSTEM})'


def test_windows_acl_policy_accepts_exact_directory_and_file_access():
    private._validate_acl(private._Acl(USER, True, DIRECTORY_ACES), USER, directory=True)
    for flags in (0, 0x10):
        entries = tuple((kind, flags, mask, sid) for kind, _, mask, sid in DIRECTORY_ACES)
        private._validate_acl(private._Acl(USER, False, entries), USER, directory=False)
    private._validate_acl(private._Acl(SYSTEM, True, ((0, 3, FULL, SYSTEM),)), SYSTEM, directory=True)


@pytest.mark.parametrize('acl', [
    private._Acl(USER, True, None),
    private._Acl(USER, True, ()),
    private._Acl(USER, False, DIRECTORY_ACES),
    private._Acl('S-1-5-32-544', True, DIRECTORY_ACES),
    private._Acl(USER, True, DIRECTORY_ACES + ((0, 3, FULL, 'S-1-1-0'),)),
    private._Acl(USER, True, ((0, 3, FULL, USER), (0, 3, FULL, 'S-1-1-0'))),
    private._Acl(USER, True, ((0, 3, FULL, USER), (0, 3, FULL, USER))),
    private._Acl(USER, True, ((1, 3, FULL, USER), (0, 3, FULL, SYSTEM))),
    private._Acl(USER, True, ((0, 3, 0x10000000, USER), (0, 3, FULL, SYSTEM))),
    private._Acl(USER, True, ((0, 0, FULL, USER), (0, 3, FULL, SYSTEM))),
    private._Acl(USER, True, ((0, 0x13, FULL, USER), (0, 3, FULL, SYSTEM))),
    private._Acl(USER, True, ((0, 0x0B, FULL, USER), (0, 3, FULL, SYSTEM))),
])
def test_windows_acl_policy_rejects_null_broad_inherited_or_incomplete_acl(acl):
    with pytest.raises(PermissionError):
        private._validate_acl(acl, USER, directory=True)


def test_windows_file_policy_rejects_inherit_only_ace():
    entries = ((0, 0x18, FULL, USER), (0, 0x10, FULL, SYSTEM))
    with pytest.raises(PermissionError):
        private._validate_acl(private._Acl(USER, False, entries), USER, directory=False)


def test_windows_creation_failure_is_not_downgraded(tmp_path, monkeypatch):
    class FailedSecurity:
        def create_directory(self, path):
            raise PermissionError('Security descriptor setup failed')

    monkeypatch.setattr(private, '_WindowsSecurity', FailedSecurity)
    with pytest.raises(PermissionError, match='setup failed'):
        private._make_windows_directory(tmp_path, 'cache-')
    assert list(tmp_path.iterdir()) == []


def test_windows_pin_failure_is_fail_closed_before_readback(tmp_path, monkeypatch):
    calls = []

    class FailedSecurity:
        def create_directory(self, path):
            calls.append('create')
            path.mkdir()

        def pin_directory(self, path):
            calls.append('pin')
            raise PermissionError('Cannot pin private cache root')

        def verify(self, path, *, directory):
            pytest.fail('ACL verification must not run without a pinned root')

    monkeypatch.setattr(private, '_WindowsSecurity', FailedSecurity)
    with pytest.raises(PermissionError, match='Cannot pin'):
        private._make_windows_directory(tmp_path, 'cache-')
    assert calls == ['create', 'pin']
    assert list(tmp_path.iterdir()) == []


def test_windows_failed_readback_removes_empty_directory(tmp_path, monkeypatch):
    calls = []

    class FailedSecurity:
        def create_directory(self, path):
            calls.append('create')
            path.mkdir()

        def pin_directory(self, path):
            calls.append('pin')
            return SimpleNamespace(close=lambda: calls.append('close'))

        def verify(self, path, *, directory):
            calls.append('verify')
            assert directory and path.is_dir() and list(path.iterdir()) == []
            raise PermissionError('Filesystem did not preserve the DACL')

    monkeypatch.setattr(private, '_WindowsSecurity', FailedSecurity)
    with pytest.raises(PermissionError, match='preserve the DACL'):
        private._make_windows_directory(tmp_path, 'cache-')
    assert calls == ['create', 'pin', 'verify', 'close']
    assert list(tmp_path.iterdir()) == []


def test_windows_collision_never_modifies_existing_directory(tmp_path, monkeypatch):
    existing = tmp_path / 'cache-first'
    existing.mkdir()
    marker = existing / 'untouched'
    marker.write_text('existing data')
    identifiers = iter(['first', 'second'])
    monkeypatch.setattr(private.uuid, 'uuid4', lambda: SimpleNamespace(hex=next(identifiers)))
    checked = []

    class FakeSecurity:
        def create_directory(self, path):
            if path.exists():
                error = OSError('Already exists')
                error.winerror = 183
                raise error
            path.mkdir()

        def pin_directory(self, path):
            return SimpleNamespace(close=lambda: None)

        def verify(self, path, *, directory):
            checked.append(path)

    monkeypatch.setattr(private, '_WindowsSecurity', FakeSecurity)
    result, pin = private._make_windows_directory(tmp_path, 'cache-')
    assert Path(result) == tmp_path / 'cache-second'
    assert checked == [Path(result)]
    assert marker.read_text() == 'existing data'


def test_cleanup_closes_pin_immediately_before_removal(tmp_path, monkeypatch):
    calls = []
    pin = SimpleNamespace(close=lambda: calls.append('close'))
    monkeypatch.setattr(private.shutil, 'rmtree', lambda name: calls.append(('remove', name)))
    private._remove_directory(str(tmp_path / 'cache'), pin)
    assert calls == ['close', ('remove', str(tmp_path / 'cache'))]


@pytest.mark.parametrize('attributes', [0x10, 0x410, 0x80])
def test_windows_pin_requires_non_reparse_directory_and_real_read_access(tmp_path, attributes):
    calls = []

    class FileInformation(ctypes.Structure):
        _fields_ = [('dwFileAttributes', ctypes.c_uint32)]

    class FakeKernel:
        def CreateFileW(self, *arguments):
            calls.append(arguments)
            return 123

        def GetFileInformationByHandle(self, handle, information):
            information._obj.dwFileAttributes = attributes
            return True

        def CloseHandle(self, handle):
            calls.append(('close', handle))

    security = private._WindowsSecurity.__new__(private._WindowsSecurity)
    security.kernel = FakeKernel()
    security.c = ctypes
    security.w = SimpleNamespace(HANDLE=ctypes.c_void_p)
    security.FileInformation = FileInformation
    if attributes == 0x10:
        pin = security.pin_directory(tmp_path)
        assert len(calls) == 1
        pin.close()
        pin.close()
    else:
        with pytest.raises(PermissionError, match='regular directory'):
            security.pin_directory(tmp_path)
    arguments = calls[0]
    assert arguments == (str(tmp_path), 0x00020081, 3, None, 3, 0x02200000, None)
    assert calls[1:] == [('close', 123)]


@pytest.mark.skipif(os.name != 'nt', reason='Requires Windows share-delete enforcement')
def test_windows_private_root_is_pinned_until_cleanup(tmp_path):
    parent = tmp_path / 'synthetic-cache-parent'
    parent.mkdir()
    directory = private.PrivateTemporaryDirectory(dir=parent)
    root = Path(directory.name)
    moved = parent / 'renamed-cache'
    moved_parent = tmp_path / 'renamed-parent'
    try:
        # Even this owner cannot rename/replace the root while the private cache
        # is usable. A DELETE_CHILD grant on its parent cannot bypass the pin.
        with pytest.raises(OSError) as failure:
            root.rename(moved)
        assert failure.value.winerror in (5, 32)  # ACCESS_DENIED / SHARING_VIOLATION
        assert root.is_dir() and not moved.exists()
        with pytest.raises(OSError) as failure:
            root.rmdir()
        assert failure.value.winerror in (5, 32)
        with pytest.raises(OSError) as failure:
            parent.rename(moved_parent)
        assert failure.value.winerror in (5, 32)
        assert parent.is_dir() and not moved_parent.exists()
        private.assert_private_directory(root)
        (root / 'synthetic.input').write_bytes(b'synthetic bytes only')
    finally:
        directory.cleanup()
    assert not root.exists()
    assert directory._pin.handle is None
    parent.rename(moved_parent)
    assert moved_parent.is_dir()


@pytest.mark.skipif(os.name != 'nt', reason='Requires actual Windows security descriptors')
def test_windows_real_dacl_and_worker_file_inheritance(tmp_path):
    # Independently read ACLs through Windows PowerShell/.NET rather than trusting
    # the same ctypes reader used by production. No ACLs or OS settings are changed.
    with private.PrivateTemporaryDirectory(dir=tmp_path) as name:
        root = Path(name)
        files = [root / suffix for suffix in ('source.input', 'request.json', 'worker.response', 'preview.png')]
        files[0].write_bytes(b'synthetic input')
        files[1].write_text('{}')
        private.protect_file(files[0])
        private.protect_file(files[1])
        subprocess.run([sys.executable, '-c',
                        'from pathlib import Path; import sys; '
                        'Path(sys.argv[1]).write_text("{}"); Path(sys.argv[2]).write_bytes(b"synthetic")',
                        str(files[2]), str(files[3])], check=True, timeout=20)
        # Check immediately after the child writes, before protect_file: the ACL
        # must be private from creation, not repaired after sensitive bytes exist.
        security = private._WindowsSecurity()
        snapshot = security.read_acl(root)
        assert snapshot.protected
        assert snapshot.owner == security.user_sid
        assert {entry[3] for entry in snapshot.entries} == {security.user_sid, SYSTEM}
        for file in files:
            private.assert_private_file(file)
            snapshot = security.read_acl(file)
            assert all(entry[1] == 0x10 for entry in snapshot.entries)

        script = r'''
        $ErrorActionPreference = 'Stop'
        $paths = @($env:MISTBRIDGE_TEST_CACHE) + @(Get-ChildItem -LiteralPath $env:MISTBRIDGE_TEST_CACHE | ForEach-Object { $_.FullName })
        $items = @(foreach ($path in $paths) {
            $acl = Get-Acl -LiteralPath $path
            $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
                [PSCustomObject]@{
                    sid = $_.IdentityReference.Value
                    rights = [int]$_.FileSystemRights
                    allow = ($_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow)
                    inherited = $_.IsInherited
                    inheritance = [int]$_.InheritanceFlags
                    propagation = [int]$_.PropagationFlags
                }
            })
            [PSCustomObject]@{ path = $path; protected = $acl.AreAccessRulesProtected; rules = $rules }
        })
        [PSCustomObject]@{
            userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
            items = $items
        } | ConvertTo-Json -Depth 6 -Compress
        '''
        environment = os.environ.copy()
        environment['MISTBRIDGE_TEST_CACHE'] = str(root)
        result = subprocess.run(['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
                                env=environment, capture_output=True, text=True, check=True, timeout=30)
        value = json.loads(result.stdout)
        expected = {value['userSid'], SYSTEM}
        assert len(value['items']) == 5
        for index, item in enumerate(value['items']):
            rules = item['rules']
            assert len(rules) == len(expected)
            assert {rule['sid'] for rule in rules} == expected
            assert all(rule['allow'] and rule['rights'] == FULL and rule['propagation'] == 0 for rule in rules)
            if index == 0:
                assert item['protected'] is True
                assert all(not rule['inherited'] and rule['inheritance'] == 3 for rule in rules)
            else:
                assert all(rule['inherited'] for rule in rules)
