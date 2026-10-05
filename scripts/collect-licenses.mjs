import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const npm=process.platform==='win32'?'npm.cmd':'npm';
const result=spawnSync(npm,['ls','--omit=dev','--all','--parseable'],{encoding:'utf8',shell:process.platform==='win32'});
if(result.status!==0)throw new Error('Install the locked dependencies before collecting notices.');
const blocks=[];
for(const root of [...new Set(result.stdout.trim().split('\n'))].slice(1)){
 const p=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
 const files=readdirSync(root).filter(f=>/^(license|licence|copying)(\.|$)/i.test(f));
 let content=files.map(f=>`${f}\n${readFileSync(path.join(root,f),'utf8')}`).join('\n');
 if(!content)content=`License declaration: ${JSON.stringify(p.license||'See upstream package')}\nRepository: ${JSON.stringify(p.repository||'See lockfile')}`;
 blocks.push(`${'='.repeat(72)}\n${p.name} ${p.version}\n${content}`);
}
writeFileSync('docs/THIRD-PARTY-LICENSES.txt',blocks.join('\n\n')+'\n');
console.log(`Collected ${blocks.length} installed production package notices.`);
