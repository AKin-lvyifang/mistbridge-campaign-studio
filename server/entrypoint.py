"""Desktop service and frozen one-shot worker entrypoint.

The parent owns a private stdin pipe. Closing it requests service shutdown. The
socket is bound to an ephemeral loopback port before its number is announced;
Electron never probes or attaches to an existing listener.
"""
from __future__ import annotations

import argparse
import hmac
import json
import os
from pathlib import Path
import re
import socket
import sys
import threading

TOKEN_HEADER = b'x-studio-instance'


class DesktopGuard:
    """Ephemeral per-launch ownership proof; no credential is persisted."""
    def __init__(self, app, token: str):
        self.app = app
        self.token = token.encode('ascii')

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http':
            headers = dict(scope.get('headers', []))
            if not hmac.compare_digest(headers.get(TOKEN_HEADER, b''), self.token):
                await send({'type': 'http.response.start', 'status': 403,
                            'headers': [(b'content-type', b'application/json'), (b'cache-control', b'no-store')]})
                await send({'type': 'http.response.body', 'body': b'{"detail":"Desktop instance token required."}'})
                return
        if scope['type'] == 'websocket':
            await send({'type': 'websocket.close', 'code': 1008})
            return

        async def owned_send(message):
            if message['type'] == 'http.response.start' and scope.get('path') == '/api/health':
                message = {**message, 'headers': [*message.get('headers', []), (TOKEN_HEADER, self.token)]}
            await send(message)
        await self.app(scope, receive, owned_send)


def serve() -> None:
    token = os.environ.pop('STUDIO_INSTANCE_TOKEN', '')
    if not re.fullmatch(r'[0-9a-f]{64}', token):
        raise ValueError('Desktop launch requires a fresh 64-character instance token.')
    import uvicorn
    from server.app import app
    # Binding port zero in the child reserves the actual socket until shutdown.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(('127.0.0.1', 0))
        listener.listen(128)
        server = uvicorn.Server(uvicorn.Config(DesktopGuard(app, token), host='127.0.0.1',
                                port=listener.getsockname()[1], log_level='warning',
                                access_log=False, loop='asyncio', http='h11', ws='none',
                                timeout_graceful_shutdown=3))

        def parent_lifetime():
            # The stdin pipe belongs to the parent. EOF is also delivered if it dies.
            try:
                sys.stdin.buffer.read(1)
            finally:
                server.should_exit = True
        threading.Thread(target=parent_lifetime, daemon=True, name='desktop-parent-watch').start()
        print('STUDIO_READY ' + json.dumps({'port': listener.getsockname()[1], 'pid': os.getpid()}), flush=True)
        server.run(sockets=[listener])


def self_test() -> None:
    """Exercise bundled data, metadata, fresh workers and the new-map fixture."""
    from importlib.metadata import version
    from server.native import ROOT, import_scenario, export_scenario
    root = ROOT
    fixture = root / 'fixtures/upstream/default-1.59.aoe2scenario'
    raw = fixture.read_bytes()
    project = import_scenario(raw, '空白 场景.aoe2scenario')['project']
    binary, report = export_scenario(project)
    if binary != raw or not report['verified']:
        raise RuntimeError('Frozen no-op roundtrip failed.')
    project.pop('native')
    project['name'] = '雾桥 packaged smoke'
    project['map']['tiles'][0]['terrain'] = 2
    binary, report = export_scenario(project)
    imported = import_scenario(binary, '新场景.aoe2scenario')
    if not report['verified'] or imported['project']['map']['tiles'][0]['terrain'] != 2:
        raise RuntimeError('Frozen new-map compile failed.')
    authored = json.loads((root / 'fixtures/generated-mistbridge-project.json').read_text('utf-8'))
    authored['name'] = '雾桥 packaged authored test'
    authored['objects'][0]['x'] += 0.25
    authored['story'][0]['text'] = '打包验证：中文剧情与对象改动'
    authored_binary, authored_report = export_scenario(authored)
    authored_import = import_scenario(authored_binary, '原创关卡.aoe2scenario')
    if (not authored_report['verified'] or
            len(authored_import['project']['objects']) != len(authored['objects']) or
            len(authored_report['triggerHashes']) != len(authored['story'])):
        raise RuntimeError('Frozen authored object/story compilation failed.')
    if not (root / 'dist/index.html').is_file():
        raise RuntimeError('Bundled frontend is missing.')
    print(json.dumps({'ok': True, 'frozen': bool(getattr(sys, 'frozen', False)),
                      'parserVersion': version('AoE2ScenarioParser'),
                      'nativeVerified': 'fresh-process', 'newMapBytes': len(binary),
                      'authoredObjects': len(authored['objects']), 'authoredTriggers': len(authored['story']),
                      'gameTested': False}))


def main(argv=None) -> None:
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0] == '--worker':
        if len(args) != 3:
            raise SystemExit('Worker mode requires request and response paths.')
        # Deliberately imported only after dispatch. The HTTP process never loads
        # native_worker or the AoE2 parser. This remains a new process per operation.
        from server.native_worker import main as worker_main
        sys.argv = [sys.argv[0], *args[1:]]
        worker_main()
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['--serve', '--self-test'], nargs='?')
    # Explicit flags keep frozen dispatch and source dispatch identical.
    if args == ['--serve']:
        serve()
    elif args == ['--self-test']:
        self_test()
    else:
        parser.error('Choose --serve, --self-test, or --worker REQUEST RESPONSE.')


if __name__ == '__main__':
    main()
