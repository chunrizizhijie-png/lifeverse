import assert from 'node:assert/strict';
import test from 'node:test';
import { GRID_SIZE, LEGACY_GRID_SIZE, LEGACY_MAP_HALF, MAP_HALF } from '../src/sim/terrain.ts';
import { World, MATURE_AGE } from '../src/sim/world.ts';
import { DEFAULT_SEED, MAX_POPULATION, ROLE_KEYS } from '../src/sim/types.ts';
import type { Role } from '../src/sim/types.ts';

function advance(world: World, ticks: number) {
  for (let i = 0; i < ticks; i++) world.step();
}

test('同一种子和干预顺序产生相同世界', () => {
  const left = new World(DEFAULT_SEED);
  const right = new World(DEFAULT_SEED);
  for (const world of [left, right]) {
    advance(world, 125);
    world.setClimate({ temperature: 31, rain: 32 });
    world.gift(1, 'adapt');
    advance(world, 280);
  }
  assert.deepEqual(left.save(), right.save());
  assert.notDeepEqual(new World(DEFAULT_SEED + 1).terrain.heights, left.terrain.heights);
});

test('五种初始生态角色移动，世界持续发生出生和死亡', () => {
  const world = new World();
  const start = world.save();
  assert.equal(ROLE_KEYS.length, 5);
  assert.deepEqual(new Set(start.creatures.map(c => c.role)), new Set(ROLE_KEYS));
  world.step();
  assert.ok(world.creatures.some((c, i) => c.x !== start.creatures[i].x || c.z !== start.creatures[i].z));
  assert.ok(world.creatures.some((c, i) => c.energy !== start.creatures[i].energy));
  advance(world, 359);
  assert.ok(world.births > 0);
  assert.ok(world.deaths > 0);
  assert.equal(world.creatures.length, start.creatures.length + world.births - world.deaths);
  assert.ok(world.creatures.length <= MAX_POPULATION);
  assert.ok(world.creatures.every(c => c.energy > 0 && c.energy <= 100));
  assert.ok(world.creatures.every(c => world.terrain.isLand(c.x, c.z)
    || ((c.role === 'wader' || c.role === 'stalker' || c.form === 'wetland') && world.terrain.isShallow(c.x, c.z))));
  assert.ok(world.resources.every((amount, index) => amount >= 0 && amount <= world.terrain.cells[index].capacity));
  const child = world.creatures.find(c => c.parent !== null);
  assert.ok(child);
  assert.ok(child.generation > 1);
  assert.ok(child.genes.speed >= 0.65 && child.genes.speed <= 1.58);
});

test('扩大的地图提供旧范围以外的陆地和可用浅滩', () => {
  const world = new World(DEFAULT_SEED);
  assert.ok(MAP_HALF > LEGACY_MAP_HALF);
  assert.ok(world.terrain.land.some(index => {
    const { x, z } = world.terrain.cells[index];
    return Math.max(Math.abs(x), Math.abs(z)) > LEGACY_MAP_HALF;
  }));
  assert.ok(world.creatures.some(c => c.role === 'wader' && world.terrain.isShallow(c.x, c.z)));
});

test('同种苔叶兽的湿地型能从陆地进入浅滩', () => {
  const world = new World(DEFAULT_SEED);
  const { terrain } = world;
  const pace = 0.23;
  const shore = terrain.cells.find(({ x, z }) => terrain.isLand(x, z) && terrain.isShallow(x + pace, z)
    && Math.abs(terrain.height(x, z) - terrain.height(x + pace, z)) < pace * 2.4)!;
  assert.ok(shore);
  const [grazer] = world.creatures;
  Object.assign(grazer, { x: shore.x, z: shore.z, angle: 0, age: MATURE_AGE, energy: 99, cooldown: 99 });
  grazer.genes.speed = 1;
  world.creatures = [grazer];
  const other = World.restore(world.save());
  grazer.form = 'wetland';

  world.step();
  other.step();

  assert.ok(terrain.isShallow(grazer.x, grazer.z));
  const [ancestral] = other.creatures;
  assert.ok(terrain.isLand(ancestral.x, ancestral.z));
});

