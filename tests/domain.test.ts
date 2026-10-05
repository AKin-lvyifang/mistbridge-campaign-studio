import { describe, expect, it } from 'vitest';
import { ASSETS, TERRAINS, compileAi, createProject, generateMap, generateStory, parseProject, validateAi, validateProject } from '../src/domain';
import type { GenerationOptions, Project } from '../src/types';

const defaults: GenerationOptions = {seed: 240518, size: 120, theme: 'river', forest: 42};
const errors = (project: unknown) => validateProject(project).filter(d => d.severity === 'error');
function fresh() { return createProject({size: 36}); }
function imported(): Project {
  const p = fresh();
  p.native = {version: '1.59', filename: 'original.aoe2scenario', originalBase64: 'AAAA', sha256: 'a'.repeat(64), importedObjectIds: p.objects.map(o => o.id), importedTriggerCount: 2};
  return p;
}
function pathExists(project: Pick<Project, 'map'|'objects'>, start: {x: number; y: number}, end: {x: number; y: number}) {
  const {width, height, tiles} = project.map;
  const terrain = new Map(TERRAINS.map(t => [t.id, t]));
  const startIndex = Math.floor(start.y) * width + Math.floor(start.x), endIndex = Math.floor(end.y) * width + Math.floor(end.x);
  const seen = new Uint8Array(tiles.length), queue = [startIndex];
  seen[startIndex] = 1;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current === endIndex) return true;
    const x = current % width, y = Math.floor(current / width);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (seen[next] || !terrain.get(tiles[next].terrain)?.passable || Math.abs(tiles[next].elevation - tiles[current].elevation) > 1) continue;
      seen[next] = 1; queue.push(next);
    }
  }
  return false;
}

describe('curated native references', () => {
  it('has unique IDs and distinguishes shallows from impassable shallow water', () => {
    expect(new Set(ASSETS.map(a => a.id)).size).toBe(ASSETS.length);
    expect(new Set(TERRAINS.map(a => a.id)).size).toBe(TERRAINS.length);
    expect(TERRAINS.find(t => t.id === 4)?.passable).toBe(true);
    expect(TERRAINS.find(t => t.id === 1)?.passable).toBe(false);
    expect(ASSETS.find(a => a.id === 304)?.english).toBe('Bonfire');
  });
});

