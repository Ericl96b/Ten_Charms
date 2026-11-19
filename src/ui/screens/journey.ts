// The Journey map (home screen), the Match Intro sheet, and starting matches.
import type { BotId } from '../../bots/profiles.ts';
import { BOTS, GLADE_STOPS, LINES, STOPS, TYPE_LABEL, UNLOCKABLES, gladeStop, type GladeStopId } from '../../content.ts';
import { createGame } from '../../engine/game.ts';
import { PHASES } from '../../engine/phases.ts';
import type { GameEvent, MatchRules, Variant } from '../../engine/types.ts';
import { crossroadsOpen, currentStop, gladeFogged, gladeOpen, gladeStars, newTracker, totalStars } from '../../meta/progress.ts';
import { canPlayStop, canSeeCrossroads, canSeeGlade, canUse, devModeOn } from '../../meta/devmode.ts';
import type { MatchMode, SavedMatch } from '../../meta/save.ts';
import { app, persist, show } from '../app.ts';
import { icon, portraitEl } from '../art.ts';
import { sfx, type MusicId } from '../audio/audio.ts';
import { h, wait } from '../dom.ts';
import { SOFT, SPRING, animate, fx, motion, setFxLayer } from '../fx/motion.ts';
import { closeAllSheets, openSheet, tooltip } from '../overlays.ts';
import { bossIntro, lunariaIntro } from '../table/boss.ts';
import { Table } from '../table/table.ts';
import { collectionScreen } from './collection.ts';
import { freePlayScreen } from './freeplay.ts';
import { GLADE_SPOTS, gladeReward, gladeView } from './glade.ts';
import { settingsScreen } from './settings.ts';
import { statsScreen } from './stats.ts';
import { crossroadsScreen } from './crossroads.ts';
import { towerMusic } from './tower.ts';

const SPOTS = [{ x: 12.5, y: 57 }, { x: 26, y: 45 }, { x: 12.5, y: 33 }, { x: 26, y: 21 }, { x: 19.5, y: 0.5 }];
/** How far the current stop's pink halo reaches past its portrait, in rem. */
const HALO = 1.6;
/** The Play button and reward chip stay this many points from the screen edges. */
const EDGE = 16;

export type NavTab = 'journey' | 'free' | 'collection' | 'stats';

export function bottomNav(active: NavTab): HTMLElement {
  const freeOpen = canUse(app.save, 'free-play');
  const item = (id: NavTab, label: string, ic: string, go: () => void, locked = false, lockedNote = '') =>
    h('button.nav-item', { class: `${active === id ? 'on' : ''} ${locked ? 'locked' : ''}`, 'data-testid': `nav-${id}`, onclick: go, 'aria-label': locked ? `${label}, locked. ${lockedNote}` : label, 'aria-current': active === id ? 'page' : undefined },
      h('span.nav-icon', { html: icon(locked ? 'lock' : ic) }),
      h('span.nav-label', null, label),
      locked ? h('small.nav-note', null, lockedNote) : null,
    );
  return h('nav.bottom-nav', null,
    item('journey', 'Journey', 'map', () => { if (active !== 'journey') show(journey(), mapMusic()); }),
    item('free', 'Free Play', 'cards', () => { if (freeOpen && active !== 'free') show(freePlayScreen(), 'map'); }, !freeOpen, 'Beat Pip to unlock'),
    item('collection', 'Collection', 'gift', () => { if (active !== 'collection') show(collectionScreen(), 'map'); }),
    item('stats', 'Stats', 'chart', () => { if (active !== 'stats') show(statsScreen(), 'map'); }),
  );
}

function rewardFor(stop: number): string | null {
  const items = UNLOCKABLES.filter((u) => u.req.kind === 'stop' && u.req.stop === stop + 1);
  if (items.length === 0) return null;
  const first = items[0];
  const label = first.type === 'mode' ? 'mode' : TYPE_LABEL[first.type].toLowerCase();
  return `${first.name} ${label}${items.length > 1 ? ` + ${items.length - 1} more` : ''}`;
}

export function starsRow(n: number): HTMLElement {
  const row = h('div.stars', { 'aria-label': `${n} of 3 stars` });
  for (let i = 0; i < 3; i++) row.append(h('span.star', { class: i < n ? 'on' : 'off', html: icon('star') }));
  return row;
}

