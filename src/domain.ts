import type { Asset, BehaviorProfile, Diagnostic, GenerationOptions, MapObject, Project, StoryNode, TerrainDefinition, Tile } from './types';

// Numeric IDs are references only. No original game artwork is bundled.
// Verified against AoE2ScenarioParser 0.9.4 datasets/{terrains,units,buildings,other}.py.
export const TERRAINS: TerrainDefinition[] = [
  { id: 0, name: '草地', color: '#718b51', detail: 'Grass 1 · 原生 0', passable: true },
  { id: 12, name: '草甸', color: '#8c9b5d', detail: 'Grass 2 · 原生 12', passable: true },
  { id: 9, name: '深草', color: '#526f47', detail: 'Grass 3 · 原生 9', passable: true },
  { id: 6, name: '泥土', color: '#a39068', detail: 'Dirt 1 · 原生 6', passable: true },
  { id: 3, name: '山地土壤', color: '#8e805e', detail: 'Dirt 3 · 原生 3', passable: true },
  { id: 24, name: '石路', color: '#b4ad90', detail: 'Road · 原生 24', passable: true },
  { id: 25, name: '旧石路', color: '#a09b7b', detail: 'Road, broken · 原生 25', passable: true },
  { id: 2, name: '沙岸', color: '#c9b67f', detail: 'Beach · 原生 2', passable: true },
  { id: 4, name: '可涉浅滩', color: '#75a4a1', detail: 'Shallows · 原生 4 · 可涉水', passable: true },
  { id: 1, name: '近岸水域', color: '#4f858c', detail: 'Water, shallow · 原生 1 · 陆地单位不可通行', passable: false },
  { id: 23, name: '河水', color: '#376c7b', detail: 'Water, medium · 原生 23', passable: false },
  { id: 22, name: '深水', color: '#285160', detail: 'Water, deep · 原生 22', passable: false },
];

export const ASSETS: Asset[] = [
  { id: 448, name: '斥候骑兵', english: 'Scout Cavalry', category: 'unit', icon: '♞', size: 1, color: '#79a0ca' },
  { id: 93, name: '长矛兵', english: 'Spearman', category: 'unit', icon: '⚑', size: 1, color: '#83a9d0' },
  { id: 74, name: '民兵', english: 'Militia', category: 'unit', icon: '⚔', size: 1, color: '#c78c78' },
  { id: 4, name: '弓箭手', english: 'Archer', category: 'unit', icon: '⌁', size: 1, color: '#c1986d' },
  { id: 38, name: '骑士', english: 'Knight', category: 'unit', icon: '♞', size: 1, color: '#b7b5b1' },
  { id: 83, name: '村民', english: 'Villager', category: 'unit', icon: '♟', size: 1, color: '#c1ae7b' },
  { id: 125, name: '僧侣', english: 'Monk', category: 'unit', icon: '✦', size: 1, color: '#ebe0bc' },
  { id: 594, name: '绵羊', english: 'Sheep', category: 'unit', icon: '●', size: 1, color: '#e8e2cf' },
  { id: 109, name: '城镇中心', english: 'Town Center', category: 'building', icon: '⌂', size: 4, color: '#cfb48c' },
  { id: 70, name: '民居', english: 'House', category: 'building', icon: '⌂', size: 2, color: '#baa186' },
  { id: 12, name: '兵营', english: 'Barracks', category: 'building', icon: '⚑', size: 3, color: '#ae8666' },
  { id: 598, name: '前哨站', english: 'Outpost', category: 'building', icon: '♜', size: 1, color: '#ae9b76' },
  { id: 79, name: '瞭望箭塔', english: 'Watch Tower', category: 'building', icon: '♜', size: 1, color: '#bcb6a5' },
  { id: 562, name: '伐木场', english: 'Lumber Camp', category: 'building', icon: '⌂', size: 2, color: '#ad8964' },
  { id: 349, name: '橡树', english: 'Oak Tree', category: 'decoration', icon: '♠', size: 1, color: '#365d37' },
  { id: 350, name: '松树', english: 'Pine Tree', category: 'decoration', icon: '♠', size: 1, color: '#2d5240' },
  { id: 623, name: '岩石', english: 'Rock 1', category: 'decoration', icon: '◆', size: 1, color: '#8a9185' },
  { id: 304, name: '营火', english: 'Bonfire', category: 'decoration', icon: '♨', size: 1, color: '#dc9656' },
  { id: 59, name: '浆果丛', english: 'Forage Bush', category: 'decoration', icon: '♣', size: 1, color: '#67774a' },
  { id: 66, name: '金矿', english: 'Gold Mine', category: 'decoration', icon: '◆', size: 1, color: '#c9a55a' },
  { id: 102, name: '石矿', english: 'Stone Mine', category: 'decoration', icon: '◆', size: 1, color: '#a0a399' },
  { id: 600, name: '引路旗', english: 'Flag A', category: 'decoration', icon: '⚑', size: 1, color: '#d4ba78' },
];

