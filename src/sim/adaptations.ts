import type { Genes, LimbForm, Role, WingForm } from './types.ts';

export const LIMBS = {
  foot: { name: '陆行足', short: '足', color: '#c8b88a', minHeight: 0.55, maxHeight: Infinity, landPace: 1.05, waterPace: 0 },
  webbed: { name: '涉水蹼', short: '蹼', color: '#7ec4b6', minHeight: -2.4, maxHeight: Infinity, landPace: 0.93, waterPace: 1.14 },
  fin: { name: '游水鳍', short: '鳍', color: '#5ca4d8', minHeight: -12, maxHeight: 1.85, landPace: 0.56, waterPace: 1.38 },
} as const satisfies Record<LimbForm, object>;

export const WINGS = {
  wingless: { name: '无翼', short: '无翼', ability: '依靠足、蹼或鳍移动' },
  glider: { name: '滑翔翼', short: '滑翔', ability: '可沿地势向下滑翔，不能持续越海' },
  flyer: { name: '飞行翼', short: '飞行', ability: '可越过海面和陡坡，飞行消耗能量' },
} as const satisfies Record<WingForm, object>;

export function limbForm(aquatic: number): LimbForm {
  if (aquatic >= 0.70) return 'fin';
  if (aquatic >= 0.35) return 'webbed';
  return 'foot';
}

export function wingForm(aerial: number): WingForm {
  if (aerial >= 0.70) return 'flyer';
  if (aerial >= 0.35) return 'glider';
  return 'wingless';
}

export function fitsHeight(limb: LimbForm, height: number) {
  const { minHeight, maxHeight } = LIMBS[limb];
  return height >= minHeight && height <= maxHeight;
}

export const isShoreRole = (role: Role) => role === 'wader' || role === 'stalker';

export function limbSpeed(genes: Genes) {
  const limb = LIMBS[limbForm(genes.aquatic)];
  return `陆 ${(limb.landPace * genes.speed).toFixed(2)}× · 水 ${(limb.waterPace * genes.speed).toFixed(2)}×`;
}
