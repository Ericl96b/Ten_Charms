// Tower home and the floor intro sheet (TOWER_SPEC.md §7.1, §7.2), and starting a floor.
import type { BotId } from '../../bots/profiles.ts';
import { BOTS, LINES, TOWER_HEARTS } from '../../content.ts';
import { displayPhase, phaseText } from '../../engine/phases.ts';
import { persist, app, show } from '../app.ts';
import { icon, portraitEl } from '../art.ts';
import { setMusicLayers, sfx, type MusicId } from '../audio/audio.ts';
import { h } from '../dom.ts';
import { SOFT, SPRING, animate, fx, motion } from '../fx/motion.ts';
import { confirmSheet, openSheet, type Sheet } from '../overlays.ts';
import { ambientLife, track, type AmbientKind } from '../tower/ambient.ts';
import { FLOOR_H, floorLook, loadKit, svgDoc, svgUrl, towerStrip, cageArt, type TowerKit } from '../tower/art.ts';
import { heartSvg, heartsRow } from '../tower/hearts.ts';
import { currentAttempt, endClimb, floorRules, guardianOf, isGuardianFloor, skyName, startClimb, tierOf, tierSetup, type ClimbEnd } from '../../meta/tower.ts';
import { bottomNav, journey, mapMusic, startFromMode } from './journey.ts';
import { resumeMatch } from './journey.ts';
import { prepareRunOver, runOver } from './tower-end.ts';

/** The music on the Crossroads and Tower home. Its layers follow the climb's tier: one per tier, up to four. */
export function towerMusic(): MusicId {
  setMusicLayers(tierOf(viewFloor()));
  return 'tower';
}

/** The sky band's CSS name for a tier. */
export function skyClass(tier: number): string {
  return `sky-${skyName(tier).toLowerCase().replace(/ /g, '-')}`;
}

/** What each sky band's ambient life is (§9.1). Petals drift on Tower home in every band. */
export function skyLife(tier: number): AmbientKind[] {
  const band = (tier - 1) % 5;
  return ([
    ['clouds', 'butterflies'],
    ['clouds', 'butterflies'],
    ['clouds', 'fireflies'],
    ['pinkClouds', 'stars', 'fireflies'],
    ['aurora', 'stars', 'clouds'],
  ] as AmbientKind[][])[band];
}

/** The Guardian's name in the status line: her title's first words, his own name. */
function guardianName(bot: BotId): string {
  return bot === 'lunaria' ? 'Lady Lunaria' : BOTS[bot].name;
}

/** The floor the view centers on: the climb's floor, or floor 1 with no climb. */
function viewFloor(): number {
  return app.save.tower.climb?.floor ?? 1;
}

function towerMatch(): boolean {
  return app.save.match?.mode.kind === 'tower';
}

/** Opens Tower home, once its art is ready. `then` runs on it, such as opening the next floor's intro. */
export async function openTowerHome(then?: (home: HTMLElement) => void): Promise<void> {
  const kit = await loadKit();
  const home = towerHome(kit);
  show(home, towerMusic());
  fx('tower.home');
  if (then) requestAnimationFrame(() => then(home));
}

/** Scale of the tower art on Tower home: the 200-unit tower is a little over half the screen wide. */
const ART_W = 220;

