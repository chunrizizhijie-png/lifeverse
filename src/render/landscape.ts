import * as THREE from 'three';
import { clamp, hash, MAP_HALF, noise } from '../sim/terrain.ts';
import type { Habitat, Terrain } from '../sim/terrain.ts';

export const habitatColors: Record<Habitat, string> = {
  sea: '#1b514d', shallows: '#528577', shore: '#b8a578', meadow: '#77914f', woodland: '#536c40', ridge: '#8f8e74',
};
const shade = new THREE.Color('#42443a');
const sunlit = new THREE.Color('#c9bd89');

function ground(terrain: Terrain) {
  const resolution = Math.sqrt(terrain.heights.length) - 1;
  const geometry = new THREE.PlaneGeometry(MAP_HALF * 2, MAP_HALF * 2, resolution, resolution);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const palette = Object.fromEntries(Object.entries(habitatColors).map(([key, hex]) => [key, new THREE.Color(hex)]));
  const tint = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const height = terrain.heights[i];
    positions.setY(i, height);
    const biome = terrain.habitat(x, z);
    const contour = noise(x * 0.22, z * 0.22, terrain.seed + 581);
    const mottled = noise(x * 0.64, z * 0.64, terrain.seed + 717);
    tint.copy(palette[biome]);
    if (biome === 'shore') tint.lerp(palette.meadow, clamp((height - 0.52) / 1.55, 0, 0.62));
    if (biome === 'meadow') tint.lerp(palette.woodland, (1 - contour) * 0.32);
    if (biome === 'ridge') tint.lerp(shade, Math.max(0, 0.8 - contour) * 0.60);
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
  const geometry = new THREE.PlaneGeometry(640, 640).rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      terrainDepth: { value: depth },
      mapHalf: { value: MAP_HALF },
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
  for (let i = 0; i < 12800; i++) {
    const x = (hash(i, 125, terrain.seed) - 0.5) * 2 * MAP_HALF;
    const z = (hash(i, 219, terrain.seed) - 0.5) * 2 * MAP_HALF;
    const y = terrain.height(x, z);
    if (y < 0.7) continue;
    const biome = terrain.habitat(x, z);
    const slope = Math.abs(y - terrain.height(x + 1.4, z)) + Math.abs(y - terrain.height(x, z + 1.4));
    const spin = hash(i, 417, terrain.seed) * Math.PI * 2;
    const trait = hash(i, 141, terrain.seed);
    const variety = hash(i, 812, terrain.seed);
    const inClearing = ((x - 8) / 7) ** 2 + ((z - 13) / 6) ** 2 < 1;
    if (biome === 'woodland' && tall.length < 1100 && slope < 2.9 && !inClearing
      && trait < 0.68 && noise(x * 0.17, z * 0.17, terrain.seed + 68) > 0.32) {
      tall.push({ x, y, z, spin, scale: 0.53 + variety ** 1.4 * 1.20,
        color: crown[Math.floor(variety * crown.length)] });
      continue;
    }
    if ((biome === 'ridge' || (slope > 1.25 && y < 3.7)) && rocks.length < 470 && trait < 0.64) {
      rocks.push({ x, y, z, spin, scale: 0.33 + 1.03 * variety ** 1.2,
        color: stone[Math.floor(variety * stone.length)] });
      continue;
    }
    if (y > 1.2 && biome !== 'ridge' && shrubs.length < 890 && trait < 0.69) {
      shrubs.push({ x, y, z, spin, scale: 0.22 + variety * 0.59, color: crown[Math.floor(variety * crown.length)] });
      continue;
    }
    if (herbs.length < 1000 && slope < 2.1) {
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
        object.geometry.dispose();
        if (!Array.isArray(object.material)) materials.add(object.material);
      });
      for (const material of materials) material.dispose();
      ocean.depth.dispose();
    },
  };
}
