// Launch the actual packaged GUI with a fresh throwaway profile and bounded wait.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const directories = fs.readdirSync('release', { withFileTypes: true }).filter(entry => entry.isDirectory());
const candidates = directories.map(entry => process.platform === 'darwin'
  ? path.resolve('release', entry.name, 'Mistbridge Studio.app/Contents/MacOS/Mistbridge Studio')
  : path.resolve('release', entry.name, 'Mistbridge Studio.exe')).filter(file => fs.existsSync(file));
assert.equal(candidates.length, 1, 'Expected one platform-native packaged GUI executable.');
fs.mkdirSync('build/smoke', { recursive: true });
const child = spawn(candidates[0], ['--studio-smoke-test'], { stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, STUDIO_SMOKE_SCREENSHOT: path.resolve('build/smoke/desktop.png') } });
let stdout = '', stderr = '';
child.stdout.on('data', data => { stdout += data; process.stdout.write(data); });
child.stderr.on('data', data => { stderr = (stderr + data).slice(-16384); process.stderr.write(data); });
const timeout = setTimeout(() => { child.kill(); }, 120000);
try {
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(code, 0, 'Packaged app failed or timed out: ' + stderr);
  const line = stdout.split('\n').find(line => line.startsWith('STUDIO_APP_SMOKE '));
  assert.ok(line, 'Packaged app did not report a completed renderer/native smoke test.');
  const report = JSON.parse(line.slice('STUDIO_APP_SMOKE '.length));
  assert.equal(report.packaged, true);
  assert.equal(report.renderer, true);
  if (process.platform === 'darwin') assert.equal(report.macCloseReopen, true);
  fs.writeFileSync('build/smoke/desktop.json', JSON.stringify(report, null, 2) + '\n');
} finally { clearTimeout(timeout); }
