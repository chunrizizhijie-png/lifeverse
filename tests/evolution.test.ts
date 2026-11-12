import assert from 'node:assert/strict';
import test from 'node:test';
import { nicheFor, speciesName } from '../src/sim/evolution.ts';
import { MATURE_AGE, World } from '../src/sim/world.ts';

test('同一原种连续两代适应低温或高温多雨后分成不同物种', () => {
  const world = new World();
  const founder = world.creatures.find(creature => creature.role === 'stalker')!;
  world.gift(founder.id, 'grow');
  assert.ok(founder.age >= MATURE_AGE);
  const directions = ['cold-wet', 'hot-wet'] as const;

  for (const niche of directions) {
    const first = world.creatures.length;
    world.breed(founder.id, niche, 2);
    const juveniles = world.creatures.slice(first);
    assert.equal(juveniles.length, 2);
    assert.ok(juveniles.every(creature => creature.parent === founder.id && creature.species === founder.species
      && nicheFor(creature.genes) === niche));

    const [parent] = juveniles;
    world.gift(parent.id, 'grow');
    const second = world.creatures.length;
    world.breed(parent.id, niche, 2);
    const grandchildren = world.creatures.slice(second);
    assert.equal(grandchildren.length, 2);
    assert.ok(grandchildren.every(creature => creature.parent === parent.id && creature.species !== founder.species
      && nicheFor(creature.genes) === niche));
    assert.equal(new Set(grandchildren.map(creature => creature.species)).size, 1);
  }

  const branches = world.frame(false, 1).species.filter(species => species.parent === founder.species);
  assert.deepEqual(branches.map(species => species.niche), [...directions]);
  assert.deepEqual(branches.map(speciesName), ['低温多雨影爪兽', '高温多雨影爪兽']);
  assert.deepEqual(branches.map(species => species.population), [2, 2]);
  const saved = world.save();
  const restored = World.restore(saved);
  assert.deepEqual(restored.save(), saved);
  assert.deepEqual(restored.frame(false, 1).species, world.frame(false, 1).species);
});

test('血脉根个体死亡后可选在世后代延续，也可从存档遗传性状复育', () => {
  const world = new World();
  const root = world.creatures.find(creature => creature.role === 'stalker')!;
  world.gift(root.id, 'grow');
  world.track(root.id);
  world.breed(root.id, 'hot-wet', 1);
  const child = world.creatures.at(-1)!;
  assert.equal(child.parent, root.id);
  world.gift(child.id, 'grow');

  root.energy = 0;
  world.step();
  let frame = world.frame(false, 1);
  assert.equal(frame.bloodline?.root, root.id);
  assert.equal(frame.bloodline?.living, 1);
  assert.equal(frame.branch.find(record => record.id === root.id)?.died, world.tick);
  assert.ok(frame.branch.some(record => record.id === child.id && record.died === null));

  const livingBranchResult = world.breedLineage(root.id, 0, 'hot-wet', 1);
  const grandchild = world.creatures.at(-1)!;
  assert.match(livingBranchResult, new RegExp(`#${child.id}\\b`));
  assert.equal(grandchild.parent, child.id);
  child.energy = 0;
  grandchild.energy = 0;
  world.step();

  const restored = World.restore(world.save());
  frame = restored.frame(false, 1);
  assert.equal(frame.bloodline?.living, 0);
  assert.deepEqual(frame.bloodline?.archive?.genes, root.genes);

  const result = restored.breedLineage(root.id, 0, 'cold-wet', 2);
  assert.match(result, /档案复育/);
  const recovered = restored.creatures.slice(-2);
  assert.ok(recovered.every(creature => creature.parent === root.id && nicheFor(creature.genes) === 'cold-wet'));
  frame = restored.frame(false, 1);
  assert.equal(frame.bloodline?.living, 2);
  assert.equal(frame.bloodline?.total, 4);
  assert.equal(frame.bloodline?.generation, grandchild.generation);
});
