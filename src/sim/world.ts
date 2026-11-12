import { clamp, GRID_SIZE, LAND_HEIGHT, MAP_HALF, SHALLOW_HEIGHT, Terrain } from './terrain.ts';
import { DEFAULT_SEED, INITIAL_CLIMATE, LIMBS, limbForm, MAX_POPULATION, MINUTES_PER_TICK } from './types.ts';
import type {
  Bloodline,
  Census,
  Climate,
  Creature,
  Frame,
  Genes,
  Gift,
  LimbForm,
  LineageComparison,
  Record as LineageRecord,
  Role,
  Save,
  Speed,
} from './types.ts';

export const MATURE_AGE = 70;
const MAX_RECORDS = 2200;
const HISTORY_LENGTH = 80;
const TAU = Math.PI * 2;
export const LIMITS = {
  size: [0.60, 1.58],
  speed: [0.65, 1.58],
  comfort: [5, 38],
  hue: [15, 174],
  crest: [0, 1],
  aquatic: [0, 1],
} as const;
const GENES = Object.keys(LIMITS) as (keyof Genes)[];
const bounds = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const integer = (n: unknown, min: number, max: number): n is number =>
  bounds(n, min, max) && Number.isSafeInteger(n);
const isRole = (role: unknown): role is Role => role === 'grazer' || role === 'hunter';
const isLimb = (limb: unknown): limb is LimbForm => limb === 'foot' || limb === 'webbed' || limb === 'fin';
const distance2 = (a: Creature, b: Creature) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

export function validSeed(seed: unknown): seed is number {
  return integer(seed, 1, 999999999);
}

export class World {
  readonly seed: number;
  readonly terrain: Terrain;
  climate: Climate = { ...INITIAL_CLIMATE };
  creatures: Creature[] = [];
  resources: Float64Array;
  records = new Map<number, LineageRecord>();
  tick = 0;
  births = 0;
  deaths = 0;
  census: Census[] = [];
  bloodline: Bloodline | null = null;
  private rng: number;
  private nextId = 1;

  constructor(seed = DEFAULT_SEED, populate = true) {
    if (!validSeed(seed)) throw new Error('世界种子超出范围');
    this.seed = seed;
    this.rng = seed;
    this.terrain = new Terrain(seed);
    this.resources = Float64Array.from(this.terrain.cells, cell => cell.capacity * (0.60 + this.random() * 0.38));
    if (!populate) return;
    const central = this.terrain.land.filter(i => this.terrain.cells[i].capacity > 23);
    const nursery = central.length ? central : this.terrain.land;
    const first = nursery.reduce((nearest, index) => {
      const { x, z } = this.terrain.cells[index];
      const { x: a, z: b } = this.terrain.cells[nearest];
      return (x - 8) ** 2 + (z - 13) ** 2 < (a - 8) ** 2 + (b - 13) ** 2 ? index : nearest;
    }, nursery[0]);
    // Nursery cells are land, which all founding forms can traverse.
    for (let i = 0; i < 45; i++) this.creatures.push(this.spawn('grazer', i === 0 ? first : this.pick(nursery))!);
    for (let i = 0; i < 8; i++) this.creatures.push(this.spawn('hunter', this.pick(nursery))!);
    this.sample();
  }

