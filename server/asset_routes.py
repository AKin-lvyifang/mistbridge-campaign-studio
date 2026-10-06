"""Private desktop routes for local previews. The renderer never supplies a path."""
from __future__ import annotations
import asyncio
import json
from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from server.native_assets import NativeAssetStore, AssetError

router = APIRouter(prefix='/api/assets')
store = NativeAssetStore()
jobs = asyncio.Semaphore(1)

async def payload(request: Request, fields: set[str], maximum=8192):
    chunks = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > maximum:
            raise HTTPException(413, 'Asset request is too large.')
        chunks.append(chunk)
    try:
        value = json.loads(b''.join(chunks))
        if not isinstance(value, dict) or set(value) != fields:
            raise ValueError()
        return value
    except (ValueError, UnicodeError):
        raise HTTPException(422, 'Invalid asset request fields.') from None

async def operation(fn, *args):
    if jobs.locked():
        raise HTTPException(409, 'An asset operation is running. Wait for it to finish.')
    try:
        async with jobs:
            return await run_in_threadpool(fn, *args)
    except AssetError as exc:
        raise HTTPException(422, str(exc)) from None
    except Exception:
        raise HTTPException(422, 'The local asset operation could not be completed.') from None

def response(value):
    return JSONResponse(value, headers={'Cache-Control': 'no-store'})

def asset_id(value):
    import re
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{32}', value):
        raise HTTPException(422, 'A valid asset handle is required.')
    return value

@router.post('/mount')
async def mount(request: Request):
    # DesktopGuard establishes proof of owned backend. native-protocol deliberately
    # does not forward this main-only selection header from renderer fetch calls.
    if not request.scope.get('studio_desktop_owned') or request.headers.get('x-studio-asset-selection') != 'dialog':
        raise HTTPException(403, 'Choose the resource folder through the desktop directory picker.')
    value = await payload(request, {'directory'})
    if not isinstance(value['directory'], str) or len(value['directory']) > 4096:
        raise HTTPException(422, 'Invalid selected directory.')
    return response(await operation(store.mount, value['directory']))

@router.get('/status')
async def status():
    return response(await run_in_threadpool(store.status))

@router.get('/catalog')
async def catalog(query: str = Query('', max_length=160), kind: str = Query('', max_length=8), offset: int = Query(0, ge=0, le=60000)):
    return response(await run_in_threadpool(store.catalog, query, kind, offset))

@router.post('/clear')
async def clear(request: Request):
    await payload(request, set())
    return response(await operation(store.clear))

@router.post('/decode')
async def decode(request: Request):
    value = await payload(request, {'assetId'})
    return response(await operation(store.decode, asset_id(value['assetId'])))

@router.post('/dat')
async def dat(request: Request):
    value = await payload(request, {'assetId'})
    return response(await operation(store.load_dat, asset_id(value['assetId'])))

@router.post('/bindings')
async def bindings(request: Request):
    value = await payload(request, {'civilization', 'unitIds'})
    civ, ids = value['civilization'], value['unitIds']
    if type(civ) is not int or not 0 <= civ <= 256 or not isinstance(ids, list) or len(ids) > 256 or any(type(i) is not int or not 0 <= i <= 32767 for i in ids):
        raise HTTPException(422, 'Choose one civilization and at most 256 unit IDs.')
    return response(await operation(store.bindings, civ, ids))

@router.get('/image/{token}')
async def image(token: str):
    try:
        binary = await run_in_threadpool(store.image, asset_id(token))
    except AssetError:
        raise HTTPException(404, 'Preview expired.') from None
    return Response(binary, media_type='image/png', headers={'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin'})
