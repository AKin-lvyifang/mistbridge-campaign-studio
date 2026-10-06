"""Private, session-only directories for decoded local assets.

Windows chmod only changes the read-only attribute. Create the directory with a
protected DACL *before* writing anything, then verify the ACL the filesystem
actually stored. Its inheritable ACEs protect worker-created files as well.
This protects against other ordinary accounts, not administrators, SYSTEM, or
other processes running as this user. No existing directory ACL is modified.
"""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import shutil
import stat
import tempfile
import uuid
import weakref


_SYSTEM_SID = 'S-1-5-18'
_FILE_ALL_ACCESS = 0x001F01FF
_INHERIT_CHILDREN = 0x03  # OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE
_INHERITED = 0x10


@dataclass(frozen=True)
class _Acl:
    owner: str
    protected: bool
    # (ACE type, flags, access mask, SID); None denotes a missing/null DACL.
    entries: tuple[tuple[int, int, int, str], ...] | None


def _validate_acl(acl: _Acl, user_sid: str, *, directory: bool) -> None:
    allowed = {user_sid, _SYSTEM_SID}
    if acl.entries is None or len(acl.entries) != len(allowed):
        raise PermissionError('Asset cache requires a restricted Windows DACL.')
    if directory and (not acl.protected or acl.owner != user_sid):
        raise PermissionError('Asset cache requires a protected, user-owned DACL.')
    seen = set()
    for ace_type, flags, mask, sid in acl.entries:
        valid_flags = flags == _INHERIT_CHILDREN if directory else flags in (0, _INHERITED)
        if ace_type != 0 or not valid_flags or mask != _FILE_ALL_ACCESS or sid not in allowed:
            raise PermissionError('Asset cache DACL grants unexpected access.')
        seen.add(sid)
    if seen != allowed:
        raise PermissionError('Asset cache DACL does not grant the required private access.')


def _private_sddl(user_sid: str) -> str:
    principals = [_SYSTEM_SID] + ([user_sid] if user_sid != _SYSTEM_SID else [])
    return f'O:{user_sid}D:P' + ''.join(f'(A;OICI;FA;;;{sid})' for sid in principals)


