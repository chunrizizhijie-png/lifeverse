export const DEFAULT_SEED = 41827;
export const MAX_POPULATION = 180;
export const MINUTES_PER_TICK = 8;
export const SPEEDS = [1, 4, 12] as const;
export const INITIAL_CLIMATE = { temperature: 22, rain: 64 } as const;

export const ROLES = {
  grazer: { name: '苔叶兽', diet: '植食', color: '#a9cd8b' },
  hunter: { name: '琥脊兽', diet: '捕食', color: '#e6ac6e' },
} as const;

export type Role = keyof typeof ROLES;
export type Speed = typeof SPEEDS[number];
export type Gift = 'grow' | 'restore' | 'adapt';

export interface Genes {
  size: number;
  speed: number;
  comfort: number;
  hue: number;
  crest: number;
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
}

export interface Record {
  id: number;
  parent: number | null;
  role: Role;
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
