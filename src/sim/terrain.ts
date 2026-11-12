export const LEGACY_MAP_HALF = 63;
export const LEGACY_GRID_SIZE = 42;
export const MAP_HALF = 99;
export const GRID_SIZE = 66;
export const CELL_WIDTH = 2 * MAP_HALF / GRID_SIZE;
export const LAND_HEIGHT = 0.55;
const HEIGHT_RESOLUTION = 2 * MAP_HALF;
const SHALLOW_DEPTH = -0.95;

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

function outerTerrain(x: number, z: number, seed: number) {
  const drift = (noise(4, 8, seed + 74) - 0.5) * 8;
  const east = ellipse(x, z, 50, -17 + drift, 36, 25);
  const northwest = ellipse(x + z * 0.18, z, -53, -38 + drift, 31, 24);
  const south = Math.max(
    ellipse(x, z, 17, 53 - drift, 27, 22),
    ellipse(x, z, -21, 58 + drift, 16, 12) - 0.06,
  );
  const islands = Math.max(
    ellipse(x, z, 66, 38, 17, 12) - 0.09,
    ellipse(x, z, -73, 27, 16, 18) - 0.08,
  );
  const coast = Math.max(east, northwest, south, islands)
    + (noise(x * 0.105, z * 0.105, seed + 61) - 0.5) * 0.24
    + (noise(x * 0.26, z * 0.26, seed + 84) - 0.5) * 0.10;
  if (coast < 0) return Math.max(-11, coast * 7.5);

  const mountains = 17 * Math.exp(-((x + 45) ** 2 / 260 + (z + 43) ** 2 / 195))
    + 12 * Math.exp(-((x - 13) ** 2 / 190 + (z - 57) ** 2 / 180));
  const relief = 1.9 + 4 * noise(x * 0.12, z * 0.12, seed + 96);
  return coast * 2.1 + (mountains + relief) * smooth(clamp(coast * 3.5, 0, 1));
}

export type Habitat = 'sea' | 'shallows' | 'shore' | 'meadow' | 'woodland' | 'ridge';

export interface Cell {
  x: number;
  z: number;
  capacity: number;
}

export class Terrain {
  readonly seed: number;
  readonly heights = new Float32Array((HEIGHT_RESOLUTION + 1) ** 2);
  readonly cells: Cell[] = [];
  readonly land: number[] = [];

  constructor(seed: number) {
    this.seed = seed;
    for (let row = 0; row <= HEIGHT_RESOLUTION; row++) {
      for (let col = 0; col <= HEIGHT_RESOLUTION; col++) {
        const x = col - MAP_HALF;
        const z = row - MAP_HALF;
        this.heights[row * (HEIGHT_RESOLUTION + 1) + col] = Math.max(
          terrainShape(x, z, seed), outerTerrain(x, z, seed),
        );
      }
    }
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const x = (col + 0.5) * CELL_WIDTH - MAP_HALF;
        const z = (row + 0.5) * CELL_WIDTH - MAP_HALF;
        const habitat = this.habitat(x, z);
        const capacity = { sea: 0, shallows: 14, shore: 18, meadow: 38, woodland: 49, ridge: 16 }[habitat];
        if (this.isLand(x, z)) this.land.push(this.cells.length);
        this.cells.push({ x, z, capacity: capacity * (0.78 + hash(col, row, seed) * 0.42) });
      }
    }
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
    return Math.abs(x) < MAP_HALF && Math.abs(z) < MAP_HALF && this.height(x, z) >= LAND_HEIGHT;
  }

  isShallow(x: number, z: number) {
    if (Math.abs(x) >= MAP_HALF || Math.abs(z) >= MAP_HALF) return false;
    const height = this.height(x, z);
    return height >= SHALLOW_DEPTH && height < LAND_HEIGHT;
  }

  habitat(x: number, z: number): Habitat {
    const h = this.height(x, z);
    if (h < SHALLOW_DEPTH) return 'sea';
    if (h < LAND_HEIGHT) return 'shallows';
    if (h < 1.45) return 'shore';
    if (h > 12 + 4 * noise(x * 0.09, z * 0.09, this.seed + 72)) return 'ridge';
    return noise(x * 0.075, z * 0.075, this.seed + 39) > 0.48 ? 'woodland' : 'meadow';
  }

  moistureOffset(x: number, z: number) {
    const habitat = this.habitat(x, z);
    const local = { sea: 22, shallows: 22, shore: 16, meadow: -3, woodland: 8, ridge: -20 }[habitat];
    return local + (noise(x * 0.065, z * 0.065, this.seed + 133) - 0.5) * 8;
  }

  cellAt(x: number, z: number) {
    const col = clamp(Math.floor((x + MAP_HALF) / CELL_WIDTH), 0, GRID_SIZE - 1);
    const row = clamp(Math.floor((z + MAP_HALF) / CELL_WIDTH), 0, GRID_SIZE - 1);
    return row * GRID_SIZE + col;
  }
}
