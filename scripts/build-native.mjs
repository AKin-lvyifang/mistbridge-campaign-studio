import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const local = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
const python = process.env.PYTHON || (existsSync(local) ? local : (process.platform === 'win32' ? 'python' : 'python3'));
const result = spawnSync(python, ['scripts/build-native.py'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
