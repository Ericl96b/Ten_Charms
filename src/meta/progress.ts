// Campaign progress, unlocks, Charms and stats. Pure logic over the save data.
import { BOTS, GLADE_STOPS, STOPS, UNLOCKABLES, type CharmId, type GladeStop, type GladeStopId, type Requirement, type Unlockable } from '../content.ts';
import { phaseSequence } from '../engine/phases.ts';
import type { GameEvent, GameState } from '../engine/types.ts';
import type { BotId } from '../bots/profiles.ts';
import type { MatchTracker, SaveData, SavedMatch } from './save.ts';

export function totalStars(save: SaveData): number {
  return save.campaign.stars.reduce((a, b) => a + b, 0);
}

export function meets(save: SaveData, req: Requirement): boolean {
  if (req.kind === 'default') return true;
  if (req.kind === 'stars') return totalStars(save) >= req.stars;
  if (req.kind === 'glade') return gladeWon(save, req.stop);
  if (req.kind === 'gladeStars') return gladeStars(save) >= req.stars;
  return save.campaign.won[req.stop - 1];
}

/* ---------- The Moonlit Glade ---------- */

/** Map 2 opens once Nightshade has been beaten. */
export function gladeOpen(save: SaveData): boolean {
  return save.campaign.won[4];
}

export function gladeWon(save: SaveData, id: GladeStopId): boolean {
  return save.glade.winOrder.includes(id);
}

export function gladeStars(save: SaveData): number {
  return GLADE_STOPS.reduce((n, s) => n + (save.glade.stars[s.id] ?? 0), 0);
}

/**
 * When a stop opened, as a position in the order of wins: -1 for the first stop, which opens with the map,
 * or null while it is still locked. A stop with two ways in opens with whichever was won first.
 */
export function gladeOpenedAt(save: SaveData, stop: GladeStop): number | null {
  if (!gladeOpen(save)) return null;
  if (stop.opensAfter.length === 0) return -1;
  const at = stop.opensAfter.map((id) => save.glade.winOrder.indexOf(id)).filter((i) => i >= 0);
  return at.length > 0 ? Math.min(...at) : null;
}

export function gladeUnlocked(save: SaveData, id: GladeStopId): boolean {
  return gladeOpenedAt(save, GLADE_STOPS.find((s) => s.id === id)!) !== null;
}

/** Open stops: unlocked but not yet won. */
export function gladeOpenStops(save: SaveData): GladeStopId[] {
  return GLADE_STOPS.filter((s) => gladeOpenedAt(save, s) !== null && !gladeWon(save, s.id)).map((s) => s.id);
}

/**
 * The open stop that gets the Play button: the one unlocked most recently. Stops unlocked by the same win
 * tie, and the earlier in GLADE_STOPS wins, so A1 comes before B1. Null once every stop is won.
 */
export function gladePlayStop(save: SaveData): GladeStopId | null {
  let best: GladeStopId | null = null;
  let bestAt = -Infinity;
  for (const id of gladeOpenStops(save)) {
    const at = gladeOpenedAt(save, GLADE_STOPS.find((s) => s.id === id)!)!;
    if (at > bestAt) { bestAt = at; best = id; }
  }
  return best;
}

export function gladeStarsFor(stop: GladeStop, rounds: number): number {
  if (rounds <= stop.stars.three) return 3;
  if (rounds <= stop.stars.two) return 2;
  return 1;
}

/** The fog is up in Glade campaign matches until the boss has been beaten once. */
export function gladeFogged(save: SaveData): boolean {
  return !save.glade.fogLifted;
}

export function isUnlocked(save: SaveData, id: string): boolean {
  const u = UNLOCKABLES.find((x) => x.id === id);
  return !!u && meets(save, u.req);
}

export function unlockedSet(save: SaveData): Set<string> {
  return new Set(UNLOCKABLES.filter((u) => meets(save, u.req)).map((u) => u.id));
}

/** The first stop not yet won; the last stop once everything is won. */
export function currentStop(save: SaveData): number {
  const i = save.campaign.won.indexOf(false);
  return i === -1 ? STOPS.length - 1 : i;
}

