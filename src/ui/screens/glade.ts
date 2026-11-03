// The Moonlit Glade map: the Heart Path, fogged at dusk until Lunaria is beaten, then bright at sunrise.
import { BOTS, GLADE_STOPS, LUNARIA_TITLE, TYPE_LABEL, UNLOCKABLES, type GladeStop, type GladeStopId } from '../../content.ts';
import { gladeFogged, gladeOpenedAt, gladePlayStop, gladeWon } from '../../meta/progress.ts';
import { app, persist } from '../app.ts';
import { icon, petalSvg, portraitEl } from '../art.ts';
import { sfx } from '../audio/audio.ts';
import { h, wait } from '../dom.ts';
import { fogLayer, type FogLayer } from '../fx/fog.ts';
import { SOFT, animate, burst, fx, motion } from '../fx/motion.ts';
import { centerOfStop, placeCta, starsRow } from './journey.ts';

/** Where each stop's medallion sits, in rem, on a 39 by 65 rem map. From the reference mock-ups. */
export const GLADE_SPOTS: Record<GladeStopId, { x: number; y: number }> = {
  g3: { x: 19.5, y: 8 },
  g2: { x: 19.5, y: 24.4 },
  a2: { x: 5.9, y: 37.4 },
  b2: { x: 33.1, y: 37.4 },
  a1: { x: 7, y: 48.6 },
  b1: { x: 32, y: 48.6 },
  g1: { x: 19.5, y: 58.4 },
};
export const GLADE_HEIGHT = 65;

/** The Heart Path in tenths of a rem: the stem up to G1, both lanes over the lobes to G2, and the climb to G3. */
const LEFT_LANE = 'M195 584C150 572 92 538 78 486C66 440 50 414 59 374C70 300 120 248 195 244';
const RIGHT_LANE = 'M195 584C240 572 298 538 312 486C324 440 340 414 331 374C320 300 270 248 195 244';
const STEM = 'M195 584L195 660';
const CLIMB = 'M195 244L195 80';

/** Rosebuds along both sides of the path, from G3 down, so the bloom can ripple in order. */
const BUDS: [number, number][] = [
  [178, 120], [212, 178], [118, 252], [272, 252], [96, 300], [294, 300], [66, 342], [324, 342],
  [40, 420], [350, 420], [96, 438], [294, 438], [62, 520], [328, 520], [140, 566], [250, 566], [176, 620], [214, 640],
];

function pathSvg(): string {
  const path = (d: string) => `<path d="${d}" class="gp-bed"/><path d="${d}" class="gp-dash"/>`;
  return `<svg class="glade-path" viewBox="0 0 390 650" aria-hidden="true">${path(STEM)}${path(LEFT_LANE)}${path(RIGHT_LANE)}${path(CLIMB)}</svg>`;
}

function lantern(x: number, y: number, lit: boolean): HTMLElement {
  return h('i.lantern', { class: lit ? 'lit' : '', style: `left:${x}rem;top:${y}rem`, html: '<svg viewBox="0 0 24 60" aria-hidden="true"><path d="M4 60V8Q4 2 10 2H14" fill="none" stroke="#A97E93" stroke-width="2.4" stroke-linecap="round"/><path d="M14 2V8" stroke="#A97E93" stroke-width="1.6"/><rect class="lamp" x="8" y="8" width="12" height="16" rx="3"/><circle class="flame" cx="14" cy="16" r="3"/></svg>' });
}

function stones(x: number, y: number): HTMLElement {
  return h('i.old-stones', { style: `left:${x}rem;top:${y}rem`, html: '<svg viewBox="0 0 40 30" aria-hidden="true"><path d="M4 30V10Q4 4 10 4Q16 4 16 10V30Z" fill="#C9BFC8"/><path d="M20 30V14Q20 9 26 9Q32 9 32 14V30Z" fill="#D6CCD4"/><path d="M4 12Q10 8 16 13" stroke="#8FB58A" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M21 17Q26 13 31 17" stroke="#8FB58A" stroke-width="2" fill="none" stroke-linecap="round"/></svg>' });
}

function pond(): HTMLElement {
  return h('i.pond', { html: '<svg viewBox="0 0 120 70" aria-hidden="true"><ellipse cx="60" cy="36" rx="58" ry="30" class="water"/><ellipse cx="44" cy="32" rx="12" ry="7" fill="#9FC58F"/><ellipse cx="80" cy="42" rx="11" ry="6" fill="#8FB58A"/><ellipse cx="62" cy="50" rx="8" ry="4.5" fill="#9FC58F"/><g transform="translate(58 26)"><path d="M0 6C-6 4-8-2-4-4C-2 0 0 0 0 -6C0 0 2 0 4-4C8-2 6 4 0 6Z" fill="#E8789A"/></g></svg>' });
}

