import type { Creature, CreatureForm, Role } from './types.ts';
import type { Habitat } from './terrain.ts';

export const FOUNDERS = { grazer: 30, hunter: 6, browser: 20, wader: 20, stalker: 5 } satisfies Record<Role, number>;

export const TRAIT_CENTERS = {
  grazer: { speed: 1.015, hue: 114, moisture: 58 },
  hunter: { speed: 1.195, hue: 33, moisture: 56 },
  browser: { speed: 0.94, hue: 46, moisture: 43 },
  wader: { speed: 1.04, hue: 173, moisture: 72 },
  stalker: { speed: 1.22, hue: 266, moisture: 62 },
} satisfies Record<Role, { speed: number; hue: number; moisture: number }>;

interface HuntingRules {
  prey: Role[];
  pace: number;
  sight: number;
  reward: number;
  chance: number;
  fallbackFood: number;
}

const HUNTING: Record<'hunter' | 'stalker', HuntingRules> = {
  hunter: { prey: ['grazer', 'browser'], pace: 0.41, sight: 13, reward: 47, chance: 0.31, fallbackFood: 0 },
  stalker: { prey: ['wader', 'browser'], pace: 0.44, sight: 11, reward: 52, chance: 0.38, fallbackFood: 0.45 },
};

export const huntingRules = (role: Role) =>
  role === 'hunter' || role === 'stalker' ? HUNTING[role] : undefined;

export function forageQuality(role: Role, habitat: Habitat) {
  if (role === 'wader') return habitat === 'shallows' || habitat === 'shore' ? 1.20 : 0.89;
  if (role === 'browser') return habitat === 'ridge' || habitat === 'woodland' ? 1.17 : 1.02;
  return habitat === 'meadow' || habitat === 'woodland' ? 1.05 : 0.89;
}

export function inheritedForm(moisture: number): CreatureForm {
  if (moisture >= 76) return 'wetland';
  if (moisture <= 38) return 'dryland';
  return 'ancestral';
}

export const canWade = (creature: Pick<Creature, 'role' | 'form'>) =>
  creature.role === 'wader' || creature.role === 'stalker' || creature.form === 'wetland';
