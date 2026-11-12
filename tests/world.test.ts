import assert from 'node:assert/strict';
import test from 'node:test';
import { World, MATURE_AGE } from '../src/sim/world.ts';
import { DEFAULT_SEED, describeCapabilities, limbForm, MAX_POPULATION } from '../src/sim/types.ts';

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

test('两种生态角色移动、繁殖、消耗能量和死亡', () => {
  const world = new World();
  const start = world.save();
  assert.equal(start.creatures.length, 53);
  assert.deepEqual(new Set(start.creatures.map(c => c.role)), new Set(['grazer', 'hunter']));
  assert.ok(start.creatures.every(c => limbForm(c.genes.aquatic) === 'foot'));
  world.step();
  assert.ok(world.creatures.some((c, i) => c.x !== start.creatures[i].x || c.z !== start.creatures[i].z));
  assert.ok(world.creatures.some((c, i) => c.energy !== start.creatures[i].energy));
  advance(world, 359);
  assert.ok(world.births > 0);
  assert.ok(world.deaths > 0);
  assert.equal(world.creatures.length, 53 + world.births - world.deaths);
  assert.ok(world.creatures.length <= MAX_POPULATION);
  assert.ok(world.creatures.every(c =>
    world.terrain.canTraverse(c.x, c.z, limbForm(c.genes.aquatic)) && c.energy > 0 && c.energy <= 100
  ));
  assert.ok(world.resources.every((amount, index) => amount >= 0 && amount <= world.terrain.cells[index].capacity));
  const child = world.creatures.find(c => c.parent !== null);
  assert.ok(child);
  assert.ok(child.generation > 1);
  assert.ok(child.genes.speed >= 0.65 && child.genes.speed <= 1.58);
});

