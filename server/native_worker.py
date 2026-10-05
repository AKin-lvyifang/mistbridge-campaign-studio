"""One-shot native parser worker. Never import this module in the HTTP process.

Only one tested scenario version is loaded per process. Native scripts are data;
XS checking/external helpers are disabled. All file paths come from our runner.
"""
from __future__ import annotations

import base64
import contextlib
import hashlib
import io
import json
import math
import os
from pathlib import Path
from types import SimpleNamespace
import sys
import uuid
import zlib
from datetime import datetime, timezone

from server.models import ASSETS, TERRAINS, SUPPORTED_VERSION, validate_project

MAX_NATIVE_BYTES = 16 * 1024 * 1024
MAX_EXPANDED_BYTES = 128 * 1024 * 1024
ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / 'fixtures' / 'upstream' / 'default-1.59.aoe2scenario'


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def bounded_decompress(data: bytes) -> bytes:
    decoder = zlib.decompressobj(-zlib.MAX_WBITS)
    output = decoder.decompress(data, MAX_EXPANDED_BYTES + 1)
    if len(output) > MAX_EXPANDED_BYTES or decoder.unconsumed_tail:
        raise ValueError('Decompressed native content exceeds the 128 MiB limit.')
    if not decoder.eof or decoder.unused_data:
        raise ValueError('Truncated or trailing compressed scenario data is not supported.')
    return output


def load_scenario(path: Path):
    if path.stat().st_size > MAX_NATIVE_BYTES:
        raise ValueError('Native file exceeds the 16 MiB limit.')
    with path.open('rb') as f:
        version = f.read(4)
    if version != SUPPORTED_VERSION.encode('ascii'):
        raise ValueError('Untested scenario version. Only ordinary AoE2 DE 1.59 is accepted.')
    import AoE2ScenarioParser
    if AoE2ScenarioParser.__version__ != '0.9.4':
        raise ValueError('The native backend requires AoE2ScenarioParser exactly 0.9.4.')
    from AoE2ScenarioParser import settings
    settings.PRINT_STATUS_UPDATES = False
    settings.ENABLE_XS_CHECK_INTEGRATION = False
    import AoE2ScenarioParser.scenarios.aoe2_scenario as parser_module
    parser_module._decompress_bytes = bounded_decompress
    from AoE2ScenarioParser.scenarios.aoe2_de_scenario import AoE2DEScenario
    scenario = AoE2DEScenario.from_file(str(path))
    if int(scenario.variant or 0) != 1:
        raise ValueError('Only the ordinary AoE2 dataset is supported; RoR and unknown variants are rejected.')
    consumed = sum(section.byte_length for name, section in scenario.sections.items() if name != 'FileHeader')
    if consumed != len(scenario._decompressed_file_data):
        raise ValueError('Unparsed native tail detected. Export is blocked to prevent data loss.')
    m = scenario.map_manager
    if m.map_width != m.map_height or not 36 <= m.map_width <= 480:
        raise ValueError('This preview supports square native maps between 36 and 480 tiles.')
    if any(not 0 <= tile.elevation <= 16 for tile in m.terrain):
        raise ValueError('This native map uses untested elevation values outside 0–16.')
    units = [u for group in scenario.unit_manager.units for u in group]
    refs = [u.reference_id for u in units]
    if len(set(refs)) != len(refs):
        raise ValueError('Duplicate native object reference IDs are unsupported.')
    if any(not math.isfinite(v) for u in units for v in (u.x, u.y, u.rotation)):
        raise ValueError('Native objects contain non-finite coordinates.')
    return scenario