test('成年琥脊兽能缩短与稍慢的逃跑苔叶兽之间的距离', () => {
  const world = new World(DEFAULT_SEED);
  const grazer = world.creatures.find(c => c.role === 'grazer')!;
  const hunter = world.creatures.find(c => c.role === 'hunter')!;
  const initialGrazerX = grazer.x;
  const initialGap = 2;

  // 在首只苔叶兽附近的陆地上安排一场直线追逐。
  hunter.x = grazer.x - initialGap;
  hunter.z = grazer.z;
  grazer.genes.speed = 1;
  hunter.genes.speed = 1.05;
  for (const creature of [grazer, hunter]) {
    creature.age = MATURE_AGE;
    creature.energy = 65;
    creature.cooldown = 99;
  }
  world.creatures = [grazer, hunter];

  world.step();

  assert.ok(grazer.x > initialGrazerX);
  assert.ok(Math.hypot(grazer.x - hunter.x, grazer.z - hunter.z) < initialGap);
});

test('棘冠兽会逃避两种捕食者，苔叶兽和潮鳍兽面临不同威胁', () => {
  function flees(preyRole: Role, predatorRole: Role) {
    const world = new World(DEFAULT_SEED);
    const [origin] = world.creatures;
    const prey = world.creatures.find(c => c.role === preyRole)!;
    const predator = world.creatures.find(c => c.role === predatorRole)!;
    const startX = origin.x;
    Object.assign(prey, { x: startX, z: origin.z, age: MATURE_AGE, energy: 60, angle: Math.PI });
    Object.assign(predator, { x: startX - 2, z: origin.z, age: MATURE_AGE, energy: 60, angle: 0 });
    world.creatures = [prey, predator];
    world.step();
    return prey.x > startX;
  }

  assert.equal(flees('grazer', 'hunter'), true);
  assert.equal(flees('grazer', 'stalker'), false);
  assert.equal(flees('browser', 'hunter'), true);
  assert.equal(flees('browser', 'stalker'), true);
  assert.equal(flees('wader', 'hunter'), false);
  assert.equal(flees('wader', 'stalker'), true);
});

test('造物主促生、恢复能量和遗传调适分别作用于对应属性', () => {
  const world = new World();
  const child = world.creatures.find(c => c.age < MATURE_AGE)!;
  const genes = { ...child.genes };
  child.energy = 48;
  world.gift(child.id, 'grow');
  assert.equal(child.age, MATURE_AGE);
  assert.equal(child.cooldown, 0);
  assert.ok(child.energy > 48);
  child.energy = 48;
  world.gift(child.id, 'restore');
  assert.equal(child.energy, 100);
  assert.deepEqual(child.genes, genes);
  world.setClimate({ temperature: 38, rain: 10 });
  const before = world.frame(false, 1).creatures.find(c => c.id === child.id)!;
  world.gift(child.id, 'adapt');
  assert.ok(child.genes.comfort > genes.comfort);
  assert.ok(Math.abs(child.genes.moisture - before.localMoisture) < Math.abs(genes.moisture - before.localMoisture));
  const after = world.frame(false, 1).creatures.find(c => c.id === child.id)!;
  assert.ok(after.stress < before.stress);
  assert.equal(child.genes.size, genes.size);
});

test('气候影响资源和个体能耗', () => {
  const mild = new World();
  const dry = new World();
  dry.setClimate({ temperature: 36, rain: 12 });
  advance(mild, 100);
  advance(dry, 100);
  assert.notDeepEqual(mild.resources, dry.resources);
  assert.notDeepEqual(mild.creatures.map(c => c.energy), dry.creatures.map(c => c.energy));
});

test('持续干旱和丰雨让同一批祖先留下不同适湿性状的后代', () => {
  const dry = new World(DEFAULT_SEED);
  const wet = new World(DEFAULT_SEED);
  dry.setClimate({ rain: 18 });
  wet.setClimate({ rain: 95 });
  assert.equal(dry.rainTrend, wet.rainTrend);

  for (const world of [dry, wet]) {
    for (let step = 0; step < 1800; step++) {
      world.step();
      assert.ok(world.creatures.length <= MAX_POPULATION);
    }
  }
  assert.ok(dry.rainTrend < 20 && wet.rainTrend > 90);

  const dryGrazers = dry.creatures.filter(c => c.role === 'grazer' && c.generation > 1);
  const wetGrazers = wet.creatures.filter(c => c.role === 'grazer' && c.generation > 1);
  assert.ok(dryGrazers.some(c => c.form === 'dryland'));
  assert.ok(wetGrazers.some(c => c.form === 'wetland'));
  const mean = (grazers: typeof dryGrazers) => grazers.reduce((sum, c) => sum + c.genes.moisture, 0) / grazers.length;
  assert.ok(mean(wetGrazers) - mean(dryGrazers) > 15);
});