/** The Crossroads' one-time reveal is owed: it waits until the fog-lift scene, which comes first, has played. */
function crossroadsRevealDue(): boolean {
  const save = app.save;
  return crossroadsOpen(save) && !save.tower.revealSeen && !save.glade.liftScenePending && save.glade.revealSeen;
}

/** The home screen: whichever place she last viewed, after the one-time reveals of the Glade and the Crossroads. */
export function journey(): HTMLElement {
  const save = app.save;
  if (gladeOpen(save) && !save.glade.revealSeen) return gardenMap(true);
  if (crossroadsRevealDue()) return gladeMap(true);
  if (canSeeCrossroads(save) && save.glade.lastMap === 'crossroads') return crossroadsScreen();
  return canSeeGlade(save) && save.glade.lastMap === 'glade' ? gladeMap() : gardenMap(false);
}

/** The music for the place being shown. */
export function mapMusic(): MusicId {
  const save = app.save;
  // A place open only in Dev Mode has no reveal of its own to wait for; one that is really open waits for its reveal.
  const gladeRevealDue = gladeOpen(save) && !save.glade.revealSeen;
  if (save.glade.lastMap === 'crossroads' && (crossroadsOpen(save) ? save.tower.revealSeen : devModeOn() && !gladeRevealDue)) return towerMusic();
  if (save.glade.lastMap !== 'glade' || !(gladeOpen(save) ? save.glade.revealSeen : devModeOn())) return 'map';
  return gladeFogged(save) ? 'gladeFog' : 'gladeLift';
}

export type Place = 'garden' | 'glade' | 'crossroads';

/**
 * The three-part switcher and the gear. Each map's own option shows its stars, so there's no star counter beside it;
 * the Crossroads is an icon-only signpost at the right end.
 */
export function mapTop(which: Place): HTMLElement {
  const save = app.save;
  const open = canSeeGlade(save);
  const xrOpen = canSeeCrossroads(save);
  const pick = (id: Place, el: HTMLElement) => {
    if (id === 'glade' && !open) { tooltip(el, 'Beat Nightshade to unlock.'); return; }
    if (id === 'crossroads' && !xrOpen) { tooltip(el, 'Beat Lady Lunaria to unlock.'); return; }
    if (id === which) return;
    fx('map.switch');
    sfx('pageTurn');
    save.glade.lastMap = id;
    persist();
    show(journey(), mapMusic(), 'none');
  };
  const signpost: HTMLElement = h('button.map-opt.map-sign', {
    class: `${which === 'crossroads' ? 'on' : ''} ${xrOpen ? '' : 'locked'}`,
    'data-testid': 'map-crossroads', 'aria-pressed': which === 'crossroads' ? 'true' : 'false',
    'aria-label': xrOpen ? 'The Crossroads' : 'The Crossroads, locked. Beat Lady Lunaria to unlock.',
    onclick: () => pick('crossroads', signpost),
  },
    h('span.sign-icon', { html: icon('signpost') }),
    xrOpen ? null : h('span.sign-lock', { html: icon('lock') }),
  );
  const option = (id: 'garden' | 'glade', name: string, stars: number, total: number) => {
    const locked = id === 'glade' && !open;
    const el: HTMLElement = h('button.map-opt', {
      class: `${which === id ? 'on' : ''} ${locked ? 'locked' : ''}`,
      'data-testid': `map-${id}`, 'aria-pressed': which === id ? 'true' : 'false',
      'aria-label': locked ? `${name}, locked. Beat Nightshade to unlock.` : `${name}, ${stars} of ${total} stars`,
      onclick: () => pick(id, el),
    },
      locked ? h('b', { html: `${icon('lock')}<span>${name}</span>` }) : h('b', null, name),
      locked
        ? h('small.opt-note', null, 'Beat Nightshade to unlock.')
        : h('small', { html: `${icon('star')}<span>${stars}/${total}</span>` }),
    );
    return el;
  };
  return h('div.map-top', { 'data-testid': 'map-top' },
    h('div.map-switch', { 'data-testid': 'map-switch', role: 'group', 'aria-label': 'Map' },
      option('garden', 'Rose Garden', totalStars(save), 15),
      option('glade', 'Moonlit Glade', gladeStars(save), 21),
      signpost,
    ),
    h('button.round-btn', { 'aria-label': 'Settings', html: icon('settings'), onclick: () => settingsScreen(false), 'data-testid': 'settings' }),
  );
}