describe('seeded map generation', () => {
  it('is reproducible and responds to the seed', () => {
    const a = generateMap(defaults), b = generateMap(defaults), c = generateMap({...defaults, seed: 240519});
    expect(a).toEqual(b);
    expect(a.map.tiles).not.toEqual(c.map.tiles);
    expect(a.objects).not.toEqual(c.objects);
  });
  it.each(['river', 'highland', 'coast'] as const)('creates a coherent populated %s with a traversable story route', theme => {
    const p = createProject({...defaults, theme});
    expect(errors(p)).toEqual([]);
    expect(p.map.tiles).toHaveLength(120 * 120);
    expect(p.objects.length).toBeGreaterThan(80);
    expect(p.objects.filter(o => o.player === 1 && o.category === 'unit').length).toBeGreaterThan(5);
    const guide = p.objects.find(o => o.nativeId === 448)!, camp = p.objects.find(o => o.nativeId === 304)!;
    expect(pathExists(p, guide, camp)).toBe(true);
    expect(p.objects.every(o => o.x >= 0 && o.y >= 0 && o.x < 120 && o.y < 120)).toBe(true);
  });
  it('has theme-specific water and relief', () => {
    const river = generateMap(defaults), coast = generateMap({...defaults, theme: 'coast'}), highland = generateMap({...defaults, theme: 'highland'});
    expect(river.map.tiles.some(t => t.terrain === 23)).toBe(true);
    expect(coast.map.tiles.some(t => t.terrain === 22)).toBe(true);
    expect(highland.map.tiles.some(t => t.elevation >= 4)).toBe(true);
    expect(highland.map.tiles.some(t => [1, 22, 23].includes(t.terrain))).toBe(false);
  });
  it('forest density changes actual trees without replacing the terrain layout', () => {
    const bare = generateMap({...defaults, forest: 0}), dense = generateMap({...defaults, forest: 100});
    const trees = (p: typeof bare) => p.objects.filter(o => [349, 350].includes(o.nativeId));
    expect(trees(bare)).toHaveLength(0);
    expect(trees(dense).length).toBeGreaterThan(300);
    expect(bare.map.tiles).toEqual(dense.map.tiles);
  });
  it('validates minimum/maximum sizes and seed boundaries', () => {
    expect(errors(createProject({size: 36, seed: 0}))).toEqual([]);
    expect(errors(createProject({size: 480, seed: 0xffffffff, forest: 0}))).toEqual([]);
    for (const size of [0, 35, 481, 120.5, NaN, Infinity]) expect(() => generateMap({...defaults, size})).toThrow();
    for (const seed of [-1, 0x100000000, .5, NaN]) expect(() => generateMap({...defaults, seed})).toThrow();
    expect(() => generateMap({...defaults, forest: -1})).toThrow();
    expect(() => generateMap({...defaults, forest: 101})).toThrow();
  });
  it('retains passable guide-to-camp routes across fixed regression seeds and sizes', () => {
    for (const theme of ['river', 'coast', 'highland'] as const) {
      for (const size of [36, 72, 120]) {
        for (const seed of [0, 1, 481516, 0xffffffff]) {
          const p = generateMap({theme, size, seed, forest: 100});
          expect(pathExists(p, p.objects.find(o => o.nativeId === 448)!, p.objects.find(o => o.nativeId === 304)!)).toBe(true);
        }
      }
    }
  });
});