test('血脉记录识别真实的父代和子代', () => {
  const world = new World();
  advance(world, 180);
  const child = world.creatures.find(c => c.parent !== null);
  assert.ok(child);
  world.track(child.parent!);
  const frame = world.frame(true, 1);
  assert.equal(frame.bloodline?.root, child.parent);
  assert.ok((frame.bloodline?.total ?? 0) >= 1);
  assert.ok(frame.branch.some(record => record.id === child.id && record.parent === child.parent));
});

test('存档可恢复随机状态，拒绝错误版本和异常数据', () => {
  const original = new World();
  original.track(1);
  advance(original, 400);
  const snapshot = JSON.parse(JSON.stringify(original.save()));
  assert.equal(snapshot.version, 3);
  const restored = World.restore(snapshot);
  assert.deepEqual(restored.save(), original.save());
  advance(original, 165);
  advance(restored, 165);
  assert.deepEqual(restored.save(), original.save());
  assert.throws(() => World.restore({ ...snapshot, version: 77 }), /无法读取/);
  assert.throws(() => World.restore({ ...snapshot, resources: [] }), /存档内容有误/);
});

test('v1 存档把旧地图资源移到对应坐标并保留个体和血脉', () => {
  // 来自 308be23 的初始种子 41827，裁剪到一个个体和一个资源格。
  const creature = {
    id: 1, role: 'grazer', parent: null, generation: 1, x: 7.5, z: 13.5,
    angle: 3.637662784879083, age: 64, energy: 81.03593768714927, cooldown: 38,
    genes: { size: 1.067755065858364, speed: 0.9515041498863138, comfort: 18.47989788092673,
      hue: 98.61119676241651, crest: 0.7738467522431165 },
  };
  const resources = Array<number>(LEGACY_GRID_SIZE ** 2).fill(0);
  resources[1073] = 38.9186017269287;
  const bloodline = { root: 1, role: 'grazer', total: 0, living: 0, generation: 1 };
  const oldSave = {
    version: 1, seed: DEFAULT_SEED, rng: 3597402844, tick: 0, nextId: 2,
    climate: { temperature: 22, rain: 64 }, resources, creatures: [creature],
    records: [{ id: 1, parent: null, role: 'grazer', generation: 1, born: 0, died: null, tracked: true }],
    births: 0, deaths: 0, census: [{ tick: 0, grazer: 1, hunter: 0 }], bloodline,
  };
  const migrated = World.restore(oldSave);
  const save = migrated.save();
  assert.equal(save.version, 3);
  assert.equal(save.rng, oldSave.rng);
  assert.equal(save.resources.length, GRID_SIZE ** 2);
  assert.equal(save.resources[migrated.terrain.cellAt(creature.x, creature.z)], resources[1073]);
  assert.equal(save.activeLineage, bloodline.root);
  const { archive, ...line } = save.lineages[0];
  assert.ok(archive);
  assert.deepEqual(line, bloodline);
  assert.equal(save.creatures.length, 1);
  const [survivor] = save.creatures;
  assert.equal(survivor.form, 'ancestral');
  const { form, species, genes, ...originalCreature } = survivor;
  assert.equal(save.species.find(branch => branch.id === species)?.role, creature.role);
  const { moisture, ...originalGenes } = genes;
  const { genes: oldGenes, ...oldCreature } = creature;
  assert.ok(moisture >= 0 && moisture <= 100);
  assert.deepEqual(originalGenes, oldGenes);
  assert.deepEqual(originalCreature, oldCreature);
  assert.deepEqual(save.census, [{ tick: 0, grazer: 1, hunter: 0, browser: 0, wader: 0, stalker: 0 }]);
  const restored = World.restore(save);
  advance(migrated, 10);
  advance(restored, 10);
  assert.deepEqual(restored.save(), migrated.save());
});
