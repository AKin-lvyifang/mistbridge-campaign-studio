import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const local=process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python';
const p=spawnSync(process.env.PYTHON||(existsSync(local)?local:'python'),['-m','unittest','discover','-s','tests','-p','test_*.py','-v'],{stdio:'inherit'});
process.exit(p.status??1);
