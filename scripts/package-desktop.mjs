import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
const manifestPath = 'build/native/studio-native/_internal/licenses/native-build.json';
if (!existsSync(manifestPath)) throw new Error('Build the frozen runtime with npm run native:build first.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const arch = { AMD64: 'x64', x86_64: 'x64', arm64: 'arm64', aarch64: 'arm64' }[manifest.architecture];
if (manifest.platform !== process.platform || arch !== process.arch) throw new Error('Native runtime must match this host OS and CPU architecture.');
if (!['darwin', 'win32', 'linux'].includes(process.platform)) throw new Error('Unsupported packaging platform.');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--dir')) throw new Error('Only --dir is supported; cross-platform/architecture packaging is intentionally blocked.');
const result = spawnSync(process.execPath, [path.resolve('node_modules/electron-builder/out/cli/cli.js'),
  '--publish', 'never', '--' + process.arch, ...args], { stdio: 'inherit',
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
process.exit(result.status ?? 1);