export function towerHome(kit: TowerKit): HTMLElement {
  const save = app.save;
  const climb = save.tower.climb;
  const floor = viewFloor();
  const tier = tierOf(floor);
  const best = save.tower.best;
  const guardian = isGuardianFloor(floor);
  const inProgress = towerMatch() && climb !== null;

  // The view: floors around the current one, the base below floor 1, the tower fading into the sky at the top.
  const low = Math.max(1, floor - 3);
  const high = floor + 4;
  const strip = towerStrip(kit, low, high, floor);
  const withBase = low === 1;
  const base = withBase ? `<g transform="translate(0 ${strip.height - 924})">${kit.base}</g>` : '';
  const baseH = withBase ? 126 : 0;
  const stripH = strip.height + baseH;
  const img = h('img.tw-strip', { alt: '', 'aria-hidden': 'true', draggable: 'false', 'data-testid': 'tower-strip' }) as HTMLImageElement;
  img.src = svgUrl(svgDoc(kit, `-${ART_W / 2} 0 ${ART_W} ${stripH}`, strip.svg + base, ART_W * 3, Math.round(stripH * 3)));
  const glow = h('i.tw-glow', { 'data-testid': 'current-glow' });
  const cage = h('img.tw-cage', { alt: '', 'aria-hidden': 'true', 'data-testid': 'cage' }) as HTMLImageElement;
  const c = cageArt(kit);
  cage.src = svgUrl(svgDoc(kit, c.viewBox, c.svg, 200, 300));
  const rail = h('i.tw-rail');
  const plaques = h('div.tw-plaques', { 'data-testid': 'plaques' });
  const art = h('div.tw-art', null, img, glow, rail, cage);
  const life = h('div.tw-life');
  const view = h('div.tw-view', { 'data-testid': 'tower-view' }, h('i.tw-light'), life, art, plaques);
  const marker = best > 0 && best > high ? h('div.tw-best-pill', { 'data-testid': 'best-marker', html: `${icon('flag')}<span>Best · Floor ${best}</span>${icon('arrowUp')}` }) : null;

  for (let n = high; n >= low; n--) {
    const plaque = h('span.tw-plaque', { class: n === floor ? 'current' : '', 'data-floor': String(n), 'data-testid': `plaque-${n}` }, String(n));
    if (best > 0 && n === best) plaque.append(h('i.tw-flag', { 'data-testid': 'best-flag', html: icon('flag') }));
    plaques.append(plaque);
  }

  // The panel.
  const status = (() => {
    if (!climb) return 'A fresh climb · 3 hearts';
    if (inProgress) {
      const g = save.match!.game;
      const me = g.players[0];
      const x = me.phase === null ? 1 : displayPhase(g, me.phase);
      return `Floor in progress · Phase ${x} of 3`;
    }
    if (guardian) return `Guardian: ${guardianName(guardianOf(floor))} and the Thorned Crown. Win to get a heart back.`;
    return `Ready for Floor ${floor}`;
  })();
  const label = !climb ? 'Begin a climb' : inProgress ? 'Resume' : 'Play';
  const chip = guardian
    ? h('span.tw-chip.guardian', { 'data-testid': 'floor-chip', html: `${icon('crown')}<span>Guardian</span>` })
    : best > 0 ? h('span.tw-chip', { 'data-testid': 'floor-chip', html: `${icon('flag')}<span>Best ${best}</span>` }) : null;
  const primary = h('button.btn.primary.play', { 'data-testid': 'tower-play', html: `${icon('play')}<span>${label}</span>`, onclick: () => go() });
  const panel = h('div.tw-panel', { 'data-testid': 'tower-panel' },
    h('div.tw-panel-head', null,
      h('div', null,
        h('h2.tw-floor', { 'data-testid': 'tower-floor' }, `Floor ${floor}`),
        h('p.tw-tier', { 'data-testid': 'tower-tier' }, `Tier ${tier} · ${skyName(tier)}`),
      ),
      chip,
    ),
    h('p.tw-status', { 'data-testid': 'tower-status' }, status),
    primary,
    climb ? h('button.tw-end', { 'data-testid': 'end-climb', onclick: () => confirmEnd() }, 'End this climb') : null,
  );
  const hearts = heartsRow(climb?.hearts ?? TOWER_HEARTS, 'pill');
  const top = h('div.tw-top', null,
    h('button.round-btn', { 'aria-label': 'Back to the Crossroads', 'data-testid': 'tower-back', html: icon('back'), onclick: () => back() }),
    h('h1.tw-title', null, 'The Tower'),
    hearts,
  );
  const root = h('div.screen.tower-screen', { class: skyClass(tier), 'data-screen': 'tower', 'data-tier': String(tier) },
    view, top, marker, panel, bottomNav('journey'),
  );

  function back(): void {
    save.glade.lastMap = 'crossroads';
    persist();
    show(journey(), mapMusic());
  }
  function go(): void {
    if (!save.tower.climb) {
      startClimb(save);
      persist();
      fx('tower.climbStart');
    }
    if (towerMatch()) { resumeMatch(save.match!); return; }
    openFloorIntro(root);
  }
  function confirmEnd(): void {
    const n = save.tower.climb!.floor;
    // The run-over's tower is drawn while she reads the sheet, so ending the climb never waits on it.
    void prepareRunOver().catch(() => undefined);
    const s = confirmSheet('End this climb?', `Your climb will end on Floor ${n}. Your best floor is kept.`, 'End climb', () => {
      const end = endClimb(save);
      persist();
      fx('tower.climbEnded');
      runOver(end);
    }, 'Keep climbing');
    s.el.querySelector('[data-testid="confirm-ok"]')?.classList.add('danger');
  }

  /** Places the tower so the current floor's window sits about 58% of the way down the view. */
  const place = () => {
    const box = view.getBoundingClientRect();
    if (box.width === 0) return;
    // The view runs from under the top bar to the top of the panel; the tower carries on behind the panel.
    const from = top.getBoundingClientRect().bottom - box.top;
    const to = panel.getBoundingClientRect().top - box.top;
    const scale = (box.width * 0.62) / ART_W;
    const look = floorLook(floor, kit);
    const top0 = strip.tops.get(floor)!;
    const windowY = top0 + (look.guardian ? 60 : 38);
    const y = from + (to - from) * 0.58 - windowY * scale;
    view.style.setProperty('--fade-to', `${Math.max(0, from + (to - from) * 0.12)}px`);
    Object.assign(art.style, { width: `${ART_W * scale}px`, height: `${stripH * scale}px`, transform: `translate(-50%, ${y}px)` });
    Object.assign(glow.style, { left: `${(ART_W / 2 + (look.guardian ? 0 : look.x)) * scale}px`, top: `${windowY * scale}px`, width: `${(look.guardian ? 80 : 64) * scale}px`, height: `${(look.guardian ? 92 : 64) * scale}px` });
    Object.assign(cage.style, { top: `${(windowY - 26) * scale}px`, width: `${44 * scale}px` });
    for (const p of plaques.children as HTMLCollectionOf<HTMLElement>) {
      const n = Number(p.dataset.floor);
      const t = strip.tops.get(n)!;
      p.style.top = `${y + (t + (isGuardianFloor(n) ? 59 : FLOOR_H / 2)) * scale}px`;
    }
  };
  let stopLife = () => {};
  requestAnimationFrame(() => {
    place();
    window.addEventListener('resize', place);
    stopLife = ambientLife(life, [...skyLife(tier), 'petals'], tier * 31 + 3);
    if (!motion.reduced) {
      track(cage.animate([{ transform: 'translate(-50%, 0) rotate(-1.5deg)' }, { transform: 'translate(-50%, -.35rem) rotate(1.5deg)' }, { transform: 'translate(-50%, 0) rotate(-1.5deg)' }], { duration: 3000, iterations: Infinity, easing: 'ease-in-out' }));
      track(glow.animate([{ opacity: 0.55, transform: 'translate(-50%, -50%) scale(.94)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1.06)' }, { opacity: 0.55, transform: 'translate(-50%, -50%) scale(.94)' }], { duration: 2400, iterations: Infinity, easing: 'ease-in-out' }));
    }
    app.onLeave = () => { window.removeEventListener('resize', place); stopLife(); };
  });
  void img.decode?.().catch(() => undefined).then(() => root.classList.add('ready'));
  return root;
}

