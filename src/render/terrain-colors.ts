import { MAP_HALF } from '../sim/terrain.ts';
import type { Habitat, Terrain } from '../sim/terrain.ts';
import type { Biome } from '../sim/types.ts';

const base = {
  sea: '#1b514d', shallows: '#528577', shore: '#b8a578', meadow: '#77914f', woodland: '#536c40', ridge: '#8f8e74',
};

export const terrainColors: Record<Biome, Record<Habitat, string>> = {
  archipelago: base,
  desert: { ...base, shore: '#d3b57e', meadow: '#bb8550', woodland: '#92744f', ridge: '#a2603e' },
  forest: { ...base, shore: '#9b9e75', meadow: '#608c54', woodland: '#365e45', ridge: '#737c67' },
  highlands: { ...base, shore: '#a0a28b', meadow: '#7b8c6d', woodland: '#5e7564', ridge: '#9c9a91' },
  marsh: { ...base, shallows: '#55786c', shore: '#969268', meadow: '#819a58', woodland: '#4c7548', ridge: '#93966d' },
  grassland: { ...base, shore: '#c4ae78', meadow: '#a3a751', woodland: '#687a44', ridge: '#949066' },
  tundra: { ...base, shallows: '#6e9296', shore: '#97adad', meadow: '#a1b1a1', woodland: '#708a7f', ridge: '#d4dbd3' },
};

// Feather the colors over each shared seam without altering biome or climate.
export function seamColor(terrain: Terrain, x: number, z: number, region: number) {
  if (terrain.tiles.length === 1) return;
  const width = MAP_HALF * 2;
  const distance = 9;
  const u = (x + terrain.mapHalf) % width;
  const v = (z + terrain.mapHalf) % width;
  const nearX = Math.min(u, width - u);
  const nearZ = Math.min(v, width - v);
  if (nearX >= distance && nearZ >= distance) return;
  const other = nearX <= nearZ
    ? terrain.tileAt(x + (u <= width / 2 ? -distance : distance), z)
    : terrain.tileAt(x, z + (v <= width / 2 ? -distance : distance));
  if (other === region) return;
  return { biome: terrain.tiles[other].biome, weight: 0.5 * (1 - Math.min(nearX, nearZ) / distance) };
}