describe('project runtime validation and persistence', () => {
  it('roundtrips complete projects and preserves native envelopes', () => {
    for (const p of [fresh(), imported()]) expect(parseProject(JSON.stringify(p))).toEqual(p);
  });
  it.each([null, [], {}, {map: null}, 'x', 1])('rejects malformed schema without crashing: %j', value => {
    expect(errors(value).length).toBeGreaterThan(0);
    expect(() => parseProject(JSON.stringify(value))).toThrow();
  });
  it('rejects invalid JSON, truncation, wrong versions and missing fields', () => {
    expect(() => parseProject('{')).toThrow(/JSON/);
    const p = fresh();
    expect(errors({...p, formatVersion: 2}).some(d => d.code === 'project.version')).toBe(true);
    expect(errors({...p, map: {...p.map, tiles: p.map.tiles.slice(1)}}).some(d => d.code === 'map.tiles')).toBe(true);
    expect(errors({...p, map: {...p.map, height: 37}}).some(d => d.code === 'map.dimensions')).toBe(true);
    expect(errors({...p, createdAt: 'yesterday'}).some(d => d.code === 'project.createdAt')).toBe(true);
  });
  it('rejects invalid tiles, invalid object IDs, duplicate IDs, and nonfinite coordinates', () => {
    const p = fresh();
    p.map.tiles[0].elevation = 17;
    p.objects[0].x = Infinity;
    p.objects[1].id = p.objects[0].id;
    p.objects[2].player = 9;
    p.objects[3].nativeId = 54321;
    const codes = errors(p).map(d => d.code);
    expect(codes).toEqual(expect.arrayContaining(['tile.invalid', 'object.bounds', 'object.id', 'object.player', 'object.unsupported']));
  });
  it('checks new building footprints, native references, and rotation', () => {
    const p = fresh();
    p.objects[0].x = .2;
    p.objects[0].rotation = -1;
    p.objects[0].nativeReferenceId = 44;
    p.objects[1].nativeReferenceId = 44;
    expect(errors(p).map(d => d.code)).toEqual(expect.arrayContaining(['object.footprint', 'object.rotation', 'object.reference']));
  });
  it('preserves unknown imported IDs but refuses unaudited new assets', () => {
    const p = imported();
    p.objects[0].nativeId = 54321;
    p.objects[0].locked = true;
    p.map.tiles[0].terrain = 199;
    expect(errors(p)).toEqual([]);
    p.objects.push({...p.objects[0], id: 'not-in-original'});
    expect(errors(p).some(d => d.code === 'object.unsupported')).toBe(true);
    delete p.native;
    expect(errors(p).some(d => d.code === 'terrain.unknown')).toBe(true);
  });
  it('preserves only verified locked imported placeholders outside bounds', () => {
    const p = imported();
    const o = p.objects[0];
    o.locked = true; o.nativeReferenceId = 123; o.x = -1; o.rotation = -10;
    expect(errors(p)).toEqual([]);
    delete o.nativeReferenceId;
    expect(errors(p).map(d => d.code)).toEqual(expect.arrayContaining(['object.bounds', 'object.rotation']));
    o.nativeReferenceId = 123; delete p.native;
    expect(errors(p).some(d => d.code === 'object.bounds')).toBe(true);
  });
  it('checks native payload syntax, version, fingerprint, and original ID uniqueness', () => {
    const p = imported();
    p.native!.version = '1.58'; p.native!.sha256 = 'invalid'; p.native!.originalBase64 = '*===';
    p.native!.importedObjectIds.push(p.native!.importedObjectIds[0]);
    expect(errors(p).map(d => d.code)).toEqual(expect.arrayContaining(['native.version', 'native.sha256', 'native.payload', 'native.objects']));
  });
  it('retains structurally valid drafts with broken story references for repair', () => {
    const p = fresh();
    p.story.find(s => s.kind === 'move')!.objectId = 'deleted-guide';
    p.story.find(s => s.kind === 'dialogue')!.text = '';
    expect(parseProject(JSON.stringify(p))).toEqual(p);
    expect(errors(p).some(d => d.code === 'story.reference')).toBe(true);
    (p.story[0] as unknown as {text: unknown}).text = {};
    expect(() => parseProject(JSON.stringify(p))).toThrow();
  });
  it('roundtrips editable custom PER drafts while reporting lint issues', () => {
    const p = {...fresh(), customAi: '(defrule (true) =>'};
    expect(parseProject(JSON.stringify(p))).toEqual(p);
    expect(validateProject(p).some(d => d.code === 'ai.parentheses' && d.severity === 'warning')).toBe(true);
    expect(errors({...p, customAi: ''}).some(d => d.code === 'ai.script')).toBe(true);
  });
  it('bounds diagnostic output for highly malformed inputs', () => {
    const p = fresh();
    p.objects = Array.from({length: 1000}, () => null) as unknown as Project['objects'];
    expect(validateProject(p).length).toBeLessThanOrEqual(101);
    expect(validateProject(p).at(-1)?.code).toBe('diagnostics.limit');
  });
});

