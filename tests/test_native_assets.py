import hashlib
import io
import json
import os
from pathlib import Path
import struct
import zlib
from types import SimpleNamespace
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from server.native_assets import NativeAssetStore, AssetError, read_selected
from server.asset_worker import decode_dds, bounded_dat
from server.private_assets import assert_private_directory, assert_private_file
from server.app import app
from server.entrypoint import DesktopGuard

@pytest.fixture
def resources(tmp_path):
    root = tmp_path / 'licensed synthetic resources'
    textures = root / 'resources/_common/terrain/textures'
    graphics = root / 'resources/_common/drs/graphics'
    textures.mkdir(parents=True)
    graphics.mkdir(parents=True)
    image = Image.new('RGBA', (8, 8), (40, 180, 90, 255))
    image.save(textures / 'synthetic.dds')
    (graphics / 'indexed-only.smx').write_bytes(b'not decoded')
    (root / 'ignore.txt').write_text('never included')
    return root

@pytest.fixture
def store(resources):
    value = NativeAssetStore()
    value.mount(str(resources))
    yield value
    value.clear()
    value.directory.cleanup()

def test_scan_is_relative_and_private(store, resources):
    status = store.status()
    assert status['mounted'] and status['counts']['dds'] == 1 and status['counts']['smx'] == 1
    assert str(resources) not in json.dumps(status)
    catalog = store.catalog()
    assert len(catalog['entries']) == 2
    assert all(not Path(e['relativePath']).is_absolute() for e in catalog['entries'])
    assert not any(e['name'] == 'ignore.txt' for e in catalog['entries'])
    assert_private_directory(store.cache_dir)

def test_decode_real_dds_via_isolated_worker(store):
    item = store.catalog(kind='dds')['entries'][0]
    result = store.decode(item['id'])
    assert result['width'] == result['height'] == 8
    assert result['limitations'] == ['flat-texture-only', 'no-terrain-blending', 'no-water-animation']
    png = store.image(result['imageUrl'].split('/')[-1])
    with Image.open(io.BytesIO(png)) as image:
        assert image.convert('RGBA').getpixel((0, 0)) == (40, 180, 90, 255)
    assert store.decode(item['id'])['imageUrl'] == result['imageUrl']
    assert len(list(store.cache_dir.iterdir())) == 1
    assert_private_file(next(store.cache_dir.iterdir()))

def test_hash_change_invalidates_cache(store, resources):
    item = store.catalog(kind='dds')['entries'][0]
    a = store.decode(item['id'])
    Image.new('RGBA', (8, 8), 'red').save(resources / item['relativePath'])
    b = store.decode(item['id'])
    assert a['sha256'] != b['sha256'] and a['imageUrl'] != b['imageUrl']

def test_clear_expires_all_handles(store):
    item = store.catalog(kind='dds')['entries'][0]
    image = store.decode(item['id'])
    revision = store.status()['revision']
    store.clear()
    assert store.status()['revision'] != revision
    assert not list(store.cache_dir.iterdir())
    with pytest.raises(AssetError): store.decode(item['id'])
    with pytest.raises(AssetError): store.image(image['imageUrl'].split('/')[-1])

def test_scan_does_not_follow_links(store, resources, tmp_path):
    outside = tmp_path / 'outside'
    outside.mkdir()
    Image.new('RGBA',(4,4),'red').save(outside/'private.dds')
    (resources / 'linked').symlink_to(outside, target_is_directory=True)
    (resources / 'fake.dds').symlink_to(outside/'private.dds')
    store.mount(str(resources))
    assert store.status()['skipped'] == 2
    assert len(store.catalog(kind='dds')['entries']) == 1
    for rel in ['linked/private.dds', 'fake.dds', '../outside/private.dds', str(outside/'private.dds')]:
        with pytest.raises((AssetError,OSError)): read_selected(resources,rel)

def test_swap_file_for_link_after_scan_rejected(store, resources, tmp_path):
    item = store.catalog(kind='dds')['entries'][0]
    path = resources / item['relativePath']
    outside = tmp_path/'secret.dds'
    outside.write_bytes(path.read_bytes())
    path.unlink(); path.symlink_to(outside)
    with pytest.raises(AssetError,match='link'): store.decode(item['id'])

def test_nonregular_and_large_files_rejected(store,resources):
    huge=resources/'large.dds'
    with huge.open('wb') as f: f.truncate(65*1024*1024)
    store.mount(str(resources))
    assert store.status()['skipped']==1
    with pytest.raises(AssetError): read_selected(resources,'large.dds')
    if hasattr(os,'mkfifo'):
        os.mkfifo(resources/'pipe.dds')
        with pytest.raises(AssetError): read_selected(resources,'pipe.dds')