const assetById = new Map(ASSETS.map(asset => [asset.id, asset]));
const terrainById = new Map(TERRAINS.map(terrain => [terrain.id, terrain]));
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const smooth = (v: number) => v * v * (3 - 2 * v);

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(x: number, y: number, seed: number) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), sx = smooth(x - ix), sy = smooth(y - iy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
function anchors(size: number) {
  return {
    west: {x: size * .22, y: size * .64},
    east: {x: size * .69, y: size * .55},
    north: {x: size * .72, y: size * .23},
    crossing: {x: size * .47, y: size * .59},
  };
}
function segmentDistance(x: number, y: number, a: {x: number; y: number}, b: {x: number; y: number}) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}
function checkGeneration(options: GenerationOptions) {
  if (!Number.isInteger(options.size) || options.size < 36 || options.size > 480) throw new RangeError('地图边长必须为 36–480 的整数。');
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) throw new RangeError('种子必须为 0–4294967295 的整数。');
  if (!['river', 'highland', 'coast'].includes(options.theme)) throw new RangeError('不支持的地图主题。');
  if (!Number.isFinite(options.forest) || options.forest < 0 || options.forest > 100) throw new RangeError('林地密度必须为 0–100。');
}

/** Seeded local layout generator. Road clearance is geometric, not game pathfinding. */
export function generateMap(options: GenerationOptions): Pick<Project, 'map' | 'objects'> {
  checkGeneration(options);
  const {size, seed, theme, forest} = options;
  const rng = random(seed), points = anchors(size), tiles: Tile[] = [], objects: MapObject[] = [];
  const scale = size / 120, roadWidth = Math.max(1.7, size * .019);
  const mainRoad = [{x: 0, y: size * .70}, points.west, points.crossing, points.east, {x: size * .92, y: size * .57}];
  const branches = [[points.east, points.north], [points.west, {x: size * .12, y: size * .31}]];
  const roadDistance = (x: number, y: number) => Math.min(
    ...mainRoad.slice(1).map((point, i) => segmentDistance(x, y, mainRoad[i], point)),
    ...branches.map(([a, b]) => segmentDistance(x, y, a, b) + roadWidth * .36),
  );
  const riverX = (y: number) => size * (.49 + .055 * Math.sin(y / size * 7 + .3) + .018 * Math.sin(y / size * 19 + seed * .0001));
  const coastX = (y: number) => size * (.80 + .055 * Math.sin(y / size * 8 + (seed % 17)));
  const plazaRadius = Math.max(5, size * .066);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x / (size * .13), y / (size * .13), seed);
      const detail = noise(x / 9, y / 9, seed ^ 5719);
      let terrain = n < .32 ? 9 : n > .68 ? 12 : 0;
      let elevation = Math.floor((n * .75 + detail * .25) * (theme === 'highland' ? 7 : 3));
      if (theme === 'highland' && elevation >= 4) terrain = detail > .45 ? 3 : 6;
      const riverDistance = Math.abs(x + .5 - riverX(y + .5));
      const riverHalfWidth = Math.max(2, size * .042);
      if (theme === 'river' && riverDistance < riverHalfWidth + 1.6) {
        terrain = riverDistance < riverHalfWidth * .48 ? 23 : riverDistance < riverHalfWidth ? 1 : 2;
        elevation = 0;
      }
      if (theme === 'coast' && x + .5 > coastX(y + .5) - 2.5) {
        const offshore = x + .5 - coastX(y + .5);
        terrain = offshore < 0 ? 2 : offshore < size * .04 ? 1 : offshore < size * .12 ? 23 : 22;
        elevation = 0;
      }
      const road = roadDistance(x + .5, y + .5);
      const plaza = Math.min(...[points.west, points.east, points.north].map(p => Math.hypot(x + .5 - p.x, y + .5 - p.y)));
      const coastalRoadAllowed = theme !== 'coast' || x + .5 < coastX(y + .5) - 1;
      if (plaza < plazaRadius) { terrain = plaza < plazaRadius * .68 ? 6 : 12; elevation = 0; }
      if (coastalRoadAllowed && road < roadWidth + 1.2) {
        elevation = 0;
        terrain = road < roadWidth ? (detail > .60 ? 25 : 24) : 6;
      }
      tiles.push({terrain, elevation});
    }
  }
  const tileAt = (x: number, y: number) => tiles[Math.floor(y) * size + Math.floor(x)];
  const half = (v: number) => Math.floor(v) + .5;
  const occupied = new Set<string>();
  const add = (nativeId: number, player: number, x: number, y: number, label?: string) => {
    const asset = assetById.get(nativeId)!;
    x = half(clamp(x, asset.size / 2 + .5, size - asset.size / 2 - 1));
    y = half(clamp(y, asset.size / 2 + .5, size - asset.size / 2 - 1));
    // Authored settlement clearings are flat, dry, and large enough for native footprints.
    const radius = asset.category === 'building' ? asset.size / 2 + 1 : .6;
    for (let ty = Math.max(0, Math.floor(y - radius)); ty <= Math.min(size - 1, Math.ceil(y + radius)); ty++) {
      for (let tx = Math.max(0, Math.floor(x - radius)); tx <= Math.min(size - 1, Math.ceil(x + radius)); tx++) {
        occupied.add(`${tx},${ty}`);
        const tile = tiles[ty * size + tx];
        if (asset.category !== 'decoration') { tile.elevation = 0; if (!terrainById.get(tile.terrain)?.passable) tile.terrain = 6; }
      }
    }
    const object = {id: `obj-${seed}-${objects.length + 1}`, nativeId, player, x, y, rotation: Math.floor(rng() * 8) * 45, label: label ?? asset.name, category: asset.category};
    objects.push(object);
    return object;
  };
  // Template offsets retain native building separation even on the minimum map size.
  const spacing = Math.max(.75, scale);
  add(109, 1, points.west.x, points.west.y - 2.5 * spacing, '西岸驿站');
  add(70, 1, points.west.x - 5 * spacing, points.west.y + 3.5 * spacing, '驿站民居');
  add(562, 1, points.west.x + 5 * spacing, points.west.y + 4 * spacing, '河谷伐木场');
  add(448, 1, size * .39, size * .60, '林川 · 引路斥候');
  for (let i = 0; i < 5; i++) add(93, 1, points.west.x + (i % 3) * 1.5 * spacing, points.west.y + (2 + Math.floor(i / 3) * 1.5) * spacing, `护卫 ${i + 1}`);
  for (let i = 0; i < 4; i++) add(83, 1, points.west.x + (i - 1.5) * 1.5 * spacing, points.west.y - 6 * spacing, `村民 ${i + 1}`);
  add(304, 0, points.east.x, points.east.y, '东岸营火');
  add(600, 1, points.east.x + 2 * spacing, points.east.y + 2 * spacing, '东岸路标');
  add(70, 1, points.east.x + 4 * spacing, points.east.y - 4 * spacing, '守桥人小屋');
  add(598, 1, points.east.x - 4 * spacing, points.east.y + 4 * spacing, '河岸瞭望');
  add(109, 2, points.north.x - 6 * spacing, points.north.y - 4 * spacing, '北路补给站');
  for (let i = 0; i < 3; i++) add(83, 2, points.north.x - (5 + i * 1.5) * spacing, points.north.y + .5 * spacing, `北路工匠 ${i + 1}`);
  add(12, 2, points.north.x, points.north.y - 1.5 * spacing, '北路守军兵营');
  add(70, 2, points.north.x + 5 * spacing, points.north.y - 2 * spacing, '守军营舍');
  add(79, 2, points.north.x - 4 * spacing, points.north.y + 3 * spacing, '北路箭塔');
  for (let i = 0; i < 7; i++) add(i < 4 ? 74 : 4, 2, points.north.x + (i % 4 - 1.5) * 1.5 * spacing, points.north.y + (3 + Math.floor(i / 4) * 1.5) * spacing, `北路守军 ${i + 1}`);
  // Resource pockets are distributed around the western settlement without blocking its exits.
  for (const [nativeId, dx, dy] of [[59, -8, -5], [66, 8, 7], [102, -7, 8]] as const) {
    for (let i = 0; i < 4; i++) {
      const x = points.west.x + dx * spacing + (i % 2) * 1.3, y = points.west.y + dy * spacing + Math.floor(i / 2) * 1.3;
      if (x > 1 && y > 1 && x < size - 2 && y < size - 2 && terrainById.get(tileAt(x, y).terrain)?.passable && roadDistance(x, y) > roadWidth + 1) add(nativeId, 0, x, y);
    }
  }
  // Spatially correlated groves, with deterministic scatter and a guaranteed clear story corridor.
  for (let y = 2; y < size - 2; y += 2) {
    for (let x = 2; x < size - 2; x += 2) {
      if (occupied.has(`${x},${y}`) || roadDistance(x, y) < roadWidth + 2.8) continue;
      if (Math.min(...[points.west, points.east, points.north].map(p => Math.hypot(x - p.x, y - p.y))) < plazaRadius + 1.5) continue;
      const tile = tileAt(x, y);
      if (!terrainById.get(tile.terrain)?.passable || tile.terrain === 2 || tile.terrain === 4) continue;
      const grove = noise(x / (size * .1), y / (size * .1), seed ^ 7331);
      const chance = forest / 100 * clamp((grove - .2) * 1.6, .05, 1);
      if (rng() < chance) {
        const nativeId = theme === 'highland' || (x + y) % 5 === 0 ? 350 : 349;
        add(nativeId, 0, x + .2 + rng() * .6, y + .2 + rng() * .6);
      } else if (tile.elevation >= 3 && rng() < .05) add(623, 0, x, y);
    }
  }
  return {map: {width: size, height: size, tiles}, objects};
}