function gardenMap(reveal: boolean): HTMLElement {
  const save = app.save;
  const current = currentStop(save);
  const allWon = save.campaign.won.every(Boolean);
  const stops = STOPS.map((stop, i) => {
    const won = save.campaign.won[i];
    const open = canPlayStop(save, i);
    const isCurrent = i === current && !won;
    const bot = BOTS[stop.featured];
    const boss = i === 4;
    const portrait = portraitEl(stop.featured, boss || isCurrent ? 'medium' : 'small');
    const reward = isCurrent ? rewardFor(i) : null;
    const tap = () => {
      if (open) matchIntro(i);
      else tooltip(node, `Win Stop ${i} to open this stop.`);
    };
    const node = h('div.stop', {
      class: `${won ? 'won' : ''} ${isCurrent ? 'current' : ''} ${!open ? 'locked' : ''} ${boss ? 'boss-stop' : ''}`,
      style: `left:${SPOTS[i].x}rem;top:${SPOTS[i].y}rem`,
      'data-testid': `stop-${i + 1}`,
    },
      won ? starsRow(save.campaign.stars[i]) : null,
      h('button.stop-btn', { onclick: tap, 'aria-label': `Stop ${i + 1}: ${bot.name}${open ? '' : ', locked'}` },
        boss ? h('div.moth-wings', { html: wingsSvg() }) : null,
        h('div.stop-medal', null, portrait),
        !open ? h('span.lock-badge', { html: icon('lock') }) : null,
      ),
      boss
        ? h('div.boss-plate', null, h('small', null, 'FINAL BOSS'), h('b', null, 'Nightshade, the Moth Queen'))
        : h('div.name-plate', null, bot.name),
      isCurrent ? h('div.stop-cta', { 'data-testid': 'stop-cta' },
        h('button.btn.primary.play', { onclick: () => matchIntro(i), 'data-testid': 'play', html: `${icon('play')}<span>Play</span>` }),
        reward ? h('div.reward-chip', { 'data-testid': 'reward-chip' }, `Win: ${reward}`) : null,
      ) : null,
    );
    return node;
  });

  const scroller = h('div.map-scroll', { 'data-testid': 'map' },
    h('div.map-inner', null,
      h('i.bed.a'), h('i.bed.b'), h('i.bed.c'),
      bush(0.5, 13), bush(31.5, 8), bush(1, 42), bush(31.5, 62), bush(0.5, 66),
      h('div.map-path', { html: pathSvg() }),
      stops,
    ),
  );
  const root = h('div.screen.map-screen', { 'data-screen': 'journey', 'data-map': 'garden' },
    mapTop('garden'),
    scroller,
    bottomNav('journey'),
  );
  if (reveal) {
    // Saved first, so a force-quit partway through can never replay it.
    save.glade.revealSeen = true;
    save.glade.lastMap = 'glade';
    persist();
    requestAnimationFrame(() => void revealGlade(root, scroller));
  }
  requestAnimationFrame(() => {
    const target = stops[allWon ? 4 : current];
    const cta = target.querySelector<HTMLElement>('.stop-cta');
    if (cta) {
      const place = () => placeCta(scroller, target, cta);
      place();
      void document.fonts.ready.then(() => { if (cta.isConnected) place(); });
      window.addEventListener('resize', place);
      app.onLeave = () => window.removeEventListener('resize', place);
    }
    if (scroller.scrollHeight > scroller.clientHeight) {
      scroller.scrollTop = Math.max(0, cta ? centerOfStop(scroller, target) - scroller.clientHeight / 2 : target.offsetTop - scroller.clientHeight / 2);
    }
  });
  return root;
}

type Box = { l: number; t: number; r: number; b: number };