def test_reselect_expires_previous_handles(store,resources):
    first=store.catalog(kind='dds')['entries'][0]['id']
    store.mount(str(resources))
    with pytest.raises(AssetError): store.decode(first)

def test_unsupported_indexed_format_is_honest(store):
    with pytest.raises(AssetError,match='indexed only'): store.decode(store.catalog(kind='smx')['entries'][0]['id'])

def test_dds_size_and_header_boundaries():
    with pytest.raises(ValueError): decode_dds(b'DDS '+b'\0'*123)
    data=bytearray(128);data[:4]=b'DDS ';struct.pack_into('<I',data,4,124);struct.pack_into('<II',data,12,8192,8192)
    with pytest.raises(ValueError,match='dimensions'): decode_dds(bytes(data))
    struct.pack_into('<II',data,12,4,4);struct.pack_into('<I',data,112,0x200)
    with pytest.raises(ValueError,match='cubemaps'): decode_dds(bytes(data))

def test_unsupported_dat_version_and_trailing_compression():
    invalid=zlib.compress(b'VER 9.9\0'+b'\0'*128,wbits=-15)
    with pytest.raises(ValueError,match='Unsupported DAT version'): bounded_dat(invalid)
    with pytest.raises(ValueError,match='trailing'): bounded_dat(invalid+b'trailing')

def test_dat_mapping_never_guesses_ids_or_ambiguous_files(store,resources):
    graphics=resources/'resources/_common/drs/graphics'
    (graphics/'actual_name.sld').write_bytes(b'synthetic placeholder')
    store.mount(str(resources))
    store.dat={'version':'VER 8.9','sha256':'a'*64,'tileWidth':96,'civilizations':[{'id':1,'name':'Synthetic','units':{'109':{'graphicId':7,'footprint':[3,3]}}}], 'graphics':{'7':{'filename':'actual_name','frameCount':10,'angleCount':1,'childGraphics':2}}}
    result=store.bindings(1,[109,83])['bindings']
    assert result[0]['resolved'] and result[0]['graphicId']==7
    assert not result[1]['resolved']
    (resources/'actual_name.sld').write_bytes(b'duplicate')
    dat=store.dat;store.mount(str(resources));store.dat=dat
    assert 'Multiple' in store.bindings(1,[109])['bindings'][0]['reason']

def test_mount_requires_desktop_proof_even_for_loopback(resources):
    with TestClient(app,base_url='http://127.0.0.1') as client:
        assert client.post('/api/assets/mount',json={'directory':str(resources)},headers={'x-studio-asset-selection':'dialog'}).status_code==403

def test_owned_mount_and_api_handles(resources,monkeypatch):
    from server import asset_routes
    test_store=NativeAssetStore();monkeypatch.setattr(asset_routes,'store',test_store)
    token='a'*64
    with TestClient(DesktopGuard(app,token),base_url='http://127.0.0.1',headers={'x-studio-instance':token}) as client:
        assert client.post('/api/assets/mount',json={'directory':str(resources)}).status_code==403
        response=client.post('/api/assets/mount',json={'directory':str(resources)},headers={'x-studio-asset-selection':'dialog'})
        assert response.status_code==200
        assert str(resources) not in response.text
        catalog=client.get('/api/assets/catalog?kind=dds').json()
        item=catalog['entries'][0]
        assert client.post('/api/assets/decode',json={'assetId':'../../etc/passwd'}).status_code==422
        assert client.post('/api/assets/decode',json={'assetId':item['id'],'path':'/etc/passwd'}).status_code==422
        preview=client.post('/api/assets/decode',json={'assetId':item['id']}).json()
        assert client.get(preview['imageUrl']).headers['content-type']=='image/png'
        assert client.post('/api/assets/clear',json={}).status_code==200
        assert client.get(preview['imageUrl']).status_code==404
    test_store.directory.cleanup()


def test_worker_private_file_setup_failure_cleans_snapshot(store, monkeypatch):
    from server import native_assets
    item = store.catalog(kind='dds')['entries'][0]
    def fail(_path):
        raise PermissionError('Synthetic permissions failure')
    monkeypatch.setattr(native_assets, 'protect_file', fail)
    with pytest.raises(PermissionError, match='Synthetic'):
        store.decode(item['id'])
    assert list(store.cache_dir.iterdir()) == []