export function createProject(options: Partial<GenerationOptions> = {}): Project {
  const settings: GenerationOptions = {seed: 240518, size: 120, theme: 'river', forest: 42, ...options};
  const now = new Date().toISOString();
  const project: Project = {
    formatVersion: 1, id: `mistbridge-${settings.seed}-${now.replace(/[^0-9]/g, '')}`,
    name: '雾桥来信', description: '原创河谷习作。沿石路穿过河谷，跟随林川前往东岸营火。规则生成；剧情目前仅支持定时事件，尚未进行游戏内验证。',
    seed: settings.seed, ...generateMap(settings), story: [],
    behavior: {player: 2, name: '北路守军', villagers: 8, military: 12, attackTime: 240, aggression: 'defend'},
    createdAt: now, updatedAt: now,
  };
  project.story = generateStory('林川说“渡口已失守，跟我走。”随后前往东岸营火，再说“援军会从北路来。”', project);
  return project;
}

/** Keyword/quotation template only. No model, network call, or invented branching semantics. */
export function generateStory(text: string, project: Project): StoryNode[] {
  const chinese = /[\u3400-\u9fff]/u.test(text);
  const guide = project.objects.find(o => /林川|guide|scout/i.test(o.label) && o.category === 'unit' && o.player >= 1)
    ?? project.objects.find(o => o.category === 'unit' && o.player === 1);
  const camp = project.objects.find(o => o.nativeId === 304) ?? project.objects.find(o => o.nativeId === 600);
  const origin = guide ?? {x: project.map.width / 2, y: project.map.height / 2};
  const destination = camp ?? origin;
  const quotes = Array.from(text.matchAll(/[“「"]([^”」"\n]{1,1000})[”」"]/g), match => match[1]);
  const assault = /进攻|攻占|攻击|attack|assault|capture/i.test(text);
  const defend = /防守|守住|保卫|defend|hold|protect/i.test(text);
  const firstLine = quotes[0] ?? (text.trim() ? text.trim().slice(0, 1000) : chinese ? '沿石路前进，我们在营火旁会合。' : 'Follow the road. We will regroup at the campfire.');
  const secondLine = quotes[1] ?? (chinese
    ? assault ? '前方就是北路营地，准备行动。' : defend ? '守住这条道路，等待援军。' : '援军会从北路来。'
    : assault ? 'The northern camp is ahead. Prepare to advance.' : defend ? 'Hold this road until reinforcements arrive.' : 'Reinforcements will approach from the north.');
  const player = guide?.player ?? 1;
  const node = (id: string, kind: StoryNode['kind'], delay: number, name: string, line: string, point = origin): StoryNode => ({id, kind, delay, name, text: line, enabled: true, player, x: point.x, y: point.y, duration: kind === 'dialogue' ? 8 : 0});
  const nodes = [
    node('story-camera', 'camera', 0, chinese ? '开场镜头' : 'Opening camera', ''),
    node('story-opening', 'dialogue', 3, chinese ? '林间来信' : 'A message on the road', firstLine),
  ];
  if (guide) nodes.push({...node('story-move', 'move', 12, chinese ? '前往集结点 · 定时命令' : 'Move to rendezvous · timed order', '', destination), objectId: guide.id});
  nodes.push(node('story-followup', 'dialogue', 26, chinese ? '后续对白 · 定时播放' : 'Follow-up dialogue · timed', secondLine, destination));
  // Explicit opt-in is required: a timer is not an arrival or objective-completion condition.
  if (/胜利|获胜|通关|victory|win\b/i.test(text)) nodes.push({...node('story-victory', 'victory', 90, chinese ? '定时胜利 · 确认后启用' : 'Timed victory · enable after review', '', destination), enabled: false});
  return nodes;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown, min: number, max: number): value is number => finite(value) && Number.isInteger(value) && value >= min && value <= max;
const string = (value: unknown, max = 1000, nonempty = false): value is string => typeof value === 'string' && value.length <= max && (!nonempty || value.trim().length > 0);

/** Runtime validation also accepts unknown input; malformed imports never rely on a TS cast. */
export function validateProject(project: unknown): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let omitted = 0, omittedErrors = 0;
  const add = (severity: Diagnostic['severity'], code: string, message: string, targetId?: string) => {
    if (diagnostics.length < 100) diagnostics.push({severity, code, message, ...(targetId ? {targetId} : {})}); else { omitted++; if (severity === 'error') omittedErrors++; }
  };
  if (!record(project)) return [{severity: 'error', code: 'project.type', message: '工程必须是 JSON 对象。'}];
  if (project.formatVersion !== 1) add('error', 'project.version', '不支持的工程版本，当前仅支持 formatVersion 1。');
  for (const key of ['id', 'name'] as const) if (!string(project[key], key === 'id' ? 200 : 500, true)) add('error', `project.${key}`, `工程 ${key} 必须是非空文本（最多 500 字符）。`);
  if (!string(project.description, 50000)) add('error', 'project.description', '工程描述必须是文本（最多 50000 字符）。');
  if (!integer(project.seed, 0, 0xffffffff)) add('error', 'project.seed', '种子必须为 0–4294967295 的整数。');
  for (const key of ['createdAt', 'updatedAt'] as const) if (!string(project[key], 64, true) || !/^\d{4}-\d{2}-\d{2}T/.test(project[key] as string) || !Number.isFinite(Date.parse(project[key] as string))) add('error', `project.${key}`, `${key} 必须是有效的 ISO 日期。`);
  const native = project.native;
  const isImported = record(native);
  const importedIds = new Set<string>();
  if (native !== undefined) {
    if (!isImported) add('error', 'native.type', '原生文件保留信息格式无效。');
    else {
      if (native.version !== '1.59') add('error', 'native.version', '此切片只支持 DE 1.59 场景。');
      if (!string(native.filename, 500, true)) add('error', 'native.filename', '缺少原始场景文件名。');
      if (!string(native.sha256, 64) || !/^[a-f0-9]{64}$/i.test(native.sha256 as string)) add('error', 'native.sha256', '原始场景的 SHA-256 无效。');
      if (!string(native.originalBase64, 24 * 1024 * 1024, true) || (native.originalBase64 as string).length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(native.originalBase64 as string)) add('error', 'native.payload', '原始场景数据必须是有效的 base64。');
      if (!integer(native.importedTriggerCount, 0, 100000)) add('error', 'native.triggers', '原始触发器数量无效。');
      if (native.baselineHash !== undefined && (!string(native.baselineHash, 64) || !/^[a-f0-9]{64}$/i.test(native.baselineHash as string))) add('error', 'native.baseline', '导入基线校验值无效。');
      if (!Array.isArray(native.importedObjectIds) || native.importedObjectIds.length > 100000) add('error', 'native.objects', '原始对象索引无效。');
      else for (const id of native.importedObjectIds) {
        if (!string(id, 200, true) || importedIds.has(id)) add('error', 'native.objects', '原始对象索引含无效或重复 ID。');
        else importedIds.add(id);
      }
      add('info', 'native.preserved', '原始文件随工程保存。原生导出还会验证哈希、地图尺寸及受保护对象，并保留已有触发器。');
    }
  }
  const map = record(project.map) ? project.map : {};
  const width = map.width, height = map.height;
  const validSize = integer(width, 36, 480) && integer(height, 36, 480) && width === height;
  if (!validSize) add('error', 'map.dimensions', 'DE 地图必须为正方形，边长是 36–480 的整数。');
  const tiles = Array.isArray(map.tiles) ? map.tiles : [];
  if (!Array.isArray(map.tiles) || !validSize || tiles.length !== (width as number) * (height as number)) add('error', 'map.tiles', '地块数量必须与地图宽度 × 高度完全一致。');
  const unknownTerrains = new Set<number>();
  for (let i = 0; i < Math.min(tiles.length, 480 * 480); i++) {
    const tile = tiles[i];
    if (!record(tile) || !integer(tile.terrain, 0, 255) || !integer(tile.elevation, 0, 16)) { add('error', 'tile.invalid', `第 ${i + 1} 格的地形 ID 或高度无效；高度应为 0–16。`); continue; }
    if (!terrainById.has(tile.terrain)) unknownTerrains.add(tile.terrain);
  }
  if (unknownTerrains.size) add(isImported ? 'info' : 'error', 'terrain.unknown', `${isImported ? '保留导入' : '不支持新建'}地形 ID：${[...unknownTerrains].slice(0, 20).join(', ')}。`);
  const inBounds = (x: unknown, y: unknown) => validSize && finite(x) && finite(y) && x >= 0 && y >= 0 && x < (width as number) && y < (height as number);
  const objects = Array.isArray(project.objects) ? project.objects : [];
  if (!Array.isArray(project.objects) || objects.length > 100000) add('error', 'objects.type', '对象列表必须是数组，最多 100000 个对象。');
  const objectIds = new Set<string>(), referenceIds = new Set<number>(), objectMap = new Map<string, Record<string, unknown>>();
  for (const object of objects.slice(0, 100000)) {
    if (!record(object)) { add('error', 'object.type', '对象数据必须是 JSON 对象。'); continue; }
    const id = typeof object.id === 'string' ? object.id : undefined;
    if (!string(object.id, 200, true) || objectIds.has(object.id)) add('error', 'object.id', '对象 ID 为空、无效或重复。', id);
    else { objectIds.add(object.id); objectMap.set(object.id, object); }
    const asset = typeof object.nativeId === 'number' ? assetById.get(object.nativeId) : undefined;
    if (!integer(object.nativeId, 0, 65535)) add('error', 'object.nativeId', '原生对象 ID 必须为非负整数。', id);
    else if (!asset && !(isImported && id && importedIds.has(id))) add('error', 'object.unsupported', `新放置的对象 ID ${object.nativeId} 不在已核对的素材目录中。`, id);
    if (!integer(object.player, 0, 8)) add('error', 'object.player', '对象玩家必须为 0（Gaia）到 8。', id);
    const preservedSpecial = isImported && !!id && importedIds.has(id) && object.locked === true && integer(object.nativeReferenceId, 0, 2147483647);
    if (!finite(object.x) || !finite(object.y) || (!preservedSpecial && !inBounds(object.x, object.y))) add('error', 'object.bounds', '对象坐标必须位于地图范围内。', id);
    else if (asset && !isImported && (object.x as number < asset.size / 2 || object.y as number < asset.size / 2 || object.x as number > (width as number) - asset.size / 2 || object.y as number > (height as number) - asset.size / 2)) add('error', 'object.footprint', '对象占地超出地图边缘。', id);
    if (!finite(object.rotation) || (!preservedSpecial && (object.rotation < 0 || object.rotation > 360))) add('error', 'object.rotation', '对象朝向必须是 [0, 360] 范围内的角度。', id);
    if (!string(object.label, 500)) add('error', 'object.label', '对象标签必须是文本（最多 500 字符）。', id);
    if (!['unit', 'building', 'decoration'].includes(object.category as string) || (asset && asset.category !== object.category && !isImported)) add('error', 'object.category', '对象分类与原生素材不匹配。', id);
    if (object.locked !== undefined && typeof object.locked !== 'boolean') add('error', 'object.locked', '对象锁定状态必须是布尔值。', id);
    if (object.nativeReferenceId !== undefined) {
      if (!isImported || !id || !importedIds.has(id)) add('error', 'object.unboundReference', '新对象不能自行指定原生引用 ID。', id);
      if (!integer(object.nativeReferenceId, 0, 2147483647) || referenceIds.has(object.nativeReferenceId)) add('error', 'object.reference', '原生引用 ID 无效或重复。', id);
      else referenceIds.add(object.nativeReferenceId);
    }
    if (asset && asset.category !== 'decoration' && inBounds(object.x, object.y)) {
      const tile = tiles[Math.floor(object.y as number) * (width as number) + Math.floor(object.x as number)];
      if (record(tile) && terrainById.get(tile.terrain as number)?.passable === false) add('warning', 'object.water', '陆地单位或建筑位于水域；请在游戏内检查放置。', id);
    }
  }
  const story = Array.isArray(project.story) ? project.story : [];
  if (!Array.isArray(project.story) || story.length > 1000) add('error', 'story.type', '剧情必须是数组，最多 1000 个节点。');
  const storyIds = new Set<string>();
  let hasTimedStory = false;
  for (const item of story.slice(0, 1000)) {
    if (!record(item)) { add('error', 'story.type', '剧情节点必须是 JSON 对象。'); continue; }
    const id = typeof item.id === 'string' ? item.id : undefined;
    if (!string(item.id, 200, true) || storyIds.has(item.id)) add('error', 'story.id', '剧情节点 ID 为空、无效或重复。', id); else storyIds.add(item.id);
    if (!string(item.name, 240, true)) add('error', 'story.name', '剧情节点必须有名称。', id);
    if (typeof item.enabled !== 'boolean') add('error', 'story.enabled', '节点启用状态必须是布尔值。', id);
    if (!['dialogue', 'camera', 'move', 'victory'].includes(item.kind as string)) add('error', 'story.kind', '只支持对白、镜头、移动与胜利四种定时节点。', id);
    if (!integer(item.delay, 0, 86400)) add('error', 'story.delay', '触发时间必须为 0–86400 的整数秒（自场景开始计时）。', id);
    if (!integer(item.duration, 0, 3600)) add('error', 'story.duration', '持续时间必须为 0–3600 的整数秒。', id);
    if (!integer(item.player, 1, 8)) add('error', 'story.player', '剧情玩家必须为 1–8。', id);
    if (!inBounds(item.x, item.y)) add('error', 'story.bounds', '剧情坐标必须位于地图范围内。', id);
    if (!string(item.text, 10000) || (item.kind === 'dialogue' && !string(item.text, 10000, true))) add('error', 'story.text', '对白必须为非空文本，最多 10000 字符。', id);
    if (item.kind === 'dialogue' && item.duration === 0) add('error', 'story.duration', '对白显示时间必须大于 0。', id);
    if (item.objectId !== undefined && !string(item.objectId, 200, true)) add('error', 'story.object', '剧情对象引用格式无效。', id);
    if (item.kind === 'move') {
      const object = typeof item.objectId === 'string' ? objectMap.get(item.objectId) : undefined;
      if (!object) add('error', 'story.reference', '移动命令引用的对象不存在。', id);
      else if (object.category !== 'unit' || object.player === 0) add('error', 'story.moveTarget', '移动命令必须引用玩家拥有的单位。', id);
      else if (object.player !== item.player) add('error', 'story.owner', '移动命令的玩家必须与单位所属玩家一致。', id);
      if (inBounds(item.x, item.y)) {
        const tile = tiles[Math.floor(item.y as number) * (width as number) + Math.floor(item.x as number)];
        if (record(tile) && terrainById.get(tile.terrain as number)?.passable === false) add('warning', 'story.water', '移动目标位于不可涉水地形。', id);
      }
    }
    if (item.enabled) hasTimedStory = true;
    if (item.kind === 'victory' && item.enabled) add('warning', 'story.timedVictory', '此胜利节点仅按时间触发，不会等待到达、战斗或任务完成。', id);
    if (item.enabled && item.kind === 'move' && record(project.behavior) && item.player === project.behavior.player) add('warning', 'story.aiConflict', '剧情与玩家 AI 可能同时控制该单位，请在游戏中检查命令冲突。', id);
  }
  if (hasTimedStory) add('info', 'story.timers', '剧情是绝对时间触发的规则模板，不包含到达检测、死亡分支或 LLM 推理。');
  const behavior = project.behavior;
  if (!record(behavior)) add('error', 'behavior.type', '缺少 AI 行为配置。');
  else {
    if (!integer(behavior.player, 1, 8)) add('error', 'behavior.player', 'AI 玩家必须为 1–8。');
    if (!string(behavior.name, 200, true)) add('error', 'behavior.name', 'AI 配置必须有名称。');
    if (!integer(behavior.villagers, 0, 500) || !integer(behavior.military, 0, 500)) add('error', 'behavior.population', 'AI 目标人口必须为 0–500 的整数。');
    if (!integer(behavior.attackTime, 0, 86400)) add('error', 'behavior.attackTime', 'AI 进攻时间必须为 0–86400 的整数秒。');
    if (!['defend', 'balanced', 'attack'].includes(behavior.aggression as string)) add('error', 'behavior.aggression', 'AI 行为模式无效。');
  }
  if (project.customAi !== undefined) {
    if (!string(project.customAi, 1000000, true)) add('error', 'ai.script', '自定义 PER 必须为非空文本，最大 1 MB。');
    else for (const diagnostic of validateAi(project.customAi)) add(diagnostic.severity === 'error' ? 'warning' : diagnostic.severity, diagnostic.code, diagnostic.message);
  }
  if (omitted) diagnostics.push({severity: omittedErrors ? 'error' : 'warning', code: 'diagnostics.limit', message: `另有 ${omitted} 条诊断未显示，请先修复以上问题。`});
  return diagnostics;
}

export function parseProject(json: string): Project {
  if (typeof json !== 'string' || json.length > 64 * 1024 * 1024) throw new Error('工程文件过大或不是文本；上限为 64 MiB。');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('无法读取工程：JSON 格式无效。'); }
  // Preserve editable drafts with broken story bindings. Loading is not export approval.
  // Shapes, finite numeric limits, format versions, and bounded storage remain strict.
  const repairable = new Set(['story.reference', 'story.owner', 'story.moveTarget']);
  if (record(value) && Array.isArray(value.story)) {
    if (value.story.every(s => record(s) && string(s.text, 10000))) repairable.add('story.text');
    if (value.story.every(s => record(s) && string(s.name, 240))) repairable.add('story.name');
  }
  const errors = validateProject(value).filter(d => d.severity === 'error' && !repairable.has(d.code));
  if (errors.length) throw new Error(`工程校验失败：${errors.slice(0, 5).map(d => d.message).join(' ')}${errors.length > 5 ? `（另有 ${errors.length - 5} 项）` : ''}`);
  return value as Project;
}

