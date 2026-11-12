import * as THREE from 'three';
import { clamp, hash, noise } from '../sim/terrain.ts';
import type { Habitat, Terrain } from '../sim/terrain.ts';
import type { Biome } from '../sim/types.ts';
import { seamColor, terrainColors } from './terrain-colors.ts';

const shade = new THREE.Color('#42443a');
const sunlit = new THREE.Color('#c9bd89');
const palettes = Object.fromEntries(Object.entries(terrainColors).map(([biome, colors]) => [
  biome, Object.fromEntries(Object.entries(colors).map(([habitat, hex]) => [habitat, new THREE.Color(hex)])),
])) as Record<Biome, Record<Habitat, THREE.Color>>;

function ground(terrain: Terrain) {
  const width = terrain.mapHalf * 2;
  const resolution = terrain.tiles.length === 1 ? width : width / 2;
  const geometry = new THREE.PlaneGeometry(width, width, resolution, resolution);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const tint = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const height = terrain.height(x, z);
    positions.setY(i, height);
    const region = terrain.tileAt(x, z);
    const habitat = terrain.habitat(x, z, region);
    const palette = palettes[terrain.tiles[region].biome];
    const contour = noise(x * 0.22, z * 0.22, terrain.seed + 581);
    const mottled = noise(x * 0.64, z * 0.64, terrain.seed + 717);
    tint.copy(palette[habitat]);
    const seam = seamColor(terrain, x, z, region);
    if (seam) tint.lerp(palettes[seam.biome][habitat], seam.weight);
    if (habitat === 'shore') tint.lerp(palette.meadow, clamp((height - 0.52) / 1.55, 0, 0.62));
    if (habitat === 'meadow') tint.lerp(palette.woodland, (1 - contour) * 0.32);
    if (habitat === 'ridge') tint.lerp(shade, Math.max(0, 0.8 - contour) * 0.60);
    tint.lerp(mottled > 0.5 ? sunlit : shade, Math.abs(mottled - 0.5) * 0.30);
    tint.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.99, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function water(terrain: Terrain) {
  const size = Math.sqrt(terrain.heights.length);
  const heightData = Uint8Array.from(terrain.heights, h => Math.round(clamp((h + 11) / 36, 0, 1) * 255));
  const depth = new THREE.DataTexture(heightData, size, size, THREE.RedFormat);
  depth.magFilter = THREE.LinearFilter;
  depth.minFilter = THREE.LinearFilter;
  depth.needsUpdate = true;
  const oceanWidth = Math.max(640, terrain.mapHalf * 6);
  const geometry = new THREE.PlaneGeometry(oceanWidth, oceanWidth).rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      terrainDepth: { value: depth },
      mapHalf: { value: terrain.mapHalf },
      time: { value: 0 },
      deep: { value: new THREE.Color('#164944') },
      shallows: { value: new THREE.Color('#528577') },
      surf: { value: new THREE.Color('#b1c2a2') },
    },
    vertexShader: `
      varying vec2 world;
      void main() {
        world = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: `
      uniform sampler2D terrainDepth;
      uniform vec3 deep, shallows, surf;
      uniform float time, mapHalf;
      varying vec2 world;
      void main() {
        vec2 uv = world / (mapHalf * 2.) + .5;
        float d = 11.0 - texture2D(terrainDepth, uv).r * 36.0;
        float edge = max(abs(world.x), abs(world.y));
        d = mix(d, 11.0, smoothstep(mapHalf - 18., mapHalf, edge));
        float a = sin(world.x * 1.57 + world.y * 1.24 + time * .55);
        float b = sin(world.x * .28 - world.y * .68 + a * .85 - time * .22);
        float c = sin(world.x * .39 + world.y * 1.83 + b * 1.11 + time * .41);
        float broad = sin(world.x * .095 + world.y * .08 + a * .18 - time * .18);
        float ripple = a * .06 + b * .07 + c * .055;
        float glint = smoothstep(.81, .99, c) * smoothstep(.23, .94, b) * .11;
        float shelf = exp(-max(0.0, d) * .235) * .89;
        vec3 color = mix(deep, shallows, shelf) * (1.0 + ripple + broad * .09);
        float bank = exp(-abs(d - .68 - a * .12) * 2.7) * (.28 + .18 * b);
        float foam = exp(-abs(d - 1.55 - b * .19) * 2.35) * smoothstep(-.2, .8, a) * .25;
        color = mix(color, surf, bank + foam + glint);
        gl_FragColor = vec4(color, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.08;
  return { mesh, depth, material };
}

interface Planting {
  x: number;
  y: number;
  z: number;
  scale: number;
  spin: number;
  color: string;
}

function scatter(terrain: Terrain) {
  const tall: Planting[] = [];
  const shrubs: Planting[] = [];
  const rocks: Planting[] = [];
  const herbs: Planting[] = [];
  const crown = ['#416940', '#4d7648', '#6d8950', '#365b42', '#71894f', '#628450', '#809b5b'];
  const stone = ['#777f6e', '#a19a7d', '#77786c', '#958f77'];
  const density = terrain.tiles.length === 1 ? 1 : 3;
  for (let i = 0; i < 12800 * density; i++) {
    const x = (hash(i, 125, terrain.seed) - 0.5) * 2 * terrain.mapHalf;
    const z = (hash(i, 219, terrain.seed) - 0.5) * 2 * terrain.mapHalf;
    const y = terrain.height(x, z);
    if (y < 0.7) continue;
    const region = terrain.tileAt(x, z);
    const habitat = terrain.habitat(x, z, region);
    const biome = terrain.tiles[region].biome;
    const sparse = biome === 'desert' || biome === 'tundra';
    const slope = Math.abs(y - terrain.height(x + 1.4, z)) + Math.abs(y - terrain.height(x, z + 1.4));
    const spin = hash(i, 417, terrain.seed) * Math.PI * 2;
    const trait = hash(i, 141, terrain.seed);
    const variety = hash(i, 812, terrain.seed);
    const inClearing = ((x - 8) / 7) ** 2 + ((z - 13) / 6) ** 2 < 1;
    if (habitat === 'woodland' && tall.length < 1100 * density && slope < 2.9 && !inClearing
      && trait < (sparse ? 0.09 : 0.68) && noise(x * 0.17, z * 0.17, terrain.seed + 68) > 0.32) {
      tall.push({ x, y, z, spin, scale: 0.53 + variety ** 1.4 * 1.20,
        color: crown[Math.floor(variety * crown.length)] });
      continue;
    }
    if ((habitat === 'ridge' || (slope > 1.25 && y < 3.7)) && rocks.length < 470 * density && trait < 0.64) {
      rocks.push({ x, y, z, spin, scale: 0.33 + 1.03 * variety ** 1.2,
        color: stone[Math.floor(variety * stone.length)] });
      continue;
    }
    if (y > 1.2 && habitat !== 'ridge' && shrubs.length < 890 * density && trait < (sparse ? 0.16 : 0.69)) {
      shrubs.push({ x, y, z, spin, scale: 0.22 + variety * 0.59, color: crown[Math.floor(variety * crown.length)] });
      continue;
    }
    if (herbs.length < 1000 * density && slope < 2.1 && (!sparse || trait < 0.24)) {
      herbs.push({ x, y, z, spin, scale: 0.14 + variety * 0.37, color: trait > 0.78 ? '#bfaa5e' : '#95a96b' });
    }
  }
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const mixColor = new THREE.Color('#314737');
  const surface = new THREE.MeshStandardMaterial({ roughness: 0.94, flatShading: true });
  const group = new THREE.Group();

  function batch(geometry: THREE.BufferGeometry, entries: Planting[], offset: number, w: number, h: number,
    d: number, hue?: string, under = false, shadow = false) {
    const mesh = new THREE.InstancedMesh(geometry, surface, entries.length);
    for (let i = 0; i < entries.length; i++) {
      const { x, y, z, scale, spin, color } = entries[i];
      dummy.position.set(x + Math.cos(spin) * (under ? 0.24 : 0), y + offset * scale, z + Math.sin(spin) * (under ? 0.24 : 0));
      dummy.rotation.set(0, spin, under ? 0.18 : 0);
      dummy.scale.set(w * scale, h * scale, d * scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      tint.set(hue ?? color);
      if (under) tint.lerp(mixColor, 0.21);
      mesh.setColorAt(i, tint);
    }
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  batch(new THREE.CylinderGeometry(0.12, 0.20, 2.1, 5), tall, 0.89, 1, 1, 1, '#605443');
  batch(new THREE.IcosahedronGeometry(1, 1), tall, 1.66, 0.97, 0.79, 0.93, undefined, true, true);
  batch(new THREE.IcosahedronGeometry(1, 1), tall, 2.22, 0.73, 0.97, 0.76, undefined, false, true);
  batch(new THREE.IcosahedronGeometry(1, 0), shrubs, 0.22, 0.82, 0.52, 0.75);
  batch(new THREE.DodecahedronGeometry(1, 0), rocks, 0.12, 0.88, 0.70, 0.69, undefined, false, true);
  batch(new THREE.ConeGeometry(0.42, 1.2, 4), herbs, 0.30, 0.78, 1.24, 0.92);
  return group;
}

export function island(terrain: Terrain) {
  const ocean = water(terrain);
  const group = new THREE.Group();
  group.add(ground(terrain), ocean.mesh, scatter(terrain));
  return {
    group,
    animate(time: number) { ocean.material.uniforms.time.value = time; },
    dispose() {
      const materials = new Set<THREE.Material>();
      group.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        if (object instanceof THREE.InstancedMesh) object.dispose();
        object.geometry.dispose();
        if (!Array.isArray(object.material)) materials.add(object.material);
      });
      for (const material of materials) material.dispose();
      ocean.depth.dispose();
    },
  };
}