def native_objects(scenario) -> list[dict]:
    objects = []
    for group in scenario.unit_manager.units:
        for u in group:
            label, category = ASSETS.get(u.unit_const, (f'Native object #{u.unit_const}', 'decoration'))
            special = (u.unit_const not in ASSETS or u.garrisoned_in_id != -1 or u.status != 2
                       or u.z != 0 or not 0 <= u.x < scenario.map_manager.map_width
                       or not 0 <= u.y < scenario.map_manager.map_height
                       or not 0 <= u.rotation <= math.tau)
            objects.append({'id': f'native-{u.reference_id}', 'nativeId': u.unit_const,
                            'player': int(u.player), 'x': u.x, 'y': u.y,
                            'rotation': math.degrees(u.rotation), 'label': label, 'category': category,
                            'nativeReferenceId': u.reference_id, 'locked': special})
    return objects


def editable_state(scenario) -> dict:
    m = scenario.map_manager
    return {'map': {'width': m.map_width, 'height': m.map_height,
                    'tiles': [{'terrain': t.terrain_id, 'elevation': t.elevation} for t in m.terrain]},
            'objects': native_objects(scenario), 'description': scenario.message_manager.instructions}


def normalized_section_hash(section) -> str:
    # ASP appends NUL to newly authored trigger strings but strips it on parse.
    # Normalize those terminators only for comparison; leave actual serialized
    # content untouched. Numeric values are compared in their native byte form.
    restored = []
    def visit(current):
        for retriever in current.retriever_map.values():
            data = retriever.data
            if isinstance(data, str) and data.endswith('\0'):
                restored.append((retriever, data))
                retriever._data = data.rstrip('\0')
            elif isinstance(data, list):
                for item in data:
                    if hasattr(item, 'retriever_map'):
                        visit(item)
    try:
        visit(section)
        return digest(section.get_data_as_bytes())
    finally:
        for retriever, data in restored:
            retriever._data = data


def section_hashes(scenario) -> dict:
    return {key: normalized_section_hash(section) for key, section in scenario.sections.items()}


def trigger_hashes(scenario) -> list[str]:
    return [normalized_section_hash(t) for t in scenario.sections['Triggers'].trigger_data]


def unit_field_hashes(scenario) -> dict:
    result = {}
    for group in scenario.sections['Units'].players_units:
        for unit in group.units:
            result[unit.reference_id] = {name: normalized_section_hash(SimpleNamespace(retriever_map={name: retriever}, get_data_as_bytes=retriever.get_data_as_bytes))
                                         for name, retriever in unit.retriever_map.items()}
    return result


def protected_references(scenario) -> set[int]:
    references = set()
    for trigger in scenario.trigger_manager.triggers:
        for condition in trigger.conditions:
            for key in ('unit_object', 'next_object'):
                value = getattr(condition, key, -1)
                if isinstance(value, int) and value >= 0:
                    references.add(value)
        for effect in trigger.effects:
            references.update(x for x in (effect.selected_object_ids or []) if x >= 0)
            for key in ('location_object_reference', 'legacy_location_object_reference'):
                value = getattr(effect, key, -1)
                if isinstance(value, int) and value >= 0:
                    references.add(value)
    for group in scenario.unit_manager.units:
        for unit in group:
            if unit.garrisoned_in_id >= 0:
                references.add(unit.garrisoned_in_id)
    return references


def import_native(payload: dict) -> dict:
    path = Path(payload['source'])
    raw = path.read_bytes()
    scenario = load_scenario(path)
    state = editable_state(scenario)
    now = datetime.now(timezone.utc).isoformat()
    filename = Path(payload.get('filename') or 'imported.aoe2scenario').name
    project = {'formatVersion': 1, 'id': str(uuid.uuid4()), 'name': Path(filename).stem,
               'description': state['description'], 'seed': 0, 'map': state['map'], 'objects': state['objects'],
               'story': [], 'behavior': {'player': 2, 'name': 'Imported AI (preserved)', 'villagers': 20,
                                        'military': 15, 'attackTime': 600, 'aggression': 'balanced'},
               'createdAt': now, 'updatedAt': now,
               'native': {'originalBase64': base64.b64encode(raw).decode('ascii'), 'filename': filename,
                          'version': SUPPORTED_VERSION, 'sha256': digest(raw),
                          'importedObjectIds': [o['id'] for o in state['objects']],
                          'importedTriggerCount': len(scenario.trigger_manager.triggers),
                          'baselineHash': digest(json.dumps(state, sort_keys=True).encode())}}
    summary = {'version': SUPPORTED_VERSION, 'width': state['map']['width'], 'height': state['map']['height'],
               'objects': len(state['objects']), 'triggers': len(scenario.trigger_manager.triggers), 'sha256': digest(raw)}
    warnings = ['Imported triggers, player settings, AI, and unsupported fields remain in the native envelope. '
                'Story edits append triggers; this interface does not edit the imported trigger graph.',
                'Parser round-trip testing does not certify game loading or playback. Open the exported file in AoE2 DE.']
    locked = sum(o['locked'] for o in state['objects'])
    if locked:
        warnings.append(f'{locked} unsupported or special native objects are locked and preserved.')
    return {'project': project, 'summary': summary, 'warnings': warnings}


