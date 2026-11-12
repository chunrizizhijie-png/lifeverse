import './style.css';
import { createMap, createPortrait } from './render/view.ts';
import { LIMBS, WINGS, limbForm, limbSpeed, wingForm } from './sim/adaptations.ts';
import { nicheFor, nicheName, speciesName } from './sim/evolution.ts';
import { BIOMES, creatureName, DEFAULT_SEED, FORM_NAMES, INITIAL_CLIMATE, MINUTES_PER_TICK, populationCounts, ROLE_KEYS, ROLES } from './sim/types.ts';
import type { Command, Creature, Frame, Gift, ObservedCreature, Record as LineageRecord, Species, Speed, WorkerReply } from './sim/types.ts';
import { MATURE_AGE, validSeed } from './sim/world.ts';
import { createAtlas } from './ui/atlas.ts';
import { makeChart } from './ui/chart.ts';
import { createEvolution } from './ui/evolution.ts';

const element = <T extends HTMLElement = HTMLElement>(id: string) => {
  const match = document.getElementById(id);
  if (!match) throw new Error(`缺少页面元素 ${id}`);
  return match as T;
};
const update = (id: string, text: string) => {
  const target = element(id);
  if (target.textContent !== text) target.textContent = text;
};
const labelId = (id: number) => `#${String(id).padStart(3, '0')}`;
const generationLabel = (generation: number) => generation === 1 ? '第 1 代（初代）' : `第 ${generation} 代`;
const percent = (value: number) => `${Math.round(value)}%`;
const showSeed = (seed: number) => String(seed).padStart(6, '0');
const fmt = new Intl.NumberFormat('zh-CN');
const timeLabel = (tick: number) => {
  const minutes = tick * MINUTES_PER_TICK;
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `第 ${Math.floor(minutes / 1440) + 1} 天 · ${hh}:${mm}`;
};

const mapHost = element('map-surface');
const picker = element<HTMLSelectElement>('creature-picker');
const play = element<HTMLButtonElement>('play');
const step = element<HTMLButtonElement>('step');
const gifts = [...document.querySelectorAll<HTMLButtonElement>('[data-gift]')];
const track = element<HTMLButtonElement>('track');
const trackFromLineage = element<HTMLButtonElement>('track-from-lineage');
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-speed]')];
const temperature = element<HTMLInputElement>('set-temperature');
const rain = element<HTMLInputElement>('set-rain');
const lineagePicker = element<HTMLSelectElement>('lineage-picker');
const toast = element('toast');
const giftResult = element('gift-result');
const localClimate = element('local-climate');
const map = createMap(mapHost, element('selection-label'), id => choose(id, true));
const drawPortrait = createPortrait(element('portrait'));
const drawChart = makeChart(element<HTMLCanvasElement>('population-chart'));
const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
const send = (command: Command) => worker.postMessage(command);
const atlas = createAtlas(send, notice, focusRegion);
const evolution = createEvolution(element('evolution-content'), send, id => choose(id));

const populationLegend = element('population-legend');
const foodWeb = element('food-web-list');
for (const role of ROLE_KEYS) {
  const { name, diet, color } = ROLES[role];
  const item = document.createElement('span');
  const count = document.createElement('b');
  count.id = `${role}-count`;
  count.textContent = '—';
  item.style.setProperty('--role-color', color);
  item.append(`${name} `, count);
  populationLegend.append(item);
  const food = document.createElement('li');
  const species = document.createElement('strong');
  species.textContent = name;
  food.append(species, diet);
  foodWeb.append(food);
}

let frame: Frame | undefined;
let currentEpoch = -1;
let activeRegion = 0;
let species = new Map<number, Species>();
let selected: number | null = null;
let manuallySelected = false;
let pickerKey = '';
let portraitKey = '';
let lineageKey = '';
let lineagePickerKey = '';
let comparedRecord: number | null = null;
let comparedRoot: number | null = null;
let noticeTimer = 0;
let lastGift: { id: number; message: string } | null = null;
const current = () => frame?.creatures.find(c => c.id === selected);
const individualName = (creature: Creature) => {
  const branch = species.get(creature.species);
  return branch && branch.parent !== null ? speciesName(branch) : creatureName(creature.role, creature.form);
};

