// After a Tower floor: the floor result (TOWER_SPEC.md §7.4) and, when a climb ends, the run-over screen (§7.5).
import { app, show } from '../app.ts';
import { icon } from '../art.ts';
import { sfx } from '../audio/audio.ts';
import { h } from '../dom.ts';
import { SOFT, SPRING, animate, confetti, finishAll, fx, motion } from '../fx/motion.ts';
import { closeAllSheets } from '../overlays.ts';
import type { MatchSummary } from '../../meta/progress.ts';
import { takeLingering } from '../../meta/devmode.ts';
import type { SavedMatch } from '../../meta/save.ts';
import { startClimb, type ClimbEnd, type FloorOutcome } from '../../meta/tower.ts';
import { persist } from '../app.ts';
import { crackHeart, heartsRow, refillHeart } from '../tower/hearts.ts';
import { loadKit, svgDoc, svgUrl, wholeTower } from '../tower/art.ts';
import { ambientLife } from '../tower/ambient.ts';
import { climbScene, prepareClimb } from '../tower/scenes.ts';
import { openFloorIntro, openTowerHome, towerMusic } from './tower.ts';
import { toMap } from './end.ts';
import type { Table } from '../table/table.ts';

/** The floor result, over the table, in the match-end style. */
export function towerResult(t: Table, match: SavedMatch, s: MatchSummary): void {
  closeAllSheets();
  const o = s.tower!;
  const won = o.won;
  fx(won ? 'tower.floorWon' : 'tower.floorLost');
  sfx(won ? 'victory' : 'defeat');
  const header = won ? (o.guardian ? 'Guardian defeated!' : `Floor ${o.floor} cleared!`) : 'Not this time';
  const sub = won
    ? (o.guardian ? (o.heartBack ? 'You won back a heart.' : 'Your hearts are full.') : `On to Floor ${o.floor + 1}`)
    : o.end ? 'That was your last heart.' : `You lost a heart. ${o.heartsAfter === 1 ? '1 heart left.' : `${o.heartsAfter} hearts left.`}`;
  // The hearts as they were, so the change plays here: a crack on a loss, a refill on a Guardian win.
  const hearts = heartsRow(o.heartsBefore, 'result');
  // Dev Mode was turned off during this floor, and the Tower is locked without it: only the way back is offered.
  const buttons = takeLingering()
    ? [h('button.btn.secondary', { 'data-testid': 'back-map', onclick: toMap }, 'Back to Map')]
    : won
    ? [h('button.btn.primary.play', { 'data-testid': 'climb', html: `${icon('play')}<span>Climb</span>`, onclick: () => climb(o) })]
    : o.end
      ? [h('button.btn.primary', { 'data-testid': 'see-climb', onclick: () => runOver(o.end!) }, 'See your climb')]
      : [
        h('button.btn.primary', { 'data-testid': 'try-again', onclick: () => void openTowerHome((home) => openFloorIntro(home)) }, 'Try again'),
        h('button.btn.secondary', { 'data-testid': 'back-tower', onclick: () => void openTowerHome() }, 'Back to the Tower'),
      ];
  // Have the next picture ready while this screen shows: the lift's after a win, the run-over's tower after a loss.
  if (won) void prepareClimb(o.floor, o.floor + 1).catch(() => undefined);
  else void prepareRunOver().catch(() => undefined);
  const card = h('div.tw-result-card', null,
    h('h1.title', { 'data-testid': 'result-header' }, header),
    h('p.sheet-text', { 'data-testid': 'result-sub' }, sub),
    hearts,
    h('div.re-actions.end.tw-actions', null, buttons),
  );
  const screen = h(`div.overlay-screen.tw-result.${won ? 'won' : 'lost'}`, { 'data-testid': 'floor-result', 'data-screen': 'floor-result' }, h('div.dim'), card);
  t.root.append(screen);
  void animate(card, [{ transform: 'translateY(60px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { ms: 480, ease: SOFT, fill: 'backwards' });
  void (async () => {
    await new Promise((r) => setTimeout(r, motion.reduced ? 0 : 520 * motion.testScale));
    if (!won) await crackHeart(hearts, o.heartsBefore - 1);
    else if (o.heartBack) await refillHeart(hearts, o.heartsBefore);
    t.autoHook?.();
  })();
  void match;
}

/** "Climb": the ascent, or the tier change after a Guardian, then Tower home with the next floor's intro open. */
async function climb(o: FloorOutcome): Promise<void> {
  closeAllSheets();
  fx('tower.climb');
  await climbScene(o.floor, o.floor + 1);
  await openTowerHome((home) => openFloorIntro(home));
}

/* ---------- Run over ---------- */

/** Where the lights end, as a fraction of the way from the base to the flag. */
export function lightsFraction(end: ClimbEnd): number {
  if (end.newBest || end.oldBest <= 0) return 1;
  return Math.max(0, Math.min(1, end.floor / end.oldBest));
}

/** The whole tower's base and flag, in its own units, for the fairy lights. */
const BASE_Y = 1036;
const FLAG_Y = 52;

/** A gold wire winding up the tower's front in swags, from the base to the flag, with a bulb every few steps. */
export function fairyLights(fraction: number): { svg: string; topY: number; bulbs: number } {
  const stopY = BASE_Y - fraction * (BASE_Y - FLAG_Y);
  const pts: { x: number; y: number }[] = [];
  const turns = 13;
  for (let i = 0; i <= turns * 12; i++) {
    const t = i / (turns * 12);
    const y = BASE_Y - t * (BASE_Y - FLAG_Y);
    // Narrower toward the roof, as the tower is.
    const half = y < 330 ? 30 + (y - FLAG_Y) * 0.25 : 96;
    const x = Math.sin(t * turns * Math.PI) * half;
    if (y < stopY - 0.5) break;
    pts.push({ x, y: y + Math.abs(Math.cos(t * turns * Math.PI)) * 6 });
  }
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  let bulbs = '';
  let n = 0;
  for (let i = 3; i < pts.length; i += 4) {
    const p = pts[i];
    bulbs += `<circle class="bulb" cx="${p.x.toFixed(1)}" cy="${(p.y + 2).toFixed(1)}" r="4" fill="${n % 2 ? '#F7A3BC' : '#FBE2A0'}"/><circle cx="${p.x.toFixed(1)}" cy="${(p.y + 2).toFixed(1)}" r="9" fill="${n % 2 ? '#F7A3BC' : '#FBE2A0'}" opacity=".35"/>`;
    n++;
  }
  const svg = `<path d="${d}" fill="none" stroke="#D9A441" stroke-width="2" stroke-linecap="round"/>${bulbs}`;
  return { svg, topY: pts.length ? pts[pts.length - 1].y : BASE_Y, bulbs: n };
}

/** The whole tower as an image, built and decoded once, ahead of time, so the run-over never waits on it. */
let wholeImage: Promise<string> | null = null;
export function prepareRunOver(): Promise<string> {
  wholeImage ??= loadKit().then(async (kit) => {
    const whole = wholeTower(kit);
    const url = svgUrl(svgDoc(kit, whole.viewBox, whole.svg, 340, 1086));
    const probe = new Image();
    probe.src = url;
    await probe.decode().catch(() => undefined);
    return url;
  }).catch((e) => { wholeImage = null; throw e; });
  return wholeImage;
}

/** The run-over screen: the whole tower on a cloud under the Aurora, the lights, and the climb's numbers. */
export function runOver(end: ClimbEnd): void {
  closeAllSheets();
  void Promise.all([loadKit(), prepareRunOver()]).then(([kit, url]) => {
    const whole = wholeTower(kit);
    const frac = lightsFraction(end);
    const lights = fairyLights(frac);
    const [vx, vy, vw, vh] = whole.viewBox.split(' ').map(Number);
    const art = h('div.ro-art', { 'data-testid': 'runover-tower' });
    const img = h('img.ro-tower', { alt: '', 'aria-hidden': 'true' }) as HTMLImageElement;
    img.src = url;
    const lightLayer = h('div.ro-lights', { 'data-testid': 'fairy-lights', 'data-fraction': frac.toFixed(3), html: `<svg viewBox="${whole.viewBox}" aria-hidden="true">${lights.svg}</svg>` });
    const flagBurst = h('i.ro-burst');
    const pct = (y: number) => `${((y - vy) / vh) * 100}%`;
    const floorPill = h('span.ro-pill.gold', { 'data-testid': 'pill-floor', style: `top:${pct(lights.topY)}` }, `Floor ${end.floor}`);
    const bestY = end.newBest
      ? BASE_Y - (end.oldBest > 0 ? end.oldBest / end.floor : 0) * (BASE_Y - FLAG_Y)
      : FLAG_Y;
    const bestPill = end.oldBest > 0
      ? h('span.ro-pill', { 'data-testid': 'pill-best', style: `top:${pct(bestY)}` }, end.newBest ? `Old best ${end.oldBest}` : `Best ${end.oldBest}`)
      : null;
    art.append(h('i.ro-cloud'), img, lightLayer, flagBurst, floorPill);
    if (bestPill) art.append(bestPill);
    void vx; void vw;

    const stat = (value: string | number, label: string, id: string) => h('div.ro-stat', { 'data-testid': id }, h('b', null, String(value)), h('small', null, label));
    const card = h('div.ro-card', { 'data-testid': 'runover-card' },
      end.newBest ? h('div.ro-ribbon', { 'data-testid': 'new-best' }, 'A new best!') : null,
      h('p.ro-reached', null, 'Your climb reached'),
      h('h1.ro-floor', { 'data-testid': 'runover-floor' }, `Floor ${end.floor}`),
      h('div.ro-stats', null,
        stat(end.run.floorsCleared, 'Floors cleared', 'stat-floors'),
        stat(end.run.phasesCompleted, 'Phases completed', 'stat-phases'),
        stat(end.run.guardiansBeaten, 'Guardians beaten', 'stat-guardians'),
        stat(end.oldBest > 0 ? end.oldBest : '—', end.newBest ? 'Old best floor' : 'Best floor', 'stat-best'),
      ),
      h('button.btn.primary.play', { 'data-testid': 'new-climb', html: `${icon('play')}<span>Start a new climb</span>`, onclick: () => newClimb() }),
      h('button.btn.secondary', { 'data-testid': 'back-tower', onclick: () => void openTowerHome() }, 'Back to the Tower'),
    );
    const life = h('div.ro-life');
    const root = h('div.screen.runover-screen.sky-aurora', { 'data-screen': 'runover', 'data-testid': 'runover', class: end.newBest ? 'new-best' : '' },
      life, art, card,
    );
    show(root, towerMusic());
    fx('tower.runOver');
    const stop = ambientLife(life, ['aurora', 'stars', 'clouds'], 5);
    app.onLeave = () => stop();
    void playRunOver(root, { art, lightLayer, floorPill, bestPill, card, flagBurst, newBest: end.newBest });
  }).catch(() => undefined);
}

function newClimb(): void {
  const save = app.save;
  if (!save.tower.climb) startClimb(save);
  persist();
  fx('tower.climbStart');
  void openTowerHome((home) => openFloorIntro(home));
}

type RunOverParts = { art: HTMLElement; lightLayer: HTMLElement; floorPill: HTMLElement; bestPill: HTMLElement | null; card: HTMLElement; flagBurst: HTMLElement; newBest: boolean };

/** About 4 s (§9.7): the tower zooms out, the lights switch on upward, the flag bursts on a new best, the card rises. */
async function playRunOver(root: HTMLElement, p: RunOverParts): Promise<void> {
  const bulbs = [...p.lightLayer.querySelectorAll<SVGElement>('circle')];
  if (motion.reduced) {
    if (p.newBest) root.classList.add('burst');
    return;
  }
  let skipped = false;
  const skip = () => { skipped = true; finishAll(); };
  root.addEventListener('pointerdown', skip, { once: true });
  const s = motion.testScale * motion.factor;
  const wait = (ms: number) => (skipped ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms * s)));
  for (const b of bulbs) b.style.opacity = '0';
  p.floorPill.style.opacity = '0';
  p.card.style.opacity = '0';
  void animate(p.art, [{ transform: 'scale(2.3) translateY(18%)' }, { transform: 'none' }], { ms: 1100, ease: SOFT });
  await wait(1100);
  fx('tower.lights');
  sfx('fairyTwinkle');
  bulbs.slice().reverse();
  const order = bulbs;
  order.forEach((b, i) => { void animate(b, [{ opacity: 0 }, { opacity: 1 }], { ms: 160, delay: (i / Math.max(1, order.length)) * 1400, fill: 'forwards' }).then(() => { b.style.opacity = '1'; }); });
  await wait(1400);
  for (const b of bulbs) b.style.opacity = '1';
  if (p.newBest) {
    fx('tower.newBest');
    sfx('newBest');
    root.classList.add('burst');
    void animate(p.flagBurst, [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.3)', opacity: 1, offset: 0.4 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0.85 }], { ms: 700, ease: SOFT });
    confetti(1800, 30);
  }
  p.floorPill.style.opacity = '1';
  void animate(p.floorPill, [{ transform: 'scale(.5)', opacity: 0 }, { transform: 'scale(1.1)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], { ms: 360, ease: SPRING });
  await wait(300);
  p.card.style.opacity = '1';
  await animate(p.card, [{ transform: 'translateY(40%)', opacity: 0 }, { transform: 'translateY(-3%)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], { ms: 600, ease: SPRING });
  root.removeEventListener('pointerdown', skip);
}
