'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NativeService, runtimeCommand } = require('./native-service.cjs');

function folder(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('packaged app refuses external Python fallback', t => {
  const root = folder(t);
  assert.throws(() => runtimeCommand({ packaged: true, resourcesPath: root, root, env: { STUDIO_PYTHON: process.execPath } }), /bundled native runtime is missing/);
});
test('packaged app prefers bundled binary and ignores environment override', t => {
  const root = folder(t);
  fs.mkdirSync(path.join(root, 'native'));
  fs.writeFileSync(path.join(root, 'native/studio-native'), 'fixture');
  const command = runtimeCommand({ packaged: true, resourcesPath: root, root, platform: 'darwin', env: { STUDIO_PYTHON: '/unrelated/python' } });
  assert.equal(command.executable, path.join(root, 'native/studio-native'));
  assert.deepEqual(command.args, ['--serve']);
});
test('Windows packaged binary is platform-specific', t => {
  const root = folder(t);
  fs.mkdirSync(path.join(root, 'native'));
  fs.writeFileSync(path.join(root, 'native/studio-native.exe'), 'fixture');
  assert.equal(runtimeCommand({ packaged: true, resourcesPath: root, root, platform: 'win32' }).executable, path.join(root, 'native/studio-native.exe'));
});
test('development Python uses desktop entrypoint', t => {
  const root = folder(t);
  const command = runtimeCommand({ packaged: false, resourcesPath: root, root, env: { STUDIO_PYTHON: process.execPath } });
  assert.deepEqual(command.args, ['-m', 'server.entrypoint', '--serve']);
});
test('instance tokens differ and are never persisted', t => {
  const root = folder(t);
  const options = { packaged: true, resourcesPath: root, root };
  const a = new NativeService(options), b = new NativeService(options);
  assert.match(a.token, /^[a-f0-9]{64}$/);
  assert.notEqual(a.token, b.token);
  assert.deepEqual(fs.readdirSync(root), []);
});
test('stopping before launch is safe and idempotent', async () => {
  const service = new NativeService({});
  await Promise.all([service.stop(), service.stop()]);
  assert.equal(service.stopping, true);
});