export function stopOpen(save: SaveData, stop: number): boolean {
  return stop === 0 || save.campaign.won[stop - 1];
}

export function botsUnlocked(save: SaveData): BotId[] {
  const garden = STOPS.filter((_, i) => stopOpen(save, i)).map((s) => s.featured);
  // Each Glade bot joins Free Play when its stop opens; Lunaria only once she has been beaten.
  const glade = GLADE_STOPS.filter((s) => (s.id === 'g3' ? gladeWon(save, 'g3') : gladeUnlocked(save, s.id))).map((s) => s.featured);
  return [...garden, ...glade];
}

export function starsFor(rounds: number): number {
  if (rounds <= 12) return 3;
  if (rounds <= 14) return 2;
  return 1;
}

export function newTracker(): MatchTracker {
  return { attempts: {}, failStreak: 0, neverFailedTwice: true, wasFarBehind: false, laidThisTurn: false, wasSkipped: false };
}

/** Awards a Charm once. Returns true if it is new. */
function award(save: SaveData, id: CharmId, out: CharmId[]): void {
  if (!save.charms.includes(id)) {
    save.charms.push(id);
    out.push(id);
  }
}

/**
 * Updates stats, trackers and Charms for a batch of engine events.
 * Returns the Charms earned, for the toast.
 */
export function applyEvents(save: SaveData, match: SavedMatch, events: readonly GameEvent[]): CharmId[] {
  const earned: CharmId[] = [];
  const { stats } = save;
  const t = match.tracker;
  for (const e of events) {
    switch (e.type) {
      case 'turnStart':
        if (e.seat === 0) t.laidThisTurn = false;
        break;
      case 'layDown':
        if (e.seat === 0) {
          t.laidThisTurn = true;
          stats.wildsUsed += e.wilds;
          award(save, 'first-bloom', earned);
          if (e.wilds >= 2) award(save, 'wild-at-heart', earned);
        }
        break;
      case 'skipPlayed':
        if (e.seat === 0) {
          stats.skipsPlayed++;
          if (e.targetCards <= 3 && e.targetLaidDown) award(save, 'not-today', earned);
        }
        break;
      case 'skipNoTarget':
        if (e.seat === 0) stats.skipsPlayed++;
        break;
      case 'turnSkipped':
        if (e.seat === 0) {
          stats.timesSkipped++;
          t.wasSkipped = true;
        }
        break;
      case 'goOut':
        if (e.seat === 0) {
          stats.wentOut++;
          if (t.laidThisTurn) award(save, 'clean-sweep', earned);
        }
        break;
      case 'roundEnd': {
        const r = e.result;
        const phase = r.phasesBefore[0];
        if (phase !== null) t.attempts[phase] = (t.attempts[phase] ?? 0) + 1;
        if (r.advanced[0]) {
          stats.phases++;
          t.failStreak = 0;
          if (r.points[0] === 0) award(save, 'perfect-teatime', earned);
          if (phase === 8 && t.attempts[8] === 1) award(save, 'rainbow', earned);
          const moonlit = phaseSequence('moonlit');
          if (phase === moonlit[moonlit.length - 1]) award(save, 'moonlit-mastery', earned);
        } else {
          t.failStreak++;
          if (t.failStreak >= 2) t.neverFailedTwice = false;
        }
        const players = match.game.players;
        const most = Math.max(...players.map((p) => p.completed.length));
        if (most - players[0].completed.length >= 2) t.wasFarBehind = true;
        break;
      }
    }
  }
  return earned;
}

export type MatchSummary = {
  humanWon: boolean;
  stars: number;
  rounds: number;
  standings: number[];
  newUnlocks: Unlockable[];
  newCharms: CharmId[];
  firstBossWin: boolean;
  /** This win lifted the Moonlit Fog. */
  liftedFog: boolean;
};