export function compileAi(profile: BehaviorProfile): string {
  if (!record(profile) || !integer(profile.player, 1, 8) || !string(profile.name, 200, true) || !integer(profile.villagers, 0, 500) || !integer(profile.military, 0, 500) || !integer(profile.attackTime, 0, 86400) || !['defend', 'balanced', 'attack'].includes(profile.aggression)) throw new Error('AI 配置无效；请检查玩家、人数、时间和行为模式。');
  const attackPercentage = {defend: 0, balanced: 50, attack: 100}[profile.aggression];
  const name = profile.name.replace(/[^\x20-\x7e]/g, '').replace(/[();]/g, '').trim() || 'Campaign Guard';
  const parts = [
    `; Mistbridge Campaign Studio - rule-based PER starter\n; Profile: ${name}; suggested scenario player: ${profile.player}\n; Save as Mistbridge.per with an empty matching Mistbridge.ai loader.\n; Select this AI for that player in the game editor; this file does not assign it.\n; Requires starting buildings/resources, population room, and in-game testing.\n; This is a limited template, not a complete competitive AI.`,
    `(defrule\n  (true)\n=>\n  (set-strategic-number sn-food-gatherer-percentage 45)\n  (set-strategic-number sn-wood-gatherer-percentage 35)\n  (set-strategic-number sn-gold-gatherer-percentage 20)\n  (set-strategic-number sn-stone-gatherer-percentage 0)\n  (set-strategic-number sn-percent-attack-soldiers ${attackPercentage})\n  (disable-self)\n)`,
    `(defrule\n  (unit-type-count-total villager < ${profile.villagers})\n  (can-train villager)\n=>\n  (train villager)\n)`,
    `(defrule\n  (housing-headroom < 4)\n  (can-build house)\n=>\n  (build house)\n)`,
  ];
  if (profile.military > 0) parts.push(
    `(defrule\n  (building-type-count-total barracks < 1)\n  (can-build barracks)\n=>\n  (build barracks)\n)`,
    `(defrule\n  (unit-type-count-total militiaman-line < ${profile.military})\n  (can-train militiaman-line)\n=>\n  (train militiaman-line)\n)`,
  );
  if (profile.aggression !== 'defend') parts.push(`; One timed attack order; not a patrol or arrival-triggered event.\n(defrule\n  (game-time >= ${profile.attackTime})\n  (military-population >= ${Math.max(1, Math.floor(profile.military / 2))})\n=>\n  (attack-now)\n  (disable-self)\n)`);
  return `${parts.join('\n\n')}\n`;
}

