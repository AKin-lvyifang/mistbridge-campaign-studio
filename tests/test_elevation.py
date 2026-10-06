"""All editable elevation levels survive real DE 1.59 export and re-import."""
import copy
from pathlib import Path
import unittest
from server.native import export_scenario, import_scenario

class ElevationRoundtripTests(unittest.TestCase):
    def test_every_editable_level_roundtrips_without_changing_terrain_or_objects(self):
        fixture = Path(__file__).resolve().parent.parent/'fixtures/upstream/default-1.59.aoe2scenario'
        project = import_scenario(fixture.read_bytes(), fixture.name)['project']
        project.pop('native')
        project['map'] = {'width':36, 'height':36, 'tiles':[{'terrain':0,'elevation':0} for _ in range(36*36)]}
        for elevation in range(17):
            project['map']['tiles'][10*36+elevation+5] = {'terrain':24,'elevation':elevation}
        project['objects'] = [{'id':'grounded-scout','nativeId':448,'player':1,'x':10.5,'y':10.5,'rotation':0,'label':'Scout','category':'unit'}]
        project['story'] = []
        original = copy.deepcopy(project)
        binary, report = export_scenario(project)
        result = import_scenario(binary, 'elevation-roundtrip.aoe2scenario')['project']
        self.assertTrue(report['verified'])
        self.assertEqual(project, original)
        for elevation in range(17):
            self.assertEqual(result['map']['tiles'][10*36+elevation+5], {'terrain':24,'elevation':elevation})
        scout = next(o for o in result['objects'] if o['nativeId']==448)
        self.assertEqual((scout['x'],scout['y']),(10.5,10.5))
