import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { limbForm, wingForm } from '../sim/adaptations.ts';
import { MATURE_AGE } from '../sim/world.ts';
import type { Creature, CreatureForm, LimbForm, Role, WingForm } from '../sim/types.ts';

type Shape = 'sphere' | 'leaf' | 'cone';
type Part = [Shape, number, number, number, number, number, number, string, number?, number?];

function geometryFor(part: Part) {
  const [shape, x, y, z, width, height, depth, color, pitch = 0, roll = 0] = part;
  const primitives = {
    sphere: () => new THREE.SphereGeometry(1, 12, 8),
    leaf: () => new THREE.IcosahedronGeometry(1, 1),
    cone: () => new THREE.ConeGeometry(1, 2, 6),
  };
  const original = primitives[shape]();
  const geo = original.index ? original.toNonIndexed() : original;
  if (original !== geo) original.dispose();
  geo.deleteAttribute('uv');
  geo.scale(width, height, depth);
  geo.rotateX(pitch);
  geo.rotateZ(roll);
  geo.translate(x, y, z);
  const tint = new THREE.Color(color);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function merge(parts: Part[]) {
  const geometries = parts.map(geometryFor);
  const result = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();
  if (!result) throw new Error('无法组合生物模型');
  return result;
}

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.77 });
const portraitSkin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74 });
const bodyProportions = {
  grazer: [1, 1, 1],
  hunter: [0.92, 1.04, 1.07],
  browser: [1.22, 1.02, 0.92],
  wader: [0.92, 0.73, 1.1],
  stalker: [0.75, 0.95, 1.17],
} as const;
const backRidges = {
  grazer: { shape: 'leaf', colors: ['#96af67', '#668448'], pitch: -0.56 },
  hunter: { shape: 'cone', colors: ['#ba783d', '#ba783d'], pitch: -0.34 },
  browser: { shape: 'cone', colors: ['#d7ac57', '#ac7837'], pitch: -0.57 },
  wader: { shape: 'leaf', colors: ['#7acbca', '#389393'], pitch: -0.69 },
  stalker: { shape: 'leaf', colors: ['#8674ad', '#584474'], pitch: -0.48 },
} as const satisfies Record<Role, { shape: Shape; colors: readonly string[]; pitch: number }>;
const wetlandTint = new THREE.Color('#75c3b9');
const drylandTint = new THREE.Color('#cea66d');

