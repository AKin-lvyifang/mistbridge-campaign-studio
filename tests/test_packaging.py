"""Desktop dispatch and private loopback guards, without requiring Electron."""
from __future__ import annotations
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from server.app import app
from server.entrypoint import DesktopGuard, main, serve
from server.native import worker_command

ROOT = Path(__file__).resolve().parent.parent
TOKEN = 'a' * 64


class PackagingTests(unittest.TestCase):
    def test_source_worker_keeps_isolated_module_dispatch(self):
        with patch.object(sys, 'frozen', False, create=True):
            self.assertEqual(worker_command(Path('input'), Path('output')),
                             [sys.executable, '-m', 'server.native_worker', 'input', 'output'])

    def test_frozen_worker_uses_bundled_executable(self):
        with patch.object(sys, 'frozen', True, create=True):
            self.assertEqual(worker_command(Path('雾桥 input'), Path('output')),
                             [sys.executable, '--worker', '雾桥 input', 'output'])

    def test_worker_entrypoint_dispatches_without_server_start(self):
        with patch('server.native_worker.main') as worker, patch('server.entrypoint.serve') as server, patch.object(sys, 'argv', ['original']):
            main(['--worker', 'request', 'response'])
            worker.assert_called_once_with()
            server.assert_not_called()
            self.assertEqual(sys.argv[1:], ['request', 'response'])

    def test_worker_mode_rejects_missing_arguments(self):
        with self.assertRaises(SystemExit):
            main(['--worker', 'request'])

    def test_serve_requires_ephemeral_token(self):
        for token in ['', 'bad', 'G' * 64]:
            with patch.dict('os.environ', {'STUDIO_INSTANCE_TOKEN': token}), self.assertRaises(ValueError):
                serve()

    def test_guard_rejects_other_instances_and_replies_with_ownership(self):
        with TestClient(DesktopGuard(app, TOKEN), base_url='http://127.0.0.1:19000') as client:
            for supplied in [None, 'b' * 64]:
                headers = {} if supplied is None else {'X-Studio-Instance': supplied}
                response = client.get('/api/health', headers=headers)
                self.assertEqual(response.status_code, 403)
                self.assertNotIn('x-studio-instance', response.headers)
            response = client.get('/api/health', headers={'X-Studio-Instance': TOKEN})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['x-studio-instance'], TOKEN)
            self.assertEqual(response.json()['parserVersion'], '0.9.4')

    def test_guard_does_not_weaken_host_origin_or_content_type(self):
        with TestClient(DesktopGuard(app, TOKEN), base_url='http://127.0.0.1:19000') as client:
            base = {'X-Studio-Instance': TOKEN}
            self.assertEqual(client.get('/api/health', headers={**base, 'Host': 'evil.example'}).status_code, 400)
            self.assertEqual(client.post('/api/export', json={}, headers={**base, 'Origin': 'https://evil.example'}).status_code, 403)
            self.assertEqual(client.post('/api/export', content='{}', headers=base).status_code, 415)
            self.assertEqual(client.post('/api/export', json={}, headers={**base, 'Origin': 'http://127.0.0.1:19000'}).status_code, 422)

    def test_package_includes_native_runtime_and_licenses(self):
        package = json.loads((ROOT / 'package.json').read_text())
        resources = {entry['to'] for entry in package['build']['extraResources']}
        self.assertTrue({'native', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-LICENSES.txt'} <= resources)
        self.assertIsNone(package['build']['publish'])
        self.assertIsNone(package['build']['mac']['identity'])
        self.assertFalse(package['build']['nsis']['deleteAppDataOnUninstall'])


if __name__ == '__main__':
    unittest.main()
