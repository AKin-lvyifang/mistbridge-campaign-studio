"""Resource-limit setup must remain usable on macOS and fail closed on overflow."""
from types import SimpleNamespace
from unittest.mock import Mock, patch
import json
from pathlib import Path
import pytest
from server.asset_limits import (MEMORY_BYTES, FILE_BYTES, WorkerBudget, WorkerLimitError,
                                 _watch_resident, apply_worker_limits)

class FakeResource:
    RLIM_INFINITY = -1
    RLIMIT_AS = 9
    RLIMIT_CPU = 0
    RLIMIT_FSIZE = 1
    RUSAGE_SELF = 0
    def __init__(self, rejected=(), inherited=None, rss=123):
        self.calls=[]; self.rejected=set(rejected); self.inherited=inherited or {}; self.rss=rss
    def getrlimit(self, which): return self.inherited.get(which,(-1,-1))
    def setrlimit(self,which,values):
        self.calls.append((which,values))
        if which in self.rejected: raise ValueError('current usage exceeds maximum limit')
    def getrusage(self, _): return SimpleNamespace(ru_maxrss=self.rss)


def test_linux_retains_hard_address_cpu_and_file_caps():
    resource=FakeResource()
    budget=apply_worker_limits(platform='linux',resource_module=resource)
    assert resource.calls==[(9,(MEMORY_BYTES,MEMORY_BYTES)),(0,(40,45)),(1,(FILE_BYTES,FILE_BYTES))]
    assert budget.report['memory']=='kernel-address-space'
    assert budget.watcher is None


def test_darwin_never_caps_reserved_virtual_address_space_and_keeps_other_limits():
    resource=FakeResource(rejected={9},rss=1024*1024)
    budget=apply_worker_limits(platform='darwin',resource_module=resource)
    try:
        assert [c[0] for c in resource.calls]==[0,1]
        assert budget.report['memory']=='peak-rss-watchdog'
        assert budget.read_memory()==1024*1024
        assert budget.watcher.is_alive()
    finally: budget.close()
    assert not budget.watcher.is_alive()


def test_one_rejected_limit_does_not_disable_other_guards():
    resource=FakeResource(rejected={9,0})
    budget=apply_worker_limits(platform='linux',resource_module=resource)
    try:
        assert [c[0] for c in resource.calls]==[9,0,1]
        assert budget.report['addressSpace']==budget.report['cpu']=='unavailable'
        assert budget.report['fileSize']=='enforced'
        assert budget.read_memory()==123*1024
    finally: budget.close()


def test_preexisting_lower_limits_are_never_raised():
    resource=FakeResource(inherited={9:(1000,2000),0:(10,20),1:(1024,2048)})
    budget=apply_worker_limits(platform='linux',resource_module=resource)
    assert resource.calls==[(9,(1000,2000)),(0,(10,20)),(1,(1024,2048))]
    budget.close()


def test_memory_guard_refuses_over_budget_at_start_and_end():
    with pytest.raises(WorkerLimitError,match='resident-memory'):
        apply_worker_limits(platform='darwin',resource_module=FakeResource(rss=MEMORY_BYTES+1))
    state={'rss':1}; budget=WorkerBudget({},read_memory=lambda:state['rss'])
    budget.check(); state['rss']=MEMORY_BYTES+1
    with pytest.raises(WorkerLimitError): budget.check()


def test_watchdog_terminates_on_memory_overflow_and_measurement_failure():
    for reader,code in [(lambda:MEMORY_BYTES+1,78),(lambda:-1,78),(Mock(side_effect=OSError('no measurement')),79)]:
        stop=Mock();stop.wait.return_value=False;terminate=Mock()
        _watch_resident(reader,stop,terminate)
        terminate.assert_called_once_with(code)


def test_missing_windows_resource_module_keeps_format_and_parent_deadline_guards():
    with patch.dict('sys.modules',{'resource':None}):
        budget=apply_worker_limits(platform='win32')
    assert budget.report['memory']=='format-allocation-bounds'
    assert budget.report['cpu']=='parent-wall-clock'
    assert budget.watcher is None


def test_worker_limit_setup_failure_writes_structured_safe_result(tmp_path):
    from server.asset_worker import main
    request=tmp_path/'request.json';response=tmp_path/'response.json'
    request.write_text('{}')
    with patch('sys.argv',['worker',str(request),str(response)]), patch('server.asset_limits.apply_worker_limits',side_effect=WorkerLimitError('Worker memory measurement is unavailable.')):
        main()
    assert json.loads(response.read_text())=={'ok':False,'error':'Worker memory measurement is unavailable.'}


def test_desktop_workflow_does_not_mask_native_command_failures():
    source=(Path(__file__).resolve().parent.parent/'.github/workflows/desktop.yml').read_text()
    assert 'run: |' not in source
    assert 'run: npm run check\n' in source
    assert 'run: npm run test:desktop\n' in source
    assert "NPM_CONFIG_AUDIT: 'false'" in source


def test_watchdog_remains_active_through_response_serialization_and_write(tmp_path):
    from server.asset_worker import main
    request=tmp_path/'request.json'; response=tmp_path/'response.json'
    request.write_text('{}')
    state={'closed':False,'writes':0,'serializations':0}
    budget=SimpleNamespace(report={'memory':'test-watchdog'},check=Mock(),
                           close=lambda:state.update(closed=True))
    original_dump=json.dumps
    original_write=Path.write_text
    def guarded_dump(*args,**kwargs):
        assert state['closed'] is False
        state['serializations']+=1
        return original_dump(*args,**kwargs)
    def guarded_write(path,*args,**kwargs):
        assert state['closed'] is False
        state['writes']+=1
        return original_write(path,*args,**kwargs)
    with patch('sys.argv',['worker',str(request),str(response)]), \
         patch('server.asset_limits.apply_worker_limits',return_value=budget), \
         patch('server.asset_worker.work',return_value={'kind':'synthetic'}), \
         patch('server.asset_worker.json.dumps',side_effect=guarded_dump), \
         patch.object(Path,'write_text',guarded_write):
        main()
    assert state=={'closed':True,'writes':1,'serializations':1}
    assert budget.check.call_count==3
    assert json.loads(response.read_text())['ok'] is True
