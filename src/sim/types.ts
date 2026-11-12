export const DEFAULT_SEED = 41827;
export const MAX_POPULATION = 180;
export const MINUTES_PER_TICK = 8;
export const SPEEDS = [1, 4, 12, 48] as const;
export const INITIAL_CLIMATE = { temperature: 22, rain: 64 } as const;

export const ROLES = {
  grazer: { name: '苔叶兽', diet: '草地嫩叶', color: '#a9cd8b' },
  hunter: { name: '琥脊兽', diet: '捕猎苔叶兽和棘冠兽', color: '#e6ac6e' },
  browser: { name: '棘冠兽', diet: '旱坡和林地的耐旱植被', color: '#dbbb76' },
  wader: { name: '潮鳍兽', diet: '沿岸和浅水植物', color: '#77c8c5' },
  stalker: { name: '影爪兽', diet: '捕猎潮鳍兽和棘冠兽，缺猎物时采食植物', color: '#b6a0db' },
} as const;

export type Role = keyof typeof ROLES;
export const ROLE_KEYS = Object.keys(ROLES) as Role[];

export const FORM_NAMES = { ancestral: '原生型', wetland: '湿地型', dryland: '旱地型' } as const;
export type CreatureForm = keyof typeof FORM_NAMES;
export const creatureName = (role: Role, form: CreatureForm) =>
  form === 'ancestral' ? ROLES[role].name : `${FORM_NAMES[form]}${ROLES[role].name}`;

export type Speed = typeof SPEEDS[number];
export type Gift = 'grow' | 'restore' | 'adapt';

export interface Genes {
  size: number;
  speed: number;
  comfort: number;
  moisture: number;
  hue: number;
  crest: number;
}

export interface Creature {
  id: number;
  role: Role;
  form: CreatureForm;
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

export interface ObservedCreature extends Creature {
  localMoisture: number;
  stress: number;
}

export interface Climate {
  temperature: number;
  rain: number;
}

export type PopulationCounts = { [K in Role]: number };
export type Census = { tick: number } & PopulationCounts;

export function populationCounts(creatures: readonly Creature[]): PopulationCounts {
  const counts = { grazer: 0, hunter: 0, browser: 0, wader: 0, stalker: 0 };
  for (const creature of creatures) counts[creature.role]++;
  return counts;
}

export interface Record {
  id: number;
  parent: number | null;
  role: Role;
  form: CreatureForm;
  generation: number;
  born: number;
  died: number | null;
  tracked: boolean;
}

export interface Bloodline {
  root: number;
  role: Role;
  total: number;
  living: number;
  generation: number;
}

export interface Frame {
  seed: number;
  tick: number;
  climate: Climate;
  rainTrend: number;
  creatures: ObservedCreature[];
  births: number;
  deaths: number;
  census: Census[];
  bloodline: Bloodline | null;
  branch: Record[];
  playing: boolean;
  speed: Speed;
}

export interface Save {
  version: 2;
  seed: number;
  tick: number;
  rng: number;
  nextId: number;
  climate: Climate;
  rainTrend: number;
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
  | { type: 'notice'; message: string; giftId?: number };