function body(role: Role, tall: boolean, form: CreatureForm, limb: LimbForm, wing: WingForm) {
  const grazer = role === 'grazer';
  const skin: Part[] = [
    ['sphere', 0, 0.81, -0.11, 0.65, 0.50, 0.89, '#f4f8ed'],
    ['sphere', 0, 1.02, 0.57, 0.52, 0.45, 0.50, '#f8f9e8'],
    ['sphere', 0, 0.87, 0.91, 0.35, 0.25, 0.24, '#fdf6dc'],
    ['sphere', 0, 0.77, -0.99, 0.15, 0.17, 0.45, '#cbdac4', -0.27],
    ['sphere', 0, 0.89, -1.32, 0.10, 0.11, 0.33, '#e2e3c9', -0.26],
  ];
  const detail: Part[] = [];
  for (const side of [-1, 1]) {
    const x = side * 0.40;
    if (limb === 'fin') {
      detail.push(
        ['leaf', side * 0.64, 0.45, 0.42, 0.46, 0.09, 0.28, '#62bdbd', -0.18, -side * 0.37],
        ['leaf', side * 0.58, 0.47, -0.56, 0.37, 0.08, 0.24, '#479cae', 0.13, -side * 0.30],
      );
    } else {
      skin.push(
        ['sphere', x, 0.38, 0.43, 0.20, 0.35, 0.23, '#c2cfbd', -0.12, side * 0.16],
        ['sphere', x, 0.39, -0.53, 0.23, 0.34, 0.30, '#cbd9c3', 0.23, side * 0.18],
      );
      if (limb === 'foot') {
        skin.push(
          ['sphere', x * 1.16, 0.13, 0.55, 0.19, 0.14, 0.25, '#a7b8a3'],
          ['sphere', x * 1.12, 0.12, -0.41, 0.18, 0.13, 0.24, '#a7b8a3'],
        );
      } else {
        detail.push(
          ['leaf', side * 0.52, 0.13, 0.59, 0.28, 0.08, 0.34, '#5cb7a4', 0, side * 0.16],
          ['leaf', side * 0.50, 0.13, -0.40, 0.25, 0.08, 0.30, '#4c9d94', 0, side * 0.15],
        );
      }
    }
    if (wing === 'glider') {
      skin.push(['leaf', side * 0.73, 1.04, -0.14, 0.57, 0.085, 0.46, '#c4bf91', 0.15, side * 0.28]);
      detail.push(['leaf', side * 0.84, 1.12, -0.06, 0.51, 0.05, 0.14, '#ebd7ab', 0.12, side * 0.24]);
    } else if (wing === 'flyer') {
      skin.push(['leaf', side * 1.02, 1.27, -0.19, 0.84, 0.10, 0.47, '#e0d6a5', 0.12, side * 0.24]);
      detail.push(
        ['leaf', side * 1.49, 1.36, -0.36, 0.70, 0.067, 0.22, '#cba467', 0.08, side * 0.14],
        ['leaf', side * 1.27, 1.31, -0.53, 0.61, 0.055, 0.20, '#dfbc80', 0.08, side * 0.14],
        ['leaf', side * 1.08, 1.27, -0.61, 0.48, 0.055, 0.16, '#f0d39a', 0.08, side * 0.14],
      );
    }
    detail.push(
      ['sphere', side * 0.32, 1.11, 0.911, 0.103, 0.116, 0.070, '#17221c'],
      ['sphere', side * 0.324, 1.13, 0.971, 0.062, 0.073, 0.026, grazer ? '#edbb63' : '#f3cc7c'],
      ['sphere', side * 0.322, 1.128, 0.991, 0.029, 0.050, 0.013, '#231e18'],
      ['sphere', side * 0.322 - 0.015, 1.163, 1.005, 0.015, 0.017, 0.01, '#fff4db'],
    );
    if (grazer) {
      detail.push(
        ['leaf', side * 0.47, 1.34, 0.54, 0.15, tall ? 0.51 : 0.37, 0.09, '#779a51', -0.22, -side * 0.55],
        ['leaf', side * 0.46, 1.39, 0.62, 0.079, tall ? 0.38 : 0.25, 0.034, '#b8ca7c', -0.22, -side * 0.52],
        ['sphere', side * 0.51, 0.93, 0.18, 0.12, 0.056, 0.11, '#c9da8b'],
        ['sphere', side * 0.56, 0.88, -0.16, 0.13, 0.046, 0.11, '#a5b967'],
      );
    } else if (role === 'hunter') {
      detail.push(['cone', side * 0.34, 1.40, 0.44, 0.15, tall ? 0.40 : 0.29, 0.15, '#f6cd8e', -0.44, -side * 0.21]);
    } else if (role === 'browser') {
      detail.push(
        ['cone', side * 0.41, 1.32, 0.63, 0.14, tall ? 0.58 : 0.45, 0.15, '#e8cf8d', 0.27, -side * 0.76],
        ['cone', side * 0.44, 1.26, 0.46, 0.11, 0.27, 0.13, '#ad813a', -0.38, -side * 1.0],
        ['leaf', side * 0.54, 0.86, -0.28, 0.13, 0.23, 0.34, '#b18b51', 0.1, -side * 0.25],
      );
    } else if (role === 'wader') {
      detail.push(
        ['leaf', side * 0.40, 1.28, 0.54, 0.11, tall ? 0.43 : 0.32, 0.27, '#80d4c3', -0.34, -side * 0.62],
      );
    } else {
      detail.push(
        ['cone', side * 0.31, 1.49, 0.51, 0.15, tall ? 0.48 : 0.37, 0.13, '#564267', -0.26, -side * 0.27],
        ['cone', side * 0.31, 1.47, 0.57, 0.089, 0.26, 0.08, '#b091c6', -0.26, -side * 0.27],
        ['cone', side * 0.47, 0.14, 0.78, 0.049, 0.18, 0.049, '#f1e1b6', 1.63],
      );
    }
    if (form === 'wetland') {
      detail.push(
        ['leaf', side * 0.53, 0.94, 0.29, 0.26, 0.06, 0.32, '#7ed6c1', -0.24, side * 0.34],
      );
    } else if (form === 'dryland') {
      detail.push(
        ['leaf', side * 0.57, 0.88, 0.06, 0.12, 0.22, 0.32, '#d2ad73', 0.16, -side * 0.19],
        ['leaf', side * 0.52, 0.85, -0.36, 0.13, 0.16, 0.28, '#ab7b43', 0.07, -side * 0.14],
      );
    }
  }
  if (limb !== 'foot') {
    detail.push(['leaf', 0, 0.80, -1.51, limb === 'fin' ? 0.47 : 0.30, 0.10, 0.45, '#61b7ac']);
  }
  const { shape, colors, pitch } = backRidges[role];
  for (let i = 0; i < (tall ? 4 : 3); i++) {
    const z = 0.23 - i * 0.26;
    const height = (tall ? 0.31 : 0.22) * (1 - 0.10 * i) * (role === 'wader' ? 1.38 : 1);
    detail.push([shape, 0, 1.35 - i * 0.045, z, 0.18, height, shape === 'leaf' ? 0.09 : 0.16, colors[i % 2], pitch]);
  }
  detail.push(['sphere', 0, 0.94, 1.116, 0.10, 0.06, 0.04, '#3a4831']);
  const [width, height, depth] = bodyProportions[role];
  return { skin: merge(skin).scale(width, height, depth), detail: merge(detail).scale(width, height, depth) };
}

