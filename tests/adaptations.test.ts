import assert from 'node:assert/strict';
import test from 'node:test';
import { limbForm, wingForm } from '../src/sim/adaptations.ts';
import { LEGACY_GRID_SIZE, LAND_HEIGHT } from '../src/sim/terrain.ts';
import { DEFAULT_SEED } from '../src/sim/types.ts';
import type { Biome, Record as LineageRecord } from '../src/sim/types.ts';
import { MATURE_AGE, World } from '../src/sim/world.ts';

const biomes: Biome[] = ['archipelago', 'highlands', 'tundra', 'marsh', 'forest', 'grassland', 'archipelago', 'desert', 'forest'];
const mapSources = (seed: number) => biomes.map((biome, index) => ({ biome, seed: seed + 113 * index }));

test('滑翔翼能沿下坡移动得更远，飞行翼能越过陆行足不能进入的水面', () => {
  const world = new World(DEFAULT_SEED);
  const { terrain } = world;
  const base = world.creatures[0];
  const coast = terrain.cells.find(({ x, z }) =>
    terrain.isLand(x, z) && terrain.inBounds(x + 7.1, z) && terrain.height(x + 7.1, z) < -2.4);
  assert.ok(coast);
  const walker = { ...base, x: coast.x, z: coast.z, age: MATURE_AGE, angle: 0,
    genes: { ...base.genes, speed: 1, aquatic: 0.20, aerial: 0.25 } };
  const flyer = { ...walker, genes: { ...walker.genes, aerial: 0.74 } };
  world.move(walker, 5);
  world.move(flyer, 5);
  assert.ok(terrain.isLand(walker.x, walker.z));
  assert.ok(terrain.height(flyer.x, flyer.z) < -2.4);
  assert.ok(!terrain.canTraverse(flyer.x, flyer.z, 'foot', 'glider'));
  assert.ok(terrain.canTraverse(flyer.x, flyer.z, 'fin'));

  const slope = terrain.cells.find(({ x, z }) => {
    const drop = terrain.height(x, z) - terrain.height(x + 1.05, z);
    return drop > 0.10 && drop < 2.4 && terrain.isLand(x + 1.68, z) && terrain.isLand(x, z);
  });
  assert.ok(slope);
  Object.assign(walker, { x: slope.x, z: slope.z, angle: 0 });
  const glider = { ...walker, genes: { ...walker.genes, aerial: 0.53 } };
  world.move(walker, 1);
  world.move(glider, 1);
  assert.ok(glider.x > walker.x);
});

function ancestry(world: World, last: LineageRecord) {
  const records = [last];
  for (let id = last.parent; id !== null;) {
    const record = world.records.get(id);
    if (!record) break;
    records.push(record);
    id = record.parent;
  }
  return records.reverse();
}

test('九区的自然繁殖产生无翼、滑翔翼到飞行翼的父子链和新的飞行物种', () => {
  const world = World.compose(mapSources(DEFAULT_SEED));
  for (let tick = 0; tick < 1650; tick++) world.step();
  const record = [...world.records.values()].find(member => {
    if (!member.genes || wingForm(member.genes.aerial) !== 'flyer') return false;
    const trail = ancestry(world, member).map(ancestor => wingForm(ancestor.genes!.aerial));
    return trail[0] === 'wingless' && trail.includes('glider');
  });
  assert.ok(record, '飞行翼应出现在可追溯到滑翔翼和无翼的自然繁殖血脉上');
  assert.ok([...world.species.values()].some(species => species.adaptation === 'flyer'));
  assert.ok(world.creatures.some(creature => limbForm(creature.genes.aquatic) === 'fin'));
});

test('单区的陆行血脉能自然传下涉水蹼与游水鳍', () => {
  const world = new World(7);
  for (let tick = 0; tick < 2400; tick++) world.step();
  const descendant = [...world.records.values()].find(record => {
    if (!record.genes || limbForm(record.genes.aquatic) !== 'fin') return false;
    const trail = ancestry(world, record).map(ancestor => limbForm(ancestor.genes!.aquatic));
    return trail[0] === 'foot' && trail.includes('webbed');
  });
  assert.ok(descendant);
  assert.ok(world.creatures.some(creature => limbForm(creature.genes.aquatic) === 'fin'
    && world.terrain.height(creature.x, creature.z) < -2.4));
});

