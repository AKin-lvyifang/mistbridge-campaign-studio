// Test the shipped native executable without Python/Node dependencies in its cwd.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const { NativeService } = require('../electron/native-service.cjs');
const root = path.resolve('.');
const packaged = process.argv.includes('--packaged');
let bundle = path.resolve('build/native/studio-native');
if (packaged) {
  const candidates = fs.readdirSync('release', { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry =>
    process.platform === 'darwin'
      ? path.resolve('release', entry.name, 'Mistbridge Studio.app/Contents/Resources/native')
      : path.resolve('release', entry.name, 'resources/native'));
  const matches = candidates.filter(candidate => fs.existsSync(candidate));
  assert.equal(matches.length, 1, 'Expected exactly one packaged app for this platform/architecture.');
  bundle = matches[0];
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), '雾桥 packaged smoke '));
const resources = path.join(temporary, 'resources');
const stage = path.join(resources, 'native');
fs.mkdirSync(resources);
fs.cpSync(bundle, stage, { recursive: true });
const executable = path.join(stage, process.platform === 'win32' ? 'studio-native.exe' : 'studio-native');
const environment = { ...process.env };
delete environment.PYTHONHOME; delete environment.PYTHONPATH;
let service;
let blocker;
try {
  for (const file of ['dist/index.html', 'licenses/LICENSE', 'licenses/LICENSE.Python.txt',
    'licenses/LICENSE.AoE2ScenarioParser', 'licenses/THIRD-PARTY-LICENSES.txt',
    'AoE2ScenarioParser/versions/DE/v1.59/default.aoe2scenario']) {
    assert.ok(fs.existsSync(path.join(stage, '_internal', file)), 'Missing bundled resource: ' + file);
  }
  assert.equal(fs.existsSync(path.join(stage, '_internal/AoE2ScenarioParser/dependencies/xs-check/xs-check')), false);
  const tested = spawnSync(executable, ['--self-test'], { cwd: temporary, env: environment, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert.equal(tested.status, 0, tested.stderr || tested.stdout || tested.error?.message);
  const report = JSON.parse(tested.stdout.trim());
  assert.equal(report.frozen, true);
  assert.equal(report.parserVersion, '0.9.4');

  // An unrelated server must remain untouched, regardless of local availability.
  let unrelatedRequests = 0;
  blocker = createServer((_request, response) => { unrelatedRequests++; response.end('{}'); });
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  const options = { packaged: true, resourcesPath: resources, root: temporary };
  service = new NativeService(options);
  const origin = await service.start();
  assert.notEqual(new URL(origin).port, String(blocker.address().port));
  const headers = { 'X-Studio-Instance': service.token };
  assert.equal((await fetch(origin + '/api/health')).status, 403);
  assert.equal((await fetch(origin + '/api/health', { headers: { 'X-Studio-Instance': 'b'.repeat(64) } })).status, 403);
  const frontend = await fetch(origin, { headers });
  assert.equal(frontend.status, 200);
  assert.match(await frontend.text(), /<html/);
  const lui = await fetch(origin + '/api/lui/status', { headers });
  assert.equal(lui.status, 200);
  const luiStatus = await lui.json();
  assert.equal(luiStatus.configured, false);
  assert.equal(luiStatus.storage, 'session-memory');
  assert.ok(Number.isSafeInteger(luiStatus.sessionRevision) && luiStatus.sessionRevision >= 0);
  assert.equal('key' in luiStatus, false);
  assert.equal(lui.headers.get('cache-control'), 'no-store');
  const imported = await fetch(origin + '/api/import?filename=' + encodeURIComponent('雾桥 fixture.aoe2scenario'),
    { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', Origin: origin },
      body: fs.readFileSync(path.join(root, 'fixtures/preservation-1.59.aoe2scenario')) });
  assert.equal(imported.status, 200, await imported.clone().text());
  const { project } = await imported.json();
  const exported = await fetch(origin + '/api/export', { method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ project }) });
  assert.equal(exported.status, 200, await exported.clone().text());
  assert.equal(exported.headers.get('x-native-verified'), 'fresh-process');
  assert.deepEqual(Buffer.from(await exported.arrayBuffer()), fs.readFileSync(path.join(root, 'fixtures/preservation-1.59.aoe2scenario')));
  const forbidden = await fetch(origin + '/api/export', { method: 'POST', headers: {
    ...headers, 'Content-Type': 'application/json', Origin: 'https://unrelated.invalid' }, body: '{}' });
  assert.equal(forbidden.status, 403);
  assert.equal(unrelatedRequests, 0);
  await service.stop();
  await assert.rejects(fetch(origin + '/api/health', { headers, signal: AbortSignal.timeout(1000) }));
  // A subsequent desktop launch starts its own fresh service; unexpected exits
  // are reported instead of quietly switching to another loopback service.
  const previousToken = service.token;
  service = new NativeService(options);
  await service.start();
  assert.notEqual(service.token, previousToken);
  const failure = new Promise(resolve => service.once('failure', resolve));
  service.child.kill();
  const error = await Promise.race([failure, new Promise((_, reject) => setTimeout(() => reject(new Error('Missing service failure event')), 5000).unref())]);
  assert.match(error.message, /stopped/);
  await service.stop();
  console.log(JSON.stringify({ ...report, packagedResources: packaged, unicodePath: true,
    httpNativeRoundtrip: true, luiUnconfigured: true, privateLoopback: true, shutdown: true, relaunch: true, failureReporting: true }));
} finally {
  await service?.stop();
  if (blocker) await new Promise(resolve => blocker.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
}
