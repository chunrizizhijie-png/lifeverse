import { MINUTES_PER_TICK, ROLE_KEYS, ROLES } from '../sim/types.ts';
import type { Census } from '../sim/types.ts';

function day(tick: number) {
  return Math.floor(tick * MINUTES_PER_TICK / 1440) + 1;
}

export function makeChart(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  let history: Census[] = [];
  const render = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpi = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpi);
    canvas.height = Math.round(rect.height * dpi);
    ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
    const first = history.at(0)?.tick ?? 0;
    const last = history.at(-1)?.tick ?? 0;
    const end = Math.max(last, first + 30);
    const peak = Math.max(0, ...history.flatMap(row => ROLE_KEYS.map(role => row[role])));
    const max = Math.max(20, Math.ceil(peak / 20) * 20);
    const width = rect.width - 37;
    const top = 9;
    const base = rect.height - 17;
    const atX = (tick: number) => 27 + width * (tick - first) / (end - first);
    const atY = (n: number) => base - (base - top) * n / max;
    ctx.lineWidth = 1;
    ctx.font = '10px DM Sans, Microsoft YaHei UI, sans-serif';
    ctx.textBaseline = 'middle';
    for (const value of [max, max / 2, 0]) {
      const y = atY(value);
      ctx.beginPath();
      ctx.strokeStyle = '#748a6d40';
      ctx.moveTo(27, y);
      ctx.lineTo(rect.width - 6, y);
      ctx.stroke();
      ctx.fillStyle = '#9cab98';
      ctx.fillText(String(value), 3, y);
    }
    ctx.fillText(`第 ${day(first)} 天`, 28, base + 11);
    if (day(last) > day(first)) {
      ctx.textAlign = 'right';
      ctx.fillText(`第 ${day(last)} 天`, rect.width - 7, base + 11);
      ctx.textAlign = 'left';
    }
    if (!history.length) return;
    for (const role of ROLE_KEYS) {
      if (!history.some(sample => sample[role] > 0)) continue;
      ctx.beginPath();
      for (const [index, row] of history.entries()) {
        const x = atX(row.tick);
        const y = atY(row[role]);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineJoin = 'round';
      ctx.strokeStyle = ROLES[role].color;
      ctx.lineWidth = 1.65;
      ctx.stroke();
      const latest = history.at(-1)!;
      ctx.fillStyle = ROLES[role].color;
      ctx.beginPath();
      ctx.arc(atX(latest.tick), atY(latest[role]), 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  new ResizeObserver(render).observe(canvas);
  return (samples: Census[], current: Census) => {
    history = samples.at(-1)?.tick === current.tick ? samples : [...samples, current];
    const counts = ROLE_KEYS.map(role => `${ROLES[role].name} ${current[role]} 只`);
    canvas.setAttribute('aria-label', `种群变化。当前在世 ${counts.join('、')}。`);
    render();
  };
}
