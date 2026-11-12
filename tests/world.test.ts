import assert from 'node:assert/strict';
import test from 'node:test';
import { World, MATURE_AGE } from '../src/sim/world.ts';
import { DEFAULT_SEED, MAX_POPULATION } from '../src/sim/types.ts';

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
  world.step();
  assert.ok(world.creatures.some((c, i) => c.x !== start.creatures[i].x || c.z !== start.creatures[i].z));
  assert.ok(world.creatures.some((c, i) => c.energy !== start.creatures[i].energy));
  advance(world, 359);
  assert.ok(world.births > 0);
  assert.ok(world.deaths > 0);
  assert.equal(world.creatures.length, 53 + world.births - world.deaths);
  assert.ok(world.creatures.length <= MAX_POPULATION);
  assert.ok(world.creatures.every(c => world.terrain.isLand(c.x, c.z) && c.energy > 0 && c.energy <= 100));
  assert.ok(world.resources.every((amount, index) => amount >= 0 && amount <= world.terrain.cells[index].capacity));
  const child = world.creatures.find(c => c.parent !== null);
  assert.ok(child);
  assert.ok(child.generation > 1);
  assert.ok(child.genes.speed >= 0.65 && child.genes.speed <= 1.58);
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
  const restored = World.restore(snapshot);
  assert.deepEqual(restored.save(), original.save());
  advance(original, 165);
  advance(restored, 165);
  assert.deepEqual(restored.save(), original.save());
  assert.throws(() => World.restore({ ...snapshot, version: 77 }), /无法读取/);
  assert.throws(() => World.restore({ ...snapshot, resources: [] }), /存档内容有误/);
});
