import { LIMBS } from './types.ts';
import type { LimbForm } from './types.ts';

export const MAP_HALF = 63;
export const GRID_SIZE = 42;
export const CELL_WIDTH = 2 * MAP_HALF / GRID_SIZE;
export const LAND_HEIGHT = 0.55;
export const SHALLOW_HEIGHT = -2.4;
export const FIN_MAX_LAND_HEIGHT = 1.85;
const HEIGHT_RESOLUTION = 126;

export const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

export function hash(x: number, z: number, seed: number) {
  let v = Math.imul(x ^ seed, 0x45d9f3b) + Math.imul(z, 0x27d4eb2d);
  v = Math.imul(v ^ (v >>> 16), 0x7feb352d);
  return ((v ^ (v >>> 15)) >>> 0) / 4294967296;
}

export function noise(x: number, z: number, seed: number) {
  const a = Math.floor(x);
  const b = Math.floor(z);
  const u = smooth(x - a);
  const v = smooth(z - b);
  return mix(mix(hash(a, b, seed), hash(a + 1, b, seed), u),
    mix(hash(a, b + 1, seed), hash(a + 1, b + 1, seed), u), v);
}

function ellipse(x: number, z: number, a: number, b: number, w: number, h: number) {
  return 1 - Math.hypot((x - a) / w, (z - b) / h);
}

function terrainShape(x: number, z: number, seed: number) {
  const bend = (noise(x * 0.04, z * 0.04, seed + 9) - 0.5) * 16;
  const main = Math.max(
    ellipse(x + z * 0.22, z, -5 + bend, 0, 40, 30),
    ellipse(x, z, 16, -11 + bend * 0.5, 25, 24) - 0.04,
    ellipse(x, z, -26, 9, 19, 16) - 0.08,
    ellipse(x, z, 9, 23, 21, 12) - 0.12,
  );
  const satellites = Math.max(
    ellipse(x, z, -37, -30, 12, 7) - 0.10,
    ellipse(x, z, 45, 18, 11, 9) - 0.10,
    ellipse(x, z, -33, 31, 8, 6) - 0.08,
    ellipse(x, z, 34, 34, 5, 3) - 0.11,
  );
  const coast = Math.max(main, satellites)
    + (noise(x * 0.13, z * 0.13, seed) - 0.5) * 0.29
    + (noise(x * 0.29, z * 0.29, seed + 22) - 0.5) * 0.11;
  if (coast < 0) return Math.max(-11, coast * 16);

  const mountains = 15 * Math.exp(-((x - 7) ** 2 / 370 + (z + 17) ** 2 / 185))
    + 10 * Math.exp(-((x + 18) ** 2 / 220 + (z + 2) ** 2 / 250));
  const relief = (noise(x * 0.11, z * 0.11, seed + 17) - 0.31) * 6;
  const valley = 1 - 0.46 * Math.exp(-((x - 1 + 0.57 * z) ** 2 / 30 + (z - 9) ** 2 / 490));
  return Math.max(0, coast * 3.8 + (mountains + relief + 1.6) * smooth(clamp(coast * 4, 0, 1)) * valley);
}

export type Habitat = 'sea' | 'shore' | 'meadow' | 'woodland' | 'ridge';

export interface Cell {
  x: number;
  z: number;
  capacity: number;
  aquatic: boolean;
}

export class Terrain {
  readonly seed: number;
  readonly heights = new Float32Array((HEIGHT_RESOLUTION + 1) ** 2);
  readonly cells: Cell[] = [];
  readonly land: number[] = [];
  readonly water: number[] = [];

  constructor(seed: number) {
    this.seed = seed;
    for (let row = 0; row <= HEIGHT_RESOLUTION; row++) {
      for (let col = 0; col <= HEIGHT_RESOLUTION; col++) {
        this.heights[row * (HEIGHT_RESOLUTION + 1) + col] = terrainShape(col - MAP_HALF, row - MAP_HALF, seed);
      }
    }
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const x = (col + 0.5) * CELL_WIDTH - MAP_HALF;
        const z = (row + 0.5) * CELL_WIDTH - MAP_HALF;
        const h = this.height(x, z);
        const habitat = this.habitat(x, z);
        const isLandCell = this.isLand(x, z);
        let baseCapacity = { sea: 0, shore: 14, meadow: 38, woodland: 49, ridge: 16 }[habitat];
        if (!isLandCell) {
          baseCapacity = h >= SHALLOW_HEIGHT ? 34 : h >= -5.5 ? 24 : 12;
        }
        const index = this.cells.length;
        if (isLandCell) this.land.push(index);
        else this.water.push(index);
        this.cells.push({
          x,
          z,
          capacity: baseCapacity * (0.78 + hash(col, row, seed) * 0.42),
          aquatic: !isLandCell,
        });
      }
    }
  }

  inBounds(x: number, z: number) {
    return Math.abs(x) < MAP_HALF && Math.abs(z) < MAP_HALF;
  }

  height(x: number, z: number) {
    const u = clamp(x + MAP_HALF, 0, HEIGHT_RESOLUTION - 1e-5);
    const v = clamp(z + MAP_HALF, 0, HEIGHT_RESOLUTION - 1e-5);
    const row = Math.floor(v);
    const col = Math.floor(u);
    const stride = HEIGHT_RESOLUTION + 1;
    const index = row * stride + col;
    return mix(mix(this.heights[index], this.heights[index + 1], u - col),
      mix(this.heights[index + stride], this.heights[index + stride + 1], u - col), v - row);
  }

  isLand(x: number, z: number) {
    return this.inBounds(x, z) && this.height(x, z) >= LAND_HEIGHT;
  }

  isShallows(x: number, z: number) {
    if (!this.inBounds(x, z)) return false;
    const h = this.height(x, z);
    return h >= SHALLOW_HEIGHT && h < LAND_HEIGHT;
  }

  isWater(x: number, z: number) {
    return this.inBounds(x, z) && this.height(x, z) < LAND_HEIGHT;
  }

  canTraverse(x: number, z: number, limb: LimbForm = 'foot') {
    if (!this.inBounds(x, z)) return false;
    const h = this.height(x, z);
    const spec = LIMBS[limb];
    return h >= spec.minHeight && h <= spec.maxHeight;
  }

  habitat(x: number, z: number): Habitat {
    const h = this.height(x, z);
    if (h <= 0) return 'sea';
    if (h < 1.45) return 'shore';
    if (h > 12 + 4 * noise(x * 0.09, z * 0.09, this.seed + 72)) return 'ridge';
    return noise(x * 0.075, z * 0.075, this.seed + 39) > 0.48 ? 'woodland' : 'meadow';
  }

  cellAt(x: number, z: number) {
    const col = clamp(Math.floor((x + MAP_HALF) / CELL_WIDTH), 0, GRID_SIZE - 1);
    const row = clamp(Math.floor((z + MAP_HALF) / CELL_WIDTH), 0, GRID_SIZE - 1);
    return row * GRID_SIZE + col;
  }
}