/* ---------- The floor intro sheet ---------- */

let introSheet: Sheet | null = null;

/** Draws the floor if it hasn't been yet (saved before it shows), then opens its intro over Tower home. */
export function openFloorIntro(home: HTMLElement): void {
  const save = app.save;
  const climb = save.tower.climb;
  if (!climb) return;
  const attempt = currentAttempt(save);
  persist();
  const floor = climb.floor;
  const tier = tierOf(floor);
  const guardian = attempt.guardian !== null;
  const fog = tierSetup(tier).fog;
  const cards = attempt.phases.map((p, i) =>
    h('div.ph-card', { 'data-testid': `phase-card-${i + 1}` },
      h('div.ph-card-back', { 'aria-hidden': 'true' }),
      h('div.ph-card-face', null,
        h('span.ph-medal', null, String(i + 1)),
        h('b.ph-label', { 'data-testid': `phase-label-${i + 1}` }, phaseText(p)),
      ),
    ));
  const deal = h('div.ph-cards', { 'data-testid': 'phase-cards' }, cards);
  const opponents = h('div.fi-opps', { 'data-testid': 'floor-opponents' },
    attempt.lineup.map((b) => h('div.fi-opp', { 'data-bot': b }, portraitEl(b, 'medium'), h('span', null, BOTS[b].name))));
  const heartsLeft = climb.hearts;
  const chips = h('div.fi-chips', null,
    fog ? h('span.rule-chip', { 'data-testid': 'chip-fog', html: `${icon('wisp')}<span>Moonlit Fog</span>` }) : null,
    guardian ? h('span.rule-chip', { 'data-testid': 'chip-crown', html: `${icon('thorncrown')}<span>Thorned Crown</span>` }) : null,
    h('span.rule-chip.hearts-chip', { 'data-testid': 'chip-hearts' },
      h('span.mini-hearts', { html: Array.from({ length: TOWER_HEARTS }, (_, i) => heartSvg(i < heartsLeft)).join('') }),
      h('span', null, heartsLeft === 1 ? '1 heart left' : `${heartsLeft} hearts left`)),
  );
  const begin = h('button.btn.primary.play', { 'data-testid': 'begin-floor', html: `${icon('play')}<span>Begin floor</span>`, onclick: () => startFloor() });
  introSheet = openSheet(h('div.floor-intro', { 'data-testid': 'floor-intro' },
    h('small.kicker', { 'data-testid': 'intro-kicker' }, `TIER ${tier} · ${skyName(tier).toUpperCase()}`),
    h('h2.fi-title', { 'data-testid': 'intro-title' }, guardian ? `Guardian Floor ${floor}` : `Floor ${floor}`),
    h('p.fi-sub', null, 'Win these three phases to climb'),
    deal, opponents, chips, begin,
  ), { className: 'floor-sheet', title: `Floor ${floor}`, onClose: () => { introSheet = null; } });
  void home;
  void dealCards(cards);
}