test('造物主促生、恢复能量和遗传调适分别作用于对应属性', () => {
  const world = new World();
  const child = world.creatures.find(c => c.age < MATURE_AGE)!;
  const genes = { ...child.genes };
  child.energy = 48;
  const oldAge = child.age;
  world.gift(child.id, 'restore');
  assert.equal(child.energy, 83);
  world.gift(child.id, 'grow');
  assert.equal(child.age, Math.min(MATURE_AGE, oldAge + 25));
  assert.deepEqual(child.genes, genes);
  world.setClimate({ temperature: 38 });
  world.gift(child.id, 'adapt');
  assert.ok(child.genes.comfort > genes.comfort);
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

test('血脉记录识别真实的父代和子代并支持祖先后代形态能力对照', () => {
  const world = new World(DEFAULT_SEED);
  world.track(30);
  advance(world, 750);
  const frame = world.frame(true, 1);
  assert.equal(frame.bloodline?.root, 30);
  assert.ok((frame.bloodline?.total ?? 0) >= 5);
  const comparison = frame.bloodline?.comparison;
  assert.ok(comparison);
  assert.equal(comparison.ancestorId, 30);
  assert.equal(comparison.ancestorLimb, 'foot');
  assert.ok(comparison.descendantGeneration > comparison.ancestorGeneration);
  assert.notEqual(comparison.descendantLimb, 'foot');
  const ancestorCap = describeCapabilities(comparison.ancestorGenes);
  const descendantCap = describeCapabilities(comparison.descendantGenes);
  assert.equal(ancestorCap.canWade, false);
  assert.equal(descendantCap.canWade, true);
  assert.ok(descendantCap.waterSpeed > ancestorCap.waterSpeed);
});

test('存档可恢复随机状态，拒绝错误版本和异常数据', () => {
  const original = new World();
  original.track(1);
  advance(original, 400);
  const snapshot = JSON.parse(JSON.stringify(original.save()));
  const restored = World.restore(snapshot);
  assert.deepEqual(restored.save(), original.save());
  advance(original, 165);
  advance(restored, 165);
  assert.deepEqual(restored.save(), original.save());
  assert.throws(() => World.restore({ ...snapshot, version: 77 }), /无法读取/);
  assert.throws(() => World.restore({ ...snapshot, resources: [] }), /存档内容有误/);
});

test('不同附肢形态具有实际行动差异：涉水蹼可涉过陆行足无法进入的浅滩', () => {
  const world = new World(DEFAULT_SEED);
  // Find a shore coordinate right next to a shallows coordinate
  let shallowPoint: { x: number; z: number } | undefined;
  for (let x = -50; x <= 50 && !shallowPoint; x += 0.5) {
    for (let z = -50; z <= 50; z += 0.5) {
      if (world.terrain.isShallows(x, z)) {
        shallowPoint = { x, z };
        break;
      }
    }
  }
  assert.ok(shallowPoint);
  assert.equal(world.terrain.isLand(shallowPoint.x, shallowPoint.z), false);
  assert.equal(world.terrain.canTraverse(shallowPoint.x, shallowPoint.z, 'foot'), false);
  assert.equal(world.terrain.canTraverse(shallowPoint.x, shallowPoint.z, 'webbed'), true);
  assert.equal(world.terrain.canTraverse(shallowPoint.x, shallowPoint.z, 'fin'), true);
});

test('固定种子自然跑出足→蹼→鳍进化链并遗传给下一代，且有蹼后代实际进入浅滩', () => {
  const world = new World(DEFAULT_SEED);
  let wadedBy73 = false;
  for (let t = 1; t <= 800; t++) {
    world.step();
    const c73 = world.creatures.find(c => c.id === 73);
    if (c73 && world.terrain.isShallows(c73.x, c73.z)) wadedBy73 = true;
  }
  const r30 = world.records.get(30)!;
  const r73 = world.records.get(73)!;
  const r105 = world.records.get(105)!;
  const r156 = world.records.get(156)!;
  const r164 = world.records.get(164)!;
  const r176 = world.records.get(176)!;

  // Gen 1 terrestrial ancestor #030 (foot) -> Gen 2 natural emergence of webbed #073 -> Gen 3 inheritance #105
  assert.equal(r30.limb, 'foot');
  assert.equal(r73.parent, 30);
  assert.equal(r73.limb, 'webbed');
  assert.ok(wadedBy73, '有蹼后代 #073 实际涉入祖先 #030 无法进入的浅滩');
  assert.equal(r105.parent, 73);
  assert.equal(r105.limb, 'webbed');

  // Gen 4 webbed #156 -> Gen 5 natural emergence of fin #164 -> Gen 6 inheritance #176
  assert.equal(r156.parent, 105);
  assert.equal(r156.limb, 'webbed');
  assert.equal(r164.parent, 156);
  assert.equal(r164.limb, 'fin');
  assert.equal(r176.parent, 164);
  assert.equal(r176.limb, 'fin');
});

test('相同起点在两种不同环境下经过多代演化后各形态数量显著分化', () => {
  const wetMarine = new World(DEFAULT_SEED);
  const dryInland = new World(DEFAULT_SEED);
  wetMarine.setClimate({ temperature: 28, rain: 95 });
  dryInland.setClimate({ temperature: 13, rain: 14 });

  advance(wetMarine, 2400);
  advance(dryInland, 2400);

  const countForms = (w: World) => {
    const counts = { foot: 0, webbed: 0, fin: 0 };
    for (const c of w.creatures) counts[limbForm(c.genes.aquatic)]++;
    return counts;
  };
  const wetCounts = countForms(wetMarine);
  const dryCounts = countForms(dryInland);

  // In warm/wet marine environment, aquatic forms (webbed + fin) dominate
  assert.ok(wetCounts.fin + wetCounts.webbed > wetCounts.foot * 3);
  assert.ok(wetCounts.fin > 100);
  // In cold/dry inland environment, terrestrial foot form dominates
  assert.ok(dryCounts.foot > dryCounts.webbed + dryCounts.fin);
  assert.equal(dryCounts.fin, 0);
});