def compile_native(payload: dict) -> dict:
    project, diagnostics = validate_project(payload['project'])
    errors = [d for d in diagnostics if d['severity'] == 'error']
    if errors:
        raise ValueError('; '.join(d['message'] for d in errors))
    p = project.model_dump(exclude_none=True)
    target = Path(payload['target'])
    envelope = p.get('native')
    if envelope:
        try:
            raw = base64.b64decode(envelope['originalBase64'], validate=True)
        except ValueError as exc:
            raise ValueError('Invalid original native base64.') from exc
        if digest(raw) != envelope['sha256'].lower():
            raise ValueError('Original native bytes do not match their SHA-256 envelope.')
        original_dir = target.parent / 'source'
        original_dir.mkdir(exist_ok=True)
        source = original_dir / 'original.aoe2scenario'
        source.write_bytes(raw)
    else:
        source = FIXTURE
    scenario = load_scenario(source)
    baseline = editable_state(scenario)
    before_hashes = section_hashes(scenario)
    option_hashes = {k: digest(r.get_data_as_bytes()) for k, r in scenario.sections['Options'].retriever_map.items() if k != 'number_of_triggers'}
    original_trigger_hashes = trigger_hashes(scenario)
    original_unit_hashes = unit_field_hashes(scenario)
    units = {f'native-{u.reference_id}': u for group in scenario.unit_manager.units for u in group}
    originals = {o['id']: o for o in baseline['objects']}
    incoming = {o['id']: o for o in p['objects']}
    if envelope:
        if envelope['importedObjectIds'] != list(originals) or envelope['importedTriggerCount'] != len(original_trigger_hashes):
            raise ValueError('Native envelope object/trigger inventory does not match its original file.')
        if p['map']['width'] != baseline['map']['width'] or p['map']['height'] != baseline['map']['height']:
            raise ValueError('Resizing imported maps is blocked to preserve native data and trigger areas.')
        for key, original in originals.items():
            if original['locked'] and (key not in incoming or any(incoming[key].get(f) != original[f] for f in
                    ('nativeId', 'player', 'x', 'y', 'rotation', 'nativeReferenceId'))):
                raise ValueError(f'Locked native object {key} cannot be modified or removed.')
        refs = protected_references(scenario)
        for key in originals.keys() - incoming.keys():
            if units[key].reference_id in refs:
                raise ValueError(f'Object {key} is referenced by an imported trigger or garrison and cannot be removed.')
    # Never trust a client-supplied lock flag as a bounds-validation exemption.
    for key, obj in incoming.items():
        if key in originals and originals[key]['locked']:
            continue
        if not (0 <= obj['x'] < p['map']['width'] and 0 <= obj['y'] < p['map']['height']
                and 0 <= obj['rotation'] <= 360):
            raise ValueError(f'Editable object {key} is outside native coordinate/rotation bounds.')
    # Compare only fields that this editor genuinely owns, ignoring presentation labels.
    relevant = ('nativeId', 'player', 'x', 'y', 'rotation', 'nativeReferenceId')
    objects_changed = set(originals) != set(incoming) or any(
        any(incoming[key].get(f) != original.get(f) for f in relevant)
        for key, original in originals.items() if key in incoming)
    map_changed = p['map'] != baseline['map']
    description_changed = p['description'] != baseline['description']
    if envelope and not objects_changed and not map_changed and not description_changed and not p['story']:
        target.write_bytes(raw)
        return {'version': SUPPORTED_VERSION, 'byteIdentical': True, 'sectionHashes': before_hashes,
                'triggerHashes': original_trigger_hashes, 'originalTriggerCount': len(original_trigger_hashes)}
    if map_changed:
        if not envelope:
            scenario.map_manager.map_size = p['map']['width']
        for index, tile in enumerate(p['map']['tiles']):
            native = scenario.map_manager.terrain[index]
            if tile['terrain'] != native.terrain_id and tile['terrain'] not in TERRAINS:
                raise ValueError(f'Terrain tile {index} requests an untested terrain ID.')
            native.terrain_id = tile['terrain']
            native.elevation = tile['elevation']
        scenario.map_manager.commit()
    object_refs = {key: u.reference_id for key, u in units.items()}
    if objects_changed:
        from AoE2ScenarioParser.objects.managers.unit_manager import create_id_generator
        next_id = max([scenario.sections['DataHeader'].next_unit_id_to_place] + [u.reference_id + 1 for u in units.values()])
        scenario.unit_manager.reference_id_generator = create_id_generator(next_id)
        for key in originals.keys() - incoming.keys():
            scenario.unit_manager.remove_unit(unit=units[key])
            object_refs.pop(key, None)
        for key, obj in incoming.items():
            if key in originals:
                unit = units[key]
                if obj.get('nativeReferenceId') != unit.reference_id:
                    raise ValueError(f'Native reference ID cannot be changed for {key}.')
                if originals[key]['locked']:
                    continue
                if obj['nativeId'] != unit.unit_const and obj['nativeId'] not in ASSETS:
                    raise ValueError(f'Object {key} uses an untested asset ID.')
                unit.unit_const = obj['nativeId']
                if unit.player != obj['player']:
                    unit.player = obj['player']
                unit.x, unit.y = obj['x'], obj['y']
                unit.rotation = math.radians(obj['rotation'])
            else:
                if obj['nativeId'] not in ASSETS or obj.get('nativeReferenceId') is not None:
                    raise ValueError(f'New object {key} must be a curated asset without a native reference.')
                unit = scenario.unit_manager.add_unit(player=obj['player'], unit_const=obj['nativeId'],
                                                     x=obj['x'], y=obj['y'], rotation=math.radians(obj['rotation']))
                object_refs[key] = unit.reference_id
        scenario.unit_manager.commit()
    if description_changed:
        scenario.sections['Messages'].ascii_instructions = p['description']
        scenario.sections['Messages'].instructions = 4294967294
    if not envelope:
        # New projects start with the package's blank scenario, then enable occupied players.
        active = max([2] + [o['player'] for o in p['objects']] + [s['player'] for s in p['story']])
        scenario.player_manager.active_players = active
        scenario.player_manager.commit()
        for pdata in scenario.sections['Units'].player_data_3:
            pdata.editor_camera_x = p['map']['width']//2
            pdata.editor_camera_y = p['map']['height']//2
            pdata.initial_camera_x = p['map']['width']//2
            pdata.initial_camera_y = p['map']['height']//2
    for node in p['story']:
        trigger = scenario.trigger_manager.add_trigger(name=f"[Studio] {node['name']}",
                                                       enabled=node['enabled'], looping=False)
        trigger.new_condition.timer(timer=node['delay'])
        effect = trigger.new_effect
        if node['kind'] == 'dialogue':
            effect.display_instructions(source_player=node['player'], message=node['text'],
                                        display_time=node['duration'], instruction_panel_position=0,
                                        play_sound=0)
        elif node['kind'] == 'camera':
            effect.change_view(source_player=node['player'], location_x=int(node['x']), location_y=int(node['y']), scroll=0)
        elif node['kind'] == 'move':
            effect.task_object(source_player=node['player'], selected_object_ids=[object_refs[node['objectId']]],
                               location_x=int(node['x']), location_y=int(node['y']))
        elif node['kind'] == 'victory':
            effect.declare_victory(source_player=node['player'], enabled=1)
    if p['story']:
        scenario.trigger_manager.commit()
    scenario.write_to_file(str(target), skip_reconstruction=True)
    after_hashes = section_hashes(scenario)
    if envelope:
        allowed = {'FileHeader', 'DataHeader'}
        if objects_changed:
            allowed.add('Units')
        if map_changed:
            allowed.add('Map')
        if description_changed:
            allowed.add('Messages')
        if p['story']:
            allowed.update({'Triggers', 'Options'})
            after_options = {k: digest(r.get_data_as_bytes()) for k, r in scenario.sections['Options'].retriever_map.items() if k != 'number_of_triggers'}
            if option_hashes != after_options:
                raise ValueError('Preservation check failed for native options outside the trigger counter.')
        for section, value in before_hashes.items():
            if section not in allowed and after_hashes[section] != value:
                raise ValueError(f'Preservation check failed for untouched native section {section}.')
        actual_unit_hashes = unit_field_hashes(scenario)
        for key in originals.keys() & incoming.keys():
            reference = originals[key]['nativeReferenceId']
            editable = set() if originals[key]['locked'] else {'x', 'y', 'rotation', 'unit_const'}
            expected_fields = {k: v for k, v in original_unit_hashes[reference].items() if k not in editable}
            actual_fields = {k: v for k, v in actual_unit_hashes.get(reference, {}).items() if k not in editable}
            if actual_fields != expected_fields:
                raise ValueError(f'Preservation check failed for native object {key}.')
        if trigger_hashes(scenario)[:len(original_trigger_hashes)] != original_trigger_hashes:
            raise ValueError('Preservation check failed: an imported trigger changed.')
    return {'version': SUPPORTED_VERSION, 'byteIdentical': False, 'sectionHashes': after_hashes,
            'triggerHashes': trigger_hashes(scenario), 'originalTriggerCount': len(original_trigger_hashes)}


