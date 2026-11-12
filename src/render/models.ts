import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MATURE_AGE } from '../sim/world.ts';
import { limbForm } from '../sim/types.ts';
import type { Creature, LimbForm, Role } from '../sim/types.ts';

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

export function body(role: Role, tall: boolean, limb: LimbForm = 'foot') {
  const grazer = role === 'grazer';
  const isFin = limb === 'fin';
  const isWebbed = limb === 'webbed';
  const finDrop = isFin ? 0.08 : 0;
  const skin: Part[] = [
    ['sphere', 0, 0.81 - finDrop, -0.11, isFin ? 0.59 : 0.65, isFin ? 0.42 : 0.50,
      isFin ? 1.02 : isWebbed ? 0.95 : 0.89, '#f4f8ed'],
    ['sphere', 0, 1.02 - finDrop, 0.57, 0.52, 0.45, 0.50, '#f8f9e8'],
    ['sphere', 0, 0.87 - finDrop, 0.91, 0.35, 0.25, 0.24, '#fdf6dc'],
    ['sphere', 0, 0.77 - finDrop, -0.99, 0.15, 0.17, 0.45, '#cbdac4', -0.27],
    ['sphere', 0, 0.89 - finDrop, -1.32, 0.10, 0.11, 0.33, '#e2e3c9', -0.26],
  ];
  const detail: Part[] = [];
  for (const side of [-1, 1]) {
    const x = side * 0.40;
    if (limb === 'foot') {
      skin.push(
        ['sphere', x, 0.38, 0.43, 0.20, 0.35, 0.23, '#c2cfbd', -0.12, side * 0.16],
        ['sphere', x, 0.39, -0.53, 0.23, 0.34, 0.30, '#cbd9c3', 0.23, side * 0.18],
        ['sphere', x * 1.16, 0.13, 0.55, 0.19, 0.14, 0.25, '#a7b8a3'],
        ['sphere', x * 1.12, 0.12, -0.41, 0.18, 0.13, 0.24, '#a7b8a3'],
      );
    } else if (isWebbed) {
      skin.push(
        ['sphere', x * 1.06, 0.34, 0.42, 0.19, 0.29, 0.24, '#b5cec6', -0.18, side * 0.28],
        ['sphere', x * 1.05, 0.35, -0.50, 0.21, 0.28, 0.28, '#bdd6ce', 0.26, side * 0.30],
      );
      detail.push(
        ['leaf', x * 1.28, 0.09, 0.58, 0.30, 0.055, 0.34, '#66b5a6', 0.08, side * 0.22],
        ['leaf', x * 1.24, 0.08, -0.42, 0.28, 0.050, 0.32, '#66b5a6', 0.12, side * 0.24],
      );
    } else {
      detail.push(
        ['leaf', side * 0.58, 0.57, 0.32, 0.38, 0.048, 0.22, '#549bc9', 0.18, -side * 0.46],
        ['leaf', side * 0.49, 0.52, -0.42, 0.28, 0.042, 0.18, '#69add6', 0.22, -side * 0.40],
      );
    }
    detail.push(
      ['sphere', side * 0.32, 1.11 - finDrop, 0.911, 0.103, 0.116, 0.070, '#17221c'],
      ['sphere', side * 0.324, 1.13 - finDrop, 0.971, 0.062, 0.073, 0.026, grazer ? '#edbb63' : '#f3cc7c'],
      ['sphere', side * 0.322, 1.128 - finDrop, 0.991, 0.029, 0.050, 0.013, '#231e18'],
      ['sphere', side * 0.322 - 0.015, 1.163 - finDrop, 1.005, 0.015, 0.017, 0.01, '#fff4db'],
    );
    if (grazer) {
      detail.push(
        ['leaf', side * 0.47, 1.34 - finDrop, 0.54, 0.15, tall ? 0.51 : 0.37, 0.09, '#779a51', -0.22, -side * 0.55],
        ['leaf', side * 0.46, 1.39 - finDrop, 0.62, 0.079, tall ? 0.38 : 0.25, 0.034, '#b8ca7c', -0.22, -side * 0.52],
        ['sphere', side * 0.51, 0.93 - finDrop, 0.18, 0.12, 0.056, 0.11, '#c9da8b'],
        ['sphere', side * 0.56, 0.88 - finDrop, -0.16, 0.13, 0.046, 0.11, '#a5b967'],
      );
    } else {
      detail.push(['cone', side * 0.34, 1.40 - finDrop, 0.44, 0.15, tall ? 0.40 : 0.29, 0.15, '#f6cd8e', -0.44, -side * 0.21]);
    }
  }
  if (isWebbed) {
    detail.push(['leaf', 0, 0.87, -1.50, 0.21, 0.10, 0.32, '#72b8aa', 0.18]);
  } else if (isFin) {
    detail.push(
      ['cone', 0, 1.19, -0.32, 0.07, 0.36, 0.28, '#498eb8', -0.48],
      ['leaf', 0, 0.81, -1.53, 0.065, 0.38, 0.32, '#5aa0cc', 0.10],
    );
  }
  for (let i = 0; i < (tall ? 4 : 3); i++) {
    const z = 0.23 - i * 0.26;
    const height = (tall ? 0.31 : 0.22) * (1 - 0.10 * i);
    detail.push(grazer
      ? ['leaf', 0, 1.36 - finDrop - i * 0.043, z, 0.19, height, 0.09, i % 2 ? '#668448' : '#96af67', -0.56]
      : ['cone', 0, 1.34 - finDrop - i * 0.046, z, 0.16, height, 0.17, '#ba783d', -0.34]);
  }
  detail.push(['sphere', 0, 0.94 - finDrop, 1.116, 0.10, 0.06, 0.04, '#3a4831']);
  return { skin: merge(skin), detail: merge(detail) };
}

const template = new Map<string, ReturnType<typeof body>>();

export function model(role: Role, tall: boolean, limb: LimbForm = 'foot') {
  const key = `${role}:${tall}:${limb}`;
  let geometries = template.get(key);
  if (!geometries) {
    geometries = body(role, tall, limb);
    template.set(key, geometries);
  }
  return geometries;
}

export function tintFor(creature: Creature, color = new THREE.Color()) {
  const limb = limbForm(creature.genes.aquatic);
  const hueShift = limb === 'fin' ? 0.06 : limb === 'webbed' ? 0.03 : 0;
  return color.setHSL((creature.genes.hue / 360 + hueShift) % 1, creature.role === 'grazer' ? 0.38 : 0.61,
    creature.role === 'grazer' ? 0.60 : 0.57, THREE.SRGBColorSpace);
}

export function scaleFor(creature: Creature) {
  return creature.genes.size * (0.63 + 0.37 * Math.min(1, creature.age / MATURE_AGE));
}

export function modelMaterial() {
  return material;
}

export function portraitModel(creature: Creature) {
  const limb = limbForm(creature.genes.aquatic);
  const parts = model(creature.role, creature.genes.crest > 0.49, limb);
  portraitSkin.color.copy(tintFor(creature));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(parts.skin, portraitSkin), new THREE.Mesh(parts.detail, material));
  const scale = 0.86 + scaleFor(creature) * 0.18;
  group.scale.set(scale, scale, scale + (creature.genes.speed - 1) * 0.21);
  return group;
}
