import assert from 'node:assert/strict';
import test from 'node:test';
import { MAP_HALF, GRID_SIZE } from '../src/sim/terrain.ts';
import { ATLAS_SIZE, BIOMES, DEFAULT_SEED, MAX_POPULATION } from '../src/sim/types.ts';
import type { Biome, MapTile, ParcelSource } from '../src/sim/types.ts';
import { MATURE_AGE, World } from '../src/sim/world.ts';

const biomes: Biome[] = [
  'archipelago', 'desert', 'forest', 'highlands', 'marsh', 'grassland', 'tundra', 'marsh', 'desert',
];
const tiles: MapTile[] = biomes.map((biome, index) => ({ seed: DEFAULT_SEED + index, biome }));

function advance(world: World, steps: number) {
  for (let step = 0; step < steps; step++) world.step();
}

test('拼合九区保留单区的进度、血脉和气候，存档可继续复现', () => {
  const first = new World(tiles[0].seed, true, [tiles[0]]);
  const last = new World(tiles[8].seed, true, [tiles[8]]);
  const tracked = [first, last].map(world => {
    const founder = world.creatures.find(creature => creature.role === 'grazer')!;
    world.gift(founder.id, 'grow');
    world.track(founder.id);
    world.breed(founder.id, 'hot-wet', 2);
    return founder.id;
  });
  first.setClimate({ temperature: 27, rain: 82 });
  last.setClimate({ temperature: 31, rain: 15 });
  advance(first, 4);
  advance(last, 9);
  const localResource = first.terrain.cellAt(first.creatures[0].x, first.creatures[0].z);
  first.resources[localResource] = 3.25;
  const firstSave = first.save();
  const lastSave = last.save();
  const unchanged = structuredClone([firstSave, lastSave]);
  const sources: ParcelSource[] = [...tiles];
  sources[0] = { save: firstSave };
  sources[8] = { save: lastSave };

  const world = World.compose(sources);
  assert.deepEqual(world.tiles, tiles);
  assert.equal(world.terrain.mapHalf, MAP_HALF * 3);
  assert.equal(world.terrain.gridSize, GRID_SIZE * 3);
  assert.equal(world.capacity, MAX_POPULATION * ATLAS_SIZE);
  assert.equal(world.tick, lastSave.tick);
  assert.deepEqual(world.regions[0], firstSave.regions[0]);
  assert.deepEqual(world.regions[8], lastSave.regions[0]);
  assert.deepEqual(world.regions[2].climate, BIOMES.forest.climate);
  assert.equal(new Set(world.creatures.map(creature => creature.id)).size, world.creatures.length);

  for (const [region, save, root] of [[0, firstSave, tracked[0]], [8, lastSave, tracked[1]]] as const) {
    const original = save.creatures.find(creature => creature.id === root)!;
    const center = world.terrain.tileCenter(region);
    const founder = world.creatures.find(creature =>
      creature.x === original.x + center.x && creature.z === original.z + center.z
      && creature.age === original.age && creature.genes.hue === original.genes.hue)!;
    assert.ok(founder);
    const offset = founder.id - root;
    assert.equal(world.terrain.tileAt(founder.x, founder.z), region);
    assert.equal(founder.energy, original.energy);
    assert.deepEqual(founder.genes, original.genes);
    assert.equal(world.lineages.get(founder.id)?.total, save.lineages[0].total);
    for (const previous of save.records.filter(record => record.parent === root)) {
      const child = world.records.get(previous.id + offset)!;
      assert.equal(child.parent, founder.id);
      assert.equal(child.born - world.tick, previous.born - save.tick);
      assert.ok(child.lineages.includes(founder.id));
    }
  }

  const cell = first.terrain.cells[localResource];
  const center = world.terrain.tileCenter(0);
  assert.equal(world.resources[world.terrain.cellAt(cell.x + center.x, cell.z + center.z)], 3.25);

  const snapshot = world.save();
  const restored = World.restore(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(restored.save(), snapshot);
  for (const state of [world, restored]) {
    state.setClimate({ rain: 37 }, 5);
    advance(state, 3);
  }
  assert.equal(world.regions[5].climate.rain, 37);
  assert.equal(world.regions[0].climate.rain, 82);
  assert.deepEqual(world.save(), restored.save());
  assert.deepEqual([firstSave, lastSave], unchanged);
});

test('拼合地貌有连续通路，苔叶兽可以通过模拟移动跨区', () => {
  const world = new World(tiles[0].seed, false, tiles);
  const { terrain } = world;
  const margin = 0.1;
  for (let index = 0; index < ATLAS_SIZE; index++) {
    const { x, z } = terrain.tileCenter(index);
    if (index % 3 < 2) {
      assert.ok(terrain.isLand(x + MAP_HALF - margin, z));
      assert.ok(terrain.isLand(x + MAP_HALF + margin, z));
    }
    if (index < 6) {
      assert.ok(terrain.isLand(x, z + MAP_HALF - margin));
      assert.ok(terrain.isLand(x, z + MAP_HALF + margin));
    }
  }
  world.introduce('grazer', 0, 1);
  const [grazer] = world.creatures;
  const center = terrain.tileCenter(0);
  Object.assign(grazer, {
    x: center.x + MAP_HALF - margin, z: center.z, angle: 0, age: MATURE_AGE, energy: 99, cooldown: 99,
  });
  grazer.genes.speed = 1;
  assert.equal(terrain.tileAt(grazer.x, grazer.z), 0);
  world.step();
  assert.equal(terrain.tileAt(grazer.x, grazer.z), 1);
  assert.equal(world.frame(false, 1).regions[1].population, 1);
});
