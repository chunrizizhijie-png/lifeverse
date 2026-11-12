import { ATLAS_SIZE } from './types.ts';
import type { Biome, LimbForm, MapTile, WingForm } from './types.ts';
import { fitsHeight, LIMBS } from './adaptations.ts';

export const LEGACY_MAP_HALF = 63;
export const LEGACY_GRID_SIZE = 42;
export const MAP_HALF = 99;
export const GRID_SIZE = 66;
export const CELL_WIDTH = 2 * MAP_HALF / GRID_SIZE;
export const LAND_HEIGHT = LIMBS.foot.minHeight;
const SHALLOW_DEPTH = -0.95;
const TILE_WIDTH = MAP_HALF * 2;

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

function tileHeight(x: number, z: number, { biome, seed }: MapTile) {
  if (biome === 'archipelago') return Math.max(terrainShape(x, z, seed), outerTerrain(x, z, seed));
  const broad = noise(x * 0.034, z * 0.034, seed + 201);
  const detail = noise(x * 0.091, z * 0.091, seed + 223);
  const coast = ellipse(x, z, 0, 0, 90, 88) + (broad - 0.5) * 0.30 + (detail - 0.5) * 0.10;
  if (coast < 0) return Math.max(-11, coast * 12);
  const inland = smooth(clamp(coast * 5, 0, 1));
  if (biome === 'desert') {
    const dune = 1.4 + 1.4 * Math.sin(x * 0.12 + z * 0.055 + broad * 5);
    const buttes = Math.max(0, broad - 0.52) * 14;
    return (1.55 + dune + buttes + detail * 1.3) * inland;
  }
  if (biome === 'marsh') {
    const channels = Math.sin(z * 0.075 + broad * 6) + Math.cos(x * 0.085 + detail * 3);
    return (1.1 + 1.08 * channels + broad * 1.75 + detail) * inland;
  }
  if (biome === 'highlands') {
    const peaks = 13 * Math.exp(-((x + 21) ** 2 / 1030 + (z - 23) ** 2 / 760))
      + 12 * Math.exp(-((x - 25) ** 2 / 620 + (z + 30) ** 2 / 1110));
    return (1.3 + peaks + 11 * broad + detail * 3) * inland;
  }
  if (biome === 'tundra') {
    const cirque = 8 * Math.exp(-((x + 24) ** 2 + (z - 28) ** 2) / 1210);
    return (1.25 + cirque + broad * 10 + detail * 1.6) * inland;
  }
  const hillHeight = biome === 'forest' ? 9.4 : 5.7;
  return (1.35 + broad * hillHeight + detail * 1.8) * inland;
}

// Neighboring tiles share a continuous land bridge.
function bridgeHeight(along: number, across: number) {
  if (along < -7) return -11;
  const bend = Math.sin(along * Math.PI / MAP_HALF) * 6;
  const width = 18 + 3 * Math.sin(along * 0.095);
  const bank = clamp(1 - Math.abs(across - bend) / width, 0, 1);
  return -11 + 14.27 * smooth(clamp(bank * 1.7, 0, 1)) * smooth(clamp((along + 7) / 20, 0, 1));
}

export type Habitat = 'sea' | 'shallows' | 'shore' | 'meadow' | 'woodland' | 'ridge';
const LAND_CAPACITY = { shore: 18, meadow: 38, woodland: 49, ridge: 16 };
const HABITAT_MOISTURE = { sea: 22, shallows: 22, shore: 16, meadow: -3, woodland: 8, ridge: -20 };
const BIOME_MOISTURE: Record<Biome, number> = {
  archipelago: 0, desert: -11, forest: 6, highlands: -7, marsh: 10, grassland: -3, tundra: -4,
};
const WOODLAND_THRESHOLD: Record<Biome, number> = {
  archipelago: 0.48, desert: 0.82, forest: 0.34, highlands: 0.52, marsh: 0.57, grassland: 0.69, tundra: 0.77,
};

export interface Cell {
  x: number;
  z: number;
  region: number;
  capacity: number;
  water: boolean;
  growth: number;
}

export const tileLayoutKey = (tiles: readonly MapTile[]) => tiles.map(tile => `${tile.seed}/${tile.biome}`).join('|');