function signpost(): HTMLElement {
  return h('div.signpost', { 'aria-hidden': 'true', 'data-testid': 'signpost' },
    h('i.post'),
    h('span.board.left', null, 'Lantern Lane'),
    h('span.board.right', null, 'Lily Pond'),
  );
}

function bud(x: number, y: number, order: number): HTMLElement {
  return h('i.bud', { style: `left:${x / 10}rem;top:${y / 10}rem`, 'data-order': order, html: '<svg viewBox="0 0 16 20" aria-hidden="true"><path class="stem" d="M8 20V10" stroke="#6E9A6A" stroke-width="1.6"/><path class="leafy" d="M8 15C4 13 3 11 4 9C7 10 8 12 8 15Z" fill="#7FAE77"/><g class="closed"><path d="M8 11C4 9 4 4 8 1C12 4 12 9 8 11Z" fill="var(--bloom-bud)"/></g><g class="open"><circle cx="8" cy="7" r="5.6" fill="var(--bloom-open)"/><circle cx="8" cy="7" r="3.4" fill="#F2A7BC"/><path d="M6 7a2 2 0 1 1 3 1.4" fill="none" stroke="#FFF8F4" stroke-width=".8" stroke-linecap="round"/></g></svg>' });
}

function bush(x: number, y: number): HTMLElement {
  return h('i.bush', { style: `left:${x}rem;top:${y}rem` }, h('i'), h('i'), h('b'), h('b'));
}

function wingsSvg(): string {
  return '<svg viewBox="0 0 200 120" aria-hidden="true"><g fill="#F1E8F7" stroke="#C9B6DD" stroke-width="1.6"><path d="M92 62C70 8 18 0 8 24c-9 22 26 62 84 52Z"/><path d="M108 62C130 8 182 0 192 24c9 22-26 62-84 52Z"/></g><g fill="none" stroke="#C9B6DD" stroke-width="1.2" stroke-linecap="round"><path d="M22 18c4-6 12-6 12 2"/><path d="M178 18c-4-6-12-6-12 2"/><path d="M26 66c6 4 14 2 14-4"/><path d="M174 66c-6 4-14 2-14-4"/></g><g fill="#E8789A"><circle cx="40" cy="32" r="3"/><circle cx="160" cy="32" r="3"/><circle cx="60" cy="66" r="2.4"/><circle cx="140" cy="66" r="2.4"/></g><g fill="#D9A441"><circle cx="70" cy="38" r="1.6"/><circle cx="130" cy="38" r="1.6"/></g></svg>';
}