const template = new Map<string, ReturnType<typeof body>>();

export function model(role: Role, tall: boolean, form: CreatureForm, limb: LimbForm, wing: WingForm) {
  const key = `${role}/${tall}/${form}/${limb}/${wing}`;
  let geometries = template.get(key);
  if (!geometries) {
    geometries = body(role, tall, form, limb, wing);
    template.set(key, geometries);
  }
  return geometries;
}

export function tintFor(creature: Creature, color = new THREE.Color()) {
  color.setHSL(creature.genes.hue / 360, creature.role === 'grazer' ? 0.38 : 0.56,
    creature.role === 'grazer' ? 0.60 : 0.57, THREE.SRGBColorSpace);
  if (creature.form === 'wetland') color.lerp(wetlandTint, 0.26);
  if (creature.form === 'dryland') color.lerp(drylandTint, 0.24);
  return color;
}

export function scaleFor(creature: Creature) {
  return creature.genes.size * (0.63 + 0.37 * Math.min(1, creature.age / MATURE_AGE));
}

export function modelMaterial() {
  return material;
}

export function portraitModel(creature: Creature) {
  const wing = wingForm(creature.genes.aerial);
  const parts = model(creature.role, creature.genes.crest > 0.49, creature.form, limbForm(creature.genes.aquatic), wing);
  portraitSkin.color.copy(tintFor(creature));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(parts.skin, portraitSkin), new THREE.Mesh(parts.detail, material));
  const scale = (0.70 + scaleFor(creature) * 0.36) * (wing === 'flyer' ? 0.80 : 1);
  group.scale.set(scale, scale, scale + (creature.genes.speed - 1) * 0.21);
  return group;
}
