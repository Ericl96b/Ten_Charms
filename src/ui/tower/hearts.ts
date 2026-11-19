// Hearts (TOWER_SPEC.md §6.8, §9.6): a rose-pink locket with a gold rim when full, a dashed pale outline when empty.
import { TOWER_HEARTS } from '../../content.ts';
import { sfx } from '../audio/audio.ts';
import { h } from '../dom.ts';
import { SOFT, animate, burst, center, fx, motion } from '../fx/motion.ts';
import { rectOf } from '../dom.ts';
import { track } from './ambient.ts';

const SHAPE = 'M12 21.2C11.4 20.8 2.5 14.9 2.5 8.6 2.5 5.3 5 3 8 3c1.8 0 3.2.9 4 2.2C12.8 3.9 14.2 3 16 3c3 0 5.5 2.3 5.5 5.6 0 6.3-8.9 12.2-9.5 12.6Z';
let uid = 0;

export function heartSvg(full: boolean): string {
  if (!full) return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${SHAPE}" fill="none" stroke="#EBA9BC" stroke-width="1.3" stroke-dasharray="1.6 1.4" stroke-linecap="round"/></svg>`;
  const id = `hg${++uid}`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7A3BC"/><stop offset=".55" stop-color="#E8789A"/><stop offset="1" stop-color="#C7406E"/></linearGradient></defs><path d="${SHAPE}" fill="url(#${id})" stroke="#D9A441" stroke-width="1.4"/><path d="M6.4 6.2c-1 .6-1.6 1.6-1.6 2.8" fill="none" stroke="#FFFFFF" stroke-width="1.3" stroke-linecap="round" opacity=".85"/></svg>`;
}

/** A row of three hearts. The last one left pulses gently. */
export function heartsRow(count: number, cls = ''): HTMLElement {
  const row = h(`div.hearts${cls ? `.${cls}` : ''}`, { 'data-testid': 'hearts', 'data-hearts': String(count), 'aria-label': `${count} of ${TOWER_HEARTS} hearts` });
  for (let i = 0; i < TOWER_HEARTS; i++) row.append(h('span.heart', { class: i < count ? 'full' : 'empty', html: heartSvg(i < count) }));
  pulseLast(row);
  return row;
}

function pulseLast(row: HTMLElement): void {
  const full = row.querySelectorAll<HTMLElement>('.heart.full');
  for (const el of row.querySelectorAll<HTMLElement>('.heart')) for (const a of el.getAnimations()) a.cancel();
  if (full.length !== 1 || motion.reduced) return;
  track(full[0].animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 1600, iterations: Infinity, easing: 'ease-in-out' }));
}

/** The heart at `index` cracks down the middle, its halves part, petals fall, and it settles into the outline. */
export async function crackHeart(row: HTMLElement, index: number): Promise<void> {
  const el = row.querySelectorAll<HTMLElement>('.heart')[index];
  if (!el) return;
  fx('tower.heartLost');
  sfx('heartCrack');
  const done = () => {
    el.className = 'heart empty';
    el.innerHTML = heartSvg(false);
    row.dataset.hearts = String(row.querySelectorAll('.heart.full').length);
    row.setAttribute('aria-label', `${row.dataset.hearts} of ${TOWER_HEARTS} hearts`);
    pulseLast(row);
  };
  if (motion.reduced) { done(); return; }
  const halves = h('span.heart-halves', null,
    h('span.half.l', { html: heartSvg(true) }),
    h('span.half.r', { html: heartSvg(true) }),
  );
  el.innerHTML = '';
  el.append(halves);
  const [l, r] = [...halves.children] as HTMLElement[];
  const c = center(rectOf(el));
  burst(c.x, c.y, 8, ['petal'], 40);
  await Promise.all([
    animate(l, [{ transform: 'none', opacity: 1 }, { transform: 'translate(-.25em, .1em) rotate(-14deg)', opacity: 1, offset: 0.5 }, { transform: 'translate(-.3em, .5em) rotate(-20deg)', opacity: 0 }], { ms: 800, ease: SOFT }),
    animate(r, [{ transform: 'none', opacity: 1 }, { transform: 'translate(.25em, .1em) rotate(14deg)', opacity: 1, offset: 0.5 }, { transform: 'translate(.3em, .5em) rotate(20deg)', opacity: 0 }], { ms: 800, ease: SOFT }),
  ]);
  done();
}

/** An empty outline fills with pink from the bottom up, with a gold sparkle. */
export async function refillHeart(row: HTMLElement, index: number): Promise<void> {
  const el = row.querySelectorAll<HTMLElement>('.heart')[index];
  if (!el) return;
  fx('tower.heartBack');
  sfx('heartBack');
  el.className = 'heart full';
  el.innerHTML = heartSvg(true);
  row.dataset.hearts = String(row.querySelectorAll('.heart.full').length);
  row.setAttribute('aria-label', `${row.dataset.hearts} of ${TOWER_HEARTS} hearts`);
  pulseLast(row);
  if (motion.reduced) return;
  const c = center(rectOf(el));
  burst(c.x, c.y, 8, ['gold', 'sparkle'], 36);
  await animate(el, [{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { ms: 800, ease: SOFT });
}
