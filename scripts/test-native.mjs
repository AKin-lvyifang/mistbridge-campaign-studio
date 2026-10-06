import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const local=process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python';
const p=spawnSync(process.env.PYTHON||(existsSync(local)?local:'python'),['-m','pytest','tests','-q'],{stdio:'inherit'});
process.exit(p.status??1);