function notice(message: string) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
}

const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
function showTab(tab: string) {
  for (const button of tabs) {
    const active = button.id === `${tab}-tab`;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    element(button.getAttribute('aria-controls')!).hidden = !active;
  }
  if (tab === 'evolution' && frame) evolution.receive(frame, selected, activeRegion);
}

function choose(id: number, openPanel = false) {
  selected = id;
  manuallySelected = true;
  if (openPanel) showTab('individual');
  refreshIndividual();
  if (frame) evolution.receive(frame, selected, activeRegion);
}

function refreshPicker(creatures: ObservedCreature[]) {
  const local = creatures.filter(c => c.region === activeRegion || c.id === selected);
  const missing = selected !== null && !local.some(c => c.id === selected);
  const key = `${local.map(c => `${c.id}:${c.species}:${c.form}:${c.age < MATURE_AGE}`).join(',')}|${missing ? selected : ''}`;
  if (key !== pickerKey) {
    const options = local.map(c => new Option(
      `${labelId(c.id)} · ${individualName(c)}${c.age < MATURE_AGE ? ' · 幼体' : ''}`, String(c.id)));
    if (missing) options.unshift(new Option(`${labelId(selected!)} · 已死亡`, String(selected)));
    picker.replaceChildren(...(options.length ? options : [new Option('—', '')]));
    pickerKey = key;
  }
  picker.disabled = !local.length;
  if (selected !== null) picker.value = String(selected);
  update('picker-value', selected === null ? '—' : labelId(selected));
}

function setMeter(name: string, value: number | undefined) {
  element<HTMLProgressElement>(name).value = value ?? 0;
  update(`${name}-value`, value === undefined ? '—' : percent(value));
}

function refreshGiftResult() {
  const result = lastGift?.id === selected ? lastGift.message : '';
  update('gift-result', result);
  giftResult.hidden = !result;
}

function refreshIndividual() {
  const creature = current();
  const dead = !creature && selected !== null;
  const root = creature && frame?.bloodline?.root === creature.id;
  update('creature-name', creature ? individualName(creature) : dead ? `个体 ${labelId(selected!)}` : '等待观测');
  update('creature-meta', creature
    ? `${generationLabel(creature.generation)} · ${creature.age < MATURE_AGE ? '幼体' : '成年'} · ${ROLES[creature.role].diet}`
      + (frame!.tiles.length > 1 ? ` · 第 ${creature.region + 1} 区` : '')
    : dead ? '已离开世界' : '选择地图上的个体');
  element('portrait-empty').hidden = !!creature;
  update('portrait-empty', dead ? '该个体已离开世界' : '暂无在世个体');
  const maturity = creature ? Math.min(100, creature.age / MATURE_AGE * 100) : undefined;
  const imageKey = creature
    ? [creature.id, creature.role, creature.form, creature.genes.hue, creature.genes.crest, creature.genes.size,
      creature.genes.speed, creature.genes.aquatic, creature.genes.aerial, Math.floor(maturity! / 10)].join('|')
    : '-';
  if (imageKey !== portraitKey) {
    drawPortrait(creature);
    portraitKey = imageKey;
  }
  setMeter('energy', creature?.energy);
  setMeter('maturity', maturity);
  update('trait-size', creature ? `${creature.genes.size.toFixed(2)}×` : '—');
  update('trait-speed', creature ? `${creature.genes.speed.toFixed(2)}×` : '—');
  update('trait-comfort', creature ? `${creature.genes.comfort.toFixed(1)}°C` : '—');
  update('trait-moisture', creature ? percent(creature.genes.moisture) : '—');
  const genes = creature?.genes;
  const wing = genes && WINGS[wingForm(genes.aerial)];
  update('trait-limb', genes ? LIMBS[limbForm(genes.aquatic)].name : '—');
  update('trait-wing', wing ? wing.name : '—');
  element('movement-note').hidden = !genes;
  if (genes && wing) update('movement-note', `${limbSpeed(genes)} · ${wing.ability}`);
  localClimate.hidden = !creature;
  if (creature) update('local-climate', `遗传倾向 ${nicheName(nicheFor(creature.genes))} · 当地湿度 ${percent(creature.localMoisture)} · 气候耗能 ${creature.stress.toFixed(2)} / 步`);
  for (const button of gifts) {
    button.disabled = !creature
      || (button.dataset.gift === 'grow' && creature.age >= MATURE_AGE)
      || (button.dataset.gift === 'restore' && creature.energy >= 100);
  }
  refreshGiftResult();
  update('track', root ? '◇ 查看血脉' : '◇ 追踪血脉');
  track.disabled = trackFromLineage.disabled = !creature;
  update('track-from-lineage', creature ? `追踪 ${labelId(creature.id)}` : '追踪当前个体');
  map.select(selected);
  refreshPicker(frame?.creatures ?? []);
}

