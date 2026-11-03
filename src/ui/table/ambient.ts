// The table's always-running life: drifting petals, moths at the boss table, fog clouds. Paused when the app is hidden.
import { mothSvg, petalSvg } from '../art.ts';
import { sfx } from '../audio/audio.ts';
import { fogLayer } from '../fx/fog.ts';
import { h } from '../dom.ts';
import { fx, motion } from '../fx/motion.ts';
import type { Table } from './table.ts';

const MAX_PETALS = 6;

export function startAmbient(t: Table): () => void {
  const layer = h('div.ambient');
  t.root.insertBefore(layer, t.fxEl);
  let count = 0;
  let timer = 0;
  let stopped = false;
  fx('ambient.candle');
  fx('ambient.steam');
  fx('ambient.wildSheen');

  const spawn = () => {
    if (stopped) return;
    timer = window.setTimeout(spawn, 900 + Math.random() * 2200);
    if (motion.reduced || document.hidden || count >= MAX_PETALS) return;
    count++;
    fx('ambient.petals');
    const w = layer.clientWidth;
    const hgt = layer.clientHeight;
    const size = 10 + Math.random() * 8;
    const petal = h('div.petal', { html: petalSvg(Math.random() < 0.5 ? 'var(--rose-blush)' : 'var(--rose-bloom)'), style: `width:${size}px;height:${size}px;left:${Math.random() * w * 0.9}px` });
    layer.append(petal);
    const ms = 8000 + Math.random() * 6000;
    const dx = 40 + Math.random() * 90;
    const sway = 14 + Math.random() * 18;
    const anim = petal.animate([
      { transform: 'translate(0,-30px) rotate(0)', opacity: 0 },
      { transform: `translate(${dx * 0.25 + sway}px,${hgt * 0.25}px) rotate(120deg)`, opacity: 0.85, offset: 0.25 },
      { transform: `translate(${dx * 0.5 - sway}px,${hgt * 0.5}px) rotate(240deg)`, opacity: 0.85, offset: 0.5 },
      { transform: `translate(${dx * 0.75 + sway}px,${hgt * 0.75}px) rotate(360deg)`, opacity: 0.85, offset: 0.75 },
      { transform: `translate(${dx}px,${hgt + 30}px) rotate(480deg)`, opacity: 0 },
    ], { duration: ms, easing: 'linear', id: 'ambient' });
    void anim.finished.finally(() => { petal.remove(); count--; }).catch(() => {});
  };
  timer = window.setTimeout(spawn, __DEV__ ? 50 : 600);

  const onVis = () => {
    const hidden = document.hidden;
    for (const a of layer.getAnimations({ subtree: true })) {
      if (hidden) a.pause();
      else a.play();
    }
    t.root.classList.toggle('hidden-app', hidden);
  };
  document.addEventListener('visibilitychange', onVis);
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVis);
    layer.remove();
  };
}

/** At most two moths drift across the boss table at a time. */
export function startBossAmbient(t: Table): () => void {
  const layer = h('div.ambient.moths');
  t.root.insertBefore(layer, t.fxEl);
  let stopped = false;
  let count = 0;
  let timer = 0;
  const spawn = () => {
    if (stopped) return;
    timer = window.setTimeout(spawn, 3500 + Math.random() * 5000);
    if (motion.reduced || document.hidden || count >= 2) return;
    count++;
    fx('boss.moths');
    const hgt = layer.clientHeight;
    const w = layer.clientWidth;
    const y = Math.random() * hgt * 0.5;
    const left = Math.random() < 0.5;
    const moth = h('div.moth', { html: mothSvg(), style: `top:${y}px` });
    layer.append(moth);
    const anim = moth.animate([
      { transform: `translate(${left ? -60 : w + 60}px,0) rotate(${left ? 10 : -10}deg)` },
      { transform: `translate(${w / 2}px,${40 + Math.random() * 60}px) rotate(${left ? -8 : 8}deg)`, offset: 0.5 },
      { transform: `translate(${left ? w + 60 : -60}px,${Math.random() * 40}px) rotate(${left ? 10 : -10}deg)` },
    ], { duration: 9000 + Math.random() * 4000, easing: 'ease-in-out', id: 'ambient' });
    void anim.finished.finally(() => { moth.remove(); count--; }).catch(() => {});
  };
  timer = window.setTimeout(spawn, __DEV__ ? 80 : 2000);
  return () => {
    stopped = true;
    clearTimeout(timer);
    layer.remove();
  };
}

/**
 * Moonlit Fog at the table: one cloud layer laid just above the tablecloth, so clouds cross the wallpaper and
 * the cloth alike and pass under everything on it. The count wisps on the chips puff now and then.
 */
export function startFogAmbient(t: Table): () => void {
  const fog = fogLayer(t.root.clientWidth, t.root.clientHeight);
  t.clothEl.after(fog.el);
  let stopped = false;
  let turn = 0;
  const puff = () => {
    if (stopped) return;
    timer = window.setTimeout(puff, 3200);
    if (motion.reduced || document.hidden) return;
    const wisps = [...t.root.querySelectorAll<HTMLElement>('.fog-wisp')];
    if (wisps.length === 0) return;
    const w = wisps[turn++ % wisps.length];
    fx('fog.wispPuff');
    // Only one chip puffs at a time, and the sound is very soft.
    sfx('wispPuff', { quiet: 0.25 });
    w.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 700, easing: 'ease-out', id: 'ambient' });
  };
  let timer = window.setTimeout(puff, __DEV__ ? 80 : 2400);
  return () => {
    stopped = true;
    clearTimeout(timer);
    fog.stop();
  };
}
