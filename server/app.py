"""Loopback-first native API and optional production frontend host."""
from __future__ import annotations
import asyncio
import importlib.metadata
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool
from server.models import SUPPORTED_VERSION, validate_project
from server.native import NativeError, export_scenario, import_scenario

app = FastAPI(title='AoE2 Campaign Studio', version='0.1.0', docs_url='/api/docs', redoc_url=None)
ROOT = Path(__file__).resolve().parent.parent
MAX_NATIVE = 16*1024*1024
MAX_JSON = 48*1024*1024
jobs = asyncio.Semaphore(2)

@app.middleware('http')
async def local_request_guard(request: Request, call_next):
    # Host validation blocks DNS rebinding; explicit non-simple content types
    # plus origin checks stop arbitrary websites from driving the local parser.
    host = request.headers.get('host', '')
    try:
        hostname = urlsplit('http://' + host).hostname
    except ValueError:
        hostname = None
    if hostname not in {'127.0.0.1', 'localhost', '::1'}:
        return JSONResponse({'detail': 'Untrusted Host header.'}, status_code=400)
    if request.method in {'POST', 'PUT', 'PATCH', 'DELETE'} and request.url.path.startswith('/api/'):
        origin = request.headers.get('origin')
        allowed_origins = {f'http://{host}', 'http://127.0.0.1:5173', 'http://localhost:5173',
                           'http://127.0.0.1:8787', 'http://localhost:8787', 'http://[::1]:8787'}
        if origin and origin not in allowed_origins:
            return JSONResponse({'detail': 'Cross-origin native API requests are blocked.'}, status_code=403)
        if request.headers.get('sec-fetch-site') == 'cross-site':
            return JSONResponse({'detail': 'Cross-site native API requests are blocked.'}, status_code=403)
        media = request.headers.get('content-type', '').split(';', 1)[0].strip().lower()
        expected = 'application/octet-stream' if request.url.path == '/api/import' else 'application/json'
        if media != expected:
            return JSONResponse({'detail': f'Expected Content-Type: {expected}.'}, status_code=415)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response

async def bounded_body(request: Request, limit: int) -> bytes:
    chunks = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise HTTPException(413, 'Request exceeds the supported size limit.')
        chunks.append(chunk)
    return b''.join(chunks)

async def read_project(request: Request):
    try:
        body = json.loads(await bounded_body(request, MAX_JSON))
        if not isinstance(body, dict) or 'project' not in body:
            raise ValueError()
        return body['project']
    except (ValueError, UnicodeError):
        raise HTTPException(422, 'Expected JSON containing a project object.') from None

@app.get('/api/health')
def health():
    try:
        version = importlib.metadata.version('AoE2ScenarioParser')
    except importlib.metadata.PackageNotFoundError:
        version = None
    return {'status': 'ok' if version == '0.9.4' else 'dependency-mismatch', 'parserVersion': version,
            'supportedVersions': [SUPPORTED_VERSION], 'dataset': 'AoE2 DE',
            'gameTested': False, 'isolatedWorkers': True}

@app.post('/api/import')
async def import_file(request: Request, filename: str = Query(default='imported.aoe2scenario', max_length=500)):
    raw = await bounded_body(request, MAX_NATIVE)
    if not filename.lower().endswith('.aoe2scenario'):
        raise HTTPException(422, 'Choose a native .aoe2scenario file.')
    if len(raw) < 32:
        raise HTTPException(422, 'This is not a complete native scenario file.')
    try:
        async with jobs:
            return await run_in_threadpool(import_scenario, raw, filename)
    except NativeError as exc:
        raise HTTPException(422, str(exc)) from None

@app.post('/api/validate')
async def validate(request: Request):
    _, diagnostics = validate_project(await read_project(request))
    return {'diagnostics': diagnostics}

@app.post('/api/export')
async def export_file(request: Request):
    data = await read_project(request)
    project, diagnostics = validate_project(data)
    errors = [d for d in diagnostics if d['severity'] == 'error']
    if errors:
        raise HTTPException(422, {'message': 'Project validation failed.', 'diagnostics': errors})
    try:
        async with jobs:
            binary, verified = await run_in_threadpool(export_scenario, project.model_dump(exclude_none=True))
    except NativeError as exc:
        raise HTTPException(422, str(exc)) from None
    return Response(binary, media_type='application/octet-stream', headers={
        'Content-Disposition': "attachment; filename=\"scenario.aoe2scenario\"; filename*=UTF-8''" + quote(verified['filename']),
        'X-Scenario-Version': SUPPORTED_VERSION,
        'X-Native-Verified': 'fresh-process',
        'X-Native-Byte-Identical': str(verified['byteIdentical']).lower(),
        'Cache-Control': 'no-store',
    })

@app.get('/{path:path}', include_in_schema=False)
async def frontend(path: str):
    if path.startswith('api/'):
        raise HTTPException(404, 'Unknown API endpoint.')
    dist = (ROOT / 'dist').resolve()
    file = (dist / path).resolve()
    if not file.is_relative_to(dist):
        raise HTTPException(404)
    if file.is_file():
        return FileResponse(file)
    if (dist / 'index.html').is_file():
        return FileResponse(dist / 'index.html')
    raise HTTPException(404, 'Frontend not built. Run the Vite dev server or build the frontend.')
