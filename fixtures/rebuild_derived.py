"""Rebuild our regression fixture from AoE2ScenarioParser 0.9.4's public blank.
No game assets or proprietary campaigns are included. Run from repository root.
"""
from pathlib import Path
from AoE2ScenarioParser import settings
settings.PRINT_STATUS_UPDATES = False
settings.ENABLE_XS_CHECK_INTEGRATION = False
from AoE2ScenarioParser.scenarios.aoe2_de_scenario import AoE2DEScenario
root = Path(__file__).resolve().parent
s = AoE2DEScenario.from_file(str(root/'upstream/default-1.59.aoe2scenario'))
s.unit_manager.add_unit(player=1, unit_const=109, x=20.5, y=20.5, reference_id=10)
s.unit_manager.add_unit(player=1, unit_const=93, x=25.5, y=20.5, reference_id=11)
s.unit_manager.add_unit(player=0, unit_const=65000, x=30.5, y=30.5, reference_id=12,
                        caption_string='Opaque unsupported object', status=3, animation_frame=7)
s.unit_manager.add_unit(player=2, unit_const=74, x=40.5, y=40.5, reference_id=13)
# Explicit reference IDs do not advance the parser's generator.
from AoE2ScenarioParser.objects.managers.unit_manager import create_id_generator
s.unit_manager.reference_id_generator = create_id_generator(14)
t = s.trigger_manager.add_trigger('Existing trigger 中文', enabled=True)
t.new_condition.timer(timer=15)
t.new_effect.send_chat(source_player=1, message='原始内容 preserved')
t.new_effect.task_object(source_player=1, selected_object_ids=[11], location_x=28, location_y=28)
s.message_manager.instructions = 'Original instructions 雾桥'
s.message_manager.hints = 'A hint that the UI does not edit'
s.player_manager.players[1].gold = 1234
s.map_manager.terrain[17].terrain_id = 3
s.map_manager.terrain[17].layer = 2
s.write_to_file(str(root/'preservation-1.59.aoe2scenario'))
print(root/'preservation-1.59.aoe2scenario')
