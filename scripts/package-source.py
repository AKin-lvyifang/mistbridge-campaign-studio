"""Collect exact application source and the hash-verified parser sdist for GPL distribution."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'build/corresponding-source'


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    parser = json.loads((ROOT / 'fixtures/SOURCES.json').read_text())['parser']
    source = DEST / 'aoe2scenarioparser-0.9.4.tar.gz'
    if not source.is_file():
        subprocess.run([sys.executable, '-m', 'pip', 'download', '--no-deps', '--no-binary=:all:',
                        '--no-build-isolation', '--dest', str(DEST), 'AoE2ScenarioParser==0.9.4'], check=True)
    if hashlib.sha256(source.read_bytes()).hexdigest() != parser['sourceArchiveSha256']:
        raise RuntimeError('Parser source archive does not match fixtures/SOURCES.json. Refusing distribution.')
    dependency = json.loads((ROOT / 'docs/ASSET-DEPENDENCIES.json').read_text())['genieutils-py']
    asset_source = DEST / dependency['filename']
    if not asset_source.is_file():
        with urllib.request.urlopen(dependency['sourceUrl'], timeout=45) as response:
            content = response.read(4 * 1024 * 1024)
        if hashlib.sha256(content).hexdigest() != dependency['sha256']:
            raise RuntimeError('DAT parser source archive hash mismatch.')
        asset_source.write_bytes(content)
    if hashlib.sha256(asset_source.read_bytes()).hexdigest() != dependency['sha256']:
        raise RuntimeError('DAT parser corresponding source hash mismatch.')
    # Explicit source roots prevent accidental inclusion of credentials, venvs,
    # user projects, node_modules or generated binaries. Snapshot actual inputs.
    files = [ROOT / name for name in ['README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md', '.gitignore',
             'package.json', 'package-lock.json', 'requirements.txt', 'requirements-build.txt',
             'index.html', 'tsconfig.json', 'vite.config.ts']]
    for name in ['src', 'server', 'electron', 'scripts', 'fixtures', 'docs', 'tests', 'public', '.github']:
        files.extend((ROOT / name).rglob('*'))
    output = DEST / 'application-source.tar.gz'
    with tarfile.open(output, 'w:gz') as archive:
        for file in sorted(set(files)):
            if file.is_file() and not file.is_symlink() and '__pycache__' not in file.parts and file.suffix != '.pyc':
                archive.add(file, arcname='aoe2-campaign-studio/' + file.relative_to(ROOT).as_posix(), recursive=False)
    manifest = {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in [source, asset_source, output]}
    (DEST / 'SHA256SUMS.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    main()
