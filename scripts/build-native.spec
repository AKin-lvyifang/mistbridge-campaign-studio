# PyInstaller spec: all parser version/dataset files, no external XS checker.
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

root = Path(SPECPATH).parent
parser_data = collect_data_files('AoE2ScenarioParser', excludes=['dependencies/**'])
data = parser_data + copy_metadata('AoE2ScenarioParser', recursive=True)
for folder in ['fixtures', 'dist']:
    for source in (root / folder).rglob('*'):
        if source.is_file() and '__pycache__' not in source.parts and source.suffix not in {'.py', '.pyc'}:
            data.append((str(source), str(source.relative_to(root).parent)))
for source in (root / 'build/native-licenses').rglob('*'):
    if source.is_file():
        data.append((str(source), 'licenses/' + str(source.relative_to(root / 'build/native-licenses').parent)))

a = Analysis([str(root / 'server/entrypoint.py')], pathex=[str(root)], binaries=[], datas=data,
             hiddenimports=['server.native_worker', 'server.app', *collect_submodules('AoE2ScenarioParser'),
                            *collect_submodules('uvicorn')],
             excludes=['pytest', 'httpx', 'tkinter', 'IPython'], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='studio-native', debug=False,
          bootloader_ignore_signals=False, strip=False, upx=False, console=True,
          disable_windowed_traceback=False, target_arch=None, codesign_identity=None, entitlements_file=None)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='studio-native')
