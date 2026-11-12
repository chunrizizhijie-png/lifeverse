import './atlas.css';
import { ATLAS_SIZE, BIOMES, DEFAULT_SEED, MINUTES_PER_TICK } from '../sim/types.ts';
import type { Biome, Command, Frame, MapTile, ParcelSource, Save } from '../sim/types.ts';

const ATLAS_SLOT = ATLAS_SIZE;
const LEGACY_SOURCE = -1;
const LEGACY_KEY = 'lifeverse.save.v1';
const DRAFTS_KEY = 'lifeverse.atlas.layout';
const STORE_NAME = 'worlds';
const DEFAULT_BIOMES: readonly Biome[] = [
  'archipelago', 'highlands', 'tundra',
  'marsh', 'forest', 'grassland',
  'archipelago', 'desert', 'forest',
];
const BIOME_COLORS: Record<Biome, string> = {
  archipelago: '#7caa9e', desert: '#c69b68', forest: '#82a86f', highlands: '#a6a98c',
  marsh: '#75b49d', grassland: '#b6b77b', tundra: '#a5bac6',
};

type Source = 'auto' | 'fresh' | number;
type Draft = MapTile & { source: Source };
interface StoredWorld { slot: number; savedAt: string; world: unknown }

let database: Promise<IDBDatabase> | undefined;

function openStore() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lifeverse-atlas', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'slot' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        database = undefined;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('存档数据库被其他页面占用。'));
  }).catch(error => {
    database = undefined;
    throw error;
  });
}

async function readWorlds() {
  const db = await openStore();
  return new Promise<StoredWorld[]>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as StoredWorld[]);
    request.onerror = () => reject(request.error);
  });
}

