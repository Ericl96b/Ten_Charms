// Shared animation helpers. Everything animates transform and opacity only.
import { h, wait } from '../dom.ts';
import { petalSvg, icon } from '../art.ts';

export const SPRING = 'cubic-bezier(.34,1.56,.64,1)';
export const SOFT = 'cubic-bezier(.25,.8,.3,1)';
export const FALL = 'cubic-bezier(.5,0,.8,.6)';

export const motion = {
  /** Multiplies all non-ambient durations (0.6 when Animation speed is Fast). */
  factor: 1,
  /** Dev-only test speed-up. */
  testScale: 1,
  reduced: false,
};

export function dur(ms: number): number {
  return ms * motion.factor * motion.testScale;
}

export function setMotion(fast: boolean, reduced: boolean): void {
  motion.factor = fast ? 0.6 : 1;
  motion.reduced = reduced;
  applyMotionVars();
}

export function applyMotionVars(): void {
  const root = document.documentElement;
  root.style.setProperty('--t', String(motion.factor * motion.testScale));
  root.classList.toggle('reduced', motion.reduced);
}

export type EventLog = { kind: 'fx' | 'sound'; name: string; at: number };
export const eventLog: EventLog[] = [];

/** Records that an animation fired. In production this is compiled away. */
export function fx(name: string): void {
  if (__DEV__) eventLog.push({ kind: 'fx', name, at: Date.now() });
}

const running = new Set<Animation>();

export function animate(el: Element, frames: Keyframe[], opts: { ms: number; ease?: string; delay?: number; fill?: FillMode; ambient?: boolean; composite?: CompositeOperation }): Promise<void> {
  const a = el.animate(frames, {
    duration: opts.ambient ? opts.ms : dur(opts.ms),
    easing: opts.ease ?? 'ease',
    delay: opts.ambient ? opts.delay ?? 0 : dur(opts.delay ?? 0),
    fill: opts.fill ?? 'both',
    composite: opts.composite,
  });
  if (!opts.ambient) {
    a.playbackRate = rate;
    running.add(a);
  }
  return a.finished.then(
    () => { running.delete(a); },
    () => { running.delete(a); },
  );
}

let rate = 1;

/** Speeds up what is already running, used when she taps through a bot turn. */
export function setRate(next: number): void {
  rate = next;
  for (const a of running) a.playbackRate = next;
}

export function currentRate(): number {
  return rate;
}

/** Jumps everything to its final state, used when she taps through a celebration. */
export function finishAll(): void {
  for (const a of [...running]) {
    try { a.finish(); } catch { /* an infinite or cancelled animation */ }
  }
}

export function pause(ms: number): Promise<void> {
  return wait(dur(ms) / rate);
}

export function shake(el: Element, px = 6, ms = 240, cycles = 3): Promise<void> {
  const frames: Keyframe[] = [{ transform: 'translateX(0)' }];
  for (let i = 0; i < cycles; i++) frames.push({ transform: `translateX(${px}px)` }, { transform: `translateX(${-px}px)` });
  frames.push({ transform: 'translateX(0)' });
  return animate(el, frames, { ms, ease: 'linear', fill: 'none', composite: 'add' });
}

/* ---------- Particles ---------- */

let layer: HTMLElement | null = null;

export function setFxLayer(el: HTMLElement): void {
  layer = el;
}

export function fxLayer(): HTMLElement {
  return layer ?? document.body;
}

/** Page coordinates to the layer's own. */
export function toLayer(x: number, y: number): { x: number; y: number } {
  const r = fxLayer().getBoundingClientRect();
  return { x: x - r.left, y: y - r.top };
}

export type BurstKind = 'petal' | 'gold' | 'sparkle' | 'lilac';

function particle(kind: BurstKind): HTMLElement {
  const el = document.createElement('div');
  el.className = `particle ${kind}`;
  if (kind === 'petal') el.innerHTML = petalSvg(Math.random() < 0.5 ? 'var(--rose-blush)' : 'var(--rose-bloom)');
  else if (kind === 'sparkle') el.innerHTML = icon('sparkle');
  return el;
}

