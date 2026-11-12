import { ROLES } from './types.ts';
import type { Genes, Niche, Species } from './types.ts';

const NICHES = {
  'cold-dry': { name: '低温干旱', comfort: 12, moisture: 24 },
  'cold-normal': { name: '低温中湿', comfort: 12, moisture: 58 },
  'cold-wet': { name: '低温多雨', comfort: 12, moisture: 89 },
  'mild-dry': { name: '温和干旱', comfort: 22, moisture: 24 },
  'mild-normal': { name: '温和中湿', comfort: 22, moisture: 58 },
  'mild-wet': { name: '温和多雨', comfort: 22, moisture: 89 },
  'hot-dry': { name: '高温干旱', comfort: 33, moisture: 24 },
  'hot-normal': { name: '高温中湿', comfort: 33, moisture: 58 },
  'hot-wet': { name: '高温多雨', comfort: 33, moisture: 89 },
} as const satisfies Record<Niche, { name: string; comfort: number; moisture: number }>;

export const NICHE_KEYS = Object.keys(NICHES) as Niche[];

export function isNiche(value: unknown): value is Niche {
  return typeof value === 'string' && Object.hasOwn(NICHES, value);
}

export function nicheFor({ comfort, moisture }: Pick<Genes, 'comfort' | 'moisture'>): Niche {
  const temperature = comfort <= 16 ? 'cold' : comfort >= 28 ? 'hot' : 'mild';
  const humidity = moisture <= 38 ? 'dry' : moisture >= 76 ? 'wet' : 'normal';
  return `${temperature}-${humidity}`;
}

export function nicheTargets(niche: Niche): Pick<Genes, 'comfort' | 'moisture'> {
  const { comfort, moisture } = NICHES[niche];
  return { comfort, moisture };
}

export function nicheName(niche: Niche) {
  return NICHES[niche].name;
}

export function speciesName(species: Pick<Species, 'role' | 'niche'>) {
  const { name } = ROLES[species.role];
  return species.niche ? `${nicheName(species.niche)}${name}` : name;
}
