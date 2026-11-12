import './style.css';
import { createMap, createPortrait } from './render/view.ts';
import { DEFAULT_SEED, describeCapabilities, INITIAL_CLIMATE, LIMBS, limbForm, MINUTES_PER_TICK, ROLES } from './sim/types.ts';
import type { Command, Creature, Frame, Gift, Record as LineageRecord, Save, Speed, WorkerReply } from './sim/types.ts';
import { MATURE_AGE, validSeed } from './sim/world.ts';
import { makeChart } from './ui/chart.ts';

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
const showSeed = (seed: number) => String(seed).padStart(6, '0');
const worldName = (seed: number) => seed === DEFAULT_SEED ? '苔湾群岛' : `群岛 ${showSeed(seed)}`;
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
const saveMenu = element<HTMLDetailsElement>('save-menu');
const saveButton = element<HTMLButtonElement>('save-world');
const loadButton = element<HTMLButtonElement>('load-world');
const toast = element('toast');
const map = createMap(mapHost, element('selection-label'), id => choose(id, true));
const drawPortrait = createPortrait(element('portrait'));
const drawChart = makeChart(element<HTMLCanvasElement>('population-chart'));
const worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
const send = (command: Command) => worker.postMessage(command);
const saveKey = 'lifeverse.save.v1';

let frame: Frame | undefined;
let selected: number | null = null;
let comparedDescendantId: number | null = null;
let manuallySelected = false;
let pickerKey = '';
let portraitKey = '';
let lineageKey = '';
let noticeTimer = 0;
const current = () => frame?.creatures.find(c => c.id === selected);

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
}

function choose(id: number, openPanel = false) {
  selected = id;
  manuallySelected = true;
  if (openPanel) showTab('individual');
  refreshIndividual();
}

function refreshPicker(creatures: Creature[]) {
  const missing = selected !== null && !creatures.some(c => c.id === selected);
  const key = `${creatures.map(c => `${c.id}:${limbForm(c.genes.aquatic)}`).join(',')}|${missing ? selected : ''}`;
  if (key !== pickerKey) {
    const options = creatures.map(c => {
      const limb = LIMBS[limbForm(c.genes.aquatic)].short;
      return new Option(`${labelId(c.id)} · ${ROLES[c.role].name} [${limb}]`, String(c.id));
    });
    if (missing) options.unshift(new Option(`${labelId(selected!)} · 已死亡`, String(selected)));
    picker.replaceChildren(...(options.length ? options : [new Option('—', '')]));
    pickerKey = key;
  }
  picker.disabled = !creatures.length;
  if (selected !== null) picker.value = String(selected);
  update('picker-value', selected === null ? '—' : labelId(selected));
}

function setMeter(name: string, value: number | undefined) {
  element<HTMLProgressElement>(name).value = value ?? 0;
  update(`${name}-value`, value === undefined ? '—' : `${Math.round(value)}%`);
}

function refreshIndividual() {
  const creature = current();
  const dead = !creature && selected !== null;
  const root = creature && frame?.bloodline?.root === creature.id;
  const cap = creature ? describeCapabilities(creature.genes) : undefined;
  update('creature-name', creature && cap ? `${ROLES[creature.role].name} · ${cap.limbName}` : dead ? `个体 ${labelId(selected!)}` : '等待观测');
  update('creature-meta', creature && cap
    ? `${ROLES[creature.role].diet} · 第 ${creature.generation} 代 · ${cap.habitat}`
    : dead ? '已离开世界' : '选择地图上的个体');
  element('portrait-empty').hidden = !!creature;
  update('portrait-empty', dead ? '该个体已离开世界' : '暂无在世个体');
  const imageKey = creature && cap
    ? `${creature.id}|${creature.role}|${creature.genes.hue}|${creature.genes.crest}|${creature.genes.size}|${cap.limb}`
    : '-';
  if (imageKey !== portraitKey) {
    drawPortrait(creature);
    portraitKey = imageKey;
  }
  setMeter('energy', creature?.energy);
  setMeter('maturity', creature ? Math.min(100, creature.age / MATURE_AGE * 100) : undefined);
  update('trait-limb', creature && cap ? `${cap.limbName} (${Math.round(creature.genes.aquatic * 100)}%)` : '—');
  update('trait-size', creature ? `${creature.genes.size.toFixed(2)}×` : '—');
  update('trait-speed', creature ? `${creature.genes.speed.toFixed(2)}×` : '—');
  update('trait-comfort', creature ? `${creature.genes.comfort.toFixed(1)}°C` : '—');
  update('trait-ability', cap
    ? `${cap.ability} · 陆速 ${cap.landSpeed}× / 水速 ${cap.waterSpeed}×`
    : '栖息与行动能力：等待观测个体');
  for (const button of gifts) button.disabled = !creature;
  update('track', root ? '◇ 查看血脉' : '◇ 追踪血脉');
  track.disabled = trackFromLineage.disabled = !creature;
  update('track-from-lineage', creature ? `追踪 ${labelId(creature.id)}` : '追踪当前个体');
  map.select(selected);
  refreshPicker(frame?.creatures ?? []);
}

