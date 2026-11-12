import { clamp, hash, MAP_HALF, Terrain } from '../sim/terrain.ts';
import { creatureName, ROLES } from '../sim/types.ts';
import type { Creature, Frame } from '../sim/types.ts';
import { MATURE_AGE } from '../sim/world.ts';
import type { MapView } from './view.ts';

const palette = {
  sea: [33, 77, 68], shallows: [70, 134, 121], shore: [183, 163, 115], meadow: [110, 137, 75],
  woodland: [73, 108, 67], ridge: [143, 141, 116],
};

export class FlatView implements MapView {
  private readonly canvas = document.createElement('canvas');
  private readonly image = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private current?: Frame;
  private focus: number | null = null;
  private scale = 1;
  private angle = -0.20;
  private hits: { id: number; x: number; y: number }[] = [];

  constructor(private host: HTMLElement, private label: HTMLElement, onSelect: (id: number) => void) {
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', '可交互的平面生态地图');
    host.append(this.canvas);
    let press: { x: number; y: number; angle: number } | undefined;
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      press = { x: event.clientX, y: event.clientY, angle: this.angle };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointermove', event => {
      if (!press || Math.abs(press.x - event.clientX) <= 5) return;
      this.angle = press.angle + (event.clientX - press.x) * 0.007;
      this.draw();
    });
    this.canvas.addEventListener('pointercancel', () => { press = undefined; });
    this.canvas.addEventListener('pointerup', event => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 6) {
        const rect = this.canvas.getBoundingClientRect();
        let range = 19;
        let selection: number | undefined;
        for (const hit of this.hits) {
          const d = Math.hypot(event.clientX - rect.left - hit.x, event.clientY - rect.top - hit.y);
          if (d < range) { range = d; selection = hit.id; }
        }
        if (selection !== undefined) onSelect(selection);
      }
      press = undefined;
    });
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.zoom(Math.exp(clamp(-event.deltaY, -200, 200) * 0.0017));
    }, { passive: false });
    new ResizeObserver(() => this.draw()).observe(host);
  }

  private paint(terrain: Terrain) {
    const size = 380;
    this.image.width = this.image.height = size;
    const ctx = this.image.getContext('2d')!;
    const image = ctx.createImageData(size, size);
    const step = MAP_HALF * 2 / size;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = i * step - MAP_HALF;
        const z = j * step - MAP_HALF;
        const h = terrain.height(x, z);
        const habitat = terrain.habitat(x, z);
        const lit = clamp((h - terrain.height(x - 0.55, z - 0.65)) * -35, -29, 29);
        const sea = habitat === 'sea' ? Math.exp(h * 0.7) * 26 + Math.sin(i * 0.28 + j * 0.39) * 3 : 0;
        const fleck = (hash(i, j, terrain.seed) - 0.5) * (habitat === 'woodland' ? 22 : 9);
        const k = (j * size + i) * 4;
        image.data[k] = palette[habitat][0] + lit + sea + fleck;
        image.data[k + 1] = palette[habitat][1] + lit + sea + fleck;
        image.data[k + 2] = palette[habitat][2] + lit + sea + fleck;
        image.data[k + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  setFrame(frame: Frame) {
    if (frame.seed !== this.current?.seed) this.paint(new Terrain(frame.seed));
    this.current = frame;
    this.draw();
  }

  select(id: number | null) { this.focus = id; this.draw(); }
  zoom(factor: number) { this.scale = clamp(this.scale * factor, 0.7, 4.5); this.draw(); }
  reset() { this.scale = 1; this.angle = -0.20; this.draw(); }

  private draw() {
    if (!this.current) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    const dpi = Math.min(window.devicePixelRatio || 1, 1.5);
    const pixelWidth = Math.round(w * dpi);
    const pixelHeight = Math.round(h * dpi);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
    ctx.fillStyle = '#214d44';
    ctx.fillRect(0, 0, w, h);
    const size = Math.min(w * 0.96, h * 1.35) * this.scale;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const unit = size / (MAP_HALF * 2);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(1, 0.82);
    ctx.rotate(this.angle);
    ctx.drawImage(this.image, -size / 2, -size / 2, size, size);
    ctx.restore();
    this.label.hidden = true;
    this.hits = [];
    for (const creature of this.current.creatures) {
      const x = w / 2 + (creature.x * c - creature.z * s) * unit;
      const y = h / 2 + (creature.x * s + creature.z * c) * unit * 0.82;
      this.hits.push({ id: creature.id, x, y });
      ctx.fillStyle = ROLES[creature.role].color;
      ctx.strokeStyle = creature.form === 'wetland' ? '#b2ebda' : creature.form === 'dryland' ? '#f4cc8f' : '#172d23';
      ctx.lineWidth = creature.form === 'ancestral' ? 1.2 : 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + creature.genes.size * this.scale, 2.4 + this.scale, creature.angle + this.angle, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (this.focus !== creature.id || x < 62 || x > w - 62 || y < 60 || y > h - 25) continue;
      ctx.strokeStyle = '#ffdc89';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
      this.label.hidden = false;
      this.label.textContent = `${creatureName(creature.role, creature.form)} · ${String(creature.id).padStart(3, '0')}`;
      this.label.style.left = `${x}px`;
      this.label.style.top = `${y - 13}px`;
    }
  }
}

export function drawFlatPortrait(host: HTMLElement, creature?: Creature) {
  let canvas = host.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 165;
    canvas.setAttribute('aria-hidden', 'true');
    host.append(canvas);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!creature) return;
  const { role, form, genes, age } = creature;
  const h = genes.hue;
  const accent = ROLES[role].color;
  const ellipse = (x: number, y: number, a: number, b: number, color: string, angle = 0) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, a, b, angle, 0, Math.PI * 2);
    ctx.fill();
  };
  const spike = (x: number, y: number, tipX: number, tipY: number, width: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - width, y);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(x + width, y);
    ctx.closePath();
    ctx.fill();
  };
  const maturity = Math.min(1, age / MATURE_AGE);
  const scale = (0.76 + 0.24 * maturity) * (0.85 + 0.15 * genes.size);
  ctx.save();
  ctx.translate(180, 128);
  ctx.scale(scale * (role === 'stalker' ? 1.14 : 1), scale * (role === 'wader' ? 0.82 : 1));
  ctx.translate(-180, -128);
  ellipse(182, 136, 74, 10, '#101c18a8');
  ellipse(128, 105, 13, 27, `hsl(${h} 28% 34%)`, 0.3);
  ellipse(181, 109, 12, 28, `hsl(${h} 28% 37%)`);
  ellipse(126, 83, 30, 8, `hsl(${h} 31% 48%)`, 0.32);
  ellipse(163, 91, 52, 36, `hsl(${h} 33% 48%)`, -0.04);
  const fin = role === 'grazer' || role === 'wader';
  for (let i = 0; i < 3; i++) {
    const x = 141 + i * 17;
    const height = 17 + genes.crest * 12;
    if (fin) ellipse(x, 57, 8, height, accent, -0.58);
    else spike(x, 64, x - 10, 62 - height, 8, accent);
  }
  if (role === 'wader' || form === 'wetland') {
    ellipse(103, 80, 20, 8, '#66bfae', 0.31);
    ellipse(155, 111, 17, 7, '#87d9ca', -0.42);
  } else if (form === 'dryland') {
    ellipse(150, 81, 16, 9, '#cfa76f', -0.36);
    ellipse(174, 86, 15, 8, '#e1b978', -0.36);
  }
  if (role === 'browser') spike(199, 55, 186, 18, 13, '#ead093');
  if (role === 'stalker') spike(201, 48, 197, 12, 14, '#ad91c4');
  ellipse(202, 69, 36, 33, `hsl(${h} 36% 59%)`, 0.05);
  ellipse(219, 86, 25, 17, `hsl(${h} 35% 65%)`);
  ellipse(223, 63, 9, 11, '#2e3324');
  ellipse(224, 64, 6.3, 8.4, '#e5bb65');
  ellipse(226, 64, 3, 6, '#23241c');
  ellipse(225, 60, 2.2, 2.2, '#fff4c6');
  ellipse(240, 82, 3.5, 2.4, '#354737');
  ctx.restore();
}