test('捕食者灭绝后由幸存血脉繁殖出继替物种，继替关系能读档并随地图拼合', () => {
  const world = new World(DEFAULT_SEED, false);
  world.introduce('browser', 0, 6);
  world.introduce('hunter', 0, 1);
  const originalHunter = world.creatures.find(c => c.role === 'hunter')!;
  const extinct = world.species.get(originalHunter.species)!;
  originalHunter.energy = 0;
  world.step();
  assert.equal(extinct.extinctAt, 1);
  assert.ok(!world.creatures.some(c => c.role === 'hunter'));
  const atExtinction = World.restore(JSON.parse(JSON.stringify(world.save())));
  let successor;
  for (let i = 0; i < 520 && !successor; i++) {
    world.step();
    atExtinction.step();
    successor = [...world.species.values()].find(species => species.replaces === extinct.id);
  }
  assert.ok(successor);
  assert.deepEqual(world.save(), atExtinction.save());
  assert.equal(successor.role, 'hunter');
  assert.notEqual(successor.id, extinct.id);
  const child = world.creatures.find(c => c.species === successor.id)!;
  const parent = world.records.get(child.parent!)!;
  assert.ok(child);
  assert.equal(parent.role, 'browser');
  assert.equal(parent.species, successor.parent);
  assert.equal(child.generation, parent.generation + 1);

  const joined = World.compose([...mapSources(DEFAULT_SEED).slice(0, -1), { save: world.save() }]);
  const joinedSuccessor = [...joined.species.values()].find(species => species.replaces !== undefined)!;
  assert.equal(joined.species.get(joinedSuccessor.replaces!)?.role, 'hunter');
  assert.equal(joined.species.get(joinedSuccessor.parent!)?.role, 'browser');
  assert.ok(joined.creatures.some(c => c.species === joinedSuccessor.id && joined.terrain.tileAt(c.x, c.z) === 8));
  assert.deepEqual(World.restore(JSON.parse(JSON.stringify(joined.save()))).save(), joined.save());
});

test('旧附肢档保留水中游水鳍和血脉，旧九区档补齐遗传行动形态', () => {
  // 从附肢分支种子 41827 的第 800 步存档取一个水中后代和始祖。
  const genes = { size: 1.0312974778958595, speed: 1.0045179991330953, comfort: 17.301147432904692,
    hue: 140.44143303204328, crest: 0.06515672479290516, aquatic: 0.7332324054656549 };
  const fish = { id: 164, role: 'grazer', parent: 156, generation: 5, x: 33.498494070833374, z: 23.25005905080172,
    angle: 2.3001738987898506, age: 174, energy: 99.48207870022266, cooldown: 35, genes };
  const previous = {
    version: 1, seed: DEFAULT_SEED, rng: 42, tick: 800, nextId: 165,
    climate: { temperature: 22, rain: 64 }, resources: Array(LEGACY_GRID_SIZE ** 2).fill(0), creatures: [fish],
    records: [
      { id: 30, parent: null, role: 'grazer', generation: 1, born: 0, died: 330, tracked: true, genes: { ...genes, aquatic: 0.23 }, limb: 'foot' },
      { id: 164, parent: 156, role: 'grazer', generation: 5, born: 626, died: null, tracked: true, genes, limb: 'fin' },
    ],
    births: 1, deaths: 1, census: [{ tick: 800, grazer: 1, hunter: 0 }],
    bloodline: { root: 30, role: 'grazer', total: 1, living: 1, generation: 5 },
  };
  const restored = World.restore(previous);
  const [descendant] = restored.creatures;
  assert.deepEqual([descendant.x, descendant.z], [fish.x, fish.z]);
  assert.ok(restored.terrain.height(descendant.x, descendant.z) < LAND_HEIGHT);
  assert.equal(descendant.genes.aquatic, genes.aquatic);
  assert.equal(restored.bloodline?.archive?.id, descendant.id);

  const current = World.compose(mapSources(DEFAULT_SEED)).save();
  const v3 = {
    ...current, version: 3,
    creatures: current.creatures.map(({ genes: { aquatic, aerial, ...traits }, ...c }) => ({ ...c, genes: traits })),
    records: current.records.map(({ genes, ...record }) => record),
  };
  const atlas = World.restore(v3);
  assert.equal(atlas.tiles.length, 9);
  assert.deepEqual(atlas.creatures.map(({ id, x, z }) => ({ id, x, z })), v3.creatures.map(({ id, x, z }) => ({ id, x, z })));
  assert.ok(atlas.creatures.filter(c => c.role === 'wader').every(c => limbForm(c.genes.aquatic) === 'webbed'));
});
