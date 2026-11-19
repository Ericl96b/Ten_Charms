// Ambient life for the Crossroads and the Tower: drifting petals and clouds, butterflies, fireflies, twinkling stars.
// All of it is decoration: it never blocks and never takes a tap. Under Reduced Motion it stays still.
import { h } from '../dom.ts';
import { motion } from '../fx/motion.ts';
import { petalSvg } from '../art.ts';

/** Every running ambient loop, so a test can hold them all at one moment for a screenshot. */
const running = new Set<Animation>();
let frozenAt: number | null = null;

export function track(a: Animation): Animation {
  running.add(a);
  if (frozenAt !== null) { a.pause(); a.currentTime = frozenAt; }
  a.addEventListener('cancel', () => running.delete(a));
  a.addEventListener('finish', () => running.delete(a));
  return a;
}

/** Dev only (see src/dev/hooks.ts): holds every ambient loop, now and later, at `ms` into its cycle. */
export function freezeAmbientForTests(ms: number): void {
  if (!__DEV__) return;
  frozenAt = ms;
  for (const a of running) { a.pause(); a.currentTime = ms; }
}

/** A seeded spread, so the same screen always starts from the same layout. */
function spread(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type AmbientKind = 'petals' | 'clouds' | 'butterflies' | 'fireflies' | 'stars' | 'aurora' | 'pinkClouds';

const CLOUD = '<svg viewBox="0 0 120 50" aria-hidden="true"><path d="M16 44c-9 0-14-6-12-13 2-6 9-8 14-6 2-11 13-17 24-14 6-9 21-10 28 0 10-3 21 3 22 13 9 0 15 6 13 13-1 5-6 7-11 7Z" fill="#FFFFFF"/><path d="M8 40c10 6 92 6 102 0" fill="none" stroke="#F6C9D6" stroke-width="5" stroke-linecap="round" opacity=".6"/></svg>';
const PINK_CLOUD = CLOUD.replace('#FFFFFF', '#FBE3EE');
const BUTTERFLY = '<svg viewBox="0 0 24 20" aria-hidden="true"><path d="M12 10C8 2 1 2 2 8c1 4 6 4 10 2Z" fill="#F4A9C0"/><path d="M12 10c4-8 11-8 10-2-1 4-6 4-10 2Z" fill="#F4A9C0"/><path d="M12 10c-3 3-6 8-3 8s3-5 3-8Zm0 0c3 3 6 8 3 8s-3-5-3-8Z" fill="#E8789A"/><path d="M12 6v10" stroke="#7A3D5C" stroke-width="1.2" stroke-linecap="round"/></svg>';
const STAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 0 12 8 20 10 12 12 10 20 8 12 0 10 8 8Z" fill="#FFFFFF"/></svg>';

/**
 * Starts the ambient layers asked for inside `host`. Returns a function that stops them. `still` places them without
 * moving them one by one, for a layer that moves as a whole (the lift's parallax sky).
 */
export function ambientLife(host: HTMLElement, kinds: AmbientKind[], seed = 7, still = false): () => void {
  const rand = spread(seed);
  const els: HTMLElement[] = [];
  const add = (el: HTMLElement, frames: Keyframe[], ms: number, delay: number) => {
    host.append(el);
    els.push(el);
    if (motion.reduced) return;
    if (still) {
      // Held part-way through its cycle, so the layer starts spread out like the live sky.
      const a = el.animate(frames, { duration: ms, delay: -delay, iterations: Infinity, easing: 'linear' });
      a.pause();
      return;
    }
    track(el.animate(frames, { duration: ms, delay: -delay, iterations: Infinity, easing: 'linear' }));
  };
  for (const kind of kinds) {
    if (kind === 'clouds' || kind === 'pinkClouds') {
      for (let i = 0; i < 3; i++) {
        const w = 7 + rand() * 6;
        // Clouds keep to the sky: the upper part of the view.
        const el = h('i.amb-cloud', { html: kind === 'pinkClouds' ? PINK_CLOUD : CLOUD, style: `width:${w}rem;top:${6 + rand() * 22}%;opacity:${0.55 + rand() * 0.3}` });
        add(el, [{ transform: 'translateX(-14rem)' }, { transform: 'translateX(48rem)' }], 70000 + rand() * 40000, rand() * 60000);
      }
    }
    if (kind === 'petals') {
      for (let i = 0; i < 6; i++) {
        const el = h('i.amb-petal', { html: petalSvg(), style: `left:${rand() * 100}%;width:${0.9 + rand() * 0.6}rem` });
        const drift = (rand() - 0.5) * 12;
        add(el, [
          { transform: 'translate(0, -4rem) rotate(0deg)', opacity: 0 },
          { opacity: 0.9, offset: 0.1 },
          { transform: `translate(${drift}rem, 50vh) rotate(200deg)`, opacity: 0.8, offset: 0.55 },
          { transform: `translate(${drift * 0.4}rem, 105vh) rotate(380deg)`, opacity: 0 },
        ], 11000 + rand() * 7000, rand() * 14000);
      }
    }
    if (kind === 'butterflies') {
      for (let i = 0; i < 2; i++) {
        const el = h('i.amb-fly', { html: BUTTERFLY, style: `top:${15 + rand() * 50}%;left:${rand() * 80}%` });
        add(el, [
          { transform: 'translate(0, 0) scaleX(1)' }, { transform: 'translate(3rem, -2rem) scaleX(.6)', offset: 0.25 },
          { transform: 'translate(6rem, 1rem) scaleX(1)', offset: 0.5 }, { transform: 'translate(2rem, 3rem) scaleX(.6)', offset: 0.75 },
          { transform: 'translate(0, 0) scaleX(1)' },
        ], 9000 + rand() * 4000, rand() * 9000);
      }
    }
    if (kind === 'fireflies') {
      for (let i = 0; i < 6; i++) {
        const el = h('i.amb-firefly', { style: `top:${10 + rand() * 75}%;left:${rand() * 95}%` });
        add(el, [{ opacity: 0.15, transform: 'translate(0,0)' }, { opacity: 1, transform: 'translate(.8rem,-1rem)', offset: 0.5 }, { opacity: 0.15, transform: 'translate(0,0)' }], 3200 + rand() * 2400, rand() * 3000);
      }
    }
    if (kind === 'stars') {
      for (let i = 0; i < 9; i++) {
        const el = h('i.amb-star', { html: STAR, style: `top:${3 + rand() * 60}%;left:${rand() * 96}%;width:${0.6 + rand() * 0.6}rem` });
        add(el, [{ opacity: 0.25, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1)', offset: 0.5 }, { opacity: 0.25, transform: 'scale(.7)' }], 2600 + rand() * 2600, rand() * 2600);
      }
    }
    if (kind === 'aurora') {
      for (let i = 0; i < 3; i++) {
        const el = h('i.amb-aurora', { style: `top:${4 + i * 9}%;animation:none` });
        add(el, [{ transform: 'translateX(-6%) skewY(-4deg)', opacity: 0.55 }, { transform: 'translateX(6%) skewY(3deg)', opacity: 0.85, offset: 0.5 }, { transform: 'translateX(-6%) skewY(-4deg)', opacity: 0.55 }], 16000 + i * 4000, i * 3000);
      }
    }
  }
  return () => { for (const el of els) { for (const a of el.getAnimations()) a.cancel(); el.remove(); } };
}

/** The Crossroads' ambient life: drifting petals and slowly moving clouds. */
export function ambientLoop(root: HTMLElement, layers: { petals: HTMLElement; clouds: HTMLElement }): () => void {
  const a = ambientLife(layers.petals, ['petals'], 11);
  const b = ambientLife(layers.clouds, ['clouds'], 13);
  void root;
  return () => { a(); b(); };
}
