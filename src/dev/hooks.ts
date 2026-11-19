// Developer-only test hooks. Production builds compile all of this away.
import { decide, type BotId } from '../bots/profiles.ts';
import { observe } from '../engine/observation.ts';
import type { GameState, Variant } from '../engine/types.ts';
import { loadSave, type SaveData, type MatchMode } from '../meta/save.ts';
import { app, persist, show } from '../ui/app.ts';
import { SOUND_IDS } from '../ui/audio/audio.ts';
import { freezeFogForTests } from '../ui/fx/fog.ts';
import { matchPhases } from '../engine/phases.ts';
import { applyMotionVars, eventLog, motion } from '../ui/fx/motion.ts';
import { journey, mapMusic, resumeMatch, startFromMode } from '../ui/screens/journey.ts';
import { activeTable } from '../ui/table/table.ts';
import { drawAttempt, freshRun } from '../meta/tower.ts';
import type { TowerAttempt } from '../meta/save.ts';
import { freezeAmbientForTests } from '../ui/tower/ambient.ts';
import { openTowerHome } from '../ui/screens/tower.ts';
import { prepareRunOver, runOver } from '../ui/screens/tower-end.ts';
import * as liftScenes from '../ui/tower/scenes.ts';

type Dice = () => number;

let autoOn = false;
let autoTimer = 0;
let dice: Dice = Math.random;
let autoTrace: string[] = [];

function q<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function tapId(id: string): boolean {
  const el = q(`[data-testid="${id}"]`);
  if (el) { el.click(); return true; }
  return false;
}

/** One move of the auto-player, made only through the real on-screen controls. */
function autoStep(): void {
  if (!autoOn) return;
  autoTimer = window.setTimeout(autoStep, 4);
  if (tapId('coach-skip')) return;
  if (tapId('reveal') || tapId('reveal-charm')) return;
  if (q('[data-testid="continue"]') || q('[data-testid="back-map"]') || q('[data-testid="floor-result"]')) { autoOn = false; return; }
  const t = activeTable;
  if (!t || t.animatingBot) return;
  if (t.busy > 0) return;
  if (tapId('next-round')) return;
  const choices = q('[data-testid="phase-choices"]');
  if (choices) {
    const action = decide('hoot', observe(t.game, 0), dice);
    if (action.type === 'choosePhase') tapId(`choose-${action.phase}`);
    return;
  }
  if (!t.myTurn) return;
  const picker = q('[data-testid="target-picker"]');
  if (picker) {
    const open = picker.querySelector<HTMLElement>('.target:not(.off)');
    autoTrace.push('pick-target');
    open?.click();
    return;
  }
  if (document.querySelector('.sheet')) return;
  const action = decide('hoot', observe(t.game, 0), dice);
  autoTrace.push(action.type);
  const clickCard = (id: number) => (t.handEls.get(id) as HTMLElement | undefined)?.click();
  switch (action.type) {
    case 'draw':
      (action.source === 'pile' ? t.drawEl : t.discardEl).click();
      break;
    case 'layDown':
      t.selected = [];
      t.match.ui.slots = t.match.ui.slots.map(() => []);
      t.renderHand();
      t.renderPanel();
      action.groups.forEach((g, i) => {
        g.cardIds.forEach(clickCard);
        (q(`[data-testid="slot-${i}"]`) as HTMLElement).click();
      });
      t.primaryBtn.click();
      break;
    case 'hit':
      for (const id of [...t.selected]) clickCard(id);
      clickCard(action.cardId);
      (q(`[data-group-id="${action.groupId}"]`) as HTMLElement | null)?.click();
      break;
    case 'discard':
      for (const id of [...t.selected]) clickCard(id);
      clickCard(action.cardId);
      t.discardBtn.click();
      break;
  }
}