export class Terrain {
  readonly seed: number;
  readonly tiles: readonly MapTile[];
  readonly mapHalf: number;
  readonly gridSize: number;
  readonly heights: Float32Array;
  readonly cells: Cell[] = [];
  readonly land: number[] = [];
  private readonly side: number;
  private readonly resolution: number;
  private readonly centers: { x: number; z: number }[];

  constructor(seed: number, tiles: readonly MapTile[] = [{ seed, biome: 'archipelago' }]) {
    if (tiles.length !== 1 && tiles.length !== ATLAS_SIZE) throw new Error('地图须包含一个区域或九个区域。');
    this.seed = seed;
    this.tiles = tiles.map(tile => ({ ...tile }));
    this.side = Math.sqrt(this.tiles.length);
    this.mapHalf = MAP_HALF * this.side;
    this.gridSize = GRID_SIZE * this.side;
    this.resolution = this.mapHalf * 2;
    this.centers = this.tiles.map((_, index) => ({
      x: (index % this.side + 0.5) * TILE_WIDTH - this.mapHalf,
      z: (Math.floor(index / this.side) + 0.5) * TILE_WIDTH - this.mapHalf,
    }));
    const stride = this.resolution + 1;
    this.heights = new Float32Array(stride ** 2);
    for (let row = 0; row <= this.resolution; row++) {
      for (let col = 0; col <= this.resolution; col++) {
        const x = col - this.mapHalf;
        const z = row - this.mapHalf;
        const tile = this.tileAt(x, z);
        let height = this.surface(x, z, tile);
        // A vertex on a seam belongs to both tiles. The higher edge preserves
        // occupiable terrain on both sides when migrating existing creatures.
        const seamX = col > 0 && col < this.resolution && col % TILE_WIDTH === 0;
        const seamZ = row > 0 && row < this.resolution && row % TILE_WIDTH === 0;
        if (seamX) height = Math.max(height, this.surface(x, z, tile - 1));
        if (seamZ) height = Math.max(height, this.surface(x, z, tile - this.side));
        if (seamX && seamZ) height = Math.max(height, this.surface(x, z, tile - this.side - 1));
        this.heights[row * stride + col] = height;
      }
    }
    if (this.side > 1) this.gradeBridges(stride);
    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        const x = (col + 0.5) * CELL_WIDTH - this.mapHalf;
        const z = (row + 0.5) * CELL_WIDTH - this.mapHalf;
        const region = this.tileAt(x, z);
        const height = this.height(x, z);
        const habitat = this.habitat(x, z, region);
        const water = habitat === 'sea' || habitat === 'shallows';
        const capacity = water ? height >= LIMBS.webbed.minHeight ? 34 : height >= -5.5 ? 24 : 12 : LAND_CAPACITY[habitat];
        const growth = height >= LIMBS.webbed.minHeight ? 1 : height >= -5.5 ? 0.56 : 0.24;
        if (!water) this.land.push(this.cells.length);
        this.cells.push({ x, z, region, water, growth, capacity: capacity * (0.78 + hash(col % GRID_SIZE, row % GRID_SIZE, this.tiles[region].seed) * 0.42) });
      }
    }
  }

  private gradeBridges(stride: number) {
    const start = MAP_HALF;
    const end = this.resolution - MAP_HALF;
    const route = new Float32Array(end - start + 1);
    const maxGrade = 1.65;
    for (const northSouth of [false, true]) {
      const step = northSouth ? stride : 1;
      const across = northSouth ? 1 : stride;
      for (let tile = 0; tile < this.side; tile++) {
        const center = MAP_HALF + tile * TILE_WIDTH;
        const first = center * across + start * step;
        for (let p = 0; p < route.length; p++) route[p] = this.heights[first + p * step];
        // Fill steep cuts along the spine. Raising rather than cutting keeps old
        // positions valid after a merge and lets walkers use their normal slope limit.
        for (let p = 1; p < route.length; p++) route[p] = Math.max(route[p], route[p - 1] - maxGrade);
        for (let p = route.length - 2; p >= 0; p--) route[p] = Math.max(route[p], route[p + 1] - maxGrade);
        for (let p = 0; p < route.length; p++) {
          const i = first + p * step;
          if (route[p] <= this.heights[i]) continue;
          for (let offset = -7; offset <= 7; offset++) {
            const index = i + offset * across;
            this.heights[index] = Math.max(this.heights[index], route[p] - Math.abs(offset) * maxGrade);
          }
        }
      }
    }
  }

  private surface(x: number, z: number, region: number) {
    const center = this.centers[region];
    const u = x - center.x;
    const v = z - center.z;
    let height = tileHeight(u, v, this.tiles[region]);
    const column = region % this.side;
    if (column > 0) height = Math.max(height, bridgeHeight(-u, v));
    if (column < this.side - 1) height = Math.max(height, bridgeHeight(u, v));
    if (region >= this.side) height = Math.max(height, bridgeHeight(-v, u));
    if (region < this.side * (this.side - 1)) height = Math.max(height, bridgeHeight(v, u));
    return height;
  }

  tileAt(x: number, z: number) {
    if (this.side === 1) return 0;
    const col = clamp(Math.floor((x + this.mapHalf) / TILE_WIDTH), 0, this.side - 1);
    const row = clamp(Math.floor((z + this.mapHalf) / TILE_WIDTH), 0, this.side - 1);
    return row * this.side + col;
  }

  tileCenter(index: number) {
    return { ...this.centers[index] };
  }

  height(x: number, z: number) {
    const u = clamp(x + this.mapHalf, 0, this.resolution - 1e-5);
    const v = clamp(z + this.mapHalf, 0, this.resolution - 1e-5);
    const row = Math.floor(v);
    const col = Math.floor(u);
    const stride = this.resolution + 1;
    const index = row * stride + col;
    return mix(mix(this.heights[index], this.heights[index + 1], u - col),
      mix(this.heights[index + stride], this.heights[index + stride + 1], u - col), v - row);
  }

  isLand(x: number, z: number) {
    return Math.abs(x) < this.mapHalf && Math.abs(z) < this.mapHalf && this.height(x, z) >= LAND_HEIGHT;
  }

  inBounds(x: number, z: number) {
    return Math.abs(x) < this.mapHalf && Math.abs(z) < this.mapHalf;
  }

  canTraverse(x: number, z: number, limb: LimbForm, wing: WingForm = 'wingless') {
    return this.inBounds(x, z) && (wing === 'flyer' || fitsHeight(limb, this.height(x, z)));
  }

  isShallow(x: number, z: number) {
    if (Math.abs(x) >= this.mapHalf || Math.abs(z) >= this.mapHalf) return false;
    const height = this.height(x, z);
    return height >= SHALLOW_DEPTH && height < LAND_HEIGHT;
  }

  habitat(x: number, z: number, region = this.tileAt(x, z)): Habitat {
    const h = this.height(x, z);
    if (h < SHALLOW_DEPTH) return 'sea';
    if (h < LAND_HEIGHT) return 'shallows';
    if (h < 1.45) return 'shore';
    const { seed, biome } = this.tiles[region];
    const { x: cx, z: cz } = this.centers[region];
    const u = x - cx;
    const v = z - cz;
    if (h > (biome === 'tundra' ? 9 : 12) + 4 * noise(u * 0.09, v * 0.09, seed + 72)) return 'ridge';
    return noise(u * 0.075, v * 0.075, seed + 39) > WOODLAND_THRESHOLD[biome] ? 'woodland' : 'meadow';
  }

  moistureOffset(x: number, z: number) {
    const region = this.tileAt(x, z);
    const habitat = this.habitat(x, z, region);
    const { seed, biome } = this.tiles[region];
    const { x: cx, z: cz } = this.centers[region];
    const local = HABITAT_MOISTURE[habitat] + BIOME_MOISTURE[biome];
    return local + (noise((x - cx) * 0.065, (z - cz) * 0.065, seed + 133) - 0.5) * 8;
  }

  cellAt(x: number, z: number) {
    const col = clamp(Math.floor((x + this.mapHalf) / CELL_WIDTH), 0, this.gridSize - 1);
    const row = clamp(Math.floor((z + this.mapHalf) / CELL_WIDTH), 0, this.gridSize - 1);
    return row * this.gridSize + col;
  }
}