/** Puts the Play button and reward chip beside the current stop, on whichever side has room, or else below its plate. */
export function placeCta(scroller: HTMLElement, stop: HTMLElement, cta: HTMLElement, wide = false): void {
  const inner = scroller.firstElementChild as HTMLElement;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  const origin = inner.getBoundingClientRect();
  const boxOf = (el: Element, grow = 0): Box => {
    const r = el.getBoundingClientRect();
    return { l: r.left - origin.left - grow, t: r.top - origin.top - grow, r: r.right - origin.left + grow, b: r.bottom - origin.top + grow };
  };
  const node = boxOf(stop.querySelector('.portrait')!, HALO * rem);
  const blocked = [node, ...[...inner.querySelectorAll('.stop-btn, .moth-wings, .mist-wings, .stars, .name-plate, .boss-plate, .signpost .board, .signpost .post')].map((el) => boxOf(el))];
  const plate = boxOf(stop.querySelector('.name-plate, .boss-plate')!);
  const w = cta.offsetWidth;
  const height = cta.offsetHeight;
  const gap = 0.8 * rem;
  const minX = EDGE;
  const maxX = inner.clientWidth - EDGE - w;
  // The Glade's map ends right at the bottom bar, so there the button keeps a gap from the bottom edge too.
  const bottomRoom = wide ? gap : 0;
  const free = (x: number, y: number) => x >= minX && x <= maxX && y >= 0 && y + height + bottomRoom <= inner.clientHeight
    && blocked.every((b) => x + w + gap <= b.l || x >= b.r + gap || y + height + gap <= b.t || y >= b.b + gap);

  const slides = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 3, -3, 4, -4, 5, -5];
  const beside = (x: number): { x: number; y: number } | null => {
    const y = (node.t + node.b) / 2 - height / 2;
    for (const s of slides) if (free(x, y + s * rem)) return { x, y: y + s * rem };
    return null;
  };
  const below = (): { x: number; y: number } | null => {
    const middle = Math.min(maxX, Math.max(minX, (node.l + node.r) / 2 - w / 2));
    for (const down of [0, 1, 2, 3, 4]) {
      for (const s of slides.concat(6, -6, 7, -7, 8, -8, 9, -9, 10, -10)) {
        const x = middle + s * rem;
        const y = plate.b + gap + down * rem;
        if (free(x, y)) return { x, y };
      }
    }
    return null;
  };
  /** The Glade's map is busier: when nothing nearer is free, look further to either side below the plate. */
  const further = (): { x: number; y: number } | null => {
    if (!wide) return null;
    const middle = (node.l + node.r) / 2 - w / 2;
    for (const down of [0, 1, 2, 3]) {
      for (const s of [11, -11, 12, -12, 13, -13, 14, -14, 15, -15, 16, -16]) {
        const x = Math.min(maxX, Math.max(minX, middle + s * rem));
        const y = plate.b + gap + down * rem;
        if (free(x, y)) return { x, y };
      }
    }
    // Then up into the open middle of the heart, as for the first stop at its bottom point.
    for (let up = 0; up <= 14; up++) {
      for (const s of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
        const x = Math.min(maxX, Math.max(minX, middle + s * rem));
        const y = node.t - gap - height - up * rem;
        if (free(x, y)) return { x, y };
      }
    }
    return null;
  };
  const right = beside(node.r + gap);
  const left = right ? null : beside(node.l - gap - w);
  const spot = right ?? left ?? below() ?? further() ?? { x: Math.min(maxX, Math.max(minX, (node.l + node.r) / 2 - w / 2)), y: plate.b + gap };
  const home = boxOf(stop);
  cta.style.left = `${spot.x - home.l}px`;
  cta.style.top = `${spot.y - home.t}px`;
  cta.dataset.side = right ? 'right' : left ? 'left' : 'below';
}

/** The middle of the current stop's node, name plate, button and chip together, for scrolling them all into view. */
export function centerOfStop(scroller: HTMLElement, stop: HTMLElement): number {
  const parts = [stop.querySelector('.stop-btn')!, stop.querySelector('.name-plate, .boss-plate')!, stop.querySelector('.stop-cta')!];
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const rects = parts.map((el) => el.getBoundingClientRect());
  return (Math.min(...rects.map((r) => r.top)) + Math.max(...rects.map((r) => r.bottom))) / 2 - origin;
}