  private random() {
    this.rng = (this.rng + 0x6d2b79f5) >>> 0;
    let value = Math.imul(this.rng ^ (this.rng >>> 15), 1 | this.rng);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  private pick(items: number[]) {
    return items[Math.floor(this.random() * items.length)];
  }

  private foundingGenes(role: Role): Genes {
    return {
      size: 0.82 + this.random() * 0.32,
      speed: (role === 'grazer' ? 0.91 : 1.09) + this.random() * 0.21,
      comfort: 17 + this.random() * 10,
      hue: role === 'grazer' ? 79 + this.random() * 70 : 23 + this.random() * 20,
      crest: this.random(),
      // Founding generation starts strictly as terrestrial foot-bearing ancestors (aquatic < 0.35)
      aquatic: 0.12 + this.random() * 0.19,
    };
  }

  private inherit(genes: Genes, parent: Creature): Genes {
    const mutate = (key: keyof Genes, amplitude: number) =>
      clamp(genes[key] + (this.random() + this.random() - 1) * amplitude, LIMITS[key][0], LIMITS[key][1]);
    const h = this.terrain.height(parent.x, parent.z);
    // Environmental & coastal exposure pressure shapes mutation drift along the foot -> webbed -> fin chain
    const wetDrive = (this.climate.rain - 50) / 50;
    const coastalBias = h < LAND_HEIGHT ? 0.045 + Math.max(0, wetDrive) * 0.035
      : h < 1.55 ? 0.022 + wetDrive * 0.025
      : wetDrive < -0.25 ? -0.030 : 0;
    const rawAquatic = genes.aquatic + (this.random() + this.random() - 1) * 0.22 + coastalBias;
    return {
      size: mutate('size', 0.15),
      speed: mutate('speed', 0.13),
      comfort: mutate('comfort', 2.7),
      hue: mutate('hue', 13),
      crest: mutate('crest', 0.21),
      aquatic: clamp(rawAquatic, LIMITS.aquatic[0], LIMITS.aquatic[1]),
    };
  }

  private spawn(role: Role, index: number, parent?: Creature) {
    const { x, z } = this.terrain.cells[index];
    const genes = parent ? this.inherit(parent.genes, parent) : this.foundingGenes(role);
    const limb = limbForm(genes.aquatic);
    let spawnX = parent?.x ?? x;
    let spawnZ = parent?.z ?? z;
    if (!this.terrain.canTraverse(spawnX, spawnZ, limb)) {
      for (let sample = 0; sample < 12; sample++) {
        const angle = (sample * TAU) / 12;
        const candidateX = spawnX + Math.cos(angle) * 2.2;
        const candidateZ = spawnZ + Math.sin(angle) * 2.2;
        if (this.terrain.canTraverse(candidateX, candidateZ, limb)) {
          spawnX = candidateX;
          spawnZ = candidateZ;
          break;
        }
      }
      if (!this.terrain.canTraverse(spawnX, spawnZ, limb)) return;
    }
    const creature: Creature = {
      id: this.nextId++,
      role,
      parent: parent?.id ?? null,
      generation: parent ? parent.generation + 1 : 1,
      x: spawnX,
      z: spawnZ,
      angle: this.random() * TAU,
      age: parent ? 0 : 35 + Math.floor(this.random() * 86),
      energy: parent ? 42 : 59 + this.random() * 29,
      cooldown: parent ? 65 : Math.floor(this.random() * 74),
      genes,
    };
    const tracked = !!parent && !!this.records.get(parent.id)?.tracked;
    this.records.set(creature.id, {
      id: creature.id,
      parent: creature.parent,
      role,
      generation: creature.generation,
      born: this.tick,
      died: null,
      tracked,
      limb,
      genes: { ...genes },
    });
    if (tracked && this.bloodline) {
      this.bloodline.total++;
      this.bloodline.generation = Math.max(this.bloodline.generation, creature.generation);
    }
    return creature;
  }

  effectivePace(creature: Creature, basePace: number, x = creature.x, z = creature.z) {
    const limb = limbForm(creature.genes.aquatic);
    const spec = LIMBS[limb];
    const inWater = this.terrain.isWater(x, z);
    const mediumMultiplier = inWater ? spec.waterPace : spec.landPace;
    return basePace * mediumMultiplier * creature.genes.speed * (0.65 + 0.35 * Math.min(1, creature.age / MATURE_AGE));
  }

  move(creature: Creature, pace: number) {
    const { x, z, angle } = creature;
    const limb = limbForm(creature.genes.aquatic);
    const distance = this.effectivePace(creature, pace, x, z);
    if (distance <= 0) return false;
    for (const turn of [0, 0.7, -0.7, 1.8, -1.8, Math.PI]) {
      const heading = angle + turn;
      const nextX = x + Math.cos(heading) * distance;
      const nextZ = z + Math.sin(heading) * distance;
      if (!this.terrain.canTraverse(nextX, nextZ, limb)) continue;
      const dh = Math.abs(this.terrain.height(nextX, nextZ) - this.terrain.height(x, z));
      const maxSlope = this.terrain.isWater(nextX, nextZ) ? distance * 3.8 : distance * 2.4;
      if (dh > maxSlope) continue;
      creature.x = nextX;
      creature.z = nextZ;
      creature.angle = (heading % TAU + TAU) % TAU;
      return true;
    }
    return false;
  }

  private graze(creature: Creature, hunters: Creature[]) {
    const limb = limbForm(creature.genes.aquatic);
    let fleeing = false;
    for (const hunter of hunters) {
      if (hunter.energy <= 0 || hunter.energy > 66 || distance2(creature, hunter) > 17) continue;
      creature.angle = Math.atan2(creature.z - hunter.z, creature.x - hunter.x);
      fleeing = true;
      break;
    }
    const index = this.terrain.cellAt(creature.x, creature.z);
    const food = this.resources[index];
    if (!fleeing && (this.tick + creature.id) % 13 === 0) {
      const start = this.random() * TAU;
      let best = -Infinity;
      const probeRadius = limb === 'fin' ? 5.6 : 4.7;
      for (let sample = 0; sample < 8; sample++) {
        const angle = start + sample * TAU / 8;
        const x = creature.x + probeRadius * Math.cos(angle);
        const z = creature.z + probeRadius * Math.sin(angle);
        if (!this.terrain.canTraverse(x, z, limb)) continue;
        const targetCell = this.terrain.cellAt(x, z);
        const targetWater = this.terrain.isWater(x, z);
        const habitatBonus = limb === 'fin' ? (targetWater ? 14 : -12)
          : limb === 'webbed' ? (this.terrain.isShallows(x, z) ? 9 : 2)
          : (!targetWater ? 5 : -20);
        const score = this.resources[targetCell] + habitatBonus + this.random() * 16;
        if (score <= best) continue;
        best = score;
        creature.angle = angle;
      }
    }
    this.move(creature, fleeing ? 0.38 : food > 6 && creature.energy < 86 ? 0.12 : 0.23);
    if (fleeing) creature.energy -= 0.12;
    if (!fleeing && creature.energy < 99) {
      const inWater = this.terrain.isWater(creature.x, creature.z);
      const maxBite = inWater
        ? (limb === 'fin' ? 1.56 : limb === 'webbed' ? 1.38 : 0.30)
        : (limb === 'foot' ? 1.32 : limb === 'webbed' ? 1.18 : 0.62);
      const conversion = inWater
        ? (limb === 'fin' ? 0.96 : limb === 'webbed' ? 0.88 : 0.40)
        : (limb === 'foot' ? 0.85 : limb === 'webbed' ? 0.79 : 0.48);
      const eaten = Math.min(food, maxBite);
      this.resources[index] -= eaten;
      creature.energy += eaten * conversion;
    }
  }

  private hunt(creature: Creature, grazers: Creature[]) {
    const limb = limbForm(creature.genes.aquatic);
    let target: Creature | undefined;
    let closest = (12 + 3 * creature.genes.crest) ** 2;
    if (creature.energy < 76) {
      for (const prey of grazers) {
        const d2 = distance2(creature, prey);
        if (prey.energy <= 0 || d2 >= closest) continue;
        if (!this.terrain.canTraverse(prey.x, prey.z, limb)) continue;
        closest = d2;
        target = prey;
      }
    }
    if (target) creature.angle = Math.atan2(target.z - creature.z, target.x - creature.x);
    else if ((this.tick + creature.id) % 19 === 0) creature.angle = this.random() * TAU;
    this.move(creature, target ? 0.34 : 0.18);
    const captureChance = this.terrain.isWater(creature.x, creature.z) && limb !== 'foot' ? 0.36 : 0.31;
    if (target && distance2(creature, target) < 0.85 ** 2 && this.random() < captureChance) {
      target.energy = 0;
      creature.energy += 42 * target.genes.size;
    }
  }

  step() {
    this.tick++;
    const { rain, temperature } = this.climate;
    // Land plant regrowth vs. aquatic algae/kelp regrowth respond differently to climate
    const landRegrowth = (0.032 + rain * 0.00135) * clamp(1 - Math.abs(temperature - 22) / 30, 0.22, 1.05);
    const waterRegrowth = (0.008 + ((rain / 100) ** 1.55) * 0.22) * clamp((temperature - 9) / 19, 0.06, 1.35);
    for (const i of this.terrain.land) {
      const capacity = this.terrain.cells[i].capacity;
      this.resources[i] = Math.min(capacity, this.resources[i] + landRegrowth);
    }
    for (const i of this.terrain.water) {
      const capacity = this.terrain.cells[i].capacity;
      if (capacity <= 0) continue;
      const depthBoost = this.terrain.cells[i].x ** 2 + this.terrain.cells[i].z ** 2 < 48 ** 2 ? 1.12 : 0.88;
      this.resources[i] = Math.min(capacity, this.resources[i] + waterRegrowth * depthBoost);
    }

    const grazers = this.creatures.filter(creature => creature.role === 'grazer');
    const hunters = this.creatures.filter(creature => creature.role === 'hunter');
    const young: Creature[] = [];
    for (const creature of this.creatures) {
      if (creature.energy <= 0) continue;
      creature.age++;
      creature.cooldown = Math.max(0, creature.cooldown - 1);
      const { genes } = creature;
      const limb = limbForm(genes.aquatic);
      const h = this.terrain.height(creature.x, creature.z);
      const inWater = h < LAND_HEIGHT;
      const microclimate = inWater
        ? temperature - 2.6 - Math.max(0, -h) * 0.35 + (rain - 50) * 0.03
        : temperature - h * 0.22;
      const thermalCost = Math.max(0, Math.abs(genes.comfort - microclimate) - 4) * 0.057;

      // Medium-specific metabolic and locomotion costs
      let mediumCost = 0;
      if (inWater) {
        // Swimming in water is energetically efficient for fin and webbed, but cold/arid water drains more energy
        mediumCost = limb === 'fin' ? -0.11 : limb === 'webbed' ? -0.05 : 0.28;
        if (rain < 30) mediumCost += (30 - rain) * 0.006;
      } else {
        // Walking on land is optimal for foot, moderate for webbed, and costly for fin (drying & gravity drag)
        mediumCost = limb === 'foot' ? -0.02 : limb === 'webbed' ? (rain >= 60 ? 0.01 : 0.07) : 0.24;
        if (rain > 78 && h < 2.2 && limb === 'foot') mediumCost += 0.06;
      }

      creature.energy -= Math.max(0.12, 0.23 + genes.size * 0.23 + genes.speed * 0.16 + thermalCost + mediumCost);
      if (creature.age > 780 + genes.size * 160) creature.energy -= 1.9;
      if (creature.energy <= 0) continue;
      if (creature.role === 'grazer') this.graze(creature, hunters);
      else this.hunt(creature, grazers);
      creature.energy = Math.min(100, creature.energy);
      const threshold = creature.role === 'grazer' ? 79 : 94;
      const pressure = (this.creatures.length + young.length) / MAX_POPULATION;
      const chance = (creature.role === 'grazer' ? 0.065 : 0.030) * (1 - pressure ** 3);
      if (creature.age >= MATURE_AGE && creature.cooldown === 0 && creature.energy >= threshold
        && pressure < 1 && this.random() < chance) {
        const newborn = this.spawn(creature.role, this.terrain.cellAt(creature.x, creature.z), creature);
        if (!newborn) continue;
        creature.energy -= 43;
        creature.cooldown = creature.role === 'grazer' ? 105 : 180;
        young.push(newborn);
        this.births++;
      }
    }
    this.creatures = this.creatures.filter(creature => {
      if (creature.energy > 0) return true;
      const record = this.records.get(creature.id);
      if (record) record.died = this.tick;
      this.deaths++;
      return false;
    }).concat(young);
    if (this.tick % 18 === 0) this.sample();
    if (this.records.size > MAX_RECORDS) this.prune();
  }

  private prune() {
    for (const keepTracked of [true, false]) {
      for (const [id, record] of this.records) {
        if (this.records.size <= MAX_RECORDS) return;
        if (record.died === null || id === this.bloodline?.root || (keepTracked && record.tracked)) continue;
        this.records.delete(id);
      }
    }
  }

  private sample() {
    let grazer = 0;
    let foot = 0;
    let webbed = 0;
    let fin = 0;
    for (const c of this.creatures) {
      if (c.role === 'grazer') grazer++;
      const l = limbForm(c.genes.aquatic);
      if (l === 'foot') foot++;
      else if (l === 'webbed') webbed++;
      else fin++;
    }
    this.census.push({
      tick: this.tick,
      grazer,
      hunter: this.creatures.length - grazer,
      foot,
      webbed,
      fin,
    });
    if (this.census.length > HISTORY_LENGTH) this.census.shift();
  }

  gift(id: number, gift: Gift) {
    const creature = this.creatures.find(c => c.id === id);
    if (!creature) return '这个体已经离开世界。';
    if (gift === 'restore') {
      const recovered = Math.min(35, 100 - creature.energy);
      creature.energy += recovered;
      return recovered < 1 ? '该个体的能量已充足。' : `恢复了 ${Math.round(recovered)} 点能量。`;
    }
    if (gift === 'grow') {
      const growth = Math.min(25, Math.max(0, MATURE_AGE - creature.age));
      creature.age += growth;
      return growth ? `成熟进程提前了 ${growth * MINUTES_PER_TICK} 个世界分钟。` : '这个个体已经成熟。';
    }
    const target = this.climate.temperature - this.terrain.height(creature.x, creature.z) * 0.22;
    const previous = creature.genes.comfort;
    creature.genes.comfort = clamp(previous + clamp(target - previous, -3, 3), ...LIMITS.comfort);
    const rec = this.records.get(creature.id);
    if (rec) rec.genes = { ...creature.genes };
    return Math.abs(creature.genes.comfort - previous) < 0.05
      ? '该个体已适应此处的气温。' : `适温变为 ${creature.genes.comfort.toFixed(1)}°C，后代可继承。`;
  }

  setClimate(patch: Partial<Climate>) {
    if (bounds(patch.temperature, 5, 38)) this.climate.temperature = patch.temperature;
    if (bounds(patch.rain, 10, 100)) this.climate.rain = patch.rain;
  }

  track(id: number) {
    if (this.bloodline?.root === id) return;
    const root = this.records.get(id);
    if (!root) return;
    let total = 0;
    let generation = root.generation;
    for (const record of this.records.values()) {
      record.tracked = record.id === id || (record.parent !== null && !!this.records.get(record.parent)?.tracked);
      if (!record.tracked) continue;
      if (record.id !== id) total++;
      generation = Math.max(generation, record.generation);
    }
    this.bloodline = { root: id, role: root.role, total, living: 0, generation };
  }

  private buildComparison(branch: LineageRecord[]): LineageComparison | null {
    if (!branch.length) return null;
    const ancestor = branch[0];
    // Prefer a living descendant with the highest aquatic/limb divergence or deepest generation, else latest record
    const candidates = branch.length > 1 ? branch.slice(1) : [ancestor];
    const descendant = [...candidates].sort((a, b) => {
      const aDiff = Number(a.limb !== ancestor.limb) * 2 + Number(a.died === null);
      const bDiff = Number(b.limb !== ancestor.limb) * 2 + Number(b.died === null);
      if (bDiff !== aDiff) return bDiff - aDiff;
      if (b.generation !== a.generation) return b.generation - a.generation;
      return b.id - a.id;
    })[0];

    const chain: LimbForm[] = [];
    const byId = new Map(branch.map(r => [r.id, r]));
    let cursor: LineageRecord | undefined = descendant;
    const path: LineageRecord[] = [];
    while (cursor) {
      path.unshift(cursor);
      cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
    }
    for (const node of path) {
      if (chain.at(-1) !== node.limb) chain.push(node.limb);
    }

    return {
      ancestorId: ancestor.id,
      ancestorGeneration: ancestor.generation,
      ancestorLimb: ancestor.limb,
      ancestorGenes: { ...ancestor.genes },
      descendantId: descendant.id,
      descendantGeneration: descendant.generation,
      descendantLimb: descendant.limb,
      descendantGenes: { ...descendant.genes },
      generationSpan: descendant.generation - ancestor.generation,
      stageChain: chain,
      chainComplete: path[0]?.id === ancestor.id,
    };
  }

  frame(playing: boolean, speed: Speed): Frame {
    const root = this.bloodline?.root;
    const branch = root === undefined ? [] : [...this.records.values()].filter(record => record.tracked);
    const living = this.bloodline ? branch.filter(record => record.id !== root && record.died === null).length : 0;
    const forms = { foot: 0, webbed: 0, fin: 0 };
    for (const r of branch) forms[r.limb]++;
    const comparison = this.buildComparison(branch);

    // Keep the records used by the comparison cards, early forms, and recent descendants.
    let selectedBranch = branch.slice(-12);
    if (branch.length > 12) {
      const firstWebbed = branch.find(r => r.limb === 'webbed');
      const firstFin = branch.find(r => r.limb === 'fin');
      const shownIds = new Set(selectedBranch.map(record => record.id));
      for (const id of [root, firstWebbed?.id, firstFin?.id, comparison?.descendantId]) {
        if (id !== undefined) shownIds.add(id);
      }
      selectedBranch = branch.filter(record => shownIds.has(record.id));
    }

    return {
      seed: this.seed,
      tick: this.tick,
      climate: this.climate,
      creatures: this.creatures,
      births: this.births,
      deaths: this.deaths,
      census: this.census,
      bloodline: this.bloodline ? { ...this.bloodline, living, forms, comparison } : null,
      branch: selectedBranch,
      playing,
      speed,
    };
  }

  save(): Save {
    return {
      version: 1,
      seed: this.seed,
      rng: this.rng,
      tick: this.tick,
      nextId: this.nextId,
      climate: { ...this.climate },
      creatures: this.creatures.map(c => ({ ...c, genes: { ...c.genes } })),
      resources: Array.from(this.resources),
      records: [...this.records.values()].map(record => ({ ...record, genes: { ...record.genes } })),
      births: this.births,
      deaths: this.deaths,
      census: this.census.map(sample => ({ ...sample })),
      bloodline: this.bloodline ? { ...this.bloodline } : null,
    };
  }

  static restore(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('没有可用的存档。');
    const save = value as Save;
    if (save.version !== 1) throw new Error('当前版本无法读取此存档。');
    if (!validSeed(save.seed) || !integer(save.tick, 0, Number.MAX_SAFE_INTEGER)
      || !integer(save.rng, 0, 0xffffffff) || !integer(save.nextId, 1, Number.MAX_SAFE_INTEGER)
      || !integer(save.births, 0, save.nextId) || !integer(save.deaths, 0, save.nextId)
      || !bounds(save.climate?.temperature, 5, 38) || !bounds(save.climate?.rain, 10, 100)
      || !Array.isArray(save.resources) || save.resources.length !== GRID_SIZE ** 2
      || save.resources.some(n => !bounds(n, 0, 71))
      || !Array.isArray(save.creatures) || save.creatures.length > MAX_POPULATION
      || !Array.isArray(save.records) || save.records.length > MAX_RECORDS
      || !Array.isArray(save.census) || save.census.length > HISTORY_LENGTH) throw new Error('存档内容有误。');
    const world = new World(save.seed, false);
    let priorId = 0;
    for (const r of save.records) {
      if (!r || !integer(r.id, priorId + 1, save.nextId - 1) || !isRole(r.role)
        || !integer(r.generation, 1, r.id) || !integer(r.born, 0, save.tick)
        || (r.parent !== null && !integer(r.parent, 1, r.id - 1))
        || (r.died !== null && !integer(r.died, r.born, save.tick))
        || typeof r.tracked !== 'boolean') throw new Error('存档谱系有误。');
      const fallbackGenes: Genes = r.genes && typeof r.genes === 'object'
        ? {
            size: clamp(Number(r.genes.size ?? 1), ...LIMITS.size),
            speed: clamp(Number(r.genes.speed ?? 1), ...LIMITS.speed),
            comfort: clamp(Number(r.genes.comfort ?? 22), ...LIMITS.comfort),
            hue: clamp(Number(r.genes.hue ?? 90), ...LIMITS.hue),
            crest: clamp(Number(r.genes.crest ?? 0.5), ...LIMITS.crest),
            aquatic: clamp(Number(r.genes.aquatic ?? 0.18), ...LIMITS.aquatic),
          }
        : { size: 1, speed: 1, comfort: 22, hue: 90, crest: 0.5, aquatic: 0.18 };
      const limb = isLimb(r.limb) ? r.limb : limbForm(fallbackGenes.aquatic);
      world.records.set(r.id, { ...r, limb, genes: fallbackGenes });
      priorId = r.id;
    }
    const ids = new Set<number>();
    for (const c of save.creatures) {
      const normalizedGenes: Genes | undefined = c?.genes
        ? { ...c.genes, aquatic: c.genes.aquatic ?? 0.18 }
        : undefined;
      const limb = normalizedGenes ? limbForm(normalizedGenes.aquatic) : 'foot';
      if (!c || !normalizedGenes || !isRole(c.role) || !integer(c.id, 1, save.nextId - 1) || ids.has(c.id)
        || !integer(c.generation, 1, c.id) || world.records.get(c.id)?.died !== null
        || (c.parent !== null && !integer(c.parent, 1, c.id - 1))
        || !bounds(c.x, -MAP_HALF, MAP_HALF) || !bounds(c.z, -MAP_HALF, MAP_HALF)
        || !world.terrain.canTraverse(c.x, c.z, limb) || !bounds(c.angle, -TAU, TAU)
        || !bounds(c.energy, Number.MIN_VALUE, 100) || !integer(c.age, 0, save.tick + 160)
        || !integer(c.cooldown, 0, 180)
        || GENES.some(key => !bounds(normalizedGenes[key], LIMITS[key][0], LIMITS[key][1]))) {
        throw new Error('存档个体有误。');
      }
      ids.add(c.id);
    }
    if (save.census.some(s => !s || !integer(s.tick, 0, save.tick)
      || !integer(s.grazer, 0, MAX_POPULATION) || !integer(s.hunter, 0, MAX_POPULATION - s.grazer))) {
      throw new Error('存档统计有误。');
    }
    if (save.bloodline !== null) {
      const b = save.bloodline;
      if (!b || !world.records.get(b.root)?.tracked || !isRole(b.role)
        || !integer(b.total, 0, save.births) || !integer(b.living, 0, MAX_POPULATION)
        || !integer(b.generation, 1, save.nextId)) throw new Error('存档血脉有误。');
    }
    world.tick = save.tick;
    world.rng = save.rng;
    world.nextId = save.nextId;
    world.climate = { ...save.climate };
    world.creatures = save.creatures.map(c => ({
      ...c,
      genes: { ...c.genes, aquatic: c.genes.aquatic ?? 0.18 },
    }));
    world.resources = Float64Array.from(save.resources);
    world.births = save.births;
    world.deaths = save.deaths;
    world.census = save.census.map(s => ({ ...s }));
    world.bloodline = save.bloodline ? { ...save.bloodline } : null;
    return world;
  }
}