function veil(): HTMLElement {
  return h('i.mist-veil', { html: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#FFFFFF" fill-opacity=".72"/><path d="M8 18c4-4 10-4 14 0s10 4 12 0" fill="none" stroke="#C9B6DD" stroke-width="2.2" stroke-linecap="round"/><path d="M10 25c4-3 9-3 12 0s8 3 10 0" fill="none" stroke="#C9B6DD" stroke-width="2.2" stroke-linecap="round"/></svg>' });
}

/** The rewards for winning a Glade stop, in the same wording as Map 1's reward chip. */
export function gladeReward(id: GladeStopId): string | null {
  const items = UNLOCKABLES.filter((u) => u.req.kind === 'glade' && u.req.stop === id);
  if (items.length === 0) return null;
  const first = items[0];
  const label = first.type === 'mode' ? 'mode' : TYPE_LABEL[first.type].toLowerCase();
  return `${first.name} ${label}${items.length > 1 ? ` + ${items.length - 1} more` : ''}`;
}

type StopState = 'won' | 'current' | 'open' | 'locked';

function stopState(id: GladeStopId, play: GladeStopId | null): StopState {
  const save = app.save;
  if (id === play) return 'current';
  if (gladeWon(save, id)) return 'won';
  return gladeOpenedAt(save, GLADE_STOPS.find((s) => s.id === id)!) !== null ? 'open' : 'locked';
}

function stopNode(stop: GladeStop, state: StopState, onTap: () => void, onLocked: (node: HTMLElement) => void): HTMLElement {
  const boss = stop.id === 'g3';
  const bot = BOTS[stop.featured];
  const spot = GLADE_SPOTS[stop.id];
  const reward = state === 'current' ? gladeReward(stop.id) : null;
  const locked = state === 'locked';
  const portrait = portraitEl(stop.featured, boss || state === 'current' ? 'medium' : 'small');
  const node: HTMLElement = h('div.stop.gstop', {
    class: `${state} ${boss ? 'boss-stop' : ''}`,
    style: `left:${spot.x}rem;top:${spot.y}rem`,
    'data-testid': `glade-${stop.id}`, 'data-state': state,
  },
    state === 'won' || state === 'open' ? starsRow(state === 'won' ? app.save.glade.stars[stop.id] ?? 0 : 0) : null,
    h('button.stop-btn', {
      'aria-label': `${stop.place}: ${bot.name}${locked ? ', locked' : ''}`,
      onclick: () => (locked ? onLocked(node) : onTap()),
    },
      boss ? h('div.mist-wings', { html: wingsSvg() }) : null,
      h('div.stop-medal', null, portrait, locked ? veil() : null),
      locked ? h('span.lock-badge', { html: icon('lock') }) : null,
    ),
    boss
      ? h('div.boss-plate.glade-plate', null, h('small', null, 'FINAL BOSS'), h('b', null, LUNARIA_TITLE))
      : h('div.name-plate', null, bot.name),
    state === 'current' ? h('div.stop-cta', { 'data-testid': 'stop-cta' },
      h('button.btn.primary.play', { onclick: onTap, 'data-testid': 'play', html: `${icon('play')}<span>Play</span>` }),
      reward ? h('div.reward-chip', { 'data-testid': 'reward-chip' }, `Win: ${reward}`) : null,
    ) : null,
  );
  return node;
}

export type GladeView = { inner: HTMLElement; ready: (scroller: HTMLElement) => void; leave: () => void; liftScene: () => Promise<void> };

/** Builds the Glade map's content. `onStop` opens a stop's Match Intro; `onLocked` explains a locked one. */
export function gladeView(onStop: (id: GladeStopId) => void, onLocked: (id: GladeStopId, node: HTMLElement) => void): GladeView {
  const save = app.save;
  const fogged = gladeFogged(save);
  const play = gladePlayStop(save);
  const stops = GLADE_STOPS.map((s) => stopNode(s, stopState(s.id, play), () => onStop(s.id), (node) => onLocked(s.id, node)));
  const buds = BUDS.map(([x, y], i) => bud(x, y, i));
  const inner = h('div.map-inner.glade-inner', { style: `height:${GLADE_HEIGHT}rem` },
    h('i.sky-glow'),
    h('i.moon', { html: '<svg viewBox="0 0 60 60" aria-hidden="true"><path d="M40 6A26 26 0 1 0 54 44A22 22 0 1 1 40 6Z" fill="var(--moon-glow)" stroke="#E7D6EE" stroke-width="1.5"/></svg>' }),
    h('i.sun-rays'),
    [12, 46, 82].map((x, i) => h('i.sparkle', { style: `left:${x / 3}rem;top:${[1.5, 4.5, 2.2][i]}rem` })),
    h('i.mound.a'), h('i.mound.b'), h('i.mound.c'),
    bush(-1, 21), bush(35.5, 13), bush(-1, 51), bush(35.5, 46), bush(-0.5, 58.5),
    h('div.map-path', { html: pathSvg() }),
    buds,
    lantern(1.4, 39, fogged), lantern(12.6, 44.5, fogged), lantern(3, 53, fogged),
    pond(),
    stones(13.2, 22), stones(23.6, 22),
    signpost(),
    stops,
  );
  inner.classList.toggle('fogged', fogged);
  inner.classList.toggle('lifted', !fogged);

  let fog: FogLayer | null = null;
  const fireflies: Animation[] = [];
  const target = stops[GLADE_STOPS.findIndex((s) => s.id === (play ?? 'g3'))];

  const ready = (scroller: HTMLElement) => {
    const screen = scroller.parentElement!;
    if (fogged) {
      fog = fogLayer(screen.clientWidth, screen.clientHeight);
      scroller.after(fog.el);
      startFireflies(inner, target, fireflies);
    }
    const cta = target.querySelector<HTMLElement>('.stop-cta');
    if (cta) {
      const place = () => placeCta(scroller, target, cta, true);
      place();
      void document.fonts.ready.then(() => { if (cta.isConnected) place(); });
    }
    if (scroller.scrollHeight > scroller.clientHeight) {
      const r = target.getBoundingClientRect();
      const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
      const middle = cta ? centerOfStop(scroller, target) : r.top + r.height / 2 - origin;
      scroller.scrollTop = Math.max(0, middle - scroller.clientHeight / 2);
    }
  };

  const leave = () => {
    fog?.stop();
    fireflies.forEach((a) => a.cancel());
  };

  /** The one-time scene: clouds race away, the sky warms, the buds bloom from the boss down, petals burst. */
  const liftScene = async () => {
    fx('fog.lift');
    sfx('fogLift');
    let skipped = false;
    const shield = h('button.scene-skip', { 'aria-label': 'Skip', 'data-testid': 'lift-skip', onclick: () => { skipped = true; } });
    inner.parentElement!.parentElement!.append(shield);
    const steps: Promise<void>[] = [];
    // 1. The clouds speed up, drift off both edges and fade.
    if (fog) {
      const clouds = [...fog.el.querySelectorAll<HTMLElement>('.cloud')];
      const w = fog.el.clientWidth;
      for (const c of clouds) {
        c.getAnimations().forEach((a) => a.pause());
        const box = c.getBoundingClientRect();
        const toRight = box.left + box.width / 2 > w / 2;
        const now = getComputedStyle(c).transform;
        steps.push(animate(c, [{ transform: now === 'none' ? 'none' : now, opacity: c.style.opacity }, { transform: `${now === 'none' ? '' : now} translateX(${toRight ? w : -w}px)`, opacity: 0 }], { ms: 1400, ease: 'ease-in', ambient: true }));
      }
    }
    fireflies.forEach((a) => a.cancel());
    await Promise.race([wait(motion.reduced ? 0 : 1000), until(() => skipped)]);
    // 2. The sky warms from dusk to a bright blush sunrise.
    inner.classList.add('lifting');
    steps.push(animate(inner.querySelector('.sky-glow')!, [{ opacity: 0 }, { opacity: 1 }], { ms: 1500, ease: SOFT, ambient: true }));
    // 3. The buds open in a ripple from the boss stop down to Stop 1.
    const sorted = [...buds].sort((a, b) => Number(a.dataset.order) - Number(b.dataset.order));
    sorted.forEach((b, i) => {
      setTimeout(() => { b.classList.add('bloomed'); fx('fog.bloom'); }, motion.reduced || skipped ? 0 : 900 + i * 90);
    });
    await Promise.race([wait(motion.reduced ? 0 : 900 + sorted.length * 90 + 300), until(() => skipped)]);
    // 4. A petal burst.
    const r = inner.getBoundingClientRect();
    if (!motion.reduced) burst(r.left + r.width / 2, r.top + r.height * 0.4, 24, ['petal'], 160);
    // 5. The banner.
    const banner = h('div.banner.lift-banner', { 'data-testid': 'lift-banner' }, h('b', null, 'The fog has lifted!'), h('small', null, 'Card counts are now visible across the Glade.'));
    inner.parentElement!.parentElement!.append(banner);
    void animate(banner, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.85)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)' }], { ms: 420, ease: 'cubic-bezier(.34,1.56,.64,1)', ambient: true });
    await Promise.race([wait(motion.reduced ? 600 : 1600), until(() => skipped)]);
    void animate(banner, [{ opacity: 1 }, { opacity: 0 }], { ms: 300, ambient: true }).then(() => banner.remove());
    fog?.stop();
    fog = null;
    inner.classList.remove('fogged', 'lifting');
    inner.classList.add('lifted');
    buds.forEach((b) => b.classList.add('bloomed'));
    inner.querySelectorAll('.lantern').forEach((l) => l.classList.remove('lit'));
    shield.remove();
  };

  return { inner, ready, leave, liftScene };
}

function until(test: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => (test() ? resolve() : setTimeout(tick, 50));
    tick();
  });
}

/** 6 to 10 fireflies drift, slowly and endlessly, toward the stop with the Play button. */
function startFireflies(inner: HTMLElement, target: HTMLElement, out: Animation[]): void {
  fx('glade.fireflies');
  const tx = parseFloat(target.style.left);
  const ty = parseFloat(target.style.top);
  const count = 8;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const sx = tx + Math.cos(angle) * 12;
    const sy = ty + Math.sin(angle) * 10;
    const fly = h('i.firefly', { style: `left:${sx}rem;top:${sy}rem` });
    inner.append(fly);
    const dx = (tx - sx) * 0.7;
    const dy = (ty - sy) * 0.7;
    const a = fly.animate(
      [
        { transform: 'translate(0,0)', opacity: 0 },
        { transform: `translate(${dx * 0.5}rem,${dy * 0.5 - 1}rem)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx}rem,${dy}rem)`, opacity: 0 },
      ],
      { duration: 5200 + i * 430, iterations: Infinity, delay: -i * 700, easing: 'ease-in-out' },
    );
    if (motion.reduced) a.pause();
    out.push(a);
  }
}

void petalSvg;
void persist;
