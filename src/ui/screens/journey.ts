// The Journey map (home screen), the Match Intro sheet, and starting matches.
import type { BotId } from '../../bots/profiles.ts';
import { BOTS, STOPS, TITLE, TYPE_LABEL, UNLOCKABLES } from '../../content.ts';
import { createGame } from '../../engine/game.ts';
import { PHASES } from '../../engine/phases.ts';
import type { GameEvent, Variant } from '../../engine/types.ts';
import { currentStop, isUnlocked, newTracker, stopOpen, totalStars } from '../../meta/progress.ts';
import type { MatchMode, SavedMatch } from '../../meta/save.ts';
import { app, persist, show } from '../app.ts';
import { icon, portraitEl } from '../art.ts';
import { h } from '../dom.ts';
import { SPRING, animate, setFxLayer } from '../fx/motion.ts';
import { closeAllSheets, openSheet, tooltip } from '../overlays.ts';
import { bossIntro } from '../table/boss.ts';
import { Table } from '../table/table.ts';
import { collectionScreen } from './collection.ts';
import { freePlayScreen } from './freeplay.ts';
import { settingsScreen } from './settings.ts';
import { statsScreen } from './stats.ts';

const SPOTS = [{ x: 12.5, y: 57 }, { x: 26, y: 45 }, { x: 12.5, y: 33 }, { x: 26, y: 21 }, { x: 19.5, y: 0.5 }];
/** How far the current stop's pink halo reaches past its portrait, in rem. */
const HALO = 1.6;
/** The Play button and reward chip stay this many points from the screen edges. */
const EDGE = 16;

export type NavTab = 'journey' | 'free' | 'collection' | 'stats';

export function bottomNav(active: NavTab): HTMLElement {
  const freeOpen = isUnlocked(app.save, 'free-play');
  const item = (id: NavTab, label: string, ic: string, go: () => void, locked = false, lockedNote = '') =>
    h('button.nav-item', { class: `${active === id ? 'on' : ''} ${locked ? 'locked' : ''}`, 'data-testid': `nav-${id}`, onclick: go, 'aria-label': locked ? `${label}, locked. ${lockedNote}` : label, 'aria-current': active === id ? 'page' : undefined },
      h('span.nav-icon', { html: icon(locked ? 'lock' : ic) }),
      h('span.nav-label', null, label),
      locked ? h('small.nav-note', null, lockedNote) : null,
    );
  return h('nav.bottom-nav', null,
    item('journey', 'Journey', 'map', () => { if (active !== 'journey') show(journey(), 'map'); }),
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

function starsRow(n: number): HTMLElement {
  const row = h('div.stars', { 'aria-label': `${n} of 3 stars` });
  for (let i = 0; i < 3; i++) row.append(h('span.star', { class: i < n ? 'on' : 'off', html: icon('star') }));
  return row;
}

export function journey(): HTMLElement {
  const save = app.save;
  const current = currentStop(save);
  const allWon = save.campaign.won.every(Boolean);
  const stops = STOPS.map((stop, i) => {
    const won = save.campaign.won[i];
    const open = stopOpen(save, i);
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
  const root = h('div.screen.map-screen', { 'data-screen': 'journey' },
    h('div.map-top', null,
      h('div.star-pill', { 'data-testid': 'total-stars', html: `${icon('star')}<span>${totalStars(save)} / 15</span>` }),
      h('h1.game-title', null, TITLE),
      h('button.round-btn', { 'aria-label': 'Settings', html: icon('settings'), onclick: () => settingsScreen(false), 'data-testid': 'settings' }),
    ),
    scroller,
    bottomNav('journey'),
  );
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
function placeCta(scroller: HTMLElement, stop: HTMLElement, cta: HTMLElement): void {
  const inner = scroller.firstElementChild as HTMLElement;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  const origin = inner.getBoundingClientRect();
  const boxOf = (el: Element, grow = 0): Box => {
    const r = el.getBoundingClientRect();
    return { l: r.left - origin.left - grow, t: r.top - origin.top - grow, r: r.right - origin.left + grow, b: r.bottom - origin.top + grow };
  };
  const node = boxOf(stop.querySelector('.portrait')!, HALO * rem);
  const blocked = [node, ...[...inner.querySelectorAll('.stop-btn, .moth-wings, .stars, .name-plate, .boss-plate')].map((el) => boxOf(el))];
  const plate = boxOf(stop.querySelector('.name-plate, .boss-plate')!);
  const w = cta.offsetWidth;
  const height = cta.offsetHeight;
  const gap = 0.8 * rem;
  const minX = EDGE;
  const maxX = inner.clientWidth - EDGE - w;
  const free = (x: number, y: number) => x >= minX && x <= maxX && y >= 0 && y + height <= inner.clientHeight
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
  const right = beside(node.r + gap);
  const left = right ? null : beside(node.l - gap - w);
  const spot = right ?? left ?? below() ?? { x: Math.min(maxX, Math.max(minX, (node.l + node.r) / 2 - w / 2)), y: plate.b + gap };
  const home = boxOf(stop);
  cta.style.left = `${spot.x - home.l}px`;
  cta.style.top = `${spot.y - home.t}px`;
  cta.dataset.side = right ? 'right' : left ? 'left' : 'below';
}

/** The middle of the current stop's node, name plate, button and chip together, for scrolling them all into view. */
function centerOfStop(scroller: HTMLElement, stop: HTMLElement): number {
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

/** Starts a brand-new match. */
export function startFromMode(mode: MatchMode, lineup: BotId[], variant: Variant, back: string, cloth: string, seed?: string, botSeed?: string): void {
  closeAllSheets();
  const { state, events } = createGame({ playerCount: lineup.length + 1, variant, seed });
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
  void openTable(match, events, boss);
}

async function openTable(match: SavedMatch, events: GameEvent[], withIntro: boolean): Promise<void> {
  const table = new Table(match, true);
  const music = match.boss ? null : app.save.equipped.music === 'music-box' ? 'musicbox' : 'waltz';
  const root = table.mount();
  show(root, music);
  setFxLayer(table.fxEl);
  if (withIntro) await bossIntro(root);
  table.start(events);
}

/** Picks a saved match back up exactly where it was. */
export function resumeMatch(match: SavedMatch): void {
  const table = new Table(match, false);
  const music = match.boss ? 'boss' : app.save.equipped.music === 'music-box' ? 'musicbox' : 'waltz';
  const root = table.mount();
  show(root, music, 'none');
  setFxLayer(table.fxEl);
  table.start([]);
}

void SPRING;
void animate;