export function installDevHooks(): void {
  const hooks = {
    events: eventLog,
    soundIds: SOUND_IDS,
    setTestScale(s: number) { motion.testScale = s; applyMotionVars(); },
    startMatch(opts: { seed?: string; lineup: BotId[]; variant?: Variant; mode?: MatchMode; botSeed?: string; back?: string; cloth?: string }) {
      startFromMode(opts.mode ?? { kind: 'free' }, opts.lineup, opts.variant ?? 'standard', opts.back ?? 'rose-lattice', opts.cloth ?? 'blush-gingham', opts.seed, opts.botSeed);
    },
    getSave: (): SaveData => JSON.parse(JSON.stringify(app.save)),
    loadSave(data: SaveData) {
      app.save = data;
      persist();
      show(journey(), mapMusic(), 'none');
    },
    reloadSave() { app.save = loadSave(); },
    resume() { if (app.save.match) resumeMatch(app.save.match); },
    state: (): GameState | null => (activeTable ? JSON.parse(JSON.stringify(activeTable.game)) : null),
    ui: () => (activeTable ? JSON.parse(JSON.stringify(activeTable.match.ui)) : null),
    selected: () => activeTable?.selected.slice() ?? [],
    idle: () => !!activeTable && activeTable.busy === 0 && !activeTable.animatingBot,
    /** Changes the game directly, for preparing a test position, then redraws. */
    patch(source: string) {
      const t = activeTable!;
      new Function('game', 'match', source)(t.game, t.match);
      t.syncSlotShape();
      t.syncTension();
      persist();
      t.laidEl.dataset.sig = '';
      t.handEls.forEach((el) => el.remove());
      t.handEls.clear();
      t.render();
    },
    autoplay(on: boolean, seedDice?: Dice) {
      autoOn = on;
      dice = seedDice ?? Math.random;
      autoTrace = [];
      clearTimeout(autoTimer);
      if (on) autoStep();
    },
    autoTrace: () => autoTrace.slice(),
    /** Holds every drifting cloud at its starting place, so screenshots of fogged screens repeat exactly. */
    freezeFog: () => freezeFogForTests(),
    autoRunning: () => autoOn,
    /**
     * Sets up the Tower for a test: the floor, hearts and best, and optionally the next draw (by seed, or given
     * outright). `climb: false` leaves no climb under way.
     */
    towerSet(opts: { floor?: number; hearts?: number; best?: number; climb?: boolean; seed?: string; draw?: Partial<TowerAttempt>; revealSeen?: boolean }) {
      const t = app.save.tower;
      if (opts.best !== undefined) t.best = opts.best;
      if (opts.revealSeen !== undefined) t.revealSeen = opts.revealSeen;
      if (opts.climb === false) t.climb = null;
      else if (opts.floor !== undefined || opts.hearts !== undefined || opts.seed || opts.draw || opts.climb) {
        const floor = opts.floor ?? t.climb?.floor ?? 1;
        t.climb = { floor, hearts: opts.hearts ?? t.climb?.hearts ?? 3, run: t.climb?.run ?? freshRun(), attempt: null };
        if (opts.seed || opts.draw) {
          const base = drawAttempt(opts.seed ?? 'ab'.repeat(16), floor);
          t.climb.attempt = { ...base, ...(opts.draw ?? {}) };
        }
      }
      persist();
    },
    towerHome: () => openTowerHome(),
    /** Ends the Tower floor at the table now, won or lost, through the real end of the match. */
    forceFloor(won: boolean) {
      const t = activeTable!;
      t.game.winners = won ? [0] : [1];
      t.game.stage = 'matchOver';
      void t.endMatch();
    },
    runOver: (end: Parameters<typeof runOver>[0]) => runOver(end),
    prepareRunOver: () => prepareRunOver().then(() => undefined),
    climbScene: (from: number, to: number) => liftScenes.climbScene(from, to),
    lastLift: () => liftScenes.lastLift,
    prepareClimb: (from: number, to: number) => liftScenes.prepareClimb(from, to).then(() => undefined),
    /** Holds every Tower and Crossroads ambient loop, and the fog, at one moment, so screenshots repeat exactly. */
    freezeAmbient(ms = 0) { freezeAmbientForTests(ms); freezeFogForTests(); },
    endMatchNow(winnerSeat: number) {
      const t = activeTable!;
      const g = t.game;
      const seq = matchPhases(g);
      g.players.forEach((p, i) => { if (i === winnerSeat) { p.completed = seq.slice(0, -1); p.phase = seq[seq.length - 1]; p.laidDown = true; p.hand = [p.hand[0]]; } });
      g.current = winnerSeat;
      g.stage = 'play';
    },
  };
  (window as unknown as { __TC__: typeof hooks }).__TC__ = hooks;
}
