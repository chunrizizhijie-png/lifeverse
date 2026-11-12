import './evolution.css';
import { NICHE_KEYS, isNiche, nicheName, nicheTargets, speciesName } from '../sim/evolution.ts';
import { BIOMES, ROLE_KEYS, ROLES } from '../sim/types.ts';
import type { Command, Creature, Frame, Role, SpeciesStatus } from '../sim/types.ts';
import { MATURE_AGE } from '../sim/world.ts';

type Intervention = 'breed' | 'breedLineage' | 'introduce' | 'relocate';

const labelId = (id: number) => `#${String(id).padStart(3, '0')}`;
const format = new Intl.NumberFormat('zh-CN');
const parentReadiness = (creature: Creature) => creature.energy + (creature.age >= MATURE_AGE ? 100 : 0);

export function createEvolution(
  host: HTMLElement,
  send: (command: Command) => void,
  onSelect: (id: number) => void,
) {
  host.classList.add('evolution-panel');
  host.innerHTML = `
    <div class="section-intro">
      <h2>演化干预</h2>
      <p>扶持种群、培育血脉，或把个体迁入另一片栖息地。</p>
    </div>
    <form class="evolution-form">
      <div class="evolution-modes" role="group" aria-label="干预方式">
        <button type="button" data-intervention="breed" aria-pressed="true">个体繁育</button>
        <button type="button" data-intervention="breedLineage" aria-pressed="false">延续血脉</button>
        <button type="button" data-intervention="introduce" aria-pressed="false">投放种群</button>
        <button type="button" data-intervention="relocate" aria-pressed="false">迁移个体</button>
      </div>
      <p class="evolution-context" id="evolution-context">正在读取世界</p>
      <label class="evolution-field" id="evolution-family-field" hidden>
        <span>血脉</span><select id="evolution-family"></select>
      </label>
      <div class="evolution-fields">
        <label class="evolution-field" id="evolution-niche-field">
          <span>繁育方向</span><select id="evolution-niche"></select>
        </label>
        <label class="evolution-field" id="evolution-role-field" hidden>
          <span>投放物种</span><select id="evolution-role"></select>
        </label>
        <label class="evolution-field" id="evolution-region-field" hidden>
          <span>目标区域</span><select id="evolution-region"></select>
        </label>
        <label class="evolution-field" id="evolution-count-field">
          <span>数量</span><select id="evolution-count"></select>
        </label>
      </div>
      <p class="evolution-hint" id="evolution-hint"></p>
      <div class="evolution-actions">
        <button class="button gold-button" id="evolution-apply" type="submit" disabled>培育后代</button>
        <button class="button" id="evolution-grow" type="button" hidden>促生成熟</button>
        <button class="button" id="evolution-track" type="button" hidden>追踪当前个体</button>
        <button class="button" id="evolution-offspring" type="button" hidden>选最新后代</button>
      </div>
      <p class="evolution-feedback" id="evolution-feedback" role="status" hidden></p>
    </form>
    <section class="species-ancestry" aria-labelledby="species-ancestry-title">
      <h3 id="species-ancestry-title">物种分化图</h3>
      <p>可遗传的适应会形成新分支。物种灭绝后，幸存血脉可以留下继替物种。点在世分支可选中一个个体。</p>
      <ul class="species-tree" id="species-tree" aria-label="物种祖先与分支"></ul>
    </section>`;

  const field = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`#${id}`)!;
  const form = host.querySelector('form')!;
  const modeButtons = [...host.querySelectorAll<HTMLButtonElement>('[data-intervention]')];
  const context = field('evolution-context');
  const family = field<HTMLSelectElement>('evolution-family');
  const niche = field<HTMLSelectElement>('evolution-niche');
  const role = field<HTMLSelectElement>('evolution-role');
  const region = field<HTMLSelectElement>('evolution-region');
  const count = field<HTMLSelectElement>('evolution-count');
  const hint = field('evolution-hint');
  const apply = field<HTMLButtonElement>('evolution-apply');
  const grow = field<HTMLButtonElement>('evolution-grow');
  const track = field<HTMLButtonElement>('evolution-track');
  const offspring = field<HTMLButtonElement>('evolution-offspring');
  const result = field('evolution-feedback');
  const tree = field('species-tree');

  niche.append(new Option('随亲本自然遗传', ''), ...NICHE_KEYS.map(key => new Option(nicheName(key), key)));
  role.append(...ROLE_KEYS.map(key => new Option(ROLES[key].name, key)));
  role.value = 'stalker';
  for (let amount = 1; amount <= 6; amount++) count.append(new Option(String(amount), String(amount)));
  count.value = '3';

  let mode: Intervention = 'breed';
  let frame: Frame | undefined;
  let parentId: number | null = null;
  let focusedRegion = 0;
  let latestChild: Creature | undefined;
  let layoutKey = '';
  let familyKey = '';
  let treeKey = '';
  let speciesById = new Map<number, SpeciesStatus>();
  let livingBySpecies = new Map<number, Creature>();
  const rows = new Map<number, { item: HTMLLIElement; pick: HTMLButtonElement; count: HTMLElement }>();

  const changeText = (element: HTMLElement, value: string) => {
    if (element.textContent !== value) element.textContent = value;
  };

  function refreshControls() {
    const isBreeding = mode === 'breed' || mode === 'breedLineage';
    const parent = frame?.creatures.find(creature => creature.id === parentId);
    const juvenile = !!parent && parent.age < MATURE_AGE;
    const bloodline = frame?.lineages.find(lineage => lineage.root === Number(family.value));
    const tile = frame?.regions[focusedRegion];
    field('evolution-family-field').hidden = mode !== 'breedLineage';
    field('evolution-niche-field').hidden = !isBreeding;
    field('evolution-role-field').hidden = mode !== 'introduce';
    field('evolution-region-field').hidden = mode !== 'relocate';
    field('evolution-count-field').hidden = mode === 'relocate';
    region.disabled = (frame?.regions.length ?? 0) < 2;
    grow.hidden = mode !== 'breed' || !juvenile;
    track.hidden = mode !== 'breedLineage' || !parent || frame?.lineages.some(lineage => lineage.root === parent.id) === true;
    latestChild = undefined;
    if (parent && frame) {
      for (let index = frame.creatures.length - 1; index >= 0; index--) {
        const creature = frame.creatures[index];
        if (creature.parent !== parent.id) continue;
        latestChild = creature;
        break;
      }
    }
    offspring.hidden = mode !== 'breed' || !latestChild;
    if (latestChild) changeText(offspring, `选最新后代 ${labelId(latestChild.id)}`);

    const parentSpecies = parent && speciesById.get(parent.species);
    const parentName = parent && (parentSpecies ? speciesName(parentSpecies) : ROLES[parent.role].name);
    const destination = tile && ((frame?.tiles.length ?? 0) > 1
      ? `第 ${focusedRegion + 1} 区 ${BIOMES[tile.biome].name}`
      : BIOMES[tile.biome].name);
    if (mode === 'breed') {
      apply.disabled = !parent || juvenile;
      changeText(apply, '培育后代');
      changeText(context, parent
        ? `${labelId(parent.id)} · ${parentName}${juvenile ? ' · 幼体' : ''}`
        : '先从地图或下方分化图选一个在世个体。');
    } else if (mode === 'breedLineage') {
      const rootAlive = bloodline && frame?.creatures.some(creature => creature.id === bloodline.root);
      const canContinue = bloodline && (bloodline.living > 0 || rootAlive || bloodline.archive);
      apply.disabled = !canContinue;
      changeText(apply, '延续这条血脉');
      changeText(context, bloodline
        ? `在世后代 ${format.format(bloodline.living)} · 最高第 ${bloodline.generation} 代 · ${destination ?? ''}`
        : '先在血脉面板追踪一个个体。');
    } else if (mode === 'introduce') {
      apply.disabled = !tile;
      changeText(apply, '投放种群');
      changeText(context, destination ? `投放到当前区域 · ${destination}` : '正在读取区域');
    } else {
      apply.disabled = !parent || region.disabled;
      changeText(apply, '迁移个体');
      changeText(context, parent ? `${labelId(parent.id)} · ${parentName}` : '先从地图或下方分化图选一个在世个体。');
    }

    if (isBreeding) {
      if (mode === 'breed' && juvenile) {
        changeText(hint, '等这只幼体成年后再培育，或先使用促生。');
      } else if (mode === 'breedLineage' && bloodline && apply.disabled) {
        changeText(hint, '这条旧血脉没有在世个体或可用于培育的性状记录。');
      } else if (isNiche(niche.value)) {
        const target = nicheTargets(niche.value);
        changeText(hint, `后代适温约 ${target.comfort}°C，适湿约 ${target.moisture}%。连续两代保持同一新适应方向会形成分支。`);
      } else {
        changeText(hint, mode === 'breedLineage'
          ? '从在世血亲培育后代。没有在世血亲时可使用已归档的性状。'
          : '直接培育有能量储备的后代，后代继承性状并产生变异。');
      }
    } else if (mode === 'introduce') {
      changeText(hint, '增加独立的原种个体，可重新引入已灭绝的种群。');
    } else {
      changeText(hint, region.disabled ? '拼合九区后可迁移个体。' : '迁移后的个体保留性状和血脉。');
    }
  }

  function refreshTree(species: SpeciesStatus[]) {
    const shape = species.map(item => `${item.id}:${item.parent}:${item.role}:${item.niche}:${item.adaptation}:${item.replaces}`).join('|');
    const byId = new Map(species.map(item => [item.id, item]));
    if (treeKey !== shape) {
      treeKey = shape;
      rows.clear();
      const children = new Map<number | null, SpeciesStatus[]>();
      for (const item of species) {
        const siblings = children.get(item.parent);
        if (siblings) siblings.push(item);
        else children.set(item.parent, [item]);
      }

      function addBranch(item: SpeciesStatus): HTMLLIElement {
        const entry = document.createElement('li');
        const row = document.createElement('div');
        const pick = document.createElement('button');
        const number = document.createElement('span');
        row.className = 'species-row';
        pick.type = 'button';
        pick.dataset.species = String(item.id);
        pick.textContent = speciesName(item);
        const previous = item.replaces === undefined ? undefined : byId.get(item.replaces);
        if (previous) pick.title = `接替 ${speciesName(previous)}`;
        row.style.setProperty('--species-color', ROLES[item.role].color);
        number.className = 'species-count';
        row.append(pick, number);
        entry.append(row);
        rows.set(item.id, { item: entry, pick, count: number });

        const branches = children.get(item.id);
        if (branches?.length) {
          const list = document.createElement('ul');
          list.append(...branches.map(addBranch));
          entry.append(list);
        }
        return entry;
      }

      tree.replaceChildren(...(children.get(null) ?? []).map(addBranch));
    }
    const selectedSpecies = frame?.creatures.find(creature => creature.id === parentId)?.species;
    const successors = new Set(species.filter(item => item.population > 0).map(item => item.replaces));
    for (const item of species) {
      const row = rows.get(item.id);
      if (!row) continue;
      row.pick.disabled = !item.population;
      row.item.classList.toggle('is-extinct', item.population === 0);
      row.pick.setAttribute('aria-pressed', String(item.id === selectedSpecies));
      const extinct = item.extinctAt !== undefined || item.parent !== null;
      changeText(row.count, item.population ? `${format.format(item.population)} 在世`
        : successors.has(item.id) ? '已灭绝 · 有继替' : extinct ? '已灭绝' : '无在世');
    }
  }

  function setMode(next: Intervention) {
    mode = next;
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.intervention === mode));
    refreshControls();
  }

  function select(creature: Creature) {
    parentId = creature.id;
    onSelect(creature.id);
    refreshControls();
    if (frame) refreshTree(frame.species);
  }

  for (const button of modeButtons) button.addEventListener('click', () => setMode(button.dataset.intervention as Intervention));
  niche.addEventListener('change', refreshControls);
  family.addEventListener('change', () => {
    if (family.value) send({ type: 'track', id: Number(family.value) });
    refreshControls();
  });
  grow.addEventListener('click', () => {
    if (parentId !== null) send({ type: 'gift', id: parentId, gift: 'grow' });
  });
  track.addEventListener('click', () => {
    if (parentId !== null) send({ type: 'track', id: parentId });
  });
  offspring.addEventListener('click', () => {
    if (latestChild) select(latestChild);
  });
  tree.addEventListener('click', event => {
    const pick = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-species]');
    const creature = livingBySpecies.get(Number(pick?.dataset.species));
    if (creature) select(creature);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!frame || apply.disabled) return;
    const amount = Number(count.value);
    const direction = isNiche(niche.value) ? niche.value : null;
    if (mode === 'breed' && parentId !== null) {
      send({ type: 'breed', id: parentId, niche: direction, count: amount });
    } else if (mode === 'breedLineage' && family.value) {
      send({ type: 'breedLineage', root: Number(family.value), region: focusedRegion, niche: direction, count: amount });
    } else if (mode === 'introduce') {
      send({ type: 'introduce', role: role.value as Role, region: focusedRegion, count: amount });
    } else if (mode === 'relocate' && parentId !== null) {
      send({ type: 'relocate', id: parentId, region: Number(region.value) });
    }
  });

  return {
    receive(next: Frame, selected: number | null, focus: number) {
      const nextLayout = next.tiles.map(tile => `${tile.seed}:${tile.biome}`).join('|');
      if (layoutKey !== nextLayout) {
        layoutKey = nextLayout;
        region.replaceChildren(...next.regions.map((tile, index) =>
          new Option(`${index + 1} · ${BIOMES[tile.biome].name}`, String(index))));
        region.value = String(next.regions.length > 1 ? (focus + 1) % next.regions.length : 0);
        result.hidden = true;
      }
      if (frame && next.tick < frame.tick) result.hidden = true;
      frame = next;
      parentId = selected;
      focusedRegion = focus;
      speciesById = new Map(next.species.map(item => [item.id, item]));
      livingBySpecies = new Map();
      for (const creature of next.creatures) {
        const current = livingBySpecies.get(creature.species);
        if (creature.id === selected || !current
          || (current.id !== selected && parentReadiness(creature) > parentReadiness(current))) {
          livingBySpecies.set(creature.species, creature);
        }
      }
      const nextFamilies = next.lineages.map(lineage => `${lineage.root}:${lineage.role}`).join('|');
      if (familyKey !== nextFamilies || !family.length) {
        familyKey = nextFamilies;
        family.replaceChildren(...(next.lineages.length
          ? next.lineages.map(lineage => new Option(`${ROLES[lineage.role].name} ${labelId(lineage.root)}`, String(lineage.root)))
          : [new Option('尚未追踪血脉', '')]));
        family.disabled = !next.lineages.length;
      }
      if (next.bloodline) family.value = String(next.bloodline.root);
      refreshTree(next.species);
      refreshControls();
    },
    feedback(message: string) {
      changeText(result, message);
      result.hidden = false;
    },
    showLineage() {
      setMode('breedLineage');
    },
  };
}
