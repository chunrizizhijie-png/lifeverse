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

function frame() {
  send({ type: 'frame', frame: world.frame(playing, speed) });
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
      send({ type: 'notice', message: world.gift(command.id, command.gift) });
      break;
    case 'track':
      world.track(command.id);
      break;
    case 'climate':
      world.setClimate(command.climate);
      break;
    case 'new':
      if (!validSeed(command.seed)) {
        send({ type: 'notice', message: '请输入 1 到 999999999 的整数种子。' });
        return;
      }
      world = new World(command.seed);
      playing = true;
      speed = 1;
      accumulated = 0;
      lastTime = performance.now();
      send({ type: 'notice', message: '新世界已生成。' });
      break;
    case 'save':
      send({ type: 'saved', save: world.save() });
      return;
    case 'load':
      try {
        world = World.restore(command.save);
        playing = false;
        accumulated = 0;
        send({ type: 'notice', message: '已读取存档。世界时间已暂停。' });
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
  const count = Math.min(12, Math.floor(accumulated / tickMilliseconds));
  if (count === 0) return;
  accumulated -= count * tickMilliseconds;
  for (let i = 0; i < count; i++) world.step();
  frame();
}, 100);
frame();