function wingsSvg(): string {
  return `<svg viewBox="0 0 200 120" aria-hidden="true"><g fill="#3A1640"><path d="M92 62C70 8 18 0 8 24c-9 22 26 62 84 52Z"/><path d="M108 62C130 8 182 0 192 24c9 22-26 62-84 52Z"/></g><g fill="#C7406E"><circle cx="38" cy="34" r="9"/><circle cx="162" cy="34" r="9"/></g><g fill="#C9973F"><circle cx="58" cy="58" r="5"/><circle cx="142" cy="58" r="5"/></g></svg>`;
}

function pathSvg(): string {
  const d = 'M125 720C125 680 125 650 125 600S260 540 260 480 125 410 125 350 260 290 260 225 195 130 195 60';
  return `<svg viewBox="0 0 390 720" preserveAspectRatio="xMidYMin meet" aria-hidden="true"><path d="${d}" fill="none" stroke="#FFF8F4" stroke-width="30" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#EBA9BC" stroke-width="3" stroke-dasharray="4 11" stroke-linecap="round"/></svg>`;
}

function bush(x: number, y: number): HTMLElement {
  return h('i.bush', { style: `left:${x}rem;top:${y}rem` }, h('i'), h('i'), h('b'), h('b'));
}

/* ---------- The Moonlit Glade ---------- */

function gladeMap(revealCrossroads = false): HTMLElement {
  const save = app.save;
  const fogged = gladeFogged(save);
  const view = gladeView(gladeIntro, (id, node) => {
    const needs = gladeStop(id).opensAfter.map((x) => BOTS[gladeStop(x).featured].name);
    tooltip(node, `Win against ${needs.join(' or ')} to open this stop.`);
  });
  const scroller = h('div.map-scroll', { 'data-testid': 'map' }, view.inner);
  const root = h('div.screen.map-screen.glade-screen', { class: fogged ? 'fogged' : 'lifted', 'data-screen': 'journey', 'data-map': 'glade' },
    mapTop('glade'),
    scroller,
    bottomNav('journey'),
  );
  app.onLeave = () => view.leave();
  if (revealCrossroads) {
    // Saved first, so a force-quit partway through can never replay it.
    save.tower.revealSeen = true;
    save.glade.lastMap = 'crossroads';
    persist();
  }
  requestAnimationFrame(() => {
    view.ready(scroller);
    if (revealCrossroads) void revealTheCrossroads(root, scroller);
    if (save.glade.liftScenePending) {
      // Cleared before it plays, so it can never play twice.
      save.glade.liftScenePending = false;
      persist();
      void view.liftScene().then(() => {
        root.classList.remove('fogged');
        root.classList.add('lifted');
      });
      setTimeout(() => {
        root.classList.add('lifted');
        import('../audio/audio.ts').then((a) => a.playMusic('gladeLift')).catch(() => {});
      }, motion.reduced ? 0 : 1000);
    }
  });
  return root;
}

