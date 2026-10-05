"""Observed local adapter timings; not a game or rendering benchmark."""
from __future__ import annotations
import copy
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import statistics
import time
from server.native import export_scenario, import_scenario

ROOT=Path(__file__).resolve().parent.parent


def main():
    fixture=ROOT/'fixtures/preservation-1.59.aoe2scenario'
    raw=fixture.read_bytes()
    project=import_scenario(raw,fixture.name)['project']
    changed=copy.deepcopy(project)
    changed['map']['tiles'][17]['terrain']=9
    changed['map']['tiles'][17]['elevation']=2
    next(o for o in changed['objects'] if o['id']=='native-10')['x']=22.5
    generated_path=ROOT/'fixtures/generated-mistbridge-project.json'
    generated=json.loads(generated_path.read_text('utf-8'))
    cases=[('import_preservation_80',lambda:import_scenario(raw,fixture.name)),
           ('noop_export_preservation_80',lambda:export_scenario(project)),
           ('edited_export_preservation_80',lambda:export_scenario(changed)),
           ('new_mistbridge_export_120',lambda:export_scenario(generated))]
    report={'measuredAt':datetime.now(timezone.utc).isoformat(),'python':platform.python_version(),
            'platform':platform.platform(),'machine':platform.machine(),'logicalCpus':os.cpu_count(),
            'parser':importlib.metadata.version('AoE2ScenarioParser'),'fastapi':importlib.metadata.version('fastapi'),
            'method':'Three sequential wall-clock samples per case with time.perf_counter. Each import starts a fresh worker; each export compiles and verifies in two fresh workers. Concurrent development tasks may affect timings.',
            'fixtureSha256':hashlib.sha256(raw).hexdigest(),
            'generatedProjectSha256':hashlib.sha256(generated_path.read_bytes()).hexdigest(),
            'newProject':{'width':generated['map']['width'],'height':generated['map']['height'],
                          'objects':len(generated['objects']),'storyNodes':len(generated['story'])},
            'gameTested':False,'cases':[]}
    for name,action in cases:
        samples=[]
        for _ in range(3):
            start=time.perf_counter();result=action();samples.append(round(time.perf_counter()-start,4))
        case={'name':name,'seconds':samples,'medianSeconds':round(statistics.median(samples),4),
              'minSeconds':min(samples),'maxSeconds':max(samples)}
        if isinstance(result,tuple):
            binary, verification=result
            case.update({'outputBytes':len(binary),'sha256':hashlib.sha256(binary).hexdigest(),
                         'verified':verification['verified'],'objects':verification['objects'],
                         'triggers':verification['triggers'],'byteIdentical':verification['byteIdentical']})
            if name=='new_mistbridge_export_120':
                (ROOT/'fixtures/generated-mistbridge-1.59.aoe2scenario').write_bytes(binary)
        report['cases'].append(case)
        print(json.dumps(case),flush=True)
    path=ROOT/'docs/native-benchmark.json'
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
    print(path)

if __name__=='__main__':main()
