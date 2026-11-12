import { canWade, forageQuality, FOUNDERS, huntingRules, inheritedForm, TRAIT_CENTERS } from './ecology.ts';
import { clamp, GRID_SIZE, LAND_HEIGHT, LEGACY_GRID_SIZE, MAP_HALF, Terrain } from './terrain.ts';
import { creatureName, DEFAULT_SEED, FORM_NAMES, INITIAL_CLIMATE, MAX_POPULATION, populationCounts, ROLE_KEYS } from './types.ts';
import type { Bloodline, Census, Climate, Creature, Frame, Genes, Gift, Record as LineageRecord, Role, Save, Speed } from './types.ts';

export const MATURE_AGE = 70;
const MAX_RECORDS = 2200;
const HISTORY_LENGTH = 80;
const TAU = Math.PI * 2;
const LIMITS = {
  size: [0.60, 1.58],
  speed: [0.65, 1.58],
  comfort: [5, 38],
  moisture: [0, 100],
  hue: [15, 300],
  crest: [0, 1],
} as const;
const GENES = Object.keys(LIMITS) as (keyof Genes)[];
const bounds = (n: unknown, min: number, max: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const integer = (n: unknown, min: number, max: number): n is number =>
  bounds(n, min, max) && Number.isSafeInteger(n);
const isRole = (role: unknown): role is Role => ROLE_KEYS.includes(role as Role);
const isForm = (form: unknown): form is Creature['form'] => typeof form === 'string' && Object.hasOwn(FORM_NAMES, form);
const isLegacyRole = (role: unknown): role is 'grazer' | 'hunter' => role === 'grazer' || role === 'hunter';
const distance2 = (a: Creature, b: Creature) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

type LegacySave = Omit<Save, 'version' | 'rainTrend' | 'creatures' | 'records' | 'census'> & {
  version: 1;
  creatures: (Omit<Creature, 'form' | 'genes'> & { genes: Omit<Genes, 'moisture'> })[];
  records: Omit<LineageRecord, 'form'>[];
  census: Pick<Census, 'tick' | 'grazer' | 'hunter'>[];
};

export function validSeed(seed: unknown): seed is number {
  return integer(seed, 1, 999999999);
}

export class World {
  readonly seed: number;
  readonly terrain: Terrain;
  climate: Climate = { ...INITIAL_CLIMATE };
  rainTrend: number = INITIAL_CLIMATE.rain;
  creatures: Creature[] = [];
  resources: Float64Array;
  records = new Map<number, LineageRecord>();
  tick = 0;
  births = 0;
  deaths = 0;
  census: Census[] = [];
  bloodline: Bloodline | null = null;
  private readonly productiveCells: number[];
  private rng: number;
  private nextId = 1;

  constructor(seed = DEFAULT_SEED, populate = true) {
    if (!validSeed(seed)) throw new Error('世界种子超出范围');
    this.seed = seed;
    this.rng = seed;
    this.terrain = new Terrain(seed);
    this.productiveCells = this.terrain.cells.flatMap((cell, index) => cell.capacity > 0 ? [index] : []);
    this.resources = Float64Array.from(this.terrain.cells, cell => cell.capacity * (0.60 + this.random() * 0.38));
    if (!populate) return;
    this.populate();
    this.sample();
  }

  private populate() {
    const { cells, land } = this.terrain;
    const central = land.filter(i => {
      const { x, z, capacity } = cells[i];
      return Math.abs(x) < 48 && Math.abs(z) < 40 && capacity > 23;
    });
    const grazing = central.length ? central : land;
    const browsing = land.filter(i => {
      const { x, z } = cells[i];
      const habitat = this.terrain.habitat(x, z);
      return habitat === 'woodland' || habitat === 'ridge';
    });
    const shore = this.productiveCells.filter(i => {
      const { x, z } = cells[i];
      return this.terrain.isShallow(x, z) || this.terrain.habitat(x, z) === 'shore';
    });
    const shoreLand = land.filter(i => this.terrain.height(cells[i].x, cells[i].z) < 4 && Math.abs(cells[i].x) < 55);
    const habitat = { grazer: grazing, hunter: grazing, browser: browsing, wader: shore, stalker: shoreLand };
    const first = grazing.reduce((nearest, index) => {
      const { x, z } = cells[index];
      const { x: a, z: b } = cells[nearest];
      return (x - 8) ** 2 + (z - 13) ** 2 < (a - 8) ** 2 + (b - 13) ** 2 ? index : nearest;
    }, grazing[0]);
    for (const role of ROLE_KEYS) {
      const sites = habitat[role].length ? habitat[role] : land;
      for (let i = 0; i < FOUNDERS[role]; i++) {
        const index = role === 'grazer' && i === 0 ? first : this.pick(sites);
        this.creatures.push(this.spawn(role, index));
      }
    }
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
    const center = TRAIT_CENTERS[role];
    return {
      size: 0.82 + this.random() * 0.32,
      speed: center.speed + (this.random() - 0.5) * 0.21,
      comfort: 17 + this.random() * 10,
      moisture: center.moisture + (this.random() - 0.5) * 34,
      hue: center.hue + (this.random() - 0.5) * 28,
      crest: this.random(),
    };
  }

  private inherit(genes: Genes): Genes {
    const mutate = (key: keyof Genes, amplitude: number) =>
      clamp(genes[key] + (this.random() + this.random() - 1) * amplitude, LIMITS[key][0], LIMITS[key][1]);
    return {
      size: mutate('size', 0.15),
      speed: mutate('speed', 0.13),
      comfort: mutate('comfort', 2.7),
      moisture: mutate('moisture', 16),
      hue: mutate('hue', 13),
      crest: mutate('crest', 0.21),
    };
  }

  private spawn(role: Role, index: number, parent?: Creature) {
    const { x, z } = this.terrain.cells[index];
    const genes = parent ? this.inherit(parent.genes) : this.foundingGenes(role);
    const form = parent ? inheritedForm(genes.moisture) : 'ancestral';
    const creature: Creature = {
      id: this.nextId++,
      role,
      form,
      parent: parent?.id ?? null,
      generation: parent ? parent.generation + 1 : 1,
      x: parent?.x ?? x,
      z: parent?.z ?? z,
      angle: this.random() * TAU,
      age: parent ? 0 : 35 + Math.floor(this.random() * 86),
      energy: parent ? 42 : 59 + this.random() * 29,
      cooldown: parent ? 65 : Math.floor(this.random() * 74),
      genes,
    };
    const tracked = !!parent && !!this.records.get(parent.id)?.tracked;
    this.records.set(creature.id, {
      id: creature.id, parent: creature.parent, role, form, generation: creature.generation,
      born: this.tick, died: null, tracked,
    });
    if (tracked && this.bloodline) {
      this.bloodline.total++;
      this.bloodline.generation = Math.max(this.bloodline.generation, creature.generation);
    }
    return creature;
  }

  private canOccupy(creature: Creature, x: number, z: number) {
    return this.terrain.isLand(x, z) || (canWade(creature) && this.terrain.isShallow(x, z));
  }

  private conditions(creature: Creature) {
    const height = this.terrain.height(creature.x, creature.z);
    const localTemperature = this.climate.temperature - height * 0.22;
    const rainfall = this.climate.rain * 0.65 + this.rainTrend * 0.35;
    const localMoisture = clamp(rainfall + this.terrain.moistureOffset(creature.x, creature.z), 0, 100);
    const heatStress = Math.max(0, Math.abs(creature.genes.comfort - localTemperature) - 4) * 0.057;
    const moistureStress = Math.max(0, Math.abs(creature.genes.moisture - localMoisture) - 12) * 0.009;
    return { localTemperature, localMoisture, stress: heatStress + moistureStress };
  }

  private move(creature: Creature, pace: number) {
    const { x, z, angle } = creature;
    const height = this.terrain.height(x, z);
    const wadingPace = height < LAND_HEIGHT && creature.role !== 'wader' ? 0.78 : 1;
    const distance = pace * wadingPace * creature.genes.speed * (0.65 + 0.35 * Math.min(1, creature.age / MATURE_AGE));
    for (const turn of [0, 0.7, -0.7, 1.8, -1.8, Math.PI]) {
      const heading = angle + turn;
      const nextX = x + Math.cos(heading) * distance;
      const nextZ = z + Math.sin(heading) * distance;
      if (!this.canOccupy(creature, nextX, nextZ)) continue;
      if (Math.abs(this.terrain.height(nextX, nextZ) - height) > distance * 2.4) continue;
      creature.x = nextX;
      creature.z = nextZ;
      creature.angle = heading % TAU;
      break;
    }
  }

  private graze(creature: Creature, hunters: Creature[]) {
    let threat: Creature | undefined;
    let nearest = 17;
    for (const hunter of hunters) {
      if (hunter.energy <= 0 || hunter.energy >= 68 || !huntingRules(hunter.role)?.prey.includes(creature.role)) continue;
      const distance = distance2(creature, hunter);
      if (distance >= nearest) continue;
      if (distance >= 0.85 ** 2 && !this.canOccupy(hunter, creature.x, creature.z)) continue;
      nearest = distance;
      threat = hunter;
    }
    if (threat) creature.angle = Math.atan2(creature.z - threat.z, creature.x - threat.x);
    const index = this.terrain.cellAt(creature.x, creature.z);
    const food = this.resources[index];
    if (!threat && (this.tick + creature.id) % 13 === 0) {
      const start = this.random() * TAU;
      let best = -Infinity;
      for (let sample = 0; sample < 8; sample++) {
        const angle = start + sample * TAU / 8;
        const x = creature.x + 4.7 * Math.cos(angle);
        const z = creature.z + 4.7 * Math.sin(angle);
        if (!this.canOccupy(creature, x, z)) continue;
        const quality = forageQuality(creature.role, this.terrain.habitat(x, z));
        const score = this.resources[this.terrain.cellAt(x, z)] * quality + this.random() * 16;
        if (score <= best) continue;
        best = score;
        creature.angle = angle;
      }
    }
    const quality = forageQuality(creature.role, this.terrain.habitat(creature.x, creature.z));
    this.move(creature, threat ? 0.38 : food > 6 && creature.energy < 86 ? 0.12 : 0.23);
    if (threat) creature.energy -= 0.12;
    if (!threat && creature.energy < 99) {
      const eaten = Math.min(food, 1.30);
      this.resources[index] -= eaten;
      creature.energy += eaten * 0.84 * quality;
    }
  }

  private hunt(creature: Creature, preyGroup: Creature[], rules: NonNullable<ReturnType<typeof huntingRules>>) {
    let target: Creature | undefined;
    let closest = (rules.sight + 3 * creature.genes.crest) ** 2;
    if (creature.energy < 76) {
      for (const prey of preyGroup) {
        const d2 = distance2(creature, prey);
        const score = d2 * (prey.role === rules.prey[0] ? 1 : 1.65);
        if (prey.energy <= 0 || score >= closest || !rules.prey.includes(prey.role)) continue;
        if (d2 >= 0.85 ** 2 && !this.canOccupy(creature, prey.x, prey.z)) continue;
        closest = score;
        target = prey;
      }
    }
    if (target) creature.angle = Math.atan2(target.z - creature.z, target.x - creature.x);
    else if ((this.tick + creature.id) % 19 === 0) creature.angle = this.random() * TAU;
    if (!target && rules.fallbackFood > 0 && creature.energy < 76) {
      const index = this.terrain.cellAt(creature.x, creature.z);
      const eaten = Math.min(this.resources[index], 0.65);
      this.resources[index] -= eaten;
      creature.energy += eaten / 0.65 * rules.fallbackFood;
    }
    this.move(creature, target ? rules.pace : 0.18);
    if (target && distance2(creature, target) < 0.85 ** 2 && this.random() < rules.chance) {
      target.energy = 0;
      creature.energy += rules.reward * target.genes.size;
    }
  }

  step() {
    this.tick++;
    const { rain, temperature } = this.climate;
    this.rainTrend += (rain - this.rainTrend) / 180;
    const regrowth = (0.051 + this.rainTrend * 0.00145) * clamp(1 - Math.abs(temperature - 23) / 36, 0.34, 1);
    for (const i of this.productiveCells) {
      const capacity = this.terrain.cells[i].capacity;
      this.resources[i] = Math.min(capacity, this.resources[i] + regrowth);
    }
    const prey = this.creatures.filter(creature => !huntingRules(creature.role));
    const hunters = this.creatures.filter(creature => huntingRules(creature.role));
    const young: Creature[] = [];
    for (const creature of this.creatures) {
      if (creature.energy <= 0) continue;
      creature.age++;
      creature.cooldown = Math.max(0, creature.cooldown - 1);
      const { genes } = creature;
      const rules = huntingRules(creature.role);
      const { stress } = this.conditions(creature);
      const upkeep = 0.23 + genes.size * 0.23 + genes.speed * 0.16;
      creature.energy -= upkeep * (rules ? 0.66 : 1) + stress;
      if (creature.age > 780 + genes.size * 160) creature.energy -= 1.9;
      if (creature.energy <= 0) continue;
      if (rules) this.hunt(creature, prey, rules);
      else this.graze(creature, hunters);
      creature.energy = Math.min(100, creature.energy);
      const threshold = rules ? 89 : 77;
      const pressure = (this.creatures.length + young.length) / MAX_POPULATION;
      const chance = (rules ? 0.039 : 0.065) * (1 - pressure ** (rules ? 6 : 3));
      if (creature.age >= MATURE_AGE && creature.cooldown === 0 && creature.energy >= threshold
        && pressure < 1 && (creature.role === 'wader' || this.terrain.isLand(creature.x, creature.z))
        && this.random() < chance) {
        creature.energy -= 43;
        creature.cooldown = rules ? 145 : 95;
        young.push(this.spawn(creature.role, this.terrain.cellAt(creature.x, creature.z), creature));
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
    for (const [id, record] of this.records) {
      if (this.records.size <= MAX_RECORDS) break;
      if (record.died !== null && id !== this.bloodline?.root) this.records.delete(id);
    }
  }

  private sample() {
    this.census.push({ tick: this.tick, ...populationCounts(this.creatures) });
    if (this.census.length > HISTORY_LENGTH) this.census.shift();
  }

  gift(id: number, gift: Gift) {
    const creature = this.creatures.find(c => c.id === id);
    if (!creature) return '这个体已经离开世界。';
    const name = `${creatureName(creature.role, creature.form)} #${creature.id}`;
    if (gift === 'restore') {
      if (creature.energy === 100) return `${name} 的能量已满。`;
      const previous = Math.floor(creature.energy);
      creature.energy = 100;
      return `${name} 的能量由 ${previous} 补满至 100。`;
    }
    if (gift === 'grow') {
      if (creature.age >= MATURE_AGE) return `${name} 已成年。促生适用于幼体。`;
      const previous = Math.floor(creature.energy);
      creature.age = MATURE_AGE;
      creature.energy = Math.min(100, creature.energy + 20);
      creature.cooldown = 0;
      return `${name} 已立即成年，解除繁殖冷却，能量 ${previous} → ${Math.floor(creature.energy)}。`;
    }
    const { localTemperature, localMoisture, stress } = this.conditions(creature);
    const { comfort, moisture } = creature.genes;
    creature.genes.comfort = clamp(comfort + clamp(localTemperature - comfort, -8, 8), ...LIMITS.comfort);
    creature.genes.moisture = clamp(moisture + clamp(localMoisture - moisture, -24, 24), ...LIMITS.moisture);
    if (Math.abs(comfort - creature.genes.comfort) < 0.05 && Math.abs(moisture - creature.genes.moisture) < 0.5) {
      return `${name} 的适温和适湿已接近当地条件。`;
    }
    const current = this.conditions(creature).stress;
    return `${name} 的适温 ${comfort.toFixed(1)} → ${creature.genes.comfort.toFixed(1)}°C，适湿 ${Math.round(moisture)}% → ${Math.round(creature.genes.moisture)}%。每步环境耗能 ${stress.toFixed(2)} → ${current.toFixed(2)}，性状可遗传。`;
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

  frame(playing: boolean, speed: Speed): Frame {
    const root = this.bloodline?.root;
    const branch = root === undefined ? [] : [...this.records.values()].filter(record => record.tracked);
    const living = this.bloodline ? branch.filter(record => record.id !== root && record.died === null).length : 0;
    const recent = branch.slice(-10);
    if (branch.length > 10) recent.unshift(branch[0]);
    const creatures = this.creatures.map(creature => {
      const { localMoisture, stress } = this.conditions(creature);
      return { ...creature, localMoisture, stress };
    });
    return {
      seed: this.seed, tick: this.tick, climate: this.climate, rainTrend: this.rainTrend, creatures,
      births: this.births, deaths: this.deaths, census: this.census,
      bloodline: this.bloodline ? { ...this.bloodline, living } : null, branch: recent, playing, speed,
    };
  }

  save(): Save {
    return {
      version: 2, seed: this.seed, rng: this.rng, tick: this.tick, nextId: this.nextId,
      climate: { ...this.climate }, rainTrend: this.rainTrend,
      creatures: this.creatures.map(c => ({ ...c, genes: { ...c.genes } })),
      resources: Array.from(this.resources), records: [...this.records.values()].map(record => ({ ...record })),
      births: this.births, deaths: this.deaths, census: this.census.map(sample => ({ ...sample })),
      bloodline: this.bloodline ? { ...this.bloodline } : null,
    };
  }

  private migrateLegacy(save: LegacySave): Save {
    if (!Array.isArray(save.resources) || save.resources.length !== LEGACY_GRID_SIZE ** 2
      || save.resources.some(n => !bounds(n, 0, 71))
      || !Array.isArray(save.creatures) || !save.creatures.every(c => c?.genes && isLegacyRole(c.role))
      || !Array.isArray(save.records) || !save.records.every(r => r && isLegacyRole(r.role))
      || !Array.isArray(save.census) || !save.census.every(s => s && typeof s === 'object')
      || (save.bloodline !== null && !isLegacyRole(save.bloodline?.role))) throw new Error('旧版存档内容有误。');

    const resources = Array.from(this.resources);
    const offset = (GRID_SIZE - LEGACY_GRID_SIZE) / 2;
    for (let row = 0; row < LEGACY_GRID_SIZE; row++) {
      for (let col = 0; col < LEGACY_GRID_SIZE; col++) {
        const index = (row + offset) * GRID_SIZE + col + offset;
        resources[index] = Math.min(this.terrain.cells[index].capacity, save.resources[row * LEGACY_GRID_SIZE + col]);
      }
    }
    return {
      ...save, version: 2, rainTrend: save.climate?.rain, resources,
      creatures: save.creatures.map(c => ({
        ...c, form: 'ancestral', genes: { ...c.genes, moisture: TRAIT_CENTERS[c.role].moisture },
      })),
      records: save.records.map(r => ({ ...r, form: 'ancestral' })),
      census: save.census.map(s => ({ ...s, browser: 0, wader: 0, stalker: 0 })),
    };
  }

  static restore(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('没有可用的存档。');
    const candidate = value as Save | LegacySave;
    if (candidate.version !== 1 && candidate.version !== 2) throw new Error('当前版本无法读取此存档。');
    if (!validSeed(candidate.seed)) throw new Error('存档世界种子有误。');
    const world = new World(candidate.seed, false);
    const save = candidate.version === 1 ? world.migrateLegacy(candidate) : candidate;
    if (!integer(save.tick, 0, Number.MAX_SAFE_INTEGER)
      || !integer(save.rng, 0, 0xffffffff) || !integer(save.nextId, 1, Number.MAX_SAFE_INTEGER)
      || !integer(save.births, 0, save.nextId) || !integer(save.deaths, 0, save.nextId)
      || !bounds(save.climate?.temperature, 5, 38) || !bounds(save.climate?.rain, 10, 100)
      || !bounds(save.rainTrend, 10, 100)
      || !Array.isArray(save.resources) || save.resources.length !== GRID_SIZE ** 2
      || save.resources.some(n => !bounds(n, 0, 71))
      || !Array.isArray(save.creatures) || save.creatures.length > MAX_POPULATION
      || !Array.isArray(save.records) || save.records.length > MAX_RECORDS
      || !Array.isArray(save.census) || save.census.length > HISTORY_LENGTH) throw new Error('存档内容有误。');
    let priorId = 0;
    for (const r of save.records) {
      if (!r || !integer(r.id, priorId + 1, save.nextId - 1) || !isRole(r.role) || !isForm(r.form)
        || !integer(r.generation, 1, r.id) || !integer(r.born, 0, save.tick)
        || (r.parent !== null && !integer(r.parent, 1, r.id - 1))
        || (r.died !== null && !integer(r.died, r.born, save.tick))
        || typeof r.tracked !== 'boolean') throw new Error('存档谱系有误。');
      world.records.set(r.id, { ...r });
      priorId = r.id;
    }
    const ids = new Set<number>();
    for (const c of save.creatures) {
      if (!c || !c.genes || !isRole(c.role) || !isForm(c.form) || !integer(c.id, 1, save.nextId - 1) || ids.has(c.id)
        || !integer(c.generation, 1, c.id) || world.records.get(c.id)?.died !== null
        || world.records.get(c.id)?.form !== c.form
        || (c.parent !== null && !integer(c.parent, 1, c.id - 1))
        || !bounds(c.x, -MAP_HALF, MAP_HALF) || !bounds(c.z, -MAP_HALF, MAP_HALF)
        || !world.canOccupy(c, c.x, c.z) || !bounds(c.angle, -TAU, TAU)
        || !bounds(c.energy, Number.MIN_VALUE, 100) || !integer(c.age, 0, save.tick + 160)
        || !integer(c.cooldown, 0, 180) || GENES.some(key => !bounds(c.genes[key], LIMITS[key][0], LIMITS[key][1]))) {
        throw new Error('存档个体有误。');
      }
      ids.add(c.id);
    }
    if (save.census.some(s => !s || !integer(s.tick, 0, save.tick)
      || !ROLE_KEYS.every(role => integer(s[role], 0, MAX_POPULATION))
      || ROLE_KEYS.reduce((sum, role) => sum + s[role], 0) > MAX_POPULATION)) {
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
    world.rainTrend = save.rainTrend;
    world.creatures = save.creatures.map(c => ({ ...c, genes: { ...c.genes } }));
    world.resources = Float64Array.from(save.resources);
    world.births = save.births;
    world.deaths = save.deaths;
    world.census = save.census.map(s => ({ ...s }));
    world.bloodline = save.bloodline ? { ...save.bloodline } : null;
    return world;
  }
}
