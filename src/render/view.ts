import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { limbForm, wingForm } from '../sim/adaptations.ts';
import { speciesName } from '../sim/evolution.ts';
import { clamp, LAND_HEIGHT, MAP_HALF, Terrain, tileLayoutKey } from '../sim/terrain.ts';
import { ATLAS_SIZE, creatureName, MAX_POPULATION, ROLES } from '../sim/types.ts';
import type { Creature, Frame } from '../sim/types.ts';
import { island } from './landscape.ts';
import { model, modelMaterial, portraitModel, scaleFor, tintFor } from './models.ts';
import { FlatView, drawFlatPortrait } from './flat-view.ts';

export interface MapView {
  setFrame(frame: Frame): void;
  select(id: number | null): void;
  zoom(factor: number): void;
  reset(): void;
  focusRegion(index: number): void;
}

function light(scene: THREE.Scene, shadows = false) {
  scene.add(new THREE.HemisphereLight('#fff2ce', '#6b846b', 1.72));
  const key = new THREE.DirectionalLight('#fff1ca', 2.28);
  key.position.set(-27, 53, 26).multiplyScalar(shadows ? 1.6 : 1);
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(1536, 1536);
    key.shadow.camera.left = -MAP_HALF;
    key.shadow.camera.right = MAP_HALF;
    key.shadow.camera.top = MAP_HALF;
    key.shadow.camera.bottom = -MAP_HALF;
    key.shadow.camera.far = 230;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.19;
  }
  scene.add(key);
  const fill = new THREE.DirectionalLight('#abc3af', 0.66);
  fill.position.set(24, 12, -30);
  scene.add(fill);
}

interface BodyBatch {
  skin: THREE.InstancedMesh;
  detail: THREE.InstancedMesh;
}