/** Players in finishing order: winners, then most phases, then lowest score. */
export function standings(game: GameState): number[] {
  const seats = game.players.map((_, i) => i);
  return seats.sort((a, b) => {
    const wa = game.winners.includes(a) ? 1 : 0;
    const wb = game.winners.includes(b) ? 1 : 0;
    return wb - wa || game.players[b].completed.length - game.players[a].completed.length || game.players[a].score - game.players[b].score;
  });
}

/** Records a finished match, or a forfeit, and works out what it earned. */
export function finishMatch(save: SaveData, match: SavedMatch, forfeit = false): MatchSummary {
  const game = match.game;
  const before = unlockedSet(save);
  const humanWon = !forfeit && game.winners.includes(0);
  const rounds = game.round;
  const { stats } = save;
  const newCharms: CharmId[] = [];
  stats.played++;
  const order = standings(game);
  match.lineup.forEach((bot, i) => {
    if (bot === 'puff' || bot === 'haze') return;
    const seat = i + 1;
    const ahead = forfeit || (!humanWon && order.indexOf(seat) < order.indexOf(0));
    if (ahead) stats.perBot[bot].losses++;
    else stats.perBot[bot].wins++;
  });
  let stars = 0;
  let firstBossWin = false;
  let liftedFog = false;
  if (humanWon) {
    stats.won++;
    stats.streak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    if (game.variant === 'standard') stats.fewestRounds = stats.fewestRounds === null ? rounds : Math.min(stats.fewestRounds, rounds);
    if (match.tracker.neverFailedTwice) award(save, 'steady-hands', newCharms);
    if (match.tracker.wasFarBehind) award(save, 'comeback', newCharms);
    if (match.mode.kind === 'campaign') {
      const s = match.mode.stop;
      stars = starsFor(rounds);
      firstBossWin = s === 4 && !save.campaign.won[4];
      save.campaign.won[s] = true;
      save.campaign.stars[s] = Math.max(save.campaign.stars[s], stars);
      const best = save.campaign.bestRounds[s];
      save.campaign.bestRounds[s] = best === null ? rounds : Math.min(best, rounds);
      if (s === 4) award(save, 'garden-champion', newCharms);
      if (totalStars(save) === 15) award(save, 'bouquet', newCharms);
    }
    if (match.mode.kind === 'glade') {
      const g = save.glade;
      const id = match.mode.stop;
      const stop = GLADE_STOPS.find((x) => x.id === id)!;
      stars = gladeStarsFor(stop, rounds);
      if (!g.winOrder.includes(id)) g.winOrder.push(id);
      g.stars[id] = Math.max(g.stars[id] ?? 0, stars);
      g.bestRounds[id] = Math.min(g.bestRounds[id] ?? Infinity, rounds);
      const fogged = game.rules?.fog === true;
      if (fogged && stars === 3) award(save, 'fog-walker', newCharms);
      if (['a1', 'a2', 'b1', 'b2'].every((x) => g.winOrder.includes(x as GladeStopId))) award(save, 'both-paths', newCharms);
      if (id === 'g3') {
        if (!match.tracker.wasSkipped) award(save, 'thornproof', newCharms);
        if (!g.fogLifted) {
          g.fogLifted = true;
          g.liftScenePending = true;
          liftedFog = true;
          award(save, 'dawnbringer', newCharms);
        }
      }
    }
  } else {
    stats.streak = 0;
  }
  const after = unlockedSet(save);
  const newUnlocks = UNLOCKABLES.filter((u) => after.has(u.id) && !before.has(u.id));
  return { humanWon, stars, rounds, standings: order, newUnlocks, newCharms, firstBossWin, liftedFog };
}

/** A summary line for the Backup & Restore confirmation. */
export function saveSummary(save: SaveData): string {
  const stars = totalStars(save);
  return `${stars} ${stars === 1 ? 'star' : 'stars'}, ${save.charms.length} ${save.charms.length === 1 ? 'Charm' : 'Charms'}, ${save.stats.played} ${save.stats.played === 1 ? 'match' : 'matches'}`;
}

export function botName(id: BotId): string {
  return BOTS[id].name;
}