function compareLineage(next: Frame) {
  const root = next.bloodline?.root;
  const ancestor = next.branch.find(record => record.id === root);
  const descendant = next.branch.find(record => record.id === comparedRecord)
    ?? next.branch.reduce<LineageRecord | undefined>((best, record) => {
      if (record.id === root || !record.genes) return best;
      return !best || record.generation >= best.generation ? record : best;
    }, undefined);
  const describe = (record?: LineageRecord) => {
    if (!record) return '—';
    const { genes } = record;
    const label = `${labelId(record.id)} · 第 ${record.generation} 代`;
    return genes
      ? `${label}\n${LIMBS[limbForm(genes.aquatic)].name} · ${WINGS[wingForm(genes.aerial)].name}\n${limbSpeed(genes)}`
      : `${label}\n旧档案未记录遗传形态`;
  };
  update('lineage-ancestor', describe(ancestor));
  update('lineage-descendant', describe(descendant));
}

function refreshLineage(next: Frame) {
  const bloodline = next.bloodline;
  element('lineage-data').hidden = !bloodline;
  const pickerKey = next.lineages.map(line => `${line.root}:${line.living}`).join(',');
  if (pickerKey !== lineagePickerKey) {
    lineagePicker.replaceChildren(...next.lineages.map(line => new Option(
      `${ROLES[line.role].name} ${labelId(line.root)} · ${line.living} 在世后代`, String(line.root),
    )));
    lineagePickerKey = pickerKey;
  }
  if (bloodline) lineagePicker.value = String(bloodline.root);
  const founder = bloodline && next.branch.find(record => record.id === bloodline.root);
  update('lineage-summary', bloodline
    ? `${ROLES[bloodline.role].name} ${labelId(bloodline.root)} · 创始个体${founder?.died === null ? '在世' : '已死亡'}`
      + (bloodline.living ? `，仍有 ${bloodline.living} 只在世后代` : bloodline.archive ? '，已保留遗传档案' : '')
    : '选择一个在世个体，追踪它的后代。');
  if (!bloodline) { lineageKey = ''; return; }
  update('descendants', fmt.format(bloodline.total));
  update('descendants-alive', fmt.format(bloodline.living));
  update('descendants-generation', `第 ${bloodline.generation} 代`);
  if (comparedRoot !== bloodline.root) {
    comparedRoot = bloodline.root;
    comparedRecord = null;
  }
  compareLineage(next);
  const key = `${bloodline.root}|${next.branch.map(record => `${record.id}:${record.died}:${record.species}`).join(',')}`;
  if (key === lineageKey) return;
  lineageKey = key;
  const rows = next.branch.map(record => {
    const row = document.createElement('li');
    const select = document.createElement('button');
    select.type = 'button';
    select.textContent = record.id === bloodline.root ? `${labelId(record.id)} · 神选者`
      : `${labelId(record.id)} · 来自 ${labelId(record.parent!)}`;
    select.addEventListener('click', () => {
      comparedRecord = record.id === bloodline.root ? null : record.id;
      if (record.died === null) choose(record.id);
      if (frame) compareLineage(frame);
    });
    const info = document.createElement('span');
    const branch = species.get(record.species);
    const form = record.genes
      ? `${LIMBS[limbForm(record.genes.aquatic)].short} · ${WINGS[wingForm(record.genes.aerial)].short}`
      : FORM_NAMES[record.form];
    info.textContent = `${form} · 第 ${record.generation} 代 · ${record.died === null ? '在世' : '已死亡'}`;
    if (branch) info.title = speciesName(branch);
    row.append(select, info);
    return row;
  });
  element('lineage-list').replaceChildren(...rows);
}

