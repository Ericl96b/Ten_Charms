// Everything that persists on the device, with a schema version and one rolling backup.
import type { BotId } from '../bots/profiles.ts';
import type { GameState } from '../engine/types.ts';

export const SCHEMA = 2;
const KEY = 'ten-charms.save';
const BACKUP_KEY = 'ten-charms.save.backup';
/** One untouched copy of the save as it was before the Moonlit Glade update. Written once, never changed. */
const SNAPSHOT_KEY = 'ten-charms.save.pre-map2';

export type GladeStopId = 'g1' | 'a1' | 'a2' | 'b1' | 'b2' | 'g2' | 'g3';

/** Moonlit Glade progress. Map 2 access itself comes from campaign.won, so it needs no flag here. */
export type GladeProgress = {
  /** Stops won, earliest first. The order decides which open stop gets the Play button. */
  winOrder: GladeStopId[];
  stars: Partial<Record<GladeStopId, number>>;
  bestRounds: Partial<Record<GladeStopId, number>>;
  fogLifted: boolean;
  /** The one-time path reveal has started, so it can never play again. */
  revealSeen: boolean;
  /** The fog-lift scene is owed and hasn't started yet. */
  liftScenePending: boolean;
  lastMap: 'garden' | 'glade';
};

export type Settings = {
  music: number;
  sfx: number;
  botSpeed: 'relaxed' | 'normal' | 'brisk';
  animSpeed: 'normal' | 'fast';
  reducedMotion: boolean;
  hints: boolean;
  confirmDiscard: boolean;
};

/** Every bot with a line in Stats. Lunaria's wisps have none. */
export type StatBotId = Exclude<BotId, 'puff' | 'haze'>;

export type Stats = {
  played: number;
  won: number;
  streak: number;
  bestStreak: number;
  phases: number;
  fewestRounds: number | null;
  wentOut: number;
  skipsPlayed: number;
  timesSkipped: number;
  wildsUsed: number;
  perBot: Record<StatBotId, { wins: number; losses: number }>;
};

export type MatchMode = { kind: 'campaign'; stop: number } | { kind: 'glade'; stop: GladeStopId } | { kind: 'free' };

/** What the Charms need to remember across a match. */
export type MatchTracker = {
  attempts: Record<number, number>;
  failStreak: number;
  neverFailedTwice: boolean;
  wasFarBehind: boolean;
  laidThisTurn: boolean;
  /** The human lost a turn to a Skip this match. Missing in matches saved before Map 2. */
  wasSkipped?: boolean;
};

export type SavedMatch = {
  game: GameState;
  lineup: BotId[];
  mode: MatchMode;
  back: string;
  cloth: string;
  boss: boolean;
  ui: { order: number[]; sort: 'number' | 'color' | 'custom'; slots: number[][]; roundShown: number };
  tracker: MatchTracker;
  botTurns: number[];
  /** Dev-only: when set, bot dice are repeatable. */
  botSeed?: string;
  botDraws?: number;
};

export type SaveData = {
  schema: number;
  settings: Settings;
  campaign: { won: boolean[]; stars: number[]; bestRounds: (number | null)[] };
  glade: GladeProgress;
  equipped: { back: string; cloth: string; music: string };
  charms: string[];
  stats: Stats;
  tutorial: { done: boolean; seen: number[] };
  install: { dismissedAt: number };
  backupPrompted: boolean;
  match: SavedMatch | null;
};

function defaultGlade(): GladeProgress {
  return { winOrder: [], stars: {}, bestRounds: {}, fogLifted: false, revealSeen: false, liftScenePending: false, lastMap: 'garden' };
}

export function defaultSave(): SaveData {
  const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    schema: SCHEMA,
    settings: { music: 0.5, sfx: 0.8, botSpeed: 'normal', animSpeed: 'normal', reducedMotion: prefersReduced, hints: true, confirmDiscard: false },
    campaign: { won: [false, false, false, false, false], stars: [0, 0, 0, 0, 0], bestRounds: [null, null, null, null, null] },
    glade: defaultGlade(),
    equipped: { back: 'rose-lattice', cloth: 'blush-gingham', music: 'garden-waltz' },
    charms: [],
    stats: {
      played: 0, won: 0, streak: 0, bestStreak: 0, phases: 0, fewestRounds: null, wentOut: 0, skipsPlayed: 0, timesSkipped: 0, wildsUsed: 0,
      perBot: {
        pip: { wins: 0, losses: 0 }, marigold: { wins: 0, losses: 0 }, briar: { wins: 0, losses: 0 },
        hoot: { wins: 0, losses: 0 }, nightshade: { wins: 0, losses: 0 },
        lumi: { wins: 0, losses: 0 }, mallow: { wins: 0, losses: 0 }, velvet: { wins: 0, losses: 0 }, fennel: { wins: 0, losses: 0 },
        sable: { wins: 0, losses: 0 }, mossback: { wins: 0, losses: 0 }, lunaria: { wins: 0, losses: 0 },
      },
    },
    tutorial: { done: false, seen: [] },
    install: { dismissedAt: 0 },
    backupPrompted: false,
    match: null,
  };
}

