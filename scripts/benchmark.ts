import { createProject, generateMap, validateProject, compileAi } from '../src/domain';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
const observations=[];
for(const size of [64,120,240,480]){
 const samples=[]; let objects=0;
 for(let i=0;i<5;i++){const t=performance.now();const result=generateMap({seed:240518,size,theme:'river',forest:42});samples.push(performance.now()-t);objects=result.objects.length;}
 const project=createProject({size});const t=performance.now();const diagnostics=validateProject(project);const validationMs=performance.now()-t;
 observations.push({size,tiles:size*size,objects,generationMs:samples.map(n=>+n.toFixed(2)),medianGenerationMs:+[...samples].sort((a,b)=>a-b)[2].toFixed(2),validationMs:+validationMs.toFixed(2),errors:diagnostics.filter(d=>d.severity==='error').length});
}
const report={date:new Date().toISOString(),runtime:process.version,platform:process.platform,architecture:process.arch,cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length,memoryGiB:+(os.totalmem()/1024**3).toFixed(2),method:'Five seeded map generation runs per size in a Node process; no warmup exclusion. Structural validation once per size. Does not measure browser rendering or game performance.',observations};
mkdirSync('docs',{recursive:true});writeFileSync('docs/benchmark.json',JSON.stringify(report,null,2)+'\n');
const sample=createProject();mkdirSync('fixtures',{recursive:true});writeFileSync('fixtures/generated-mistbridge-project.json',JSON.stringify(sample));writeFileSync('fixtures/generated-mistbridge.per',compileAi(sample.behavior));
console.log(JSON.stringify(report,null,2));