/** The one-time reveal: the garden path runs on past Nightshade into soft pink mist, and the view glides up into the Glade. */
async function revealGlade(root: HTMLElement, scroller: HTMLElement): Promise<void> {
  fx('glade.reveal');
  let skipped = false;
  const veil = h('div.reveal-veil', { 'data-testid': 'reveal-veil' });
  const banner = h('div.reveal-banner', { 'data-testid': 'reveal-banner' }, 'A path appears beyond the garden…');
  const shield = h('button.scene-skip', { 'aria-label': 'Skip', 'data-testid': 'reveal-skip', onclick: () => { skipped = true; } });
  const inner = scroller.firstElementChild as HTMLElement;
  const path = h('div.reveal-path', { html: '<svg viewBox="0 0 120 220" aria-hidden="true"><path d="M60 220C60 180 40 150 50 110S80 50 60 0" fill="none" stroke="#FFF8F4" stroke-width="30" stroke-linecap="round"/><path d="M60 220C60 180 40 150 50 110S80 50 60 0" fill="none" stroke="#EBA9BC" stroke-width="3" stroke-dasharray="4 11" stroke-linecap="round"/></svg>' });
  inner.append(path);
  root.append(veil, banner, shield);
  const until = (ms: number) => Promise.race([wait(motion.reduced ? Math.min(ms, 300) : ms), new Promise<void>((r) => { const t = () => (skipped ? r() : setTimeout(t, 40)); t(); })]);
  scroller.scrollTop = 0;
  void animate(path, [{ opacity: 0, transform: 'translateY(2rem)' }, { opacity: 1, transform: 'none' }], { ms: 700, ease: SOFT, ambient: true });
  void animate(veil, [{ opacity: 0 }, { opacity: 0.55 }], { ms: 900, ease: SOFT, ambient: true });
  void animate(banner, [{ opacity: 0, transform: 'translate(-50%, 1rem)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { ms: 500, ease: SOFT, delay: 300, ambient: true });
  await until(1600);
  // The view glides up into the mist.
  if (!motion.reduced && !skipped) {
    void animate(inner, [{ transform: 'none' }, { transform: 'translateY(30rem)' }], { ms: 1600, ease: 'ease-in-out', fill: 'forwards', ambient: true });
  }
  void animate(veil, [{ opacity: 0.55 }, { opacity: 1 }], { ms: skipped ? 120 : 1500, ease: 'ease-in', fill: 'forwards', ambient: true });
  await until(1600);
  const next = journey();
  show(next, mapMusic(), 'none');
  const after = h('div.reveal-veil.out');
  next.append(after);
  await animate(after, [{ opacity: 1 }, { opacity: 0 }], { ms: motion.reduced ? 200 : 700, ease: SOFT, ambient: true });
  after.remove();
}

/**
 * The Crossroads' one-time reveal: the Glade's path runs on past Lunaria's stop into soft pink mist, the view glides up
 * into it, and lands on the Crossroads, where the Tower card's Enter button pulses twice. About 4 s; a tap skips it.
 */
async function revealTheCrossroads(root: HTMLElement, scroller: HTMLElement): Promise<void> {
  fx('crossroads.reveal');
  let skipped = false;
  const veil = h('div.reveal-veil.pink', { 'data-testid': 'xr-reveal-veil' });
  const banner = h('div.reveal-banner', { 'data-testid': 'xr-reveal-banner' }, 'Two paths lie ahead…');
  const shield = h('button.scene-skip', { 'aria-label': 'Skip', 'data-testid': 'xr-reveal-skip', onclick: () => { skipped = true; fx('crossroads.revealSkip'); } });
  const inner = scroller.firstElementChild as HTMLElement;
  const path = h('div.reveal-path.xr', { html: '<svg viewBox="0 0 120 220" aria-hidden="true"><path d="M60 220C60 180 80 150 70 110S40 50 60 0" fill="none" stroke="#FFF8F4" stroke-width="30" stroke-linecap="round"/><path d="M60 220C60 180 80 150 70 110S40 50 60 0" fill="none" stroke="#EBA9BC" stroke-width="3" stroke-dasharray="4 11" stroke-linecap="round"/></svg>' });
  inner.append(path);
  root.append(veil, banner, shield);
  const until = (ms: number) => Promise.race([wait(motion.reduced ? Math.min(ms, 300) : ms), new Promise<void>((r) => { const t = () => (skipped ? r() : setTimeout(t, 40)); t(); })]);
  scroller.scrollTop = 0;
  void animate(path, [{ opacity: 0, transform: 'translateY(2rem)' }, { opacity: 1, transform: 'none' }], { ms: 700, ease: SOFT, ambient: true });
  void animate(veil, [{ opacity: 0 }, { opacity: 0.55 }], { ms: 900, ease: SOFT, ambient: true });
  void animate(banner, [{ opacity: 0, transform: 'translate(-50%, 1rem)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { ms: 500, ease: SOFT, delay: 300, ambient: true });
  await until(1600);
  if (!motion.reduced && !skipped) {
    void animate(inner, [{ transform: 'none' }, { transform: 'translateY(30rem)' }], { ms: 1600, ease: 'ease-in-out', fill: 'forwards', ambient: true });
  }
  void animate(veil, [{ opacity: 0.55 }, { opacity: 1 }], { ms: skipped ? 120 : 1500, ease: 'ease-in', fill: 'forwards', ambient: true });
  await until(1600);
  const next = crossroadsScreen({ pulseEnter: true });
  show(next, mapMusic(), 'none');
  const after = h('div.reveal-veil.pink.out');
  next.append(after);
  await animate(after, [{ opacity: 1 }, { opacity: 0 }], { ms: motion.reduced ? 200 : 700, ease: SOFT, ambient: true });
  after.remove();
}

/** The Match Intro for a Glade stop. */
export function gladeIntro(id: GladeStopId): void {
  const stop = gladeStop(id);
  const save = app.save;
  const bot = BOTS[stop.featured];
  const reward = gladeReward(id);
  const best = save.glade.stars[id] ?? 0;
  const fogged = gladeFogged(save);
  const crowned = stop.lineup.includes('lunaria');
  const order = [stop.featured, ...stop.lineup.filter((b) => b !== stop.featured)];
  const pips = h('div.pips', { 'aria-label': `Difficulty ${bot.pips} of 5` });
  for (let i = 0; i < 5; i++) pips.append(h('i', { class: i < bot.pips ? 'on' : '' }));
  const sheet = openSheet(h('div.intro', { 'data-testid': 'match-intro' },
    h('div.intro-portraits', null, order.map((b, i) => portraitEl(b, i === 0 ? 'large' : 'medium'))),
    h('h2.intro-name', null, bot.name),
    h('p.intro-epithet', null, `“${bot.epithet}” · ${stop.format}`),
    bot.blurb ? h('p.sheet-text', null, bot.blurb) : null,
    pips,
    h('div.rule-chips', null,
      fogged ? h('span.rule-chip', { 'data-testid': 'rule-fog', html: `${icon('wisp')}<span>Moonlit Fog — card counts are hidden.</span>` }) : null,
      crowned ? h('span.rule-chip', { 'data-testid': 'rule-crown', html: `${icon('thorncrown')}<span>Thorned Crown — no one can add to Lunaria's groups.</span>` }) : null,
    ),
    h('div.intro-facts', null,
      h('div', null, h('small', null, 'Your best'), starsRow(best)),
      reward ? h('div', null, h('small', null, 'Reward for winning'), h('b', null, reward)) : null,
    ),
    h('p.star-targets', { 'data-testid': 'star-targets' }, `2 stars: win in ${stop.stars.two} rounds or fewer · 3 stars: ${stop.stars.three} or fewer`),
    h('button.btn.primary.begin', {
      'data-testid': 'begin',
      onclick: () => {
        void sheet.close();
        const cloth = id === 'g3' ? 'mistveil' : save.equipped.cloth;
        startFromMode({ kind: 'glade', stop: id }, stop.lineup, 'moonlit', save.equipped.back, cloth);
      },
    }, 'Begin'),
  ));
}

/** Lunaria's boss match, as opposed to a Free Play match she happens to be in. */
export function isLunariaBoss(match: SavedMatch): boolean {
  return match.mode.kind === 'glade' && match.mode.stop === 'g3';
}

/** A Tower Guardian floor's Guardian, or null for any other table. */
export function towerGuardian(match: SavedMatch): 'nightshade' | 'lunaria' | null {
  if (match.mode.kind !== 'tower' || match.mode.floor % 10 !== 0) return null;
  return Math.ceil(match.mode.floor / 10) % 2 === 1 ? 'nightshade' : 'lunaria';
}

/** The music for a table. A Tower Guardian floor plays that boss's music; every other floor her chosen music. */
export function tableMusic(match: SavedMatch): MusicId {
  if (match.boss) return 'boss';
  if (isLunariaBoss(match)) return 'lunaria';
  const g = towerGuardian(match);
  if (g) return g === 'nightshade' ? 'boss' : 'lunaria';
  const m = app.save.equipped.music;
  return m === 'music-box' ? 'musicbox' : m === 'moonlight-waltz' ? 'moonwaltz' : 'waltz';
}

/** The bottom sheet opened by tapping a stop. */
export function matchIntro(index: number): void {
  const stop = STOPS[index];
  const save = app.save;
  const bot = BOTS[stop.featured];
  const reward = rewardFor(index);
  const best = save.campaign.stars[index];
  const pips = h('div.pips', { 'aria-label': `Difficulty ${bot.pips} of 5` });
  for (let i = 0; i < 5; i++) pips.append(h('i', { class: i < bot.pips ? 'on' : '' }));
  const sheet = openSheet(h('div.intro', { 'data-testid': 'match-intro' },
    h('div.intro-portraits', null, stop.lineup.map((b, i) => portraitEl(b, i === 0 ? 'large' : 'medium'))),
    h('h2.intro-name', null, bot.name),
    h('p.intro-epithet', null, `“${bot.epithet}” · ${stop.format}`),
    h('p.sheet-text', null, bot.blurb),
    pips,
    h('div.intro-facts', null,
      h('div', null, h('small', null, 'Your best'), starsRow(best)),
      reward ? h('div', null, h('small', null, 'Reward for winning'), h('b', null, reward)) : null,
    ),
    h('button.btn.primary.begin', {
      'data-testid': 'begin',
      onclick: () => {
        void sheet.close();
        startFromMode({ kind: 'campaign', stop: index }, stop.lineup, 'standard', save.equipped.back, save.equipped.cloth);
      },
    }, 'Begin'),
  ));
}

/** What a Tower floor brings to its match: its own list, its rules, and the seed it was drawn with. */
export type FloorSetup = { phases: number[]; rules: MatchRules; seed: string };

/** Starts a brand-new match. */
export function startFromMode(mode: MatchMode, lineup: BotId[], variant: Variant, back: string, cloth: string, seed?: string, botSeed?: string, floor?: FloorSetup): void {
  closeAllSheets();
  const crown = lineup.indexOf('lunaria');
  // The fog covers Glade campaign matches until the boss falls. The crown goes wherever Lunaria plays. A Tower floor
  // brings its own rules: the fog by tier, and the crown on the Guardian, whoever it is.
  const rules: MatchRules = floor ? { ...floor.rules } : {
    ...(mode.kind === 'glade' && gladeFogged(app.save) ? { fog: true } : {}),
    ...(crown >= 0 ? { crownSeat: crown + 1, crownName: BOTS.lunaria.name } : {}),
  };
  const { state, events } = createGame({ playerCount: lineup.length + 1, variant, seed: seed ?? floor?.seed, rules: Object.keys(rules).length > 0 ? rules : undefined, phases: floor?.phases });
  const boss = mode.kind === 'campaign' && mode.stop === 4;
  const match: SavedMatch = {
    game: state,
    lineup: lineup.slice(),
    mode,
    back,
    cloth,
    boss,
    ui: { order: state.players[0].hand.map((c) => c.id), sort: 'number', slots: [], roundShown: 0 },
    tracker: newTracker(),
    botTurns: [],
  };
  if (__DEV__ && botSeed) match.botSeed = botSeed;
  const phase = state.players[0].phase;
  match.ui.slots = phase === null ? [] : PHASES[phase].map(() => []);
  app.save.match = match;
  persist();
  void openTable(match, events);
}

async function openTable(match: SavedMatch, events: GameEvent[]): Promise<void> {
  const table = new Table(match, true);
  const guardian = towerGuardian(match);
  const intro = match.boss || isLunariaBoss(match) || guardian !== null;
  const root = table.mount();
  show(root, intro ? null : tableMusic(match));
  setFxLayer(table.fxEl);
  if (match.boss) await bossIntro(root);
  if (isLunariaBoss(match)) await lunariaIntro(table, gladeFogged(app.save) ? LINES.lunaria.intro! : LINES.lunaria.introLifted!, match.game.rules?.fog === true);
  if (guardian && match.mode.kind === 'tower') {
    // The Guardian's existing intro, with "Guardian of Floor N" above the name line and the wisps left out.
    const card = { kicker: `Guardian of Floor ${match.mode.floor}`, fogged: match.game.rules?.fog === true, crownName: BOTS[guardian].name };
    if (guardian === 'nightshade') await bossIntro(root, card);
    else await lunariaIntro(table, LINES.lunaria.introLifted!, card.fogged, card);
  }
  table.start(events);
}

/** Picks a saved match back up exactly where it was. */
export function resumeMatch(match: SavedMatch): void {
  const table = new Table(match, false);
  const root = table.mount();
  show(root, tableMusic(match), 'none');
  setFxLayer(table.fxEl);
  table.start([]);
}

void SPRING;
void GLADE_STOPS;
void GLADE_SPOTS;
