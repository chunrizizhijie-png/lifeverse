export const DEFAULT_SEED = 41827;
export const MAX_POPULATION = 180;
export const MINUTES_PER_TICK = 8;
export const SPEEDS = [1, 4, 12] as const;
export const INITIAL_CLIMATE = { temperature: 22, rain: 64 } as const;

export const ROLES = {
  grazer: { name: '苔叶兽', diet: '植食', color: '#a9cd8b' },
  hunter: { name: '琥脊兽', diet: '捕食', color: '#e6ac6e' },
} as const;

export const LIMBS = {
  foot: {
    name: '陆行足',
    short: '足',
    badge: '足',
    color: '#c8b88a',
    habitat: '内陆与滩涂',
    ability: '陆行稳健 · 禁入浅滩',
    minHeight: 0.55,
    maxHeight: 40,
    landPace: 1.05,
    waterPace: 0,
  },
  webbed: {
    name: '涉水蹼',
    short: '蹼',
    badge: '蹼',
    color: '#7ec4b6',
    habitat: '浅滩与陆地',
    ability: '涉渡浅滩 · 水陆两栖',
    minHeight: -2.4,
    maxHeight: 40,
    landPace: 0.93,
    waterPace: 1.14,
  },
  fin: {
    name: '游水鳍',
    short: '鳍',
    badge: '鳍',
    color: '#5ca4d8',
    habitat: '浅滩与深海',
    ability: '深水疾游 · 岸行迟缓',
    minHeight: -12,
    maxHeight: 1.85,
    landPace: 0.56,
    waterPace: 1.38,
  },
} as const;

export type Role = keyof typeof ROLES;
export type LimbForm = keyof typeof LIMBS;
export type Speed = typeof SPEEDS[number];
export type Gift = 'grow' | 'restore' | 'adapt';

export function limbForm(aquatic = 0): LimbForm {
  if (aquatic >= 0.70) return 'fin';
  if (aquatic >= 0.35) return 'webbed';
  return 'foot';
}

export interface Genes {
  size: number;
  speed: number;
  comfort: number;
  hue: number;
  crest: number;
  aquatic: number;
}

export interface CapabilityProfile {
  limb: LimbForm;
  limbName: string;
  habitat: string;
  ability: string;
  landSpeed: number;
  waterSpeed: number;
  canWade: boolean;
  canDive: boolean;
}

export function describeCapabilities(genes: Genes): CapabilityProfile {
  const limb = limbForm(genes.aquatic);
  const spec = LIMBS[limb];
  return {
    limb,
    limbName: spec.name,
    habitat: spec.habitat,
    ability: spec.ability,
    landSpeed: Number((genes.speed * spec.landPace).toFixed(2)),
    waterSpeed: Number((genes.speed * spec.waterPace).toFixed(2)),
    canWade: limb !== 'foot',
    canDive: limb === 'fin',
  };
}

export interface Creature {
  id: number;
  role: Role;
  parent: number | null;
  generation: number;
  x: number;
  z: number;
  angle: number;
  age: number;
  energy: number;
  cooldown: number;
  genes: Genes;
}

export interface Climate {
  temperature: number;
  rain: number;
}

export interface Census {
  tick: number;
  grazer: number;
  hunter: number;
  foot?: number;
  webbed?: number;
  fin?: number;
}

export interface Record {
  id: number;
  parent: number | null;
  role: Role;
  generation: number;
  born: number;
  died: number | null;
  tracked: boolean;
  limb: LimbForm;
  genes: Genes;
}

export interface LineageComparison {
  ancestorId: number;
  ancestorGeneration: number;
  ancestorLimb: LimbForm;
  ancestorGenes: Genes;
  descendantId: number;
  descendantGeneration: number;
  descendantLimb: LimbForm;
  descendantGenes: Genes;
  generationSpan: number;
  stageChain: LimbForm[];
  chainComplete: boolean;
}

export interface Bloodline {
  root: number;
  role: Role;
  total: number;
  living: number;
  generation: number;
  forms?: { foot: number; webbed: number; fin: number };
  comparison?: LineageComparison | null;
}

export interface Frame {
  seed: number;
  tick: number;
  climate: Climate;
  creatures: Creature[];
  births: number;
  deaths: number;
  census: Census[];
  bloodline: Bloodline | null;
  branch: Record[];
  playing: boolean;
  speed: Speed;
}

export interface Save {
  version: 1;
  seed: number;
  tick: number;
  rng: number;
  nextId: number;
  climate: Climate;
  creatures: Creature[];
  resources: number[];
  records: Record[];
  births: number;
  deaths: number;
  census: Census[];
  bloodline: Bloodline | null;
}

export type Command =
  | { type: 'new'; seed: number }
  | { type: 'play'; playing: boolean }
  | { type: 'speed'; speed: Speed }
  | { type: 'step' }
  | { type: 'gift'; id: number; gift: Gift }
  | { type: 'climate'; climate: Partial<Climate> }
  | { type: 'track'; id: number }
  | { type: 'save' }
  | { type: 'load'; save: unknown };

export type WorkerReply =
  | { type: 'frame'; frame: Frame }
  | { type: 'saved'; save: Save }
  | { type: 'notice'; message: string };