function renderComparisonCard(prefix: 'ancestor' | 'descendant', record: LineageRecord, baseGen?: number) {
  const cap = describeCapabilities(record.genes);
  const spanText = baseGen !== undefined && record.generation > baseGen
    ? ` (+${record.generation - baseGen} 代)`
    : '';
  update(`${prefix}-title`, `${labelId(record.id)} · 第 ${record.generation} 代${spanText}`);
  update(`${prefix}-limb`, `${cap.limbName} · 水生度 ${Math.round(record.genes.aquatic * 100)}%`);
  update(`${prefix}-ability`, `${cap.ability} (陆 ${cap.landSpeed}x / 水 ${cap.waterSpeed}x)`);
  update(`${prefix}-stats`, `体型 ${record.genes.size.toFixed(2)}x · 适温 ${record.genes.comfort.toFixed(1)}°C`);
}

function refreshLineage(next: Frame) {
  const bloodline = next.bloodline;
  element('lineage-data').hidden = !bloodline;
  update('lineage-summary', bloodline
    ? `${ROLES[bloodline.role].name} ${labelId(bloodline.root)} 的血脉记录`
    : '选择一个在世个体，追踪它的后代。');
  if (!bloodline) {
    lineageKey = '';
    comparedDescendantId = null;
    return;
  }
  update('descendants', fmt.format(bloodline.total));
  update('descendants-alive', fmt.format(bloodline.living));
  update('descendants-generation', `第 ${bloodline.generation} 代`);

  const ancestorRec = next.branch[0];
  const customDesc = comparedDescendantId ? next.branch.find(r => r.id === comparedDescendantId) : undefined;
  const defaultDesc = bloodline.comparison
    ? next.branch.find(r => r.id === bloodline.comparison!.descendantId)
    : undefined;
  const descendantRec = customDesc ?? defaultDesc ?? next.branch.at(-1);

  if (ancestorRec && descendantRec) {
    const comparison = bloodline.comparison;
    const chainText = customDesc
      ? `${LIMBS[ancestorRec.limb].name} / ${LIMBS[customDesc.limb].name}`
      : comparison?.stageChain.map(limb => LIMBS[limb].name).join(' → ') ?? LIMBS[ancestorRec.limb].name;
    const chainLabel = customDesc ? '所选形态' : comparison?.chainComplete === false ? '可追溯片段' : '进化链';
    const formCounts = bloodline.forms
      ? `（档案中足 ${bloodline.forms.foot} · 蹼 ${bloodline.forms.webbed} · 鳍 ${bloodline.forms.fin}）`
      : '';
    update('lineage-chain', `${chainLabel} · ${chainText} ${formCounts}`);
    renderComparisonCard('ancestor', ancestorRec);
    renderComparisonCard('descendant', descendantRec, ancestorRec.generation);
  }

  const key = `${bloodline.root}|${comparedDescendantId}|${next.branch.map(r => `${r.id}:${r.died}:${r.limb}`).join(',')}`;
  if (key === lineageKey) return;
  lineageKey = key;
  const rows = next.branch.map(record => {
    const row = document.createElement('li');
    const select = document.createElement('button');
    select.type = 'button';
    const cap = describeCapabilities(record.genes);
    const prefix = record.id === bloodline.root
      ? `${labelId(record.id)} · 神选始祖`
      : `${labelId(record.id)} · 源自 ${labelId(record.parent!)}`;
    select.textContent = `${prefix} [${LIMBS[record.limb].name}]`;
    select.addEventListener('click', () => {
      comparedDescendantId = record.id;
      lineageKey = '';
      if (frame) refreshLineage(frame);
      if (record.died === null) choose(record.id, false);
    });
    const info = document.createElement('span');
    info.textContent = `第 ${record.generation} 代 · 陆${cap.landSpeed}x/水${cap.waterSpeed}x · ${record.died === null ? '在世' : '已逝'}`;
    row.append(select, info);
    return row;
  });
  element('lineage-list').replaceChildren(...rows);
}