async function writeWorld(world: StoredWorld) {
  const db = await openStore();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(world);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function readLegacy(): StoredWorld | undefined {
  try {
    const entry = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null') as Partial<StoredWorld> | null;
    if (entry && typeof entry.savedAt === 'string' && savedWorld(entry.world)) {
      return { slot: 0, savedAt: entry.savedAt, world: entry.world };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function savedWorld(value: unknown): Partial<Save> | undefined {
  if (!value || typeof value !== 'object' || !('seed' in value) || typeof value.seed !== 'number') return undefined;
  return value as Partial<Save>;
}

function isBiome(value: unknown): value is Biome {
  return typeof value === 'string' && Object.hasOwn(BIOMES, value);
}

function validSeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 999999999;
}

function readDrafts(): Draft[] {
  let stored: unknown;
  try {
    stored = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? 'null');
  } catch {
    stored = null;
  }
  return DEFAULT_BIOMES.map((biome, index) => {
    const draft = Array.isArray(stored) ? stored[index] as Partial<Draft> | undefined : undefined;
    const source = draft?.source;
    return {
      biome: isBiome(draft?.biome) ? draft.biome : biome,
      seed: validSeed(draft?.seed) ? draft.seed : DEFAULT_SEED + 113 * index,
      source: source === 'fresh' || (typeof source === 'number' && Number.isInteger(source) && source >= LEGACY_SOURCE && source < ATLAS_SLOT)
        ? source : 'auto',
    };
  });
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function action(text: string, className = 'button') {
  const button = element('button', className, text);
  button.type = 'button';
  return button;
}

function updateText(node: HTMLElement, text: string) {
  if (node.textContent !== text) node.textContent = text;
}

function description(saved: StoredWorld | undefined) {
  const world = savedWorld(saved?.world);
  if (!world) return '';
  const count = world.creatures?.length;
  const day = Math.floor((world.tick ?? 0) * MINUTES_PER_TICK / 1440) + 1;
  return `第 ${day} 天${count === undefined ? '' : ` · ${count} 只生物`}`;
}

export function createAtlas(send: (command: Command) => void, notice: (message: string) => void, onFocus: (index: number) => void) {
  const drafts = readDrafts();
  const worlds = new Map<number, StoredWorld>();
  const legacy = readLegacy();
  if (legacy) worlds.set(0, legacy);
  const pending = new Set<number>();
  let frame: Frame | undefined;
  let selected = 0;
  let activeSlot = 0;
  let loading = false;
  let loaded = false;
  let optionsKey = '';

  const dialog = element('dialog', 'atlas-dialog');
  dialog.setAttribute('aria-labelledby', 'atlas-title');
  const header = element('div', 'atlas-header');
  const heading = element('div');
  const title = element('h2', '', '九区图册');
  title.id = 'atlas-title';
  const current = element('p', 'atlas-muted');
  heading.append(title, current);
  const close = action('关闭');
  close.addEventListener('click', () => dialog.close());
  header.append(heading, close);

  const body = element('div', 'atlas-body');
  const layout = element('section', 'atlas-layout');
  const layoutTitle = element('h3', '', '拼合位置');
  const grid = element('div', 'atlas-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', '九区拼合位置');
  layout.append(layoutTitle, grid, element('p', 'atlas-muted', '选择一个位置，可单独培育、读档或设置它在拼合时的来源。'));
  const cards = drafts.map((_, index) => {
    const button = action('', 'atlas-card');
    button.dataset.atlasSlot = String(index + 1);
    const label = element('span', 'atlas-card-label', `第 ${index + 1} 区`);
    const biome = element('strong');
    const summary = element('span', 'atlas-card-source');
    button.append(label, biome, summary);
    button.addEventListener('click', () => select(index));
    grid.append(button);
    return { button, biome, summary };
  });

  const inspector = element('section', 'atlas-inspector');
  const inspectorTitle = element('h3');
  const focus = action('前往这一区');
  const savedDescription = element('p', 'atlas-muted');
  const sourceLabel = element('label', 'atlas-field', '拼合来源');
  const source = element('select');
  source.setAttribute('aria-label', '拼合来源');
  source.append(new Option('重新生成', 'fresh'));
  sourceLabel.append(source);
  const settings = element('div', 'atlas-fields');
  const biomeLabel = element('label', 'atlas-field', '新建地貌');
  const biome = element('select');
  biome.setAttribute('aria-label', '新建地貌');
  for (const [key, value] of Object.entries(BIOMES)) biome.add(new Option(value.name, key));
  biomeLabel.append(biome);
  const seedLabel = element('label', 'atlas-field', '新建种子');
  const seed = element('input');
  seed.type = 'number';
  seed.inputMode = 'numeric';
  seed.min = '1';
  seed.max = '999999999';
  seed.step = '1';
  seed.setAttribute('aria-label', '新建种子');
  seedLabel.append(seed);
  settings.append(biomeLabel, seedLabel);
  const soloActions = element('div', 'atlas-actions');
  const cultivate = action('新建单区');
  const loadSolo = action('读取本区存档');
  const saveSolo = action('保存当前单区到此');
  const loadLegacy = action('读取旧版单槽存档');
  loadLegacy.hidden = true;
  soloActions.append(cultivate, loadSolo, saveSolo, loadLegacy);
  inspector.append(inspectorTitle, focus, savedDescription, sourceLabel, settings, soloActions);
  body.append(layout, inspector);

  const footer = element('div', 'atlas-footer');
  const status = element('p', 'atlas-status');
  status.setAttribute('role', 'status');
  const joinedActions = element('div', 'atlas-actions');
  const loadAtlas = action('读取拼合世界');
  const saveAtlas = action('保存拼合世界');
  const compose = action('拼合九区', 'button gold-button');
  joinedActions.append(loadAtlas, saveAtlas, compose);
  footer.append(status, joinedActions);
  dialog.append(header, body, footer);
  document.body.append(dialog);

  const isAtlas = () => frame?.tiles.length === ATLAS_SLOT;
  const savedSlot = (index: number) => {
    const origin = drafts[index].source;
    if (origin === 'fresh') return undefined;
    const slot = origin === 'auto' ? index : origin;
    return worlds.has(slot) ? slot : undefined;
  };
  const slotLabel = (slot: number) => slot === LEGACY_SOURCE ? '旧版单槽存档' : `第 ${slot + 1} 区存档`;

  function report(message: string) {
    if (dialog.open) status.textContent = message;
    else notice(message);
  }

  function persistDrafts() {
    try {
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    } catch {
      report('布局将在当前页面保留。浏览器无法保存布局设置。');
    }
  }

  function updateCards() {
    for (const [index, card] of cards.entries()) {
      const slot = savedSlot(index);
      const stored = slot === undefined ? undefined : savedWorld(worlds.get(slot)?.world);
      const tile = stored?.tiles?.[0] ?? (stored ? { biome: 'archipelago' as const } : drafts[index]);
      const tileBiome = isBiome(tile.biome) ? tile.biome : 'archipelago';
      card.button.style.setProperty('--atlas-biome', BIOME_COLORS[tileBiome]);
      card.button.setAttribute('aria-pressed', String(index === selected));
      updateText(card.biome, BIOMES[tileBiome].name);
      const region = isAtlas() ? frame?.regions[index] : undefined;
      const origin = slot === undefined ? '新建' : slotLabel(slot);
      updateText(card.summary, region ? `${origin} · 在世 ${region.population} 只` : origin);
    }
  }

  function updateSourceOptions() {
    const entries = [...worlds.values()].filter(entry => entry.slot < ATLAS_SLOT).sort((a, b) => a.slot - b.slot);
    const key = entries.map(entry => `${entry.slot}:${entry.savedAt}`).join('|');
    if (key !== optionsKey) {
      optionsKey = key;
      const options = entries.map(entry => {
        const tile = savedWorld(entry.world)?.tiles?.[0];
        const name = tile && isBiome(tile.biome) ? BIOMES[tile.biome].name : BIOMES.archipelago.name;
        return new Option(`${slotLabel(entry.slot)} · ${name}`, String(entry.slot));
      });
      source.replaceChildren(new Option('重新生成', 'fresh'), ...options);
    }
    source.value = String(savedSlot(selected) ?? 'fresh');
  }

  function refresh() {
    updateCards();
    const region = isAtlas() ? frame?.regions[selected] : undefined;
    const active = frame?.tiles[0];
    updateText(current, isAtlas()
      ? '当前运行九区拼合世界'
      : active ? `当前运行单区 · ${BIOMES[active.biome].name} · 种子 ${active.seed}` : '正在生成当前世界');
    updateText(inspectorTitle, `第 ${selected + 1} 区`);
    focus.hidden = !region;
    if (region) updateText(focus, `前往 ${BIOMES[region.biome].name} · ${region.population} 只生物`);
    const stored = worlds.get(selected);
    const details = description(stored);
    updateText(savedDescription, details ? `本区存档 · ${details}` : '本区暂无存档');
    updateSourceOptions();
    cultivate.disabled = !frame || !validSeed(drafts[selected].seed);
    loadSolo.disabled = loading || !stored || pending.has(selected);
    loadLegacy.hidden = !worlds.has(LEGACY_SOURCE);
    loadLegacy.disabled = loading;
    saveSolo.disabled = loading || !frame || isAtlas() || pending.has(selected);
    loadAtlas.disabled = loading || !worlds.has(ATLAS_SLOT) || pending.has(ATLAS_SLOT);
    saveAtlas.disabled = loading || !isAtlas() || pending.has(ATLAS_SLOT);
    compose.disabled = loading || !frame || pending.size > 0;
  }

  function select(index: number) {
    selected = index;
    biome.value = drafts[index].biome;
    seed.value = String(drafts[index].seed);
    refresh();
  }

  async function refreshStorage() {
    if (loading || loaded) return;
    loading = true;
    refresh();
    try {
      for (const entry of await readWorlds()) {
        if (Number.isInteger(entry.slot) && entry.slot >= 0 && entry.slot <= ATLAS_SLOT && savedWorld(entry.world)) {
          if (entry.slot === 0 && legacy) worlds.set(LEGACY_SOURCE, { ...legacy, slot: LEGACY_SOURCE });
          worlds.set(entry.slot, entry);
        }
      }
      loaded = true;
    } catch {
      report('当前无法读取九区存档。仍可新建区域并拼合。');
    } finally {
      loading = false;
      refresh();
    }
  }

  source.addEventListener('change', () => {
    drafts[selected].source = source.value === 'fresh' ? 'fresh' : Number(source.value);
    persistDrafts();
    refresh();
  });
  biome.addEventListener('change', () => {
    if (!isBiome(biome.value)) return;
    drafts[selected].biome = biome.value;
    persistDrafts();
    refresh();
  });
  seed.addEventListener('input', () => {
    drafts[selected].seed = seed.valueAsNumber;
    if (validSeed(seed.valueAsNumber)) persistDrafts();
    refresh();
  });

  function save(slot: number) {
    pending.add(slot);
    if (slot < ATLAS_SLOT) activeSlot = slot;
    status.textContent = '正在保存世界…';
    refresh();
    send({ type: 'save', slot });
  }

  function load(slot: number) {
    const stored = worlds.get(slot);
    if (!stored) return;
    if (slot === LEGACY_SOURCE) activeSlot = selected;
    else if (slot < ATLAS_SLOT) activeSlot = slot;
    send({ type: 'load', save: stored.world });
    dialog.close();
  }

  cultivate.addEventListener('click', () => {
    const tile = drafts[selected];
    if (!validSeed(tile.seed)) return;
    activeSlot = selected;
    send({ type: 'new', seed: tile.seed, biome: tile.biome });
    dialog.close();
  });
  loadSolo.addEventListener('click', () => load(selected));
  loadLegacy.addEventListener('click', () => load(LEGACY_SOURCE));
  saveSolo.addEventListener('click', () => save(selected));
  loadAtlas.addEventListener('click', () => load(ATLAS_SLOT));
  saveAtlas.addEventListener('click', () => save(ATLAS_SLOT));
  focus.addEventListener('click', () => {
    onFocus(selected);
    dialog.close();
  });
  compose.addEventListener('click', () => {
    const invalid = drafts.findIndex((draft, index) => savedSlot(index) === undefined && !validSeed(draft.seed));
    if (invalid !== -1) {
      select(invalid);
      report(`第 ${invalid + 1} 区的种子须为 1 至 999999999 的整数。`);
      seed.focus();
      return;
    }
    const sources: ParcelSource[] = drafts.map(({ seed, biome }, index) => {
      const slot = savedSlot(index);
      return slot === undefined ? { seed, biome } : { save: worlds.get(slot)!.world };
    });
    send({ type: 'compose', sources });
    dialog.close();
  });

  select(0);
  return {
    open() {
      if (dialog.open) return;
      status.textContent = '';
      select(isAtlas() ? selected : activeSlot);
      dialog.showModal();
      void refreshStorage();
    },
    receive(next: Frame) {
      frame = next;
      if (dialog.open) refresh();
    },
    async saved(slot: number | undefined, save: Save) {
      const combined = save.tiles.length === ATLAS_SLOT;
      const destination = slot ?? (combined ? ATLAS_SLOT : activeSlot);
      const name = combined ? '拼合世界' : `第 ${destination + 1} 区`;
      try {
        const entry = { slot: destination, savedAt: new Date().toISOString(), world: save };
        await writeWorld(entry);
        if (destination === 0 && legacy) worlds.set(LEGACY_SOURCE, { ...legacy, slot: LEGACY_SOURCE });
        worlds.set(destination, entry);
        report(`已保存${name}。`);
      } catch {
        report(`未能保存${name}。请检查浏览器可用存储空间。`);
      } finally {
        pending.delete(destination);
        if (dialog.open) refresh();
      }
    },
  };
}
