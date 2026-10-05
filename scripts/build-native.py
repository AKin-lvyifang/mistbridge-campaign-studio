"""Build an onedir native runtime for this OS/architecture; never cross-compile."""
from __future__ import annotations
import hashlib
import importlib.metadata as metadata
import json
import platform
from pathlib import Path
import shutil
import subprocess
import sys
import sysconfig

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / 'build'


def collect_notices() -> None:
    target = BUILD / 'native-licenses'
    target.mkdir(parents=True, exist_ok=True)
    for source in ['LICENSE', 'THIRD-PARTY-NOTICES.md', 'requirements.txt', 'requirements-build.txt',
                   'docs/THIRD-PARTY-LICENSES.txt', 'fixtures/SOURCES.json', 'fixtures/upstream/LICENSE.AoE2ScenarioParser']:
        shutil.copy2(ROOT / source, target / Path(source).name)
    # Preserve licenses from every installed pinned runtime/build distribution.
    versions = {}
    for filename in ['requirements.txt', 'requirements-build.txt']:
        for line in (ROOT / filename).read_text().splitlines():
            if not line or line.startswith(('#', '-')):
                continue
            from packaging.requirements import Requirement
            requirement = Requirement(line)
            if requirement.marker and not requirement.marker.evaluate():
                continue
            distribution = metadata.distribution(requirement.name)
            if distribution.version not in requirement.specifier:
                raise RuntimeError(f'Unpinned installed dependency: {requirement.name} {distribution.version}')
            versions[distribution.metadata['Name']] = distribution.version
            for item in distribution.files or []:
                if any(part.lower().startswith(('license', 'licence', 'copying', 'notice', 'copyright')) for part in item.parts):
                    source = Path(distribution.locate_file(item))
                    if source.is_file():
                        destination = target / requirement.name / Path(*item.parts)
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(source, destination)
    python_license = Path(sysconfig.get_path('stdlib')) / 'LICENSE.txt'
    if not python_license.is_file():
        # python.org Windows installs put the license beside python.exe.
        python_license = Path(sys.base_prefix) / 'LICENSE.txt'
    if not python_license.is_file():
        raise RuntimeError('Python LICENSE.txt was not found; do not ship without it.')
    shutil.copy2(python_license, target / 'LICENSE.Python.txt')
    manifest = {'schemaVersion': 1, 'python': platform.python_version(), 'platform': sys.platform,
                'architecture': platform.machine(), 'packages': versions,
                'requirementsSha256': hashlib.sha256((ROOT / 'requirements.txt').read_bytes()).hexdigest(),
                'gameTested': False, 'signing': 'unsigned-development-artifact'}
    (target / 'native-build.json').write_text(json.dumps(manifest, indent=2) + '\n')


def main() -> None:
    if not (ROOT / 'dist/index.html').is_file():
        raise SystemExit('Run npm run build before freezing the native runtime.')
    if metadata.version('PyInstaller') != '6.22.3':
        raise SystemExit('Install the exact requirements-build.txt toolchain first.')
    subprocess.run([sys.executable, str(ROOT / "scripts/package-source.py")], cwd=ROOT, check=True)
    collect_notices()
    shutil.copytree(BUILD / "corresponding-source", BUILD / "native-licenses/corresponding-source", dirs_exist_ok=True)
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--clean', '--noconfirm',
                    '--distpath', str(BUILD / 'native'), '--workpath', str(BUILD / 'pyinstaller'),
                    str(ROOT / 'scripts/build-native.spec')], cwd=ROOT, check=True)
    print(f'Native runtime: {BUILD / "native/studio-native"}')


if __name__ == '__main__':
    main()
