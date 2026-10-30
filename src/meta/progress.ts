// Campaign progress, unlocks, Charms and stats. Pure logic over the save data.
import { BOTS, STOPS, UNLOCKABLES, type CharmId, type Requirement, type Unlockable } from '../content.ts';
import type { GameEvent, GameState } from '../engine/types.ts';
import type { BotId } from '../bots/profiles.ts';
import type { MatchTracker, SaveData, SavedMatch } from './save.ts';

export function totalStars(save: SaveData): number {
  return save.campaign.stars.reduce((a, b) => a + b, 0);
}

export function meets(save: SaveData, req: Requirement): boolean {
  if (req.kind === 'default') return true;
  if (req.kind === 'stars') return totalStars(save) >= req.stars;
  return save.campaign.won[req.stop - 1];
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
  return STOPS.filter((_, i) => stopOpen(save, i)).map((s) => s.featured);
}

export function starsFor(rounds: number): number {
  if (rounds <= 12) return 3;
  if (rounds <= 14) return 2;
  return 1;
}

export function newTracker(): MatchTracker {
  return { attempts: {}, failStreak: 0, neverFailedTwice: true, wasFarBehind: false, laidThisTurn: false };
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
        if (e.seat === 0) stats.timesSkipped++;
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
    const seat = i + 1;
    const ahead = forfeit || (!humanWon && order.indexOf(seat) < order.indexOf(0));
    if (ahead) stats.perBot[bot].losses++;
    else stats.perBot[bot].wins++;
  });
  let stars = 0;
  let firstBossWin = false;
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
  } else {
    stats.streak = 0;
  }
  const after = unlockedSet(save);
  const newUnlocks = UNLOCKABLES.filter((u) => after.has(u.id) && !before.has(u.id));
  return { humanWon, stars, rounds, standings: order, newUnlocks, newCharms, firstBossWin };
}

/** A summary line for the Backup & Restore confirmation. */
export function saveSummary(save: SaveData): string {
  const stars = totalStars(save);
  return `${stars} ${stars === 1 ? 'star' : 'stars'}, ${save.charms.length} ${save.charms.length === 1 ? 'Charm' : 'Charms'}, ${save.stats.played} ${save.stats.played === 1 ? 'match' : 'matches'}`;
}

export function botName(id: BotId): string {
  return BOTS[id].name;
}