type SExpression = {atom: string; quoted: boolean; line: number} | {list: SExpression[]; line: number};
/** Small S-expression lint. It deliberately does not certify the complete PER language. */
export function validateAi(script: string): Diagnostic[] {
  const result: Diagnostic[] = [];
  const add = (severity: Diagnostic['severity'], code: string, message: string) => { if (result.length < 100) result.push({severity, code, message}); };
  if (typeof script !== 'string' || script.length > 1000000) return [{severity: 'error', code: 'ai.size', message: 'PER 脚本必须是文本，最大 1 MB。'}];
  const roots: SExpression[] = [], stack: {list: SExpression[]; line: number}[] = [];
  let line = 1, index = 0;
  const push = (node: SExpression) => (stack.length ? stack[stack.length - 1].list : roots).push(node);
  while (index < script.length) {
    const char = script[index];
    if (char === '\n') { line++; index++; continue; }
    if (/\s/.test(char)) { index++; continue; }
    if (char === ';') { while (index < script.length && script[index] !== '\n') index++; continue; }
    if (char === '(') {
      const node = {list: [] as SExpression[], line}; push(node); stack.push(node); index++;
      if (stack.length > 128) return [{severity: 'error', code: 'ai.depth', message: `第 ${line} 行：嵌套超过安全上限。`}];
      continue;
    }
    if (char === ')') { if (!stack.pop()) add('error', 'ai.parentheses', `第 ${line} 行：多余的右括号。`); index++; continue; }
    const startLine = line;
    if (char === '"') {
      index++; let atom = '', closed = false;
      while (index < script.length) {
        if (script[index] === '"') { index++; closed = true; break; }
        if (script[index] === '\n') line++;
        if (script[index] === '\\' && index + 1 < script.length) { atom += script[index++]; atom += script[index++]; } else atom += script[index++];
      }
      if (!closed) add('error', 'ai.string', `第 ${startLine} 行：字符串缺少结束引号。`);
      push({atom, quoted: true, line: startLine}); continue;
    }
    let atom = '';
    while (index < script.length && !/[\s();"]/.test(script[index])) atom += script[index++];
    push({atom, quoted: false, line: startLine});
  }
  for (const node of stack) add('error', 'ai.parentheses', `第 ${node.line} 行：左括号未闭合。`);
  const atom = (node: SExpression | undefined) => node && 'atom' in node && !node.quoted ? node.atom : undefined;
  const arities: Record<string, number> = {true: 0, 'can-train': 1, 'can-build': 1, 'unit-type-count-total': 3, 'building-type-count-total': 3, 'housing-headroom': 2, 'military-population': 2, 'game-time': 2, train: 1, build: 1, 'set-strategic-number': 2, 'attack-now': 0, 'disable-self': 0};
  const factNames = new Set(['true', 'can-train', 'can-build', 'unit-type-count-total', 'building-type-count-total', 'housing-headroom', 'military-population', 'game-time']);
  const actionNames = new Set(['train', 'build', 'set-strategic-number', 'attack-now', 'disable-self']);
  let rules = 0;
  for (const root of roots) {
    if (!('list' in root)) { add('error', 'ai.topLevel', `第 ${root.line} 行：表达式必须放在括号内。`); continue; }
    const head = atom(root.list[0]);
    if (head !== 'defrule') {
      if (head === 'defconst') { if (root.list.length !== 3) add('error', 'ai.defconst', `第 ${root.line} 行：defconst 需要名称和值。`); }
      else add('warning', 'ai.unsupported', `第 ${root.line} 行：本地检查器不解析 ${head ?? '空表达式'}。`);
      continue;
    }
    rules++;
    const arrows = root.list.map((n, i) => atom(n) === '=>' ? i : -1).filter(i => i >= 0);
    if (arrows.length !== 1 || arrows[0] < 2 || arrows[0] >= root.list.length - 1) { add('error', 'ai.rule', `第 ${root.line} 行：defrule 必须有条件、一个 => 和动作。`); continue; }
    for (let i = 1; i < root.list.length; i++) {
      if (i === arrows[0]) continue;
      const expression = root.list[i];
      if (!('list' in expression)) { add('error', 'ai.expression', `第 ${expression.line} 行：条件或动作必须用括号包围。`); continue; }
      const command = atom(expression.list[0]);
      if (!command) { add('error', 'ai.expression', `第 ${expression.line} 行：表达式缺少命令名。`); continue; }
      if (!(command in arities)) { add('warning', 'ai.uncheckedCommand', `第 ${expression.line} 行：${command} 不在本地语法检查范围内。`); continue; }
      if (expression.list.length - 1 !== arities[command]) add('error', 'ai.arguments', `第 ${expression.line} 行：${command} 需要 ${arities[command]} 个参数。`);
      if ((i < arrows[0] && actionNames.has(command)) || (i > arrows[0] && factNames.has(command))) add('error', 'ai.side', `第 ${expression.line} 行：${command} 位于 => 的错误一侧。`);
      if (['unit-type-count-total', 'building-type-count-total', 'housing-headroom', 'military-population', 'game-time'].includes(command)) {
        const operatorIndex = command.endsWith('count-total') ? 2 : 1;
        if (!['<', '<=', '==', '!=', '>=', '>', 'less-than', 'greater-than', 'equal', 'not-equal', 'less-or-equal', 'greater-or-equal'].includes(atom(expression.list[operatorIndex]) ?? '')) add('error', 'ai.comparison', `第 ${expression.line} 行：比较运算符无效。`);
      }
    }
  }
  if (!rules) add('error', 'ai.noRules', '没有找到任何 defrule 规则。');
  add('info', 'ai.limited', '仅检查括号、规则结构及模板命令参数；完整 PER 编译、资源条件与 AI 行为仍需游戏内验证。');
  return result;
}
