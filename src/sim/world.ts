import { fitsHeight, isShoreRole, LIMBS, limbForm, wingForm } from './adaptations.ts';
import { canSucceed, forageQuality, FOUNDERS, huntingRules, inheritedForm, TRAIT_CENTERS } from './ecology.ts';
import { isAdaptation, isNiche, nicheFor, nicheTargets, speciesName } from './evolution.ts';
import { clamp, GRID_SIZE, LAND_HEIGHT, LEGACY_GRID_SIZE, LEGACY_MAP_HALF, Terrain } from './terrain.ts';
import { ATLAS_SIZE, BIOMES, creatureName, DEFAULT_SEED, FORM_NAMES, MAX_POPULATION, populationCounts, ROLE_KEYS } from './types.ts';
import type { Adaptation, Bloodline, Census, Climate, Creature, Frame, Genes, Gift, Record as LineageRecord, MapTile, Niche, ParcelSource, RegionClimate, Role, Save, Species, Speed } from './types.ts';

export const MATURE_AGE = 70;
const MAX_RECORDS = 2200;
const HISTORY_LENGTH = 80;
const SUCCESSION_DELAY = 80;
const ROLE_VACANCY_DELAY = 36;
const HUNT_ENERGY = 68;
const TAU = Math.PI * 2;
const LIMITS = {
  size: [0.60, 1.58],
  speed: [0.65, 1.58],
  comfort: [5, 38],
  moisture: [0, 100],
  hue: [15, 300],
  crest: [0, 1],
  aquatic: [0, 1],
  aerial: [0, 1],
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
const rootSpecies = (role: Role) => ROLE_KEYS.indexOf(role) + 1;
const isTile = (tile: unknown): tile is MapTile => {
  if (!tile || typeof tile !== 'object' || !('seed' in tile) || !('biome' in tile)) return false;
  return validSeed(tile.seed) && typeof tile.biome === 'string' && Object.hasOwn(BIOMES, tile.biome);
};
const validGenes = (genes: Genes | undefined) => !!genes && GENES.every(key => {
  const [min, max] = LIMITS[key];
  return bounds(genes[key], min, max);
});
const DEFAULT_AQUATIC = { foot: 0.20, webbed: 0.45 } as const;
const legacyAquatic = (role: Role, form: Creature['form']) =>
  isShoreRole(role) || form === 'wetland' ? DEFAULT_AQUATIC.webbed : DEFAULT_AQUATIC.foot;
const NEIGHBOR_BIN = 18;
function nearbyGroups(creatures: Creature[], mapHalf: number) {
  const stride = Math.ceil(mapHalf * 2 / NEIGHBOR_BIN) + 2;
  const axis = (position: number) => Math.floor((position + mapHalf) / NEIGHBOR_BIN) + 1;
  const buckets = new Map<number, Creature[]>();
  for (const creature of creatures) {
    const key = axis(creature.z) * stride + axis(creature.x);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(creature);
    else buckets.set(key, [creature]);
  }
  const grouped = new Map<number, Creature[]>();
  return (creature: Creature) => {
    const key = axis(creature.z) * stride + axis(creature.x);
    const cached = grouped.get(key);
    if (cached) return cached;
    const near: Creature[] = [];
    for (let z = -1; z <= 1; z++) {
      for (let x = -1; x <= 1; x++) {
        const bucket = buckets.get(key + z * stride + x);
        if (bucket) near.push(...bucket);
      }
    }
    grouped.set(key, near);
    return near;
  };
}
type Parent = Pick<Creature, 'id' | 'role' | 'species' | 'generation' | 'x' | 'z' | 'genes'>;
type PreviousGenes = Omit<Genes, 'moisture' | 'aquatic' | 'aerial'> & Partial<Pick<Genes, 'moisture' | 'aquatic' | 'aerial'>>;
type PreviousCreature = Omit<Creature, 'species' | 'form' | 'genes'> & {
  form?: Creature['form'];
  genes: PreviousGenes;
};
type PreviousRecord = Omit<LineageRecord, 'species' | 'form' | 'lineages' | 'genes'> & {
  form?: Creature['form'];
  genes?: PreviousGenes;
  tracked: boolean;
};
type PreviousSave = Omit<Save, 'version' | 'tiles' | 'regions' | 'creatures' | 'records' | 'census' | 'activeLineage' | 'lineages' | 'species'> & {
  version: 1 | 2;
  climate: Climate;
  rainTrend?: number;
  creatures: PreviousCreature[];
  records: PreviousRecord[];
  census: (Pick<Census, 'tick' | 'grazer' | 'hunter'> & Partial<Census>)[];
  bloodline: Omit<Bloodline, 'archive'> | null;
};
type AtlasSave = Omit<Save, 'version' | 'creatures' | 'records' | 'lineages'> & {
  version: 3;
  creatures: (Omit<Creature, 'genes'> & { genes: PreviousGenes })[];
  records: Omit<LineageRecord, 'genes'>[];
  lineages: (Omit<Bloodline, 'archive'> & { archive?: Omit<NonNullable<Bloodline['archive']>, 'genes'> & { genes: PreviousGenes } })[];
};

function upgradeGenes(genes: PreviousGenes, role: Role, form: Creature['form']): Genes {
  return { ...genes, moisture: genes.moisture ?? TRAIT_CENTERS[role].moisture,
    aquatic: genes.aquatic ?? legacyAquatic(role, form), aerial: genes.aerial ?? 0.25 };
}

function copyRecord(record: LineageRecord) {
  return { ...record, lineages: [...record.lineages], ...(record.genes ? { genes: { ...record.genes } } : {}) };
}

export function validSeed(seed: unknown): seed is number {
  return integer(seed, 1, 999999999);
}

export class World {
  readonly seed: number;
  readonly terrain: Terrain;
  readonly tiles: MapTile[];
  regions: RegionClimate[];
  creatures: Creature[] = [];
  resources: Float64Array;
  records = new Map<number, LineageRecord>();
  tick = 0;
  births = 0;
  deaths = 0;
  census: Census[] = [];
  lineages = new Map<number, Bloodline>();
  activeLineage: number | null = null;
  species = new Map<number, Species>();
  private readonly productiveCells: number[][];
  private readonly landCells: number[][];
  private rng: number;
  private nextId = 1;

  constructor(seed = DEFAULT_SEED, populate = true, tiles: readonly MapTile[] = [{ seed, biome: 'archipelago' }]) {
    if (!validSeed(seed) || (tiles.length !== 1 && tiles.length !== ATLAS_SIZE) || !tiles.every(isTile)) {
      throw new Error('地图配置有误。请检查地貌和种子。');
    }
    this.seed = seed;
    this.rng = seed;
    this.tiles = tiles.map(tile => ({ ...tile }));
    this.regions = tiles.map(({ biome }) => ({
      climate: { ...BIOMES[biome].climate }, rainTrend: BIOMES[biome].climate.rain,
    }));
    this.terrain = new Terrain(seed, this.tiles);
    this.productiveCells = tiles.map(() => []);
    this.landCells = tiles.map(() => []);
    for (const index of this.terrain.land) {
      const { x, z } = this.terrain.cells[index];
      this.landCells[this.terrain.tileAt(x, z)].push(index);
    }
    this.terrain.cells.forEach(({ x, z, capacity }, index) => {
      if (capacity > 0) this.productiveCells[this.terrain.tileAt(x, z)].push(index);
    });
    for (const role of ROLE_KEYS) {
      const id = rootSpecies(role);
      this.species.set(id, { id, parent: null, role, niche: null, born: 0 });
    }
    this.resources = Float64Array.from(this.terrain.cells, cell => cell.capacity * (0.60 + this.random() * 0.38) * cell.growth);
    if (!populate) return;
    for (let region = 0; region < tiles.length; region++) this.populate(region);
    this.sample();
  }

  get climate() { return this.regions[0].climate; }
  get rainTrend() { return this.regions[0].rainTrend; }
  get bloodline() { return this.activeLineage === null ? null : this.lineages.get(this.activeLineage) ?? null; }
  get capacity() { return MAX_POPULATION * this.tiles.length; }
  private get recordLimit() { return Math.max(MAX_RECORDS * this.tiles.length, this.creatures.length + this.lineages.size * 2); }

  private sites(region: number) {
    const { cells } = this.terrain;
    const land = this.landCells[region];
    const { x: centerX, z: centerZ } = this.terrain.tileCenter(region);
    const central = land.filter(i => {
      const { x, z, capacity } = cells[i];
      return Math.abs(x - centerX) < 48 && Math.abs(z - centerZ) < 40 && capacity > 23;
    });
    const grazing = central.length ? central : land;
    const browsing = land.filter(i => {
      const { x, z } = cells[i];
      const habitat = this.terrain.habitat(x, z);
      return habitat === 'woodland' || habitat === 'ridge';
    });
    const shore = this.productiveCells[region].filter(i => {
      const { x, z } = cells[i];
      return this.terrain.isShallow(x, z) || this.terrain.habitat(x, z) === 'shore';
    });
    const shoreLand = land.filter(i => this.terrain.height(cells[i].x, cells[i].z) < 4 && Math.abs(cells[i].x - centerX) < 55);
    const habitat = { grazer: grazing, hunter: grazing, browser: browsing, wader: shore, stalker: shoreLand };
    for (const role of ROLE_KEYS) if (!habitat[role].length) habitat[role] = land;
    return habitat;
  }

  private populate(region: number) {
    const habitat = this.sites(region);
    const center = this.terrain.tileCenter(region);
    const first = this.nearestCell(habitat.grazer, center.x + 8, center.z + 13);
    for (const role of ROLE_KEYS) {
      for (let i = 0; i < FOUNDERS[role]; i++) {
        const index = role === 'grazer' && i === 0 ? first : this.pick(habitat[role]);
        this.creatures.push(this.spawn(role, index));
      }
    }
  }

  private nearestCell(indices: number[], x: number, z: number) {
    let nearest = indices[0];
    let distance = Infinity;
    for (const index of indices) {
      const cell = this.terrain.cells[index];
      const d2 = (cell.x - x) ** 2 + (cell.z - z) ** 2;
      if (d2 < distance) { distance = d2; nearest = index; }
    }
    return nearest;
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
      aquatic: legacyAquatic(role, 'ancestral') + (this.random() - 0.5) * 0.18,
      aerial: 0.18 + this.random() * 0.14,
    };
  }

  private inherit(parent: Parent): Genes {
    const { genes, x, z } = parent;
    const height = this.terrain.height(x, z);
    const { climate: { rain, temperature }, rainTrend } = this.regions[this.terrain.tileAt(x, z)];
    const aquaticBias = height <= 2.1 ? 0.035 + (rain - 55) * 0.001 + (temperature - 20) * 0.001 : -0.034;
    const aerialBias = height >= 4.6 ? 0.088 : height >= LAND_HEIGHT ? 0.052 : -0.024;
    const moistureBias = rainTrend < 45 ? (rainTrend - 45) * 0.29 : Math.max(0, rainTrend - 76) * 0.21;
    const mutate = (key: keyof Genes, amplitude: number, bias = 0) => {
      const [min, max] = LIMITS[key];
      return clamp(genes[key] + (this.random() + this.random() - 1) * amplitude + bias, min, max);
    };
    return {
      size: mutate('size', 0.15),
      speed: mutate('speed', 0.13),
      comfort: mutate('comfort', 2.7),
      moisture: mutate('moisture', 16, moistureBias),
      hue: mutate('hue', 13),
      crest: mutate('crest', 0.21),
      aquatic: mutate('aquatic', 0.18, aquaticBias),
      aerial: mutate('aerial', 0.17, aerialBias),
    };
  }

  private descendantSpecies(parent: Parent, role: Role, genes: Genes, replaces?: number) {
    if (replaces !== undefined) {
      const id = this.species.size + 1;
      this.species.set(id, { id, parent: parent.species, role, niche: nicheFor(genes), born: this.tick, replaces });
      return id;
    }
    const inherited = nicheFor(genes);
    let niche: Niche | null = inherited !== 'mild-normal' && nicheFor(parent.genes) === inherited ? inherited : null;
    const wing = wingForm(genes.aerial);
    const limb = limbForm(genes.aquatic);
    const adaptations: Adaptation[] = [];
    if (wing !== 'wingless' && wingForm(parent.genes.aerial) === wing) adaptations.push(wing);
    if (limb !== 'foot' && limbForm(parent.genes.aquatic) === limb && (limb !== 'webbed' || !isShoreRole(role))) adaptations.push(limb);
    const ancestralAdaptations = new Set<Adaptation>();
    let ancestor = this.species.get(parent.species);
    while (ancestor) {
      if (ancestor.niche === niche) niche = null;
      if (ancestor.adaptation) ancestralAdaptations.add(ancestor.adaptation);
      ancestor = ancestor.parent === null ? undefined : this.species.get(ancestor.parent);
    }
    const adaptation = niche === null ? adaptations.find(form => !ancestralAdaptations.has(form)) : undefined;
    if (niche === null && adaptation === undefined) return parent.species;
    const branch = [...this.species.values()].find(s => s.parent === parent.species && s.niche === niche
      && s.adaptation === adaptation && s.replaces === undefined);
    if (branch) return branch.id;
    const id = this.species.size + 1;
    this.species.set(id, { id, parent: parent.species, role, niche, born: this.tick, ...(adaptation ? { adaptation } : {}) });
    return id;
  }

  private spawn(role: Role, index: number, parent?: Parent, support?: { niche: Niche | null; retainSpecies?: boolean }, replaces?: number) {
    const { x, z } = this.terrain.cells[index];
    const genes = parent ? this.inherit(parent) : this.foundingGenes(role);
    if (parent && support?.niche) {
      const target = nicheTargets(support.niche);
      genes.comfort = clamp(target.comfort + (genes.comfort - parent.genes.comfort) * 0.3, ...LIMITS.comfort);
      genes.moisture = clamp(target.moisture + (genes.moisture - parent.genes.moisture) * 0.3, ...LIMITS.moisture);
    }
    if (parent && replaces !== undefined) {
      const { localTemperature, localMoisture } = this.conditions(parent);
      genes.comfort = clamp(genes.comfort + clamp(localTemperature - genes.comfort, -3, 3), ...LIMITS.comfort);
      genes.moisture = clamp(genes.moisture + clamp(localMoisture - genes.moisture, -12, 12), ...LIMITS.moisture);
    }
    const form = parent ? inheritedForm(genes.moisture) : 'ancestral';
    if (form === 'wetland') genes.aquatic = Math.max(0.35, genes.aquatic);
    const species = parent
      ? support?.retainSpecies ? parent.species : this.descendantSpecies(parent, role, genes, replaces)
      : rootSpecies(role);
    const position = this.positionFor(genes, this.terrain.tileAt(x, z), parent?.x ?? x, parent?.z ?? z);
    let newbornEnergy = 42;
    if (support) newbornEnergy = 82;
    else if (huntingRules(role)) newbornEnergy = replaces === undefined ? 58 : 68;
    const creature: Creature = {
      id: this.nextId++,
      role,
      form,
      species,
      parent: parent?.id ?? null,
      generation: parent ? parent.generation + 1 : 1,
      ...position,
      angle: this.random() * TAU,
      age: parent ? 0 : 35 + Math.floor(this.random() * 86),
      energy: parent ? newbornEnergy : 59 + this.random() * 29,
      cooldown: parent ? 65 : Math.floor(this.random() * 74),
      genes,
    };
    const lineages = parent ? [...(this.records.get(parent.id)?.lineages ?? [])] : [];
    this.records.set(creature.id, {
      id: creature.id, parent: creature.parent, role, form, species, generation: creature.generation,
      born: this.tick, died: null, lineages, genes: { ...genes },
    });
    for (const root of lineages) {
      const bloodline = this.lineages.get(root);
      if (!bloodline) continue;
      bloodline.total++;
      bloodline.generation = Math.max(bloodline.generation, creature.generation);
      this.archiveMember(bloodline, creature);
    }
    return creature;
  }

  private canOccupy(creature: Creature, x: number, z: number) {
    return this.terrain.canTraverse(x, z, limbForm(creature.genes.aquatic), wingForm(creature.genes.aerial));
  }

  private positionFor(genes: Genes, region: number, x: number, z: number) {
    const limb = limbForm(genes.aquatic);
    const wing = wingForm(genes.aerial);
    if (this.terrain.tileAt(x, z) === region && this.terrain.canTraverse(x, z, limb, wing)) return { x, z };
    const indices = limb === 'foot' ? this.landCells[region] : this.productiveCells[region];
    let position: { x: number; z: number } | undefined;
    let nearest = Infinity;
    for (const index of indices) {
      const cell = this.terrain.cells[index];
      const distance = (cell.x - x) ** 2 + (cell.z - z) ** 2;
      if (distance >= nearest || !this.terrain.canTraverse(cell.x, cell.z, limb, wing)) continue;
      nearest = distance;
      position = { x: cell.x, z: cell.z };
    }
    if (!position) throw new Error('这一区没有适合该形态的地形。');
    return position;
  }

  private conditions(creature: Pick<Creature, 'x' | 'z' | 'genes'>) {
    const height = this.terrain.height(creature.x, creature.z);
    const region = this.regions[this.terrain.tileAt(creature.x, creature.z)];
    const localTemperature = region.climate.temperature - height * 0.22;
    const rainfall = region.climate.rain * 0.65 + region.rainTrend * 0.35;
    const localMoisture = clamp(rainfall + this.terrain.moistureOffset(creature.x, creature.z), 0, 100);
    const heatStress = Math.max(0, Math.abs(creature.genes.comfort - localTemperature) - 4) * 0.057;
    const moistureStress = Math.max(0, Math.abs(creature.genes.moisture - localMoisture) - 12) * 0.009;
    return { localTemperature, localMoisture, stress: heatStress + moistureStress };
  }

  move(creature: Creature, pace: number) {
    const { x, z, angle } = creature;
    const height = this.terrain.height(x, z);
    const limb = LIMBS[limbForm(creature.genes.aquatic)];
    const wing = wingForm(creature.genes.aerial);
    const multiplier = wing === 'flyer' ? 1.42 : height < LAND_HEIGHT ? limb.waterPace : limb.landPace;
    const distance = pace * multiplier * creature.genes.speed * (0.65 + 0.35 * Math.min(1, creature.age / MATURE_AGE));
    for (const turn of [0, 0.7, -0.7, 1.8, -1.8, Math.PI]) {
      const heading = angle + turn;
      const dx = Math.cos(heading) * distance;
      const dz = Math.sin(heading) * distance;
      let nextX = x + dx;
      let nextZ = z + dz;
      const drop = height - this.terrain.height(nextX, nextZ);
      if (wing === 'glider' && drop > 0.10 && this.canOccupy(creature, x + dx * 1.6, z + dz * 1.6)) {
        nextX = x + dx * 1.6;
        nextZ = z + dz * 1.6;
      }
      if (!this.canOccupy(creature, nextX, nextZ)) continue;
      const slope = this.terrain.height(nextX, nextZ) - height;
      if (wing !== 'flyer' && (slope > distance * 2.4 || (wing !== 'glider' && slope < -distance * 2.4))) continue;
      creature.x = nextX;
      creature.z = nextZ;
      creature.angle = heading % TAU;
      break;
    }
  }

  private forageAt(creature: Creature, x: number, z: number) {
    if (!this.terrain.inBounds(x, z)) return 0;
    const height = this.terrain.height(x, z);
    const limb = limbForm(creature.genes.aquatic);
    if (!fitsHeight(limb, height)) return 0;
    const quality = forageQuality(creature.role, this.terrain.habitat(x, z));
    if (height >= LAND_HEIGHT) return limb === 'fin' ? quality * 0.72 : quality;
    return quality * (limb === 'fin' ? 1.55 : 1.25);
  }

  private graze(creature: Creature, hunters: Creature[]) {
    let threat: Creature | undefined;
    let nearest = 17;
    for (const hunter of hunters) {
      if (hunter.energy <= 0 || hunter.energy >= HUNT_ENERGY || !huntingRules(hunter.role)?.prey.includes(creature.role)) continue;
      const distance = distance2(creature, hunter);
      if (distance >= nearest) continue;
      if (distance >= 0.85 ** 2 && !this.canOccupy(hunter, creature.x, creature.z)) continue;
      nearest = distance;
      threat = hunter;
    }
    if (threat) creature.angle = Math.atan2(creature.z - threat.z, creature.x - threat.x);
    const index = this.terrain.cellAt(creature.x, creature.z);
    const quality = this.forageAt(creature, creature.x, creature.z);
    const food = quality > 0 ? this.resources[index] : 0;
    if (!threat && (this.tick + creature.id) % 13 === 0) {
      const start = this.random() * TAU;
      let best = -Infinity;
      for (let sample = 0; sample < 8; sample++) {
        const angle = start + sample * TAU / 8;
        const x = creature.x + 4.7 * Math.cos(angle);
        const z = creature.z + 4.7 * Math.sin(angle);
        const destinationQuality = this.forageAt(creature, x, z);
        if (destinationQuality === 0) continue;
        const score = this.resources[this.terrain.cellAt(x, z)] * destinationQuality + this.random() * 16;
        if (score <= best) continue;
        best = score;
        creature.angle = angle;
      }
      if (best === -Infinity && quality === 0 && wingForm(creature.genes.aerial) === 'flyer') {
        const region = this.terrain.tileAt(creature.x, creature.z);
        const center = this.terrain.tileCenter(region);
        const groundGenes = { ...creature.genes, aerial: 0 };
        const landing = this.positionFor(groundGenes, region, center.x, center.z);
        creature.angle = Math.atan2(landing.z - creature.z, landing.x - creature.x);
      }
    }
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
    if (creature.energy < HUNT_ENERGY) {
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
    if (!target && rules.fallbackFood > 0 && creature.energy < HUNT_ENERGY && this.forageAt(creature, creature.x, creature.z) > 0) {
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
    for (let region = 0; region < this.regions.length; region++) {
      const conditions = this.regions[region];
      const { rain, temperature } = conditions.climate;
      conditions.rainTrend += (rain - conditions.rainTrend) / 180;
      const regrowth = (0.051 + conditions.rainTrend * 0.00145) * clamp(1 - Math.abs(temperature - 23) / 36, 0.34, 1);
      const algaeGrowth = (0.008 + (conditions.rainTrend / 100) ** 1.55 * 0.22) * clamp((temperature - 9) / 19, 0.06, 1.35);
      for (const i of this.productiveCells[region]) {
        const { capacity, water, growth } = this.terrain.cells[i];
        this.resources[i] = Math.min(capacity, this.resources[i] + (water ? algaeGrowth * growth : regrowth));
      }
    }
    const prey = this.creatures.filter(creature => !huntingRules(creature.role));
    const hunters = this.creatures.filter(creature => huntingRules(creature.role));
    const nearPrey = this.tiles.length === 1 ? () => prey : nearbyGroups(prey, this.terrain.mapHalf);
    const nearHunters = this.tiles.length === 1 ? () => hunters : nearbyGroups(hunters, this.terrain.mapHalf);
    const regionalPopulation = this.regionPopulations();
    const regionalRoles = this.tiles.map(() => populationCounts([]));
    for (const creature of this.creatures) regionalRoles[this.terrain.tileAt(creature.x, creature.z)][creature.role]++;
    const speciesBefore = new Set(this.creatures.map(creature => creature.species));
    const rolesBefore = populationCounts(this.creatures);
    const branches = [...this.species.values()];
    const successors = branches.filter(branch => branch.replaces !== undefined);
    const lastSuccession = successors.reduce((latest, branch) => Math.max(latest, branch.born), 0);
    const established = (branch: Species) => branch.extinctAt === undefined || branch.extinctAt - branch.born >= MATURE_AGE;
    const replaced = new Set(successors.filter(established).map(branch => branch.replaces));
    const vacancies = branches.filter(branch => {
      if (branch.extinctAt === undefined || speciesBefore.has(branch.id) || replaced.has(branch.id)
        || (branch.replaces !== undefined && !established(branch))) return false;
      const lostRole = rolesBefore[branch.role] === 0;
      return (lostRole || this.tick - lastSuccession >= SUCCESSION_DELAY)
        && this.tick - branch.extinctAt >= (lostRole ? ROLE_VACANCY_DELAY : SUCCESSION_DELAY);
    });
    vacancies.sort((a, b) => Number(rolesBefore[a.role] > 0) - Number(rolesBefore[b.role] > 0) || a.id - b.id);
    const young: Creature[] = [];
    for (const creature of this.creatures) {
      if (creature.energy <= 0) continue;
      creature.age++;
      creature.cooldown = Math.max(0, creature.cooldown - 1);
      const { genes } = creature;
      const rules = huntingRules(creature.role);
      const { stress, localTemperature } = this.conditions(creature);
      const height = this.terrain.height(creature.x, creature.z);
      const limb = limbForm(genes.aquatic);
      const wing = wingForm(genes.aerial);
      const supported = fitsHeight(limb, height);
      const flightCost = wing === 'flyer' ? supported ? 0.04 : 0.29 : wing === 'glider' ? 0.027 : 0;
      const mediumCost = height < LAND_HEIGHT && supported
        ? (limb === 'fin' ? -0.20 : -0.09) + Math.max(0, 17 - localTemperature) * 0.018
        : limb === 'fin' && supported ? 0.12 : 0;
      const upkeep = 0.23 + genes.size * 0.23 + genes.speed * 0.16;
      creature.energy -= Math.max(0.12, upkeep * (rules ? 0.61 : 1) + stress + flightCost + mediumCost);
      if (creature.age > 780 + genes.size * 160) creature.energy -= 1.9;
      if (creature.energy <= 0) continue;
      if (rules) this.hunt(creature, nearPrey(creature), rules);
      else this.graze(creature, nearHunters(creature));
      creature.energy = Math.min(100, creature.energy);
      const threshold = rules ? 81 : 77;
      const region = this.terrain.tileAt(creature.x, creature.z);
      const pressure = regionalPopulation[region] / MAX_POPULATION;
      if (creature.age < MATURE_AGE || creature.cooldown !== 0 || creature.energy < threshold
        || pressure >= 1 || this.creatures.length + young.length >= this.capacity) continue;
      const vacancyIndex = vacancies.findIndex(species => canSucceed(creature.role, species.role, rolesBefore[species.role] > 0));
      const vacancy = vacancies[vacancyIndex];
      const local = regionalRoles[region];
      const preySupport = rules ? clamp(rules.prey.reduce((count, role) => count + local[role], 0)
        / (7 + 2.5 * local[creature.role]), 0.16, 1) : 1;
      const chance = (vacancy ? 0.14 : rules ? 0.049 * preySupport : 0.065) * (1 - pressure ** (rules || vacancy ? 6 : 3));
      if (this.random() >= chance) continue;
      creature.energy -= rules ? 35 : 43;
      creature.cooldown = rules ? 112 : 95;
      const role = vacancy?.role ?? creature.role;
      young.push(this.spawn(role, this.terrain.cellAt(creature.x, creature.z), creature, undefined, vacancy?.id));
      if (vacancy) vacancies.length = 0;
      regionalPopulation[region]++;
      local[role]++;
      this.births++;
    }
    this.creatures = this.creatures.filter(creature => {
      if (creature.energy > 0) return true;
      const record = this.records.get(creature.id);
      if (record) record.died = this.tick;
      this.deaths++;
      return false;
    }).concat(young);
    const speciesAfter = new Set(this.creatures.map(creature => creature.species));
    for (const id of speciesBefore) {
      if (!speciesAfter.has(id)) this.species.get(id)!.extinctAt ??= this.tick;
    }
    if (this.tick % 18 === 0) this.sample();
    if (this.records.size > this.recordLimit) this.prune();
  }

  private regionPopulations() {
    const counts = this.tiles.map(() => 0);
    for (const creature of this.creatures) counts[this.terrain.tileAt(creature.x, creature.z)]++;
    return counts;
  }

  private prune() {
    const archived = new Set([...this.lineages.values()].map(line => line.archive?.id ?? line.root));
    for (const [id, record] of this.records) {
      if (this.records.size <= this.recordLimit) break;
      if (record.died !== null && !this.lineages.has(id) && !archived.has(id)) this.records.delete(id);
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
    const record = this.records.get(id);
    if (record) record.genes = { ...creature.genes };
    for (const root of record?.lineages ?? []) {
      const line = this.lineages.get(root);
      if (line) this.archiveMember(line, creature);
    }
    if (Math.abs(comfort - creature.genes.comfort) < 0.05 && Math.abs(moisture - creature.genes.moisture) < 0.5) {
      return `${name} 的适温和适湿已接近当地条件。`;
    }
    const current = this.conditions(creature).stress;
    return `${name} 的适温 ${comfort.toFixed(1)} → ${creature.genes.comfort.toFixed(1)}°C，适湿 ${Math.round(moisture)}% → ${Math.round(creature.genes.moisture)}%。每步环境耗能 ${stress.toFixed(2)} → ${current.toFixed(2)}，性状可遗传。`;
  }

  setClimate(patch: Partial<Climate>, region = 0) {
    const target = this.regions[region]?.climate;
    if (!target) return;
    if (bounds(patch.temperature, 5, 38)) target.temperature = patch.temperature;
    if (bounds(patch.rain, 10, 100)) target.rain = patch.rain;
  }

  track(id: number) {
    const root = this.records.get(id);
    if (!root) return;
    this.activeLineage = id;
    if (this.lineages.has(id)) return;
    let total = 0;
    let generation = root.generation;
    for (const record of this.records.values()) {
      if (record.id !== id && (record.parent === null || !this.records.get(record.parent)?.lineages.includes(id))) continue;
      record.lineages.push(id);
      if (record.id !== id) total++;
      generation = Math.max(generation, record.generation);
    }
    const line = { root: id, role: root.role, total, living: 0, generation };
    this.lineages.set(id, line);
    for (const creature of this.creatures) {
      if (this.records.get(creature.id)?.lineages.includes(id)) this.archiveMember(line, creature);
    }
  }

  private archiveMember(line: Bloodline, creature: Creature) {
    const prior = line.archive;
    if (prior && creature.id !== (prior.id ?? line.root) && creature.generation <= prior.generation) return;
    line.archive = {
      id: creature.id, genes: { ...creature.genes }, species: creature.species, generation: creature.generation,
    };
  }

  private spaceFor(region: number, count: number) {
    return Math.max(0, Math.min(count, this.capacity - this.creatures.length, MAX_POPULATION - this.regionPopulations()[region]));
  }

  private nurture(parent: Parent, region: number, niche: Niche | null, count: number, fromArchive = false) {
    if (!integer(region, 0, this.tiles.length - 1) || !integer(count, 1, 6) || (niche !== null && !isNiche(niche))) {
      return '请选择有效地块、培育方向和数量。';
    }
    const number = this.spaceFor(region, count);
    if (number === 0) return '此地块或世界种群已满。';
    const previousSpecies = this.species.size;
    const center = this.terrain.tileCenter(region);
    const inRegion = this.terrain.tileAt(parent.x, parent.z) === region;
    const desired = inRegion ? parent : center;
    const position = this.positionFor(parent.genes, region, desired.x, desired.z);
    const index = this.terrain.cellAt(position.x, position.z);
    const origin = { ...parent, x: position.x, z: position.z };
    const newborns: Creature[] = [];
    const retainSpecies = fromArchive && (niche === null || nicheFor(parent.genes) === niche);
    for (let i = 0; i < number; i++) newborns.push(this.spawn(parent.role, index, origin, { niche, retainSpecies }));
    this.creatures.push(...newborns);
    this.births += number;
    const branches = [...this.species.values()].filter(species => species.id > previousSpecies);
    const selectedTraits = niche ? `，首只适温 ${newborns[0].genes.comfort.toFixed(1)}°C、适湿 ${Math.round(newborns[0].genes.moisture)}%` : '';
    return `${fromArchive ? '遗传档案复育。' : ''}从 #${parent.id} 繁育了 ${number} 只第 ${parent.generation + 1} 代幼体${selectedTraits}。`
      + (branches.length ? `分化图新增 ${branches.map(speciesName).join('、')}。` : '');
  }

  breed(id: number, niche: Niche | null, count: number) {
    const parent = this.creatures.find(c => c.id === id);
    if (!parent) return '选择一只在世个体后再繁育。';
    if (parent.age < MATURE_AGE) return '幼体成年后才能繁育，可先使用促生。';
    return this.nurture(parent, this.terrain.tileAt(parent.x, parent.z), niche, count);
  }

  breedLineage(root: number, region: number, niche: Niche | null, count: number) {
    const line = this.lineages.get(root);
    if (!line || (niche !== null && !isNiche(niche))) return '请选择要延续的血脉和培育方向。';
    const candidates = this.creatures.filter(c => this.records.get(c.id)?.lineages.includes(root));
    const wanted = niche === null ? undefined : nicheTargets(niche);
    const score = (c: Creature) => c.generation * 0.1 + c.energy * 0.02
      - (wanted ? Math.abs(c.genes.comfort - wanted.comfort) + Math.abs(c.genes.moisture - wanted.moisture) * 0.33 : 0);
    const mature = candidates.filter(c => c.age >= MATURE_AGE);
    const parent = mature.sort((a, b) => score(b) - score(a))[0];
    if (parent) return this.nurture(parent, region, niche, count);
    if (candidates.length) return '这条血脉的在世成员仍是幼体。请等它们成年，或对一只幼体使用促生。';
    if (!line.archive) return '这条旧血脉没有可用的遗传档案。';
    if (!integer(region, 0, this.tiles.length - 1)) return '请选择有效地块。';
    const position = this.terrain.tileCenter(region);
    const cell = this.terrain.cells[this.nearestCell(this.landCells[region], position.x, position.z)];
    const { id = root, genes, species, generation } = line.archive;
    const role = this.species.get(species)!.role;
    return this.nurture({ id, role, genes, species, generation, x: cell.x, z: cell.z }, region, niche, count, true);
  }

  introduce(role: Role, region: number, count: number) {
    if (!isRole(role) || !integer(region, 0, this.tiles.length - 1) || !integer(count, 1, 6)) return '请选择有效地块、种群和数量。';
    const number = this.spaceFor(region, count);
    if (number === 0) return '此地块或世界种群已满。';
    const sites = this.sites(region)[role];
    for (let i = 0; i < number; i++) this.creatures.push(this.spawn(role, this.pick(sites)));
    return `在第 ${region + 1} 区投放了 ${number} 只${creatureName(role, 'ancestral')}。`;
  }

  relocate(id: number, region: number) {
    const creature = this.creatures.find(c => c.id === id);
    if (!creature || !integer(region, 0, this.tiles.length - 1)) return '请选择在世个体和有效目的地。';
    if (this.terrain.tileAt(creature.x, creature.z) === region) return '这个体已经在所选地块。';
    const before = this.conditions(creature);
    const destination = this.terrain.cells[this.pick(this.sites(region)[creature.role])];
    const position = this.positionFor(creature.genes, region, destination.x, destination.z);
    creature.x = position.x;
    creature.z = position.z;
    const after = this.conditions(creature);
    return `#${id} 已迁到第 ${region + 1} 区，环境耗能 ${before.stress.toFixed(2)} → ${after.stress.toFixed(2)}。`;
  }

  frame(playing: boolean, speed: Speed): Frame {
    const root = this.activeLineage;
    const branch = root === null ? [] : [...this.records.values()].filter(record => record.lineages.includes(root));
    const transitions = new Map<string, LineageRecord>();
    for (const record of branch) {
      const parent = record.parent === null ? undefined : this.records.get(record.parent);
      if (!record.genes || !parent?.genes) continue;
      const limb = limbForm(record.genes.aquatic);
      const previousLimb = limbForm(parent.genes.aquatic);
      const wing = wingForm(record.genes.aerial);
      const previousWing = wingForm(parent.genes.aerial);
      const limbChange = `${previousLimb}:${limb}`;
      const wingChange = `${previousWing}:${wing}`;
      if (limb !== previousLimb && !transitions.has(limbChange)) transitions.set(limbChange, record);
      if (wing !== previousWing && !transitions.has(wingChange)) transitions.set(wingChange, record);
    }
    const recent = [...new Map([
      ...branch.filter(record => record.id === root || record.died === null),
      ...transitions.values(),
      ...branch.filter(record => record.id !== root && record.died !== null).slice(-24),
    ].map(record => [record.id, record])).values()].sort((a, b) => a.id - b.id);
    const living = new Map<number, number>();
    const speciesCounts = new Map<number, number>();
    const population = this.regionPopulations();
    const creatures = this.creatures.map(creature => {
      for (const lineage of this.records.get(creature.id)?.lineages ?? []) {
        if (lineage !== creature.id) living.set(lineage, (living.get(lineage) ?? 0) + 1);
      }
      speciesCounts.set(creature.species, (speciesCounts.get(creature.species) ?? 0) + 1);
      const { localMoisture, stress } = this.conditions(creature);
      return { ...creature, localMoisture, stress, region: this.terrain.tileAt(creature.x, creature.z) };
    });
    const lineages = [...this.lineages.values()].map(line => ({ ...line, living: living.get(line.root) ?? 0 }));
    return {
      seed: this.seed, tiles: this.tiles, tick: this.tick, climate: this.climate, rainTrend: this.rainTrend, creatures,
      regions: this.tiles.map((tile, index) => ({ ...tile, ...this.regions[index], population: population[index] })),
      births: this.births, deaths: this.deaths, census: this.census,
      bloodline: lineages.find(line => line.root === root) ?? null, lineages,
      species: [...this.species.values()].map(species => ({ ...species, population: speciesCounts.get(species.id) ?? 0 })),
      branch: recent, playing, speed,
    };
  }

  save(): Save {
    return {
      version: 4, seed: this.seed, rng: this.rng, tick: this.tick, nextId: this.nextId,
      tiles: this.tiles.map(tile => ({ ...tile })),
      regions: this.regions.map(region => ({ climate: { ...region.climate }, rainTrend: region.rainTrend })),
      creatures: this.creatures.map(c => ({ ...c, genes: { ...c.genes } })),
      resources: Array.from(this.resources), records: [...this.records.values()].map(copyRecord),
      births: this.births, deaths: this.deaths, census: this.census.map(sample => ({ ...sample })),
      activeLineage: this.activeLineage, lineages: structuredClone([...this.lineages.values()]),
      species: [...this.species.values()].map(species => ({ ...species })),
    };
  }

  static compose(sources: ParcelSource[]) {
    if (!Array.isArray(sources) || sources.length !== ATLAS_SIZE) throw new Error('请选择九个地块再拼合。');
    const parcels = sources.map((source, index) => {
      try {
        if (isTile(source)) return new World(source.seed, true, [source]);
        if (!source || typeof source !== 'object' || !('save' in source)) throw new Error('无效来源');
        const parcel = World.restore(source.save);
        if (parcel.tiles.length !== 1) throw new Error('需要单区存档');
        return parcel;
      } catch (error) {
        throw new Error(`第 ${index + 1} 区无法拼合。${(error as Error).message}`);
      }
    });
    const tiles = parcels.map(parcel => parcel.tiles[0]);
    const world = new World(tiles[0].seed, false, tiles);
    world.tick = Math.max(...parcels.map(parcel => parcel.tick));
    for (const [region, parcel] of parcels.entries()) {
      const idOffset = world.nextId - 1;
      if (!Number.isSafeInteger(idOffset + parcel.nextId)) throw new Error('源存档的个体编号过大。');
      const timeOffset = world.tick - parcel.tick;
      const { x, z } = world.terrain.tileCenter(region);
      world.nextId = idOffset + parcel.nextId;
      world.births += parcel.births;
      world.deaths += parcel.deaths;
      world.regions[region] = parcel.regions[0];
      world.rng = (Math.imul(world.rng ^ parcel.rng, 0x45d9f3b) + region + 1) >>> 0;

      const branchIds = new Map<number, number>();
      for (const species of parcel.species.values()) {
        const extinctAt = species.extinctAt === undefined ? undefined : species.extinctAt + timeOffset;
        if (species.parent === null) {
          const id = rootSpecies(species.role);
          const root = world.species.get(id)!;
          if (extinctAt !== undefined) root.extinctAt = Math.min(root.extinctAt ?? extinctAt, extinctAt);
          branchIds.set(species.id, id);
          continue;
        }
        const parent = branchIds.get(species.parent)!;
        const replaces = species.replaces === undefined ? undefined : branchIds.get(species.replaces)!;
        const existing = [...world.species.values()].find(s => s.parent === parent && s.role === species.role
          && s.niche === species.niche && s.adaptation === species.adaptation && s.replaces === replaces);
        if (existing) {
          existing.born = Math.min(existing.born, species.born + timeOffset);
          if (extinctAt !== undefined) existing.extinctAt = Math.min(existing.extinctAt ?? extinctAt, extinctAt);
          branchIds.set(species.id, existing.id);
        } else {
          const id = world.species.size + 1;
          world.species.set(id, { ...species, id, parent, born: species.born + timeOffset,
            ...(extinctAt === undefined ? {} : { extinctAt }), ...(replaces === undefined ? {} : { replaces }) });
          branchIds.set(species.id, id);
        }
      }

      for (const creature of parcel.creatures) {
        const position = world.positionFor(creature.genes, region, creature.x + x, creature.z + z);
        world.creatures.push({
          ...creature, id: idOffset + creature.id, ...position,
          parent: creature.parent === null ? null : idOffset + creature.parent,
          species: branchIds.get(creature.species)!,
        });
      }
      for (const record of parcel.records.values()) {
        const id = idOffset + record.id;
        world.records.set(id, {
          ...record, id, parent: record.parent === null ? null : idOffset + record.parent,
          species: branchIds.get(record.species)!, born: record.born + timeOffset,
          died: record.died === null ? null : record.died + timeOffset,
          lineages: record.lineages.map(root => root + idOffset),
        });
      }
      for (const line of parcel.lineages.values()) {
        const root = idOffset + line.root;
        const archive = line.archive && {
          ...line.archive, id: (line.archive.id ?? line.root) + idOffset, species: branchIds.get(line.archive.species)!,
        };
        world.lineages.set(root, { ...line, root, ...(archive ? { archive } : {}) });
      }
      if (world.activeLineage === null && parcel.activeLineage !== null) world.activeLineage = idOffset + parcel.activeLineage;

      const startCol = region % 3 * GRID_SIZE;
      const startRow = Math.floor(region / 3) * GRID_SIZE;
      for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
          const index = (startRow + row) * world.terrain.gridSize + startCol + col;
          world.resources[index] = Math.min(world.terrain.cells[index].capacity, parcel.resources[row * GRID_SIZE + col]);
        }
      }
    }
    world.sample();
    return world;
  }

  private migrateLegacy(save: PreviousSave): Save {
    const originalSize = save.version === 1 ? LEGACY_GRID_SIZE : GRID_SIZE;
    const roleValid = save.version === 1 ? isLegacyRole : isRole;
    if (!Array.isArray(save.resources) || save.resources.length !== originalSize ** 2
      || save.resources.some(n => !bounds(n, 0, 71))
      || !Array.isArray(save.creatures) || !save.creatures.every(c => c?.genes && roleValid(c.role))
      || !Array.isArray(save.records) || !save.records.every(r => r && roleValid(r.role) && typeof r.tracked === 'boolean')
      || !Array.isArray(save.census) || !save.census.every(s => s && typeof s === 'object')
      || (save.bloodline !== null && !roleValid(save.bloodline?.role))) throw new Error('旧版存档内容有误。');

    const resources = Array.from(this.resources);
    const offset = (GRID_SIZE - originalSize) / 2;
    for (let row = 0; row < originalSize; row++) {
      for (let col = 0; col < originalSize; col++) {
        const index = (row + offset) * GRID_SIZE + col + offset;
        resources[index] = Math.min(this.terrain.cells[index].capacity, save.resources[row * originalSize + col]);
      }
    }
    const root = save.bloodline?.root ?? null;
    const creatures = save.creatures.map(c => this.upgradeCreature({
      ...c, form: c.form ?? 'ancestral', species: rootSpecies(c.role),
    }, save.version === 1 ? LEGACY_MAP_HALF : this.terrain.mapHalf));
    const living = new Map(creatures.map(c => [c.id, c.genes]));
    const records = save.records.map((r): LineageRecord => {
      const { id, parent, role, generation, born, died, tracked } = r;
      const form = r.form ?? 'ancestral';
      const genes = living.get(id) ?? (r.genes ? upgradeGenes(r.genes, role, form) : undefined);
      return { id, parent, role, generation, born, died, form, species: rootSpecies(role),
        lineages: tracked && root !== null ? [root] : [], ...(genes ? { genes } : {}) };
    });
    const last = root === null ? undefined : records.reduce<LineageRecord | undefined>((best, record) =>
      record.genes && record.lineages.includes(root) && (!best || record.generation >= best.generation) ? record : best, undefined);
    const archive = last?.genes && { id: last.id, genes: last.genes, species: last.species, generation: last.generation };
    return {
      version: 4, seed: save.seed, rng: save.rng, tick: save.tick, nextId: save.nextId, births: save.births, deaths: save.deaths,
      tiles: this.tiles, regions: [{ climate: save.climate, rainTrend: save.rainTrend ?? save.climate?.rain }],
      resources, creatures, records,
      census: save.census.map(({ tick, grazer, hunter, browser = 0, wader = 0, stalker = 0 }) => ({
        tick, grazer, hunter, browser, wader, stalker,
      })),
      activeLineage: root, lineages: save.bloodline ? [{ root: save.bloodline.root, role: save.bloodline.role,
        total: save.bloodline.total, living: save.bloodline.living, generation: save.bloodline.generation, ...(archive ? { archive } : {}) }] : [],
      species: this.upgradeExtinctions([...this.species.values()], records, creatures),
    };
  }

  private upgradeCreature(creature: Omit<Creature, 'genes'> & { genes: PreviousGenes }, mapHalf: number): Creature {
    if (!creature?.genes || !isRole(creature.role) || !isForm(creature.form)
      || !bounds(creature.x, -mapHalf, mapHalf) || !bounds(creature.z, -mapHalf, mapHalf)) {
      throw new Error('旧版存档个体有误。');
    }
    const genes = upgradeGenes(creature.genes, creature.role, creature.form);
    if (!validGenes(genes)) throw new Error('旧版存档性状有误。');
    const position = this.positionFor(genes, this.terrain.tileAt(creature.x, creature.z), creature.x, creature.z);
    return { ...creature, ...position, genes };
  }

  private upgradeExtinctions(species: Species[], records: LineageRecord[], creatures: Creature[]) {
    const present = new Set(creatures.map(c => c.species));
    const lastDeath = new Map<number, number>();
    for (const record of records) {
      if (record.died !== null) lastDeath.set(record.species, Math.max(record.died, lastDeath.get(record.species) ?? 0));
    }
    return species.map(branch => {
      const extinctAt = lastDeath.get(branch.id);
      return extinctAt !== undefined && !present.has(branch.id) ? { ...branch, extinctAt } : branch;
    });
  }

  private migrateAtlas(save: AtlasSave): Save {
    if (!Array.isArray(save.creatures) || !Array.isArray(save.records)
      || !Array.isArray(save.lineages) || !Array.isArray(save.species) || !save.species.every(s => s && isRole(s.role))) {
      throw new Error('九区旧存档内容有误。');
    }
    const creatures = save.creatures.map(c => this.upgradeCreature(c, this.terrain.mapHalf));
    const genesById = new Map(creatures.map(c => [c.id, c.genes]));
    const recordsById = new Map(save.records.map(r => [r?.id, r]));
    const lineages: Bloodline[] = save.lineages.map(line => {
      if (!line || !isRole(line.role)) throw new Error('九区旧存档血脉有误。');
      const { archive, ...bloodline } = line;
      if (archive === undefined) return bloodline;
      if (!archive?.genes) throw new Error('九区旧存档遗传档案有误。');
      const id = archive.id ?? line.root;
      const form = recordsById.get(id)?.form ?? 'ancestral';
      const genes = upgradeGenes(archive.genes, line.role, form);
      if (!genesById.has(id)) genesById.set(id, genes);
      return { ...bloodline, archive: { ...archive, genes } };
    });
    const records: LineageRecord[] = save.records.map(record => {
      if (!record) throw new Error('九区旧存档谱系有误。');
      const genes = genesById.get(record.id);
      return genes ? { ...record, genes } : { ...record };
    });
    return { ...save, version: 4, creatures, records, lineages,
      species: this.upgradeExtinctions(save.species, records, creatures) };
  }

  static restore(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('没有可用的存档。');
    const candidate = value as Save | AtlasSave | PreviousSave;
    if (candidate.version !== 1 && candidate.version !== 2 && candidate.version !== 3 && candidate.version !== 4) {
      throw new Error('当前版本无法读取此存档。');
    }
    if (!validSeed(candidate.seed)) throw new Error('存档世界种子有误。');
    const hasTiles = candidate.version === 3 || candidate.version === 4;
    if (hasTiles && !Array.isArray(candidate.tiles)) throw new Error('存档地块有误。');
    const world = new World(candidate.seed, false, hasTiles ? candidate.tiles : undefined);
    const save = candidate.version === 4 ? candidate : candidate.version === 3 ? world.migrateAtlas(candidate) : world.migrateLegacy(candidate);
    if (!integer(save.tick, 0, Number.MAX_SAFE_INTEGER)
      || !integer(save.rng, 0, 0xffffffff) || !integer(save.nextId, 1, Number.MAX_SAFE_INTEGER)
      || !integer(save.births, 0, save.nextId) || !integer(save.deaths, 0, save.nextId)
      || !Array.isArray(save.regions) || save.regions.length !== world.tiles.length
      || !save.regions.every(region => bounds(region?.climate?.temperature, 5, 38) && bounds(region?.climate?.rain, 10, 100)
        && bounds(region?.rainTrend, 10, 100))
      || !Array.isArray(save.resources) || save.resources.length !== world.terrain.gridSize ** 2
      || save.resources.some(n => !bounds(n, 0, 71))
      || !Array.isArray(save.creatures) || save.creatures.length > world.capacity
      || !Array.isArray(save.records) || !Array.isArray(save.lineages)
      || !Array.isArray(save.species) || save.species.length < ROLE_KEYS.length
      || !Array.isArray(save.census) || save.census.length > HISTORY_LENGTH) throw new Error('存档内容有误。');
    world.species.clear();
    for (const s of save.species) {
      if (!s || s.id !== world.species.size + 1 || !isRole(s.role) || !integer(s.born, 0, save.tick)
        || (s.extinctAt !== undefined && !integer(s.extinctAt, s.born, save.tick))) {
        throw new Error('存档物种分化图有误。');
      }
      const parent = s.parent === null ? undefined : world.species.get(s.parent);
      const replaced = s.replaces === undefined ? undefined : world.species.get(s.replaces);
      const rootValid = s.id === rootSpecies(s.role) && s.parent === null && s.niche === null
        && s.adaptation === undefined && s.replaces === undefined;
      const branchValid = parent && (
        s.replaces === undefined
          ? parent.role === s.role && (s.adaptation === undefined ? isNiche(s.niche) : s.niche === null && isAdaptation(s.adaptation))
          : replaced?.role === s.role && replaced.extinctAt !== undefined && s.born >= replaced.extinctAt
            && s.adaptation === undefined && isNiche(s.niche) && canSucceed(parent.role, s.role, false)
      );
      if (!(s.id <= ROLE_KEYS.length ? rootValid : branchValid)) throw new Error('存档物种分化图有误。');
      world.species.set(s.id, { ...s });
    }
    let priorId = 0;
    for (const r of save.records) {
      if (!r || !integer(r.id, priorId + 1, save.nextId - 1) || !isRole(r.role) || !isForm(r.form)
        || world.species.get(r.species)?.role !== r.role
        || !integer(r.generation, 1, r.id) || !integer(r.born, 0, save.tick)
        || (r.parent !== null && !integer(r.parent, 1, r.id - 1))
        || (r.died !== null && !integer(r.died, r.born, save.tick))
        || (r.genes !== undefined && !validGenes(r.genes))
        || !Array.isArray(r.lineages) || new Set(r.lineages).size !== r.lineages.length) throw new Error('存档谱系有误。');
      world.records.set(r.id, copyRecord(r));
      priorId = r.id;
    }
    const ids = new Set<number>();
    for (const c of save.creatures) {
      const record = world.records.get(c?.id);
      if (!c || !validGenes(c.genes) || !isRole(c.role) || !isForm(c.form) || !integer(c.id, 1, save.nextId - 1) || ids.has(c.id)
        || !integer(c.generation, 1, c.id) || record?.died !== null
        || record?.form !== c.form || record?.species !== c.species || record.role !== c.role
        || record.parent !== c.parent || record.generation !== c.generation
        || (c.parent !== null && !integer(c.parent, 1, c.id - 1))
        || !bounds(c.x, -world.terrain.mapHalf, world.terrain.mapHalf) || !bounds(c.z, -world.terrain.mapHalf, world.terrain.mapHalf)
        || !world.canOccupy(c, c.x, c.z) || !bounds(c.angle, -TAU, TAU)
        || !bounds(c.energy, Number.MIN_VALUE, 100) || !integer(c.age, 0, save.tick + 160)
        || !integer(c.cooldown, 0, 180)) {
        throw new Error('存档个体有误。');
      }
      ids.add(c.id);
    }
    if (save.census.some(s => !s || !integer(s.tick, 0, save.tick)
      || !ROLE_KEYS.every(role => integer(s[role], 0, world.capacity))
      || ROLE_KEYS.reduce((sum, role) => sum + s[role], 0) > world.capacity)) {
      throw new Error('存档统计有误。');
    }
    for (const line of save.lineages) {
      const founder = world.records.get(line?.root);
      const archived = line?.archive && world.records.get(line.archive.id ?? line.root);
      if (!line || !founder?.lineages.includes(line.root) || founder.role !== line.role || world.lineages.has(line.root)
        || !integer(line.total, 0, save.births) || !integer(line.living, 0, world.capacity)
        || !integer(line.generation, founder.generation, save.nextId)
        || (line.archive !== undefined && (!line.archive || !archived?.lineages.includes(line.root)
          || !validGenes(line.archive.genes) || line.archive.species !== archived.species
          || line.archive.generation !== archived.generation))) {
        throw new Error('存档血脉有误。');
      }
      world.lineages.set(line.root, structuredClone(line));
    }
    for (const record of world.records.values()) {
      if (record.lineages.some(root => !world.lineages.has(root))) throw new Error('存档血脉归属有误。');
    }
    if (save.activeLineage !== null && !world.lineages.has(save.activeLineage)) {
      throw new Error('存档血脉选择有误。');
    }
    world.tick = save.tick;
    world.rng = save.rng;
    world.nextId = save.nextId;
    world.regions = save.regions.map(region => ({ climate: { ...region.climate }, rainTrend: region.rainTrend }));
    world.creatures = save.creatures.map(c => ({ ...c, genes: { ...c.genes } }));
    world.resources = Float64Array.from(save.resources);
    world.births = save.births;
    world.deaths = save.deaths;
    world.census = save.census.map(s => ({ ...s }));
    world.activeLineage = save.activeLineage;
    return world;
  }
}