def verify_native(payload: dict) -> dict:
    scenario = load_scenario(Path(payload['source']))
    actual = section_hashes(scenario)
    expected = payload['expected']
    if actual != expected['sectionHashes']:
        changes = [k for k, v in actual.items() if expected['sectionHashes'].get(k) != v]
        raise ValueError('Fresh-process native verification failed for sections: ' + ', '.join(changes))
    if trigger_hashes(scenario) != expected['triggerHashes']:
        raise ValueError('Fresh-process trigger preservation verification failed.')
    return {'verified': True, 'version': SUPPORTED_VERSION,
            'objects': sum(len(g) for g in scenario.unit_manager.units),
            'triggers': len(scenario.trigger_manager.triggers), 'sectionHashes': actual}


def main():
    request_path, response_path = map(Path, sys.argv[1:3])
    # Best-effort Unix resource limits; runner timeout applies on Windows too.
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (1536*1024*1024, 1536*1024*1024))
        resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
        resource.setrlimit(resource.RLIMIT_FSIZE, (256*1024*1024, 256*1024*1024))
    except (ImportError, ValueError, OSError):
        pass
    try:
        request = json.loads(request_path.read_text('utf-8'))
        with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            result = {'import': import_native, 'compile': compile_native, 'verify': verify_native}[request['op']](request)
        response = {'ok': True, 'result': result}
    except Exception as exc:
        response = {'ok': False, 'error': f'{type(exc).__name__}: {str(exc)[:1500]}'}
    response_path.write_text(json.dumps(response, ensure_ascii=False), 'utf-8')

if __name__ == '__main__':
    main()
