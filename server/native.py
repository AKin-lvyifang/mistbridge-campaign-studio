"""Safe orchestration of single-use parser processes."""
from __future__ import annotations
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid
from server.models import SUPPORTED_VERSION

ROOT = Path(__file__).resolve().parent.parent

class NativeError(ValueError):
    pass


def run_worker(request: dict, directory: Path, timeout: int = 60) -> dict:
    token = uuid.uuid4().hex
    input_path = directory / f'{token}.request.json'
    output_path = directory / f'{token}.response.json'
    input_path.write_text(json.dumps(request, ensure_ascii=False), 'utf-8')
    environment = os.environ.copy()
    environment['PYTHONPATH'] = str(ROOT)
    environment['PYTHONDONTWRITEBYTECODE'] = '1'
    try:
        completed = subprocess.run([sys.executable, '-m', 'server.native_worker', str(input_path), str(output_path)],
                                   cwd=directory, env=environment, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout,
                                   check=False)
    except subprocess.TimeoutExpired as exc:
        raise NativeError('Native operation exceeded the 60-second limit.') from exc
    if completed.returncode != 0 or not output_path.is_file():
        raise NativeError('Native worker stopped unexpectedly or exceeded a resource limit.')
    result = json.loads(output_path.read_text('utf-8'))
    if not result.get('ok'):
        raise NativeError(result.get('error', 'Native operation failed.'))
    return result['result']


def import_scenario(raw: bytes, filename: str) -> dict:
    with tempfile.TemporaryDirectory(prefix='aoe2-import-') as tmp:
        directory = Path(tmp)
        source = directory / 'input.aoe2scenario'
        source.write_bytes(raw)
        return run_worker({'op': 'import', 'source': str(source), 'filename': filename}, directory)


def export_scenario(project: dict) -> tuple[bytes, dict]:
    with tempfile.TemporaryDirectory(prefix='aoe2-export-') as tmp:
        directory = Path(tmp)
        name = re.sub(r'[^\w .-]', '_', project.get('name', 'scenario'), flags=re.UNICODE).strip(' .')[:100] or 'scenario'
        target = directory / f'{name}.aoe2scenario'
        compiled = run_worker({'op': 'compile', 'project': project, 'target': str(target)}, directory)
        verified = run_worker({'op': 'verify', 'source': str(target), 'expected': compiled}, directory)
        return target.read_bytes(), {**compiled, **verified, 'filename': target.name}
