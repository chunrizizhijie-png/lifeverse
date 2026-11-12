import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp, MAP_HALF, Terrain } from '../sim/terrain.ts';
import { creatureName, MAX_POPULATION } from '../sim/types.ts';
import type { Creature, Frame } from '../sim/types.ts';
import { island } from './landscape.ts';
import { model, modelMaterial, portraitModel, scaleFor, tintFor } from './models.ts';
import { FlatView, drawFlatPortrait } from './flat-view.ts';

export interface MapView {
  setFrame(frame: Frame): void;
  select(id: number | null): void;
  zoom(factor: number): void;
  reset(): void;
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

const tag = (creature: Creature) => `${creatureName(creature.role, creature.form)} · ${String(creature.id).padStart(3, '0')}`;

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
  private readonly poses = new Map<number, { x: number; z: number }>();
  private readonly hits: { id: number; x: number; y: number }[] = [];
  private terrain?: Terrain;
  private landscape?: ReturnType<typeof island>;
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
    const extent = Math.max(113, 186 / aspect);
    this.camera.left = -extent * aspect / 2;
    this.camera.right = extent * aspect / 2;
    this.camera.top = extent / 2;
    this.camera.bottom = -extent / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
  }

  reset() {
    this.camera.position.set(112, 106, 141);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 4.4, 1.2);
    this.controls.update();
  }

  zoom(factor: number) {
    this.camera.zoom = clamp(this.camera.zoom * factor, this.controls.minZoom, this.controls.maxZoom);
    this.camera.updateProjectionMatrix();
  }

  select(id: number | null) { this.selected = id; }

  setFrame(frame: Frame) {
    if (this.terrain?.seed !== frame.seed) {
      if (this.landscape) {
        this.scene.remove(this.landscape.group);
        this.landscape.dispose();
      }
      this.terrain = new Terrain(frame.seed);
      this.landscape = island(this.terrain);
      this.scene.add(this.landscape.group);
      this.poses.clear();
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
    const key = `${creature.role}/${tall}/${creature.form}`;
    const existing = this.batches.get(key);
    if (existing) return existing;

    const parts = model(creature.role, tall, creature.form);
    const skin = new THREE.InstancedMesh(parts.skin, modelMaterial(), MAX_POPULATION);
    const detail = new THREE.InstancedMesh(parts.detail, modelMaterial(), MAX_POPULATION);
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
    if (!frame || !terrain || this.host.clientWidth === 0) return;
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.landscape?.animate(time);
    this.hits.length = 0;
    this.selectedRing.visible = false;
    this.label.hidden = true;
    for (const { skin, detail } of this.batches.values()) skin.count = detail.count = 0;
    for (const c of frame.creatures) {
      const pose = this.poses.get(c.id) ?? { x: c.x, z: c.z };
      pose.x += (c.x - pose.x) * 0.16;
      pose.z += (c.z - pose.z) * 0.16;
      this.poses.set(c.id, pose);
      const height = Math.max(0.04, terrain.height(pose.x, pose.z));
      const scale = scaleFor(c);
      const batch = this.batchFor(c);
      const index = batch.skin.count++;
      batch.detail.count++;
      const bob = frame.playing ? Math.sin(time * 9 + c.id * 2.3) * 0.055 : 0;
      this.dummy.position.set(pose.x, height + bob, pose.z);
      this.dummy.rotation.set(0, Math.PI / 2 - c.angle, 0);
      this.dummy.scale.set(scale, scale, scale * (1 + (c.genes.speed - 1) * 0.20));
      this.dummy.updateMatrix();
      batch.skin.setMatrixAt(index, this.dummy.matrix);
      batch.detail.setMatrixAt(index, this.dummy.matrix);
      batch.skin.setColorAt(index, tintFor(c, this.color));
      const hit = this.project(pose.x, height + 0.68 * scale, pose.z);
      this.hits.push({ id: c.id, ...hit });
      if (c.id !== this.selected) continue;
      this.selectedRing.visible = true;
      this.selectedRing.position.set(pose.x, height + 0.14, pose.z);
      this.selectedRing.scale.setScalar(Math.max(0.84, scale));
      const point = this.project(pose.x, height + 2.1 * scale, pose.z);
      if (point.x > 64 && point.x < this.width - 64 && point.y > 54 && point.y < this.height - 26) {
        this.label.hidden = false;
        if (this.label.textContent !== tag(c)) this.label.textContent = tag(c);
        this.label.style.left = `${point.x}px`;
        this.label.style.top = `${point.y}px`;
      }
    }
    for (const { skin, detail } of this.batches.values()) {
      if (!skin.count) continue;
      skin.instanceMatrix.needsUpdate = detail.instanceMatrix.needsUpdate = true;
      if (skin.instanceColor) skin.instanceColor.needsUpdate = true;
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
