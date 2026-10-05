"""Native binary regressions. Run: .venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v"""
from __future__ import annotations
import base64
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from fastapi.testclient import TestClient
from server.app import app
from server.native import NativeError, export_scenario, import_scenario, run_worker
from server.native_worker import load_scenario, section_hashes, trigger_hashes

ROOT = Path(__file__).resolve().parent.parent
EMPTY = ROOT/'fixtures/upstream/default-1.59.aoe2scenario'
RICH = ROOT/'fixtures/preservation-1.59.aoe2scenario'

class NativeRoundtripTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.empty = import_scenario(EMPTY.read_bytes(), EMPTY.name)['project']
        cls.rich = import_scenario(RICH.read_bytes(), RICH.name)['project']

    def parse(self, binary):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = Path(folder.name)/'exported.aoe2scenario'
        path.write_bytes(binary)
        return load_scenario(path)

    def new_project(self):
        p = copy.deepcopy(self.empty)
        p.pop('native')
        p['name'] = '雾桥 native test'
        p['map'] = {'width':36,'height':36,'tiles':[{'terrain':0,'elevation':0} for _ in range(36*36)]}
        p['objects'] = [{'id':'scout','nativeId':448,'player':1,'x':8.5,'y':9.5,
                         'rotation':90,'label':'Scout','category':'unit'}]
        return p

    def test_public_fixture_hash_and_version(self):
        self.assertEqual(hashlib.sha256(EMPTY.read_bytes()).hexdigest(),
                         '99155dfc6c6487220f6b982808ff1aad552f6985027e9aa1e10e2eb74ab5928b')
        self.assertEqual(EMPTY.read_bytes()[:4], b'1.59')
        self.assertEqual(self.empty['map']['width'], 80)
        self.assertEqual(base64.b64decode(self.empty['native']['originalBase64']), EMPTY.read_bytes())

    def test_zero_edit_returns_identical_original_bytes(self):
        for path, project in [(EMPTY,self.empty),(RICH,self.rich)]:
            binary, report = export_scenario(project)
            self.assertEqual(binary,path.read_bytes())
            self.assertTrue(report['verified'])
            self.assertTrue(report['byteIdentical'])

    def test_terrain_object_edits_preserve_native_data(self):
        p = copy.deepcopy(self.rich)
        p['map']['tiles'][0] = {'terrain':2,'elevation':2}
        tc = next(o for o in p['objects'] if o['id']=='native-10')
        tc['x']=21.5
        tc['rotation']=180
        p['objects'] = [o for o in p['objects'] if o['id'] != 'native-13']
        p['objects'].append({'id':'new-villager','nativeId':83,'player':1,'x':22.5,'y':22.5,
                             'rotation':0,'label':'Villager','category':'unit'})
        binary, report = export_scenario(p)
        s = self.parse(binary)
        original = load_scenario(RICH)
        self.assertEqual(s.map_manager.terrain[0].terrain_id,2)
        self.assertEqual(s.map_manager.terrain[0].elevation,2)
        self.assertEqual(s.map_manager.terrain[17].layer,2)
        units = {u.reference_id:u for g in s.unit_manager.units for u in g}
        self.assertEqual(units[10].x,21.5)
        self.assertNotIn(13,units)
        self.assertEqual(units[12].unit_const,65000)
        self.assertEqual(units[12].status,3)
        self.assertEqual(units[12].initial_animation_frame,7)
        self.assertEqual(units[12].caption_string,'Opaque unsupported object')
        self.assertTrue(any(u.unit_const==83 for u in units.values()))
        self.assertEqual(trigger_hashes(s),trigger_hashes(original))
        self.assertEqual(s.player_manager.players[1].gold,1234)
        self.assertEqual(s.message_manager.hints,'A hint that the UI does not edit')
        for name in ['Cinematics','BackgroundImage','PlayerDataTwo','GlobalVictory','Diplomacy','Options','Files']:
            self.assertEqual(section_hashes(s)[name],section_hashes(original)[name])
        self.assertTrue(report['verified'])

    def test_new_project_exports_real_all_story_effects(self):
        p = self.new_project()
        p['description']='中文 instructions'
        p['story']=[{'id':kind,'name':kind,'enabled':True,'delay':10+i,'kind':kind,'text':'你好，旅人',
                     'player':1,'x':14,'y':15,'objectId':'scout','duration':8 if kind=='dialogue' else 0}
                    for i,kind in enumerate(['dialogue','camera','move','victory'])]
        binary, report=export_scenario(p)
        self.assertEqual(binary[:4],b'1.59')
        s=self.parse(binary)
        self.assertEqual(s.map_manager.map_size,36)
        self.assertEqual(s.message_manager.instructions,'中文 instructions')
        self.assertEqual(len(s.trigger_manager.triggers),4)
        from AoE2ScenarioParser.datasets.effects import EffectId
        self.assertEqual([t.effects[0].effect_type for t in s.trigger_manager.triggers],
                         [EffectId.DISPLAY_INSTRUCTIONS,EffectId.CHANGE_VIEW,EffectId.TASK_OBJECT,EffectId.DECLARE_VICTORY])
        self.assertEqual(s.trigger_manager.triggers[0].effects[0].message,'你好，旅人')
        self.assertEqual(s.trigger_manager.triggers[2].effects[0].selected_object_ids,[0])
        self.assertEqual([t.conditions[0].timer for t in s.trigger_manager.triggers],[10,11,12,13])
        self.assertTrue(report['verified'])

    def test_story_appends_existing_triggers_and_repeat_export_is_stable(self):
        p=copy.deepcopy(self.rich)
        p['story']=[{'id':'dialogue','name':'追加','enabled':False,'delay':10,'kind':'dialogue',
                     'text':'新增事件','player':1,'x':10,'y':10,'duration':8}]
        a, report=export_scenario(p)
        b, _=export_scenario(p)
        self.assertEqual(a,b)
        s=self.parse(a)
        self.assertEqual(len(s.trigger_manager.triggers),2)
        self.assertEqual(trigger_hashes(s)[0],trigger_hashes(load_scenario(RICH))[0])
        self.assertFalse(s.trigger_manager.triggers[1].enabled)
        self.assertEqual(report['originalTriggerCount'],1)

    def test_locked_objects_and_references_are_guarded(self):
        for ref in ['native-12','native-11']:
            p=copy.deepcopy(self.rich)
            p['objects']=[o for o in p['objects'] if o['id']!=ref]
            with self.assertRaises(NativeError): export_scenario(p)
        p=copy.deepcopy(self.rich)
        next(o for o in p['objects'] if o['id']=='native-12')['x']=1
        with self.assertRaisesRegex(NativeError,'Locked'): export_scenario(p)

    def test_tamper_resize_future_version_and_trailing_data_rejected(self):
        p=copy.deepcopy(self.empty)
        p['native']['sha256']='0'*64
        with self.assertRaisesRegex(NativeError,'SHA-256'): export_scenario(p)
        p=copy.deepcopy(self.empty)
        p['map']={'width':36,'height':36,'tiles':[{'terrain':0,'elevation':0} for _ in range(36*36)]}
        with self.assertRaisesRegex(NativeError,'Resizing'): export_scenario(p)
        for version in [b'1.58',b'1.60']:
            with self.assertRaisesRegex(NativeError,'Untested'):
                import_scenario(version+EMPTY.read_bytes()[4:],'future.aoe2scenario')
        with self.assertRaises(NativeError): import_scenario(EMPTY.read_bytes()+b'extra','tail.aoe2scenario')
        with self.assertRaises(NativeError): import_scenario(EMPTY.read_bytes()[:100],'broken.aoe2scenario')

    def test_custom_ai_editor_locks_and_original_filename(self):
        p=copy.deepcopy(self.empty)
        p['name']='original'
        p['customAi']='(defrule (true) => (disable-self))'
        binary, report=export_scenario(p)
        self.assertEqual(binary,EMPTY.read_bytes())
        p=self.new_project()
        p['customAi']='; custom AI remains companion data'
        p['objects'][0]['locked']=True
        binary, report=export_scenario(p)
        self.assertTrue(report['verified'])
        self.assertEqual(report['objects'],1)

    def test_story_move_owner_and_category_validation(self):
        p=self.new_project()
        p['story']=[{'id':'move','name':'move','enabled':True,'delay':0,'kind':'move','text':'',
                     'player':2,'x':10,'y':10,'objectId':'scout','duration':0}]
        with self.assertRaisesRegex(NativeError,'owner'): export_scenario(p)
        p['story'][0]['player']=1
        p['objects'][0]['nativeId']=109
        with self.assertRaisesRegex(NativeError,'unit target'): export_scenario(p)

    def test_client_lock_flag_cannot_bypass_native_bounds(self):
        for x in [-20, 1e38]:
            p=copy.deepcopy(self.rich)
            obj=next(o for o in p['objects'] if o['id']=='native-10')
            obj['locked']=True
            obj['x']=x
            with self.assertRaisesRegex(NativeError,'bounds'): export_scenario(p)

    def test_loopback_origin_host_and_content_type_guards(self):
        with TestClient(app,base_url="http://127.0.0.1:8787") as client:
            self.assertEqual(client.get('/api/health',headers={'host':'evil.example'}).status_code,400)
            self.assertEqual(client.post('/api/export',json={'project':self.empty},headers={'origin':'https://evil.example'}).status_code,403)
            self.assertEqual(client.post('/api/export',content='{}',headers={'content-type':'text/plain'}).status_code,415)
            self.assertEqual(client.post('/api/export',json={'project':self.empty},headers={'sec-fetch-site':'cross-site'}).status_code,403)
            self.assertEqual(client.post('/api/validate',json={'project':self.empty},headers={'origin':'http://127.0.0.1:5173'}).status_code,200)

    def test_worker_verification_rejects_wrong_section_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(NativeError,'verification failed'):
                run_worker({'op':'verify','source':str(EMPTY),'expected':{'sectionHashes':{},'triggerHashes':[]}},Path(temp))

    def test_http_contract(self):
        with TestClient(app,base_url="http://127.0.0.1:8787") as client:
            self.assertEqual(client.get('/api/health').json()['parserVersion'],'0.9.4')
            imported=client.post('/api/import?filename=empty.aoe2scenario',content=EMPTY.read_bytes(),
                                 headers={'content-type':'application/octet-stream'})
            self.assertEqual(imported.status_code,200,imported.text)
            payload={'project':imported.json()['project']}
            checked=client.post('/api/validate',json=payload)
            self.assertEqual(checked.status_code,200)
            self.assertFalse(any(d['severity']=='error' for d in checked.json()['diagnostics']))
            exported=client.post('/api/export',json=payload)
            self.assertEqual(exported.status_code,200,exported.text[:200])
            self.assertEqual(exported.content,EMPTY.read_bytes())
            self.assertEqual(exported.headers['X-Scenario-Version'],'1.59')
            self.assertEqual(exported.headers['X-Native-Verified'],'fresh-process')
            self.assertEqual(client.post('/api/export',json={'project':{}}).status_code,422)
            self.assertEqual(client.post('/api/import',content=b'bad',headers={'content-type':'application/octet-stream'}).status_code,422)
            self.assertEqual(client.get('/api/unknown').status_code,404)

if __name__ == '__main__':
    unittest.main()