class _WindowsSecurity:
    """Small Win32 binding, loaded only on Windows (no pywin32 dependency)."""

    def __init__(self):
        import ctypes
        from ctypes import wintypes

        self.c = ctypes
        self.w = wintypes
        self.kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        self.advapi = ctypes.WinDLL('advapi32', use_last_error=True)
        pointer = ctypes.c_void_p
        out_pointer = ctypes.POINTER(pointer)
        dword_pointer = ctypes.POINTER(wintypes.DWORD)

        class SecurityAttributes(ctypes.Structure):
            _fields_ = [('nLength', wintypes.DWORD), ('lpSecurityDescriptor', pointer),
                        ('bInheritHandle', wintypes.BOOL)]

        class AclSizeInformation(ctypes.Structure):
            _fields_ = [('AceCount', wintypes.DWORD), ('AclBytesInUse', wintypes.DWORD),
                        ('AclBytesFree', wintypes.DWORD)]

        class AllowedAce(ctypes.Structure):
            _fields_ = [('AceType', wintypes.BYTE), ('AceFlags', wintypes.BYTE),
                        ('AceSize', wintypes.WORD), ('Mask', wintypes.DWORD),
                        ('SidStart', wintypes.DWORD)]

        class FileInformation(ctypes.Structure):
            _fields_ = [('dwFileAttributes', wintypes.DWORD), ('ftCreationTime', wintypes.FILETIME),
                        ('ftLastAccessTime', wintypes.FILETIME), ('ftLastWriteTime', wintypes.FILETIME),
                        ('dwVolumeSerialNumber', wintypes.DWORD), ('nFileSizeHigh', wintypes.DWORD),
                        ('nFileSizeLow', wintypes.DWORD), ('nNumberOfLinks', wintypes.DWORD),
                        ('nFileIndexHigh', wintypes.DWORD), ('nFileIndexLow', wintypes.DWORD)]

        self.SecurityAttributes = SecurityAttributes
        self.AclSizeInformation = AclSizeInformation
        self.AllowedAce = AllowedAce
        self.FileInformation = FileInformation
        bindings = [
            (self.kernel, 'GetCurrentProcess', [], wintypes.HANDLE),
            (self.kernel, 'CloseHandle', [wintypes.HANDLE], wintypes.BOOL),
            (self.kernel, 'LocalFree', [pointer], pointer),
            (self.kernel, 'CreateDirectoryW', [wintypes.LPCWSTR, ctypes.POINTER(SecurityAttributes)], wintypes.BOOL),
            (self.kernel, 'CreateFileW', [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
             pointer, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE], wintypes.HANDLE),
            (self.kernel, 'GetFileInformationByHandle', [wintypes.HANDLE, ctypes.POINTER(FileInformation)], wintypes.BOOL),
            (self.advapi, 'OpenProcessToken', [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)], wintypes.BOOL),
            (self.advapi, 'GetTokenInformation', [wintypes.HANDLE, ctypes.c_int, pointer, wintypes.DWORD, dword_pointer], wintypes.BOOL),
            (self.advapi, 'ConvertSidToStringSidW', [pointer, out_pointer], wintypes.BOOL),
            (self.advapi, 'ConvertStringSecurityDescriptorToSecurityDescriptorW',
             [wintypes.LPCWSTR, wintypes.DWORD, out_pointer, dword_pointer], wintypes.BOOL),
            (self.advapi, 'GetNamedSecurityInfoW',
             [wintypes.LPCWSTR, ctypes.c_int, wintypes.DWORD, out_pointer, out_pointer,
              out_pointer, out_pointer, out_pointer], wintypes.DWORD),
            (self.advapi, 'GetSecurityDescriptorControl',
             [pointer, ctypes.POINTER(wintypes.WORD), dword_pointer], wintypes.BOOL),
            (self.advapi, 'GetAclInformation', [pointer, pointer, wintypes.DWORD, ctypes.c_int], wintypes.BOOL),
            (self.advapi, 'GetAce', [pointer, wintypes.DWORD, out_pointer], wintypes.BOOL),
        ]
        for library, name, arguments, result in bindings:
            function = getattr(library, name)
            function.argtypes = arguments
            function.restype = result
        self.user_sid = self._current_user_sid()

    def _check(self, success):
        if not success:
            raise self.c.WinError(self.c.get_last_error())

    def _sid_string(self, sid):
        if not sid:
            raise PermissionError('Asset cache security descriptor has no owner SID.')
        result = self.c.c_void_p()
        self._check(self.advapi.ConvertSidToStringSidW(sid, self.c.byref(result)))
        try:
            return self.c.wstring_at(result)
        finally:
            self.kernel.LocalFree(result)

    def _current_user_sid(self):
        token = self.w.HANDLE()
        self._check(self.advapi.OpenProcessToken(self.kernel.GetCurrentProcess(), 0x0008, self.c.byref(token)))
        try:
            size = self.w.DWORD()
            success = self.advapi.GetTokenInformation(token, 1, None, 0, self.c.byref(size))  # TokenUser
            if success or self.c.get_last_error() != 122 or not size.value:  # ERROR_INSUFFICIENT_BUFFER
                raise self.c.WinError(self.c.get_last_error())
            buffer = self.c.create_string_buffer(size.value)
            self._check(self.advapi.GetTokenInformation(token, 1, buffer, size, self.c.byref(size)))
            # TOKEN_USER starts with SID_AND_ATTRIBUTES, whose first member is PSID.
            sid = self.c.cast(buffer, self.c.POINTER(self.c.c_void_p)).contents.value
            return self._sid_string(sid)
        finally:
            self.kernel.CloseHandle(token)

    def create_directory(self, path: Path) -> None:
        descriptor = self.c.c_void_p()
        self._check(self.advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(
            _private_sddl(self.user_sid), 1, self.c.byref(descriptor), None))
        try:
            attributes = self.SecurityAttributes(self.c.sizeof(self.SecurityAttributes), descriptor, False)
            # Atomic creation; never loosen or replace an existing directory.
            self._check(self.kernel.CreateDirectoryW(str(path), self.c.byref(attributes)))
        finally:
            self.kernel.LocalFree(descriptor)

    def read_acl(self, path: Path) -> _Acl:
        owner, dacl, descriptor = (self.c.c_void_p() for _ in range(3))
        result = self.advapi.GetNamedSecurityInfoW(
            str(path), 1, 0x0001 | 0x0004, self.c.byref(owner), None,
            self.c.byref(dacl), None, self.c.byref(descriptor))
        if result:
            raise self.c.WinError(result)
        try:
            control, revision = self.w.WORD(), self.w.DWORD()
            self._check(self.advapi.GetSecurityDescriptorControl(
                descriptor, self.c.byref(control), self.c.byref(revision)))
            entries = None
            if dacl and control.value & 0x0004:  # SE_DACL_PRESENT; NULL means unrestricted.
                information = self.AclSizeInformation()
                self._check(self.advapi.GetAclInformation(dacl, self.c.byref(information),
                            self.c.sizeof(information), 2))  # AclSizeInformation
                values = []
                for index in range(information.AceCount):
                    pointer = self.c.c_void_p()
                    self._check(self.advapi.GetAce(dacl, index, self.c.byref(pointer)))
                    ace = self.c.cast(pointer, self.c.POINTER(self.AllowedAce)).contents
                    # Only plain ACCESS_ALLOWED_ACE has the SID at this offset.
                    sid = self._sid_string(pointer.value + self.AllowedAce.SidStart.offset) if ace.AceType == 0 else ''
                    values.append((ace.AceType, ace.AceFlags, ace.Mask, sid))
                entries = tuple(values)
            return _Acl(self._sid_string(owner), bool(control.value & 0x1000), entries)
        finally:
            self.kernel.LocalFree(descriptor)

    def pin_directory(self, path: Path):
        # Deny FILE_SHARE_DELETE for the entire cache lifetime. A restrictive
        # child DACL alone does not stop a shared TMP parent with DELETE_CHILD
        # from renaming it and substituting another directory at the same path.
        # Include FILE_LIST_DIRECTORY so this is a real read-access open:
        # metadata-only opens need not participate in share-access checks.
        handle = self.kernel.CreateFileW(
            str(path), 0x00020081, 0x00000003, None, 3, 0x02200000, None)
        # READ_CONTROL | FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY;
        # SHARE_READ | SHARE_WRITE;
        # OPEN_EXISTING; BACKUP_SEMANTICS | OPEN_REPARSE_POINT.
        if handle == self.w.HANDLE(-1).value:
            raise self.c.WinError(self.c.get_last_error())
        try:
            information = self.FileInformation()
            self._check(self.kernel.GetFileInformationByHandle(handle, self.c.byref(information)))
            attributes = information.dwFileAttributes
            if not attributes & 0x10 or attributes & 0x400:
                raise PermissionError('Asset cache root must be a regular directory, not a reparse point.')
        except BaseException:
            self.kernel.CloseHandle(handle)
            raise
        return _WindowsDirectoryPin(self, handle)

    def verify(self, path: Path, *, directory: bool) -> None:
        _validate_acl(self.read_acl(path), self.user_sid, directory=directory)