class IslandView implements MapView {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.OrthographicCamera(-50, 50, 38, -38, 0.1, 420);
  private readonly controls: OrbitControls;
  private readonly batches = new Map<string, BodyBatch>();
  private readonly dummy = new THREE.Object3D();
  private readonly scratch = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly selectedRing: THREE.Mesh;
  private readonly markers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshBasicMaterial(), MAX_POPULATION * ATLAS_SIZE);
  private readonly poses = new Map<number, { x: number; z: number }>();
  private readonly hits: { id: number; x: number; y: number }[] = [];
  private terrain?: Terrain;
  private landscape?: ReturnType<typeof island>;
  private layout = '';
  private viewScale = 1;
  private frame?: Frame;
  private selected: number | null = null;
  private width = 1;
  private height = 1;

  constructor(private host: HTMLElement, private label: HTMLElement, onSelect: (id: number) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#234b45');
    light(this.scene, true);
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-label', '可旋转的三维生态地图');
    canvas.setAttribute('role', 'img');
    host.append(canvas);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.14;
    this.controls.minZoom = 0.72;
    this.controls.maxZoom = 4.7;
    this.controls.minPolarAngle = 0.24;
    this.controls.maxPolarAngle = 1.29;
    this.controls.rotateSpeed = 0.60;
    this.controls.panSpeed = 0.64;
    this.reset();
    this.selectedRing = new THREE.Mesh(new THREE.RingGeometry(1.38, 1.54, 52).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffdf89', side: THREE.DoubleSide, depthTest: false, toneMapped: false }));
    this.selectedRing.renderOrder = 4;
    this.selectedRing.visible = false;
    this.scene.add(this.selectedRing);
    this.markers.frustumCulled = false;
    this.markers.count = 0;
    this.scene.add(this.markers);

    let press: { x: number; y: number } | undefined;
    canvas.addEventListener('pointerdown', event => {
      press = event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY } : undefined;
    });
    canvas.addEventListener('pointerup', event => {
      if (!press || Math.hypot(press.x - event.clientX, press.y - event.clientY) > 6) return;
      const rect = canvas.getBoundingClientRect();
      let radius = event.pointerType === 'touch' ? 30 : 21;
      let best: number | undefined;
      for (const hit of this.hits) {
        const distance = Math.hypot(hit.x - event.clientX + rect.left, hit.y - event.clientY + rect.top);
        if (distance >= radius) continue;
        radius = distance;
        best = hit.id;
      }
      if (best !== undefined) onSelect(best);
    });
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop((time) => this.draw(time * 0.001));
  }

  private resize() {
    this.width = Math.max(this.host.clientWidth, 1);
    this.height = Math.max(this.host.clientHeight, 1);
    const aspect = this.width / this.height;
    const extent = Math.max(113, 186 / aspect) * this.viewScale;
    this.camera.left = -extent * aspect / 2;
    this.camera.right = extent * aspect / 2;
    this.camera.top = extent / 2;
    this.camera.bottom = -extent / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
  }

  reset() { this.focusRegion(-1); }

  focusRegion(index: number) {
    if (index >= 0 && (!this.terrain || index >= this.terrain.tiles.length)) return;
    const center = index >= 0 ? this.terrain!.tileCenter(index) : { x: 0, z: 0 };
    const distance = index < 0 ? this.viewScale : 1;
    this.camera.position.set(center.x + 112 * distance, 106 * distance, center.z + 141 * distance);
    this.camera.zoom = index < 0 ? 1 : this.viewScale;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(center.x, 4.4, center.z + 1.2);
    this.controls.update();
  }

  zoom(factor: number) {
    this.camera.zoom = clamp(this.camera.zoom * factor, this.controls.minZoom, this.controls.maxZoom);
    this.camera.updateProjectionMatrix();
  }

  select(id: number | null) { this.selected = id; }

  setFrame(frame: Frame) {
    const layout = `${frame.seed}|${tileLayoutKey(frame.tiles)}`;
    if (this.layout !== layout) {
      if (this.landscape) {
        this.scene.remove(this.landscape.group);
        this.landscape.dispose();
      }
      for (const { skin, detail } of this.batches.values()) {
        this.scene.remove(skin, detail);
        skin.dispose();
        detail.dispose();
      }
      this.batches.clear();
      this.layout = layout;
      this.terrain = new Terrain(frame.seed, frame.tiles);
      this.viewScale = frame.tiles.length === 1 ? 1 : 4.55;
      this.camera.far = frame.tiles.length === 1 ? 420 : 2400;
      this.controls.maxZoom = this.viewScale * 4.7;
      this.renderer.shadowMap.enabled = frame.tiles.length === 1;
      this.landscape = island(this.terrain);
      this.scene.add(this.landscape.group);
      this.poses.clear();
      this.resize();
      this.reset();
    }
    if (this.frame && this.frame.tick > frame.tick) this.poses.clear();
    if (this.poses.size > frame.creatures.length + 40) {
      const living = new Set(frame.creatures.map(c => c.id));
      for (const id of this.poses.keys()) if (!living.has(id)) this.poses.delete(id);
    }
    this.frame = frame;
  }

  private project(x: number, y: number, z: number) {
    this.scratch.set(x, y, z).project(this.camera);
    return { x: (this.scratch.x + 1) * this.width / 2, y: (1 - this.scratch.y) * this.height / 2 };
  }

  private batchFor(creature: Creature) {
    const tall = creature.genes.crest > 0.49;
    const limb = limbForm(creature.genes.aquatic);
    const wing = wingForm(creature.genes.aerial);
    const key = `${creature.role}/${tall}/${creature.form}/${limb}/${wing}`;
    const existing = this.batches.get(key);
    if (existing) return existing;

    const parts = model(creature.role, tall, creature.form, limb, wing);
    const limit = MAX_POPULATION * (this.terrain?.tiles.length ?? 1);
    const skin = new THREE.InstancedMesh(parts.skin, modelMaterial(), limit);
    const detail = new THREE.InstancedMesh(parts.detail, modelMaterial(), limit);
    skin.frustumCulled = detail.frustumCulled = false;
    skin.count = detail.count = 0;
    skin.castShadow = true;
    this.scene.add(skin, detail);
    const batch = { skin, detail };
    this.batches.set(key, batch);
    return batch;
  }

  private draw(time: number) {
    const frame = this.frame;
    const terrain = this.terrain;
    if (!frame || !terrain || this.host.clientWidth === 0 || document.querySelector('dialog[open]')) return;
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.landscape?.animate(time);
    this.hits.length = 0;
    this.selectedRing.visible = false;
    this.label.hidden = true;
    this.markers.count = 0;
    const overview = this.viewScale > 1 && this.camera.zoom < this.viewScale * 0.63;
    for (const { skin, detail } of this.batches.values()) skin.count = detail.count = 0;
    for (const c of frame.creatures) {
      const pose = this.poses.get(c.id) ?? { x: c.x, z: c.z };
      const dx = c.x - pose.x;
      const dz = c.z - pose.z;
      const blend = dx * dx + dz * dz > 1600 ? 1 : 0.16;
      pose.x += dx * blend;
      pose.z += dz * blend;
      this.poses.set(c.id, pose);
      const ground = terrain.height(pose.x, pose.z);
      const flying = wingForm(c.genes.aerial) === 'flyer';
      const height = Math.max(0.04, ground) + (flying ? ground < LAND_HEIGHT ? 3.8 : 1.15 : 0);
      const scale = scaleFor(c);
      const hit = this.project(pose.x, height + 0.68 * scale, pose.z);
      if (hit.x < -30 || hit.y < -30 || hit.x > this.width + 30 || hit.y > this.height + 30) continue;
      if (overview && c.id !== this.selected) {
        const index = this.markers.count++;
        this.dummy.position.set(pose.x, height + 1.12, pose.z);
        this.dummy.scale.setScalar(1.15 + scale * 0.65);
        this.dummy.updateMatrix();
        this.markers.setMatrixAt(index, this.dummy.matrix);
        this.markers.setColorAt(index, this.color.set(ROLES[c.role].color));
      } else {
        const batch = this.batchFor(c);
        const index = batch.skin.count++;
        batch.detail.count++;
        const bob = frame.playing ? Math.sin(time * 9 + c.id * 2.3) * (flying ? 0.21 : 0.055) : 0;
        this.dummy.position.set(pose.x, height + bob, pose.z);
        this.dummy.rotation.set(0, Math.PI / 2 - c.angle, 0);
        this.dummy.scale.set(scale, scale, scale * (1 + (c.genes.speed - 1) * 0.20));
        this.dummy.updateMatrix();
        batch.skin.setMatrixAt(index, this.dummy.matrix);
        batch.detail.setMatrixAt(index, this.dummy.matrix);
        batch.skin.setColorAt(index, tintFor(c, this.color));
      }
      this.hits.push({ id: c.id, ...hit });
      if (c.id !== this.selected) continue;
      this.selectedRing.visible = true;
      this.selectedRing.position.set(pose.x, height + 0.14, pose.z);
      this.selectedRing.scale.setScalar(Math.max(0.84, scale));
      const point = this.project(pose.x, height + 2.1 * scale, pose.z);
      if (point.x > 64 && point.x < this.width - 64 && point.y > 54 && point.y < this.height - 26) {
        this.label.hidden = false;
        const branch = frame.species.find(species => species.id === c.species);
        const name = branch && branch.parent !== null ? speciesName(branch) : creatureName(c.role, c.form);
        const label = `${name} · ${String(c.id).padStart(3, '0')}`;
        if (this.label.textContent !== label) this.label.textContent = label;
        this.label.style.left = `${point.x}px`;
        this.label.style.top = `${point.y}px`;
      }
    }
    for (const { skin, detail } of this.batches.values()) {
      if (!skin.count) continue;
      skin.instanceMatrix.needsUpdate = detail.instanceMatrix.needsUpdate = true;
      if (skin.instanceColor) skin.instanceColor.needsUpdate = true;
    }
    if (this.markers.count) {
      this.markers.instanceMatrix.needsUpdate = true;
      if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
  }
}

export function createMap(host: HTMLElement, label: HTMLElement, onSelect: (id: number) => void): MapView {
  try {
    return new IslandView(host, label, onSelect);
  } catch (error) {
    console.warn('三维视图不可用，已加载平面视图。', error);
    host.replaceChildren();
    host.dataset.renderer = 'flat';
    return new FlatView(host, label, onSelect);
  }
}

export function createPortrait(host: HTMLElement) {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    return (creature?: Creature) => drawFlatPortrait(host, creature);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  light(scene);
  const camera = new THREE.OrthographicCamera(-2.5, 2.5, 1.25, -1.25, 0.1, 50);
  camera.position.set(3.5, 2.6, 5.6);
  camera.lookAt(0, 0.85, 0);
  let animal: THREE.Group | undefined;
  const draw = () => {
    if (!host.clientWidth || !host.clientHeight) return;
    const aspect = host.clientWidth / host.clientHeight;
    camera.left = -1.23 * aspect;
    camera.right = 1.23 * aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.render(scene, camera);
  };
  new ResizeObserver(draw).observe(host);
  return (creature?: Creature) => {
    if (animal) scene.remove(animal);
    animal = creature ? portraitModel(creature) : undefined;
    if (animal) scene.add(animal);
    draw();
  };
}