/** About 1.6 s: three face-down cards fly in one after another, then turn over in order with a chime and a glow. */
async function dealCards(cards: HTMLElement[]): Promise<void> {
  fx('tower.deal');
  if (motion.reduced) { for (const c of cards) c.classList.add('up'); return; }
  sfx('towerDeal');
  const s = motion.factor * motion.testScale;
  await Promise.all(cards.map((c, i) => animate(c, [
    { transform: 'translateY(-14rem) rotate(-8deg) scale(.8)', opacity: 0 },
    { transform: 'translateY(.5rem) rotate(1deg)', opacity: 1, offset: 0.75 },
    { transform: 'none', opacity: 1 },
  ], { ms: 420, delay: i * 140, ease: SPRING, fill: 'backwards' })));
  for (const [i, c] of cards.entries()) {
    await new Promise((r) => setTimeout(r, (i === 0 ? 60 : 330) * s));
    if (!c.isConnected) return;
    fx('tower.flip');
    sfx('towerFlip');
    c.classList.add('up');
    void animate(c, [{ transform: 'rotateY(90deg)' }, { transform: 'none' }], { ms: 220, ease: SOFT });
    void animate(c, [{ boxShadow: '0 0 0 0 rgba(246,210,127,0)' }, { boxShadow: '0 0 1.6rem .4rem rgba(246,210,127,.8)', offset: 0.4 }, { boxShadow: '0 0 0 0 rgba(246,210,127,0)' }], { ms: 600 });
  }
}

/** Starts the attempt's match: the floor's list, opponents and rules, on her own card back and tablecloth. */
export function startFloor(): void {
  const save = app.save;
  const climb = save.tower.climb!;
  const attempt = currentAttempt(save);
  void introSheet?.close();
  fx('tower.floorStart');
  startFromMode({ kind: 'tower', floor: climb.floor }, attempt.lineup, 'tower', save.equipped.back, save.equipped.cloth, undefined, undefined, {
    phases: attempt.phases,
    rules: floorRules(climb.floor, attempt),
    seed: attempt.seed,
  });
}

/** For the Guardian's intro at the table: the title card and her line. */
export function guardianIntroFor(floor: number): { kicker: string; line: string } {
  const g = guardianOf(floor);
  return { kicker: `Guardian of Floor ${floor}`, line: g === 'lunaria' ? LINES.lunaria.introLifted! : LINES.nightshade.intro! };
}

export type { ClimbEnd };