/** Each entry upgrades a save from version N to N + 1. Add to this list; never rewrite old entries. */
const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {
  // The Moonlit Glade. Everything already saved stays exactly as it was.
  1: (old) => ({ ...old, glade: defaultGlade() }),
};

/** Brings any readable save up to the current shape, filling in anything missing from defaults. */
export function migrate(raw: unknown): SaveData {
  if (typeof raw !== 'object' || raw === null) throw new Error('Not a save');
  let data = raw as Record<string, unknown>;
  let version = typeof data.schema === 'number' ? data.schema : 0;
  if (version > SCHEMA) throw new Error('Save is from a newer version');
  while (version < SCHEMA) {
    const step = MIGRATIONS[version];
    if (step) data = step(data);
    version++;
  }
  const base = defaultSave();
  const merged = { ...base, ...data, schema: SCHEMA } as SaveData;
  merged.settings = { ...base.settings, ...(data.settings as object) };
  merged.campaign = { ...base.campaign, ...(data.campaign as object) };
  merged.glade = { ...base.glade, ...(data.glade as object) };
  if (!Array.isArray(merged.glade.winOrder)) throw new Error('Bad save');
  merged.equipped = { ...base.equipped, ...(data.equipped as object) };
  merged.tutorial = { ...base.tutorial, ...(data.tutorial as object) };
  merged.install = { ...base.install, ...(data.install as object) };
  merged.stats = { ...base.stats, ...(data.stats as object) };
  merged.stats.perBot = { ...base.stats.perBot, ...(merged.stats.perBot ?? {}) };
  if (!Array.isArray(merged.charms)) throw new Error('Bad save');
  for (const list of [merged.campaign.won, merged.campaign.stars, merged.campaign.bestRounds]) {
    if (!Array.isArray(list) || list.length !== 5) throw new Error('Bad save');
  }
  if (merged.match && !merged.match.game?.players) merged.match = null;
  return merged;
}

function read(key: string): SaveData | null {
  try {
    const text = localStorage.getItem(key);
    return text ? migrate(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

/** Keeps the save as it stood before its first upgrade to the Moonlit Glade schema. */
function snapshotOldSave(): void {
  try {
    const text = localStorage.getItem(KEY);
    if (!text || localStorage.getItem(SNAPSHOT_KEY)) return;
    const version = (JSON.parse(text) as { schema?: unknown }).schema;
    if (typeof version === 'number' && version < 2) localStorage.setItem(SNAPSHOT_KEY, text);
  } catch { /* the upgrade still goes ahead; the rolling backup remains */ }
}

export function loadSave(): SaveData {
  snapshotOldSave();
  return read(KEY) ?? read(BACKUP_KEY) ?? defaultSave();
}

let lastGood: string | null = null;

export function writeSave(data: SaveData): void {
  try {
    const text = JSON.stringify(data);
    if (lastGood === null) lastGood = localStorage.getItem(KEY);
    if (lastGood) localStorage.setItem(BACKUP_KEY, lastGood);
    localStorage.setItem(KEY, text);
    lastGood = text;
  } catch {
    // Storage can be full or blocked. The game keeps playing from memory.
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(BACKUP_KEY);
  } catch { /* nothing to clear */ }
  lastGood = null;
}

export function requestPersistence(): void {
  try {
    void navigator.storage?.persist?.();
  } catch { /* not supported */ }
}

/* ---------- Backup codes ---------- */

const PREFIX = 'TC1-';

function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(code: string): string {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** A copyable code holding progress. The match in progress stays out of it. */
export function exportCode(data: SaveData): string {
  const text = JSON.stringify({ ...data, match: null });
  return `${PREFIX}${checksum(text)}.${encode(text)}`;
}

export function importCode(code: string): SaveData | null {
  try {
    const trimmed = code.trim();
    if (!trimmed.startsWith(PREFIX)) return null;
    const dot = trimmed.indexOf('.');
    const sum = trimmed.slice(PREFIX.length, dot);
    const text = decode(trimmed.slice(dot + 1));
    if (checksum(text) !== sum) return null;
    return migrate(JSON.parse(text));
  } catch {
    return null;
  }
}