/** A radial burst from a page position. Reduced motion keeps 30% of the particles. */
export function burst(px: number, py: number, count: number, kinds: BurstKind[] = ['petal', 'gold'], spread = 150): void {
  const n = motion.reduced ? Math.ceil(count * 0.3) : count;
  const at = toLayer(px, py);
  const parent = fxLayer();
  for (let i = 0; i < n; i++) {
    const el = particle(kinds[i % kinds.length]);
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    parent.append(el);
    const angle = Math.random() * Math.PI * 2;
    const dist = spread * (0.4 + Math.random() * 0.7);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const spin = (Math.random() - 0.5) * 540;
    const ms = 650 + Math.random() * 450;
    void animate(el, [
      { transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.8}px),calc(-50% + ${dy * 0.8}px)) scale(1) rotate(${spin * 0.7}deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy + 40}px)) scale(.8) rotate(${spin}deg)`, opacity: 0 },
    ], { ms, ease: 'cubic-bezier(.15,.7,.35,1)' }).then(() => el.remove());
  }
}

/** Petals and gold flakes falling across the screen. */
export function confetti(ms = 1500, count = 34, kinds: BurstKind[] = ['petal', 'gold']): void {
  const n = motion.reduced ? Math.ceil(count * 0.3) : count;
  const parent = fxLayer();
  const w = parent.clientWidth;
  const hgt = parent.clientHeight;
  for (let i = 0; i < n; i++) {
    const el = particle(kinds[i % kinds.length]);
    el.style.left = `${Math.random() * w}px`;
    el.style.top = '-20px';
    parent.append(el);
    const drift = (Math.random() - 0.5) * 80;
    void animate(el, [
      { transform: 'translateY(0) rotate(0)', opacity: 1 },
      { transform: `translate(${drift}px,${hgt * 0.8}px) rotate(${Math.random() * 500}deg)`, opacity: 1, offset: 0.8 },
      { transform: `translate(${drift * 1.2}px,${hgt + 30}px) rotate(${Math.random() * 700}deg)`, opacity: 0 },
    ], { ms: ms * (0.6 + Math.random() * 0.4), delay: Math.random() * ms * 0.35, ease: 'cubic-bezier(.3,.3,.7,.9)' }).then(() => el.remove());
  }
}

/** A short-lived element placed at a page position. */
export function flyerAt(el: HTMLElement, rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  const at = toLayer(rect.left, rect.top);
  el.classList.add('flyer');
  el.style.left = `${at.x}px`;
  el.style.top = `${at.y}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  fxLayer().append(el);
  return el;
}

export function center(r: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function pop(el: HTMLElement, from = 0.6): Promise<void> {
  return animate(el, [
    { transform: `scale(${from})`, opacity: 0 },
    { transform: 'scale(1.08)', opacity: 1, offset: 0.65 },
    { transform: 'scale(1)', opacity: 1 },
  ], { ms: 320, ease: 'ease-out' });
}

/* ---------- Rolling numbers ---------- */

const DIGITS = '0123456789';

/** Rolls a number like an odometer instead of snapping to it. */
export function rollNumber(el: HTMLElement, value: number): void {
  const text = String(value);
  const old = el.dataset.value;
  if (old === text) return;
  el.dataset.value = text;
  el.setAttribute('aria-label', text);
  if (old === undefined || motion.testScale < 0.2) {
    el.textContent = text;
    return;
  }
  el.classList.add('odo');
  fx('ui.odometer');
  const prev = old.padStart(text.length, ' ');
  el.textContent = '';
  for (let i = 0; i < text.length; i++) {
    const wrap = h('span.odo-d');
    const col = h('span.odo-c');
    const from = DIGITS.indexOf(prev[i]);
    const to = DIGITS.indexOf(text[i]);
    const seq: string[] = [];
    let d = from < 0 ? 0 : from;
    seq.push(from < 0 ? ' ' : DIGITS[d]);
    while (d !== to) { d = (d + 1) % 10; seq.push(DIGITS[d]); }
    seq.forEach((c) => col.append(h('span', null, c === ' ' ? ' ' : c)));
    wrap.append(col);
    el.append(wrap);
    const steps = seq.length - 1;
    if (steps > 0) {
      void animate(col, [{ transform: 'translateY(0)' }, { transform: `translateY(${(-100 * steps) / seq.length}%)` }], { ms: 420, ease: SOFT });
    }
  }
}
