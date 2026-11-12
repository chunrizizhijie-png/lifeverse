import { World, validSeed } from './world.ts';
import { SPEEDS } from './types.ts';
import type { Command, Speed, WorkerReply } from './types.ts';

const port = self as unknown as DedicatedWorkerGlobalScope;
const send = (reply: WorkerReply) => port.postMessage(reply);
const tickMilliseconds = 205;
let world = new World();
let playing = true;
let speed: Speed = 1;
let accumulated = 0;
let lastTime = performance.now();
let epoch = 0;

function frame() {
  send({ type: 'frame', frame: world.frame(playing, speed), epoch });
}

function enter(next: World, run: boolean) {
  world = next;
  epoch++;
  playing = run;
  accumulated = 0;
  lastTime = performance.now();
}

function intervene(message: string) {
  send({ type: 'notice', message, intervention: true });
}

port.onmessage = (event: MessageEvent<Command>) => {
  const command = event.data;
  switch (command.type) {
    case 'play':
      playing = command.playing;
      accumulated = 0;
      lastTime = performance.now();
      break;
    case 'speed':
      if (SPEEDS.includes(command.speed)) speed = command.speed;
      break;
    case 'step':
      if (!playing) world.step();
      break;
    case 'gift':
      send({ type: 'notice', message: world.gift(command.id, command.gift), giftId: command.id });
      break;
    case 'track':
      world.track(command.id);
      break;
    case 'climate':
      world.setClimate(command.climate, command.region);
      break;
    case 'breed':
      intervene(world.breed(command.id, command.niche, command.count));
      break;
    case 'breedLineage':
      intervene(world.breedLineage(command.root, command.region, command.niche, command.count));
      break;
    case 'introduce':
      intervene(world.introduce(command.role, command.region, command.count));
      break;
    case 'relocate':
      intervene(world.relocate(command.id, command.region));
      break;
    case 'new':
      if (!validSeed(command.seed)) {
        send({ type: 'notice', message: '请输入 1 到 999999999 的整数种子。' });
        return;
      }
      try {
        enter(new World(command.seed, true, [{ seed: command.seed, biome: command.biome ?? 'archipelago' }]), true);
        speed = 1;
        send({ type: 'notice', message: '新世界已生成。' });
      } catch (error) {
        send({ type: 'notice', message: (error as Error).message });
        return;
      }
      break;
    case 'compose':
      try {
        enter(World.compose(command.sources), false);
        send({ type: 'notice', message: '九区已拼合。点击播放后，生物可沿陆桥跨区。' });
      } catch (error) {
        send({ type: 'notice', message: (error as Error).message });
        return;
      }
      break;
    case 'save':
      send({ type: 'saved', save: world.save(), slot: command.slot });
      return;
    case 'load':
      try {
        const legacy = !!command.save && typeof command.save === 'object' && 'version' in command.save && command.save.version !== 3;
        enter(World.restore(command.save), false);
        send({ type: 'notice', message: legacy
          ? '已迁移旧存档并暂停。原有生物已保留，新建世界可体验五种初始生物。'
          : '已读取存档。世界时间已暂停。' });
      } catch (error) {
        send({ type: 'notice', message: (error as Error).message });
        return;
      }
      break;
  }
  frame();
};

setInterval(() => {
  const now = performance.now();
  const elapsed = Math.min(220, now - lastTime);
  lastTime = now;
  if (!playing) return;
  accumulated += elapsed * speed;
  const count = Math.min(60, Math.floor(accumulated / tickMilliseconds));
  if (count === 0) return;
  accumulated -= count * tickMilliseconds;
  for (let i = 0; i < count; i++) world.step();
  frame();
}, 100);
frame();