function refresh(next: Frame) {
  if (frame?.seed !== next.seed || (frame && frame.tick > next.tick)) {
    selected = next.creatures[0]?.id ?? null;
    comparedDescendantId = null;
    manuallySelected = false;
    portraitKey = '';
  }
  if (!manuallySelected && !next.creatures.some(c => c.id === selected)) selected = next.creatures[0]?.id ?? null;
  frame = next;
  map.setFrame(next);
  refreshIndividual();
  refreshLineage(next);
  update('world-name', worldName(next.seed));
  update('world-seed', `种子 ${showSeed(next.seed)}`);
  update('world-time', timeLabel(next.tick));
  update('temperature', `${next.climate.temperature}°C`);
  update('map-status', mapHost.dataset.renderer === 'flat' ? '生态视图 · 平面' : '生态视图');
  update('run-status', next.playing ? '演化中' : '已暂停');
  element('run-dot').classList.toggle('paused', !next.playing);
  element('map-status-dot').classList.toggle('paused', !next.playing);
  play.querySelector('.play-glyph')?.classList.toggle('is-playing', next.playing);
  play.setAttribute('aria-label', next.playing ? '暂停模拟' : '继续模拟');
  step.disabled = next.playing;
  for (const button of speedButtons) button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === next.speed));
  if (document.activeElement !== temperature) {
    temperature.value = String(next.climate.temperature);
    update('set-temperature-value', `${temperature.value}°C`);
  }
  if (document.activeElement !== rain) {
    rain.value = String(next.climate.rain);
    update('set-rain-value', `${rain.value}%`);
  }
  let grazer = 0;
  let foot = 0;
  let webbed = 0;
  let fin = 0;
  for (const c of next.creatures) {
    if (c.role === 'grazer') grazer++;
    const l = limbForm(c.genes.aquatic);
    if (l === 'foot') foot++;
    else if (l === 'webbed') webbed++;
    else fin++;
  }
  const hunter = next.creatures.length - grazer;
  update('living', fmt.format(next.creatures.length));
  update('births', fmt.format(next.births));
  update('deaths', fmt.format(next.deaths));
  update('foot-count', fmt.format(foot));
  update('webbed-count', fmt.format(webbed));
  update('fin-count', fmt.format(fin));
  update('grazer-count', fmt.format(grazer));
  update('hunter-count', fmt.format(hunter));
  update('population-period', next.census[0]?.tick ? '最近记录' : '自世界生成');
  drawChart(next.census, { tick: next.tick, grazer, hunter, foot, webbed, fin });
}

interface BrowserSave { savedAt: string; world: Save }
function browserSave(): BrowserSave | null {
  try {
    const raw = localStorage.getItem(saveKey);
    if (!raw) return null;
    const data = JSON.parse(raw) as BrowserSave;
    return data.world && typeof data.savedAt === 'string' && !Number.isNaN(Date.parse(data.savedAt)) ? data : null;
  } catch { return null; }
}

function refreshSaveMenu() {
  const saved = browserSave();
  loadButton.disabled = !saved;
  update('save-description', saved ? `${worldName(saved.world.seed)} · ${timeLabel(saved.world.tick)}` : '此浏览器暂无可读存档');
}

worker.onmessage = (event: MessageEvent<WorkerReply>) => {
  const data = event.data;
  if (data.type === 'frame') refresh(data.frame);
  if (data.type === 'notice') notice(data.message);
  if (data.type === 'saved') {
    saveButton.disabled = false;
    try {
      localStorage.setItem(saveKey, JSON.stringify({ savedAt: new Date().toISOString(), world: data.save }));
      refreshSaveMenu();
      notice('已保存到此浏览器。');
    } catch { notice('浏览器无法写入存档。'); }
  }
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
for (const button of gifts) button.addEventListener('click', () => {
  if (selected !== null) send({ type: 'gift', id: selected, gift: button.dataset.gift as Gift });
});
temperature.addEventListener('input', () => update('set-temperature-value', `${temperature.value}°C`));
temperature.addEventListener('change', () => send({ type: 'climate', climate: { temperature: temperature.valueAsNumber } }));
rain.addEventListener('input', () => update('set-rain-value', `${rain.value}%`));
rain.addEventListener('change', () => send({ type: 'climate', climate: { rain: rain.valueAsNumber } }));
element('reset-climate').addEventListener('click', () => send({ type: 'climate', climate: { ...INITIAL_CLIMATE } }));
document.addEventListener('pointerdown', event => {
  if (!saveMenu.contains(event.target as Node)) saveMenu.open = false;
});
saveMenu.addEventListener('toggle', () => { if (saveMenu.open) refreshSaveMenu(); });
saveButton.addEventListener('click', () => {
  if (!frame) return;
  saveMenu.open = false;
  saveButton.disabled = true;
  send({ type: 'save' });
});
loadButton.addEventListener('click', () => {
  const saved = browserSave();
  saveMenu.open = false;
  if (saved) send({ type: 'load', save: saved.world });
  else notice('此浏览器暂无可读存档。');
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
  if (event.code !== 'Space' || event.repeat || newDialog.open || (event.target as HTMLElement).closest('input,button,select,summary,a,textarea')) return;
  event.preventDefault();
  togglePlay();
});
refreshSaveMenu();