function focusRegion(index: number) {
  if (!frame) return;
  if (index === -1) {
    map.focusRegion(-1);
    return;
  }
  if (!frame.regions[index]) return;
  activeRegion = index;
  map.focusRegion(index);
  refreshClimate(frame);
  refreshIndividual();
  evolution.receive(frame, selected, activeRegion);
}

function refreshClimate(next: Frame) {
  const region = next.regions[activeRegion] ?? next.regions[0];
  update('temperature', `${region.climate.temperature}°C`);
  update('world-seed', next.tiles.length > 1 ? `第 ${activeRegion + 1} 区 · ${BIOMES[region.biome].name}` : `种子 ${showSeed(next.seed)}`);
  update('climate-region', next.tiles.length > 1 ? `第 ${activeRegion + 1} 区 · ${BIOMES[region.biome].name}` : BIOMES[region.biome].name);
  if (document.activeElement !== temperature) {
    temperature.value = String(region.climate.temperature);
    update('set-temperature-value', `${temperature.value}°C`);
  }
  if (document.activeElement !== rain) {
    rain.value = String(region.climate.rain);
    update('set-rain-value', `${rain.value}%`);
  }
  update('rain-trend', percent(region.rainTrend));
}

function refresh(next: Frame, epoch: number) {
  if (currentEpoch !== epoch) {
    comparedRoot = comparedRecord = null;
    currentEpoch = epoch;
    activeRegion = 0;
    selected = next.creatures[0]?.id ?? null;
    manuallySelected = false;
    portraitKey = '';
    lastGift = null;
  }
  if (!manuallySelected && !next.creatures.some(c => c.id === selected)) selected = next.creatures[0]?.id ?? null;
  frame = next;
  species = new Map(next.species.map(branch => [branch.id, branch]));
  map.setFrame(next);
  atlas.receive(next);
  evolution.receive(next, selected, activeRegion);
  refreshIndividual();
  refreshLineage(next);
  update('world-name', next.tiles.length > 1 ? '九区生态世界' : BIOMES[next.tiles[0].biome].name);
  update('world-time', timeLabel(next.tick));
  update('map-status', mapHost.dataset.renderer === 'flat' ? '生态视图 · 平面' : '生态视图');
  update('run-status', next.playing ? '演化中' : '已暂停');
  element('run-dot').classList.toggle('paused', !next.playing);
  element('map-status-dot').classList.toggle('paused', !next.playing);
  play.querySelector('.play-glyph')?.classList.toggle('is-playing', next.playing);
  play.setAttribute('aria-label', next.playing ? '暂停模拟' : '继续模拟');
  step.disabled = next.playing;
  for (const button of speedButtons) button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === next.speed));
  refreshClimate(next);
  const counts = populationCounts(next.creatures);
  update('living', fmt.format(next.creatures.length));
  update('births', fmt.format(next.births));
  update('deaths', fmt.format(next.deaths));
  for (const role of ROLE_KEYS) update(`${role}-count`, fmt.format(counts[role]));
  update('wetland-count', fmt.format(next.creatures.filter(c => c.form === 'wetland').length));
  update('dryland-count', fmt.format(next.creatures.filter(c => c.form === 'dryland').length));
  const limbs = { foot: 0, webbed: 0, fin: 0 };
  const wings = { wingless: 0, glider: 0, flyer: 0 };
  for (const creature of next.creatures) {
    limbs[limbForm(creature.genes.aquatic)]++;
    wings[wingForm(creature.genes.aerial)]++;
  }
  for (const limb of Object.keys(limbs) as (keyof typeof limbs)[]) update(`${limb}-count`, fmt.format(limbs[limb]));
  update('glider-count', fmt.format(wings.glider));
  update('flyer-count', fmt.format(wings.flyer));
  update('population-period', next.census[0]?.tick ? '最近记录' : '自世界生成');
  drawChart(next.census, { tick: next.tick, ...counts });
}

