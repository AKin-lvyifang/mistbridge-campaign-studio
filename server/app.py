"""Loopback-first native API and optional production frontend host."""
from __future__ import annotations
import asyncio
import importlib.metadata
import json
import time
import uuid
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

# LUI secrets remain in this service process. The renderer receives status only.
lui_jobs = asyncio.Semaphore(1)
lui_tasks: dict[asyncio.Task, str] = {}
lui_cancelled: dict[str, float] = {}
lui_generation = 0

def lui_service():
    if not hasattr(app.state, 'provider_service'):
        from server.provider import ProviderService
        app.state.provider_service = ProviderService()
    return app.state.provider_service

async def lui_json(request: Request, maximum: int):
    try:
        value = json.loads(await bounded_body(request, maximum))
    except (ValueError, UnicodeError):
        raise HTTPException(422, 'Expected a valid JSON object.') from None
    if not isinstance(value, dict):
        raise HTTPException(422, 'Expected a valid JSON object.')
    return value

def public_lui_status():
    state = lui_service().status()
    # Explicit allowlist: a future adapter cannot accidentally return its key.
    public = {key: state.get(key) for key in ('providerName', 'baseUrl', 'model', 'preset', 'endpoint', 'sessionRevision')}
    public['configured'] = state.get('configured') is True
    public['storage'] = 'session-memory'
    public['presets'] = [{key: preset.get(key) for key in ('id', 'providerName', 'baseUrl', 'models')}
                         for preset in state.get('presets', []) if isinstance(preset, dict)]
    return public

def cancel_lui_calls():
    global lui_generation
    lui_generation += 1
    for task in tuple(lui_tasks):
        task.cancel()

def lui_request_id(value):
    if not isinstance(value, str) or len(value) != 36:
        raise HTTPException(422, 'A valid request identifier is required.')
    try:
        parsed = str(uuid.UUID(value))
    except ValueError:
        raise HTTPException(422, 'A valid request identifier is required.') from None
    if parsed != value.lower():
        raise HTTPException(422, 'A valid request identifier is required.')
    return parsed

@app.post('/api/lui/cancel')
async def cancel_lui_request(request: Request):
    value = await lui_json(request, 256)
    if set(value) != {'requestId'}:
        raise HTTPException(422, 'Only a request identifier is accepted.')
    request_id = lui_request_id(value['requestId'])
    now = time.monotonic()
    for stale in [key for key, expiry in lui_cancelled.items() if expiry < now]:
        lui_cancelled.pop(stale, None)
    # Bounded short-lived tombstones also handle cancel arriving before chat.
    if len(lui_cancelled) >= 128:
        lui_cancelled.pop(next(iter(lui_cancelled)))
    lui_cancelled[request_id] = now + 240
    for task, active_id in tuple(lui_tasks.items()):
        if active_id == request_id:
            task.cancel()
    return JSONResponse({'cancelled': True}, headers={'Cache-Control': 'no-store'})

@app.get('/api/lui/status')
async def lui_status():
    return JSONResponse(public_lui_status(), headers={'Cache-Control': 'no-store'})

@app.post('/api/lui/session')
async def configure_lui_session(request: Request):
    value = await lui_json(request, 8192)
    if set(value) - {'key', 'providerName', 'baseUrl', 'model', 'preset'} or not all(isinstance(value.get(field), str) for field in ('key', 'providerName', 'baseUrl', 'model')):
        raise HTTPException(422, 'Provide the provider, HTTPS base URL, model and API key in local settings.')
    cancel_lui_calls()
    from server.provider import ProviderError
    try:
        lui_service().configure(value)
    except ProviderError as error:
        raise HTTPException(error.status_code, str(error)) from None
    except Exception:
        # Never return credential validation inputs or upstream exception objects.
        raise HTTPException(422, 'The session configuration is invalid.') from None
    finally:
        value.clear()
    return JSONResponse(public_lui_status(), headers={'Cache-Control': 'no-store'})

@app.post('/api/lui/session/clear')
async def clear_lui_session(request: Request):
    value = await lui_json(request, 256)
    if value:
        raise HTTPException(422, 'This operation does not accept any fields.')
    cancel_lui_calls()
    lui_service().clear()
    return JSONResponse(public_lui_status(), headers={'Cache-Control': 'no-store'})

@app.post('/api/lui/chat')
async def lui_chat(request: Request):
    from server.provider import ProviderError
    payload = await lui_json(request, 512 * 1024)
    request_id = lui_request_id(payload.pop('requestId', None))
    generation = lui_generation
    if lui_cancelled.get(request_id, 0) > time.monotonic():
        raise HTTPException(499, 'Request cancelled.')
    if lui_jobs.locked():
        raise HTTPException(409, 'A model request is already running. Cancel it or wait before retrying.')
    try:
        async with lui_jobs:
            if await request.is_disconnected():
                raise HTTPException(499, 'Request cancelled.')
            if generation != lui_generation or lui_cancelled.get(request_id, 0) > time.monotonic():
                raise HTTPException(499, 'Request cancelled or provider session changed.')
            task = asyncio.create_task(lui_service().chat(payload))
            lui_tasks[task] = request_id
            try:
                while not task.done():
                    await asyncio.wait({task}, timeout=0.2)
                    if not task.done() and await request.is_disconnected():
                        task.cancel()
                        raise HTTPException(499, 'Request cancelled.')
                result = await task
            finally:
                lui_tasks.pop(task, None)
                if not task.done():
                    task.cancel()
    except ProviderError as error:
        raise HTTPException(error.status_code, str(error)) from None
    except asyncio.CancelledError:
        raise HTTPException(499, 'Request cancelled or provider session changed.') from None
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, 'The model service could not complete this request.') from None
    return JSONResponse(result, headers={'Cache-Control': 'no-store'})

from server.asset_routes import router as asset_router
app.include_router(asset_router)

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