describe('honest local story templates', () => {
  it('binds actual units and camp coordinates, preserving quoted Chinese lines', () => {
    const p = fresh();
    p.story = generateStory('林川说“跟我走。”，然后说“沿路小心。”', p);
    expect(p.story.filter(s => s.kind === 'dialogue').map(s => s.text)).toEqual(['跟我走。', '沿路小心。']);
    const move = p.story.find(s => s.kind === 'move')!;
    expect(p.objects.find(o => o.id === move.objectId)?.nativeId).toBe(448);
    expect(move.x).toBe(p.objects.find(o => o.nativeId === 304)?.x);
    expect(errors(p)).toEqual([]);
  });
  it('supports English and never silently turns victory prose into an enabled timer', () => {
    const p = fresh();
    p.story = generateStory('The scout says "Follow me." We win after reaching the camp.', p);
    expect(p.story.find(s => s.kind === 'dialogue')?.text).toBe('Follow me.');
    expect(p.story.find(s => s.kind === 'victory')?.enabled).toBe(false);
    expect(p.story.map(s => s.delay)).toEqual([...p.story.map(s => s.delay)].sort((a, b) => a - b));
  });
  it('does not invent a unit reference on an empty imported map', () => {
    const p = fresh(); p.objects = [];
    p.story = generateStory('Explain the route.', p);
    expect(p.story.some(s => s.kind === 'move')).toBe(false);
    expect(errors(p)).toEqual([]);
  });
  it('rejects broken bindings, wrong owners, zero-length dialogue and unsupported nodes', () => {
    const p = fresh();
    p.story.find(s => s.kind === 'move')!.objectId = 'missing';
    p.story.find(s => s.kind === 'dialogue')!.duration = 0;
    p.story[0].kind = 'arrival' as never;
    expect(errors(p).map(d => d.code)).toEqual(expect.arrayContaining(['story.reference', 'story.duration', 'story.kind']));
    p.story = generateStory('Go.', p);
    p.story.find(s => s.kind === 'move')!.player = 2;
    expect(errors(p).some(d => d.code === 'story.owner')).toBe(true);
  });
  it('warns on timer-only victory and conflicting AI ownership', () => {
    const p = fresh();
    p.story = generateStory('Victory at the camp.', p);
    p.story.find(s => s.kind === 'victory')!.enabled = true;
    p.behavior.player = 1;
    expect(validateProject(p).map(d => d.code)).toEqual(expect.arrayContaining(['story.timedVictory', 'story.aiConflict', 'story.timers']));
  });
});

describe('PER generator and limited lint', () => {
  it.each(['defend', 'balanced', 'attack'] as const)('generates valid local template syntax for %s', aggression => {
    const p = fresh(); p.behavior.aggression = aggression;
    const script = compileAi(p.behavior);
    expect(validateAi(script).filter(d => d.severity === 'error')).toEqual([]);
    expect(script.includes('(attack-now)')).toBe(aggression !== 'defend');
    expect(script).toContain('sn-percent-attack-soldiers');
    expect(script).toContain('Mistbridge.ai');
  });
  it('does not allow profile text to inject new script rules', () => {
    const p = fresh(); p.behavior.name = 'evil\n(defrule (true) => (attack-now))';
    const script = compileAi(p.behavior);
    expect(script).not.toContain('(attack-now)');
    expect(() => compileAi({...p.behavior, military: -1})).toThrow();
    expect(() => compileAi({...p.behavior, player: 0})).toThrow();
  });
  it('handles comments and quoted parentheses without false balance errors', () => {
    const script = '; (comment\n(defrule (true) => (chat-to-all "hello ( world; bye )"))';
    expect(validateAi(script).filter(d => d.severity === 'error')).toEqual([]);
    expect(validateAi(script).some(d => d.code === 'ai.uncheckedCommand')).toBe(true);
  });
  it.each([
    ['(defrule (true) => (attack-now)', 'ai.parentheses'],
    ['(defrule (true) => (attack-now)))', 'ai.parentheses'],
    ['(defrule (true) (attack-now))', 'ai.rule'],
    ['(defrule => (attack-now))', 'ai.rule'],
    ['(defrule (true) =>)', 'ai.rule'],
    ['(defrule (true) => (attack-now 4))', 'ai.arguments'],
    ['(defrule (train militia) => (true))', 'ai.side'],
    ['(defrule (game-time = 4) => (attack-now))', 'ai.comparison'],
    ['(defrule (true) => (chat-to-all "oops))', 'ai.string'],
    ['; Only a comment', 'ai.noRules'],
    ['defrule', 'ai.topLevel'],
  ])('finds %s', (script, code) => expect(validateAi(script).some(d => d.code === code && d.severity === 'error')).toBe(true));
  it('always explains the limited verification boundary', () => {
    expect(validateAi('(defrule (true) => (disable-self))').some(d => d.code === 'ai.limited')).toBe(true);
  });
});