class _WindowsDirectoryPin:
    def __init__(self, security: _WindowsSecurity, handle):
        self.security = security
        self.handle = handle

    def close(self):
        if self.handle is not None:
            handle, self.handle = self.handle, None
            self.security.kernel.CloseHandle(handle)


def _check_kind(path: Path, *, directory: bool) -> None:
    info = path.lstat()
    regular = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
    if not regular or getattr(info, 'st_file_attributes', 0) & 0x400:
        raise PermissionError('Asset cache must not contain links or reparse points.')


def assert_private_directory(path: Path) -> None:
    path = Path(path)
    _check_kind(path, directory=True)
    if os.name == 'nt':
        _WindowsSecurity().verify(path, directory=True)
    elif stat.S_IMODE(path.stat().st_mode) != 0o700:
        raise PermissionError('Asset cache directory must have mode 0700.')


def assert_private_file(path: Path) -> None:
    path = Path(path)
    _check_kind(path, directory=False)
    if os.name == 'nt':
        _WindowsSecurity().verify(path, directory=False)
    elif stat.S_IMODE(path.stat().st_mode) != 0o600:
        raise PermissionError('Asset cache file must have mode 0600.')


def protect_file(path: Path) -> None:
    """For files created inside a private directory, never arbitrary user files."""
    path = Path(path)
    _check_kind(path, directory=False)
    if os.name != 'nt':
        path.chmod(0o600)
    # On Windows, fail closed if the inherited permissions are not private.
    assert_private_file(path)


def _make_windows_directory(parent: Path, prefix: str) -> tuple[str, _WindowsDirectoryPin]:
    security = _WindowsSecurity()
    for _ in range(100):
        path = parent / (prefix + uuid.uuid4().hex)
        try:
            security.create_directory(path)
        except OSError as error:
            if getattr(error, 'winerror', None) in (80, 183):
                continue
            raise
        pin = None
        try:
            # Pin before inspecting ACLs or exposing this directory for writes.
            pin = security.pin_directory(path)
            _check_kind(path, directory=True)
            security.verify(path, directory=True)
        except BaseException:
            # Verification happens while empty, before any sensitive data exists.
            # Do not recursively remove anything unexpectedly added to this path.
            if pin is not None:
                pin.close()
            try:
                path.rmdir()
            except OSError:
                pass
            raise
        return str(path), pin
    raise FileExistsError('Unable to allocate a unique private asset cache.')


def _remove_directory(name: str, pin=None) -> None:
    # Keep the root immovable until removal starts, including GC/exit cleanup.
    if pin is not None:
        pin.close()
    try:
        shutil.rmtree(name)
    except FileNotFoundError:
        pass


class PrivateTemporaryDirectory:
    """TemporaryDirectory-like ownership and cleanup, with Windows ACL privacy."""

    def __init__(self, *, prefix: str = 'mistbridge-assets-', dir=None):
        if not prefix or any(character in prefix for character in ('/', '\\', '\0')):
            raise ValueError('Private cache prefix must be a single filename component.')
        self._pin = None
        if os.name == 'nt':
            self.name, self._pin = _make_windows_directory(Path(dir or tempfile.gettempdir()).absolute(), prefix)
        else:
            self.name = tempfile.mkdtemp(prefix=prefix, dir=dir)
            try:
                Path(self.name).chmod(0o700)
                assert_private_directory(Path(self.name))
            except BaseException:
                _remove_directory(self.name)
                raise
        self._finalizer = weakref.finalize(self, _remove_directory, self.name, self._pin)

    def __enter__(self):
        return self.name

    def __exit__(self, exc_type, exc_value, traceback):
        self.cleanup()

    def cleanup(self):
        if self._finalizer.detach() or os.path.exists(self.name):
            _remove_directory(self.name, self._pin)