worker.onmessage = (event: MessageEvent<WorkerReply>) => {
  const data = event.data;
  if (data.type === 'frame') refresh(data.frame, data.epoch);
  if (data.type === 'notice') {
    if (data.intervention) evolution.feedback(data.message);
    if (data.giftId === undefined) notice(data.message);
    else {
      lastGift = { id: data.giftId, message: data.message };
      refreshGiftResult();
    }
  }
  if (data.type === 'saved') void atlas.saved(data.slot, data.save);
};
worker.addEventListener('error', () => {
  update('map-status', '模拟加载失败');
  update('run-status', '未运行');
  notice('模拟无法运行，请重新载入页面。');
});

function togglePlay() {
  if (frame) send({ type: 'play', playing: !frame.playing });
}

function trackCurrent() {
  const creature = current();
  if (!creature) return;
  if (frame?.bloodline?.root !== creature.id) send({ type: 'track', id: creature.id });
  showTab('lineage');
}

for (const [index, button] of tabs.entries()) {
  const activate = (target: HTMLButtonElement) => showTab(target.id.replace(/-tab$/, ''));
  button.addEventListener('click', () => activate(button));
  button.addEventListener('keydown', event => {
    const at = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (at === undefined) return;
    event.preventDefault();
    activate(tabs[at]);
    tabs[at].focus();
  });
}
picker.addEventListener('change', () => choose(Number(picker.value)));
play.addEventListener('click', togglePlay);
step.addEventListener('click', () => send({ type: 'step' }));
for (const button of speedButtons) button.addEventListener('click', () => send({ type: 'speed', speed: Number(button.dataset.speed) as Speed }));
element('zoom-in').addEventListener('click', () => map.zoom(1.25));
element('zoom-out').addEventListener('click', () => map.zoom(0.80));
element('reset-view').addEventListener('click', () => map.reset());
track.addEventListener('click', trackCurrent);
trackFromLineage.addEventListener('click', trackCurrent);
lineagePicker.addEventListener('change', () => send({ type: 'track', id: Number(lineagePicker.value) }));
element('breed-lineage').addEventListener('click', () => {
  showTab('evolution');
  evolution.showLineage();
});
element('atlas-open').addEventListener('click', atlas.open);
for (const button of gifts) button.addEventListener('click', () => {
  if (selected !== null) send({ type: 'gift', id: selected, gift: button.dataset.gift as Gift });
});
temperature.addEventListener('input', () => update('set-temperature-value', `${temperature.value}°C`));
temperature.addEventListener('change', () => send({ type: 'climate', region: activeRegion, climate: { temperature: temperature.valueAsNumber } }));
rain.addEventListener('input', () => update('set-rain-value', `${rain.value}%`));
rain.addEventListener('change', () => send({ type: 'climate', region: activeRegion, climate: { rain: rain.valueAsNumber } }));
element('reset-climate').addEventListener('click', () => {
  const biome = frame?.tiles[activeRegion]?.biome;
  send({ type: 'climate', region: activeRegion, climate: biome ? { ...BIOMES[biome].climate } : { ...INITIAL_CLIMATE } });
});
const newDialog = element<HTMLDialogElement>('new-dialog');
const seedInput = element<HTMLInputElement>('seed-input');
element('new-world').addEventListener('click', () => {
  seedInput.value = String(frame?.seed ?? DEFAULT_SEED);
  newDialog.showModal();
  seedInput.select();
});
element('cancel-new').addEventListener('click', () => newDialog.close());
element('random-seed').addEventListener('click', () => {
  seedInput.value = String(1 + crypto.getRandomValues(new Uint32Array(1))[0] % 999999999);
});
element('new-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!validSeed(seedInput.valueAsNumber)) return;
  newDialog.close();
  frame = undefined;
  showTab('individual');
  send({ type: 'new', seed: seedInput.valueAsNumber });
});
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || document.querySelector('dialog[open]') || (event.target as HTMLElement).closest('input,button,select,summary,a,textarea')) return;
  event.preventDefault();
  togglePlay();
});
