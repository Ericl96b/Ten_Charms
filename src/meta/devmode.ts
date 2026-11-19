// Dev Mode (Change Request 05): a per-browser setting, turned on only by the secret link, under which every progression
// lock reads as open. It lives in its own storage key, never in the save, so a save and a backup code never carry it.
// The game's real progress (progress.ts) is untouched: these functions only change what the screens show and allow.
import type { BotId } from '../bots/profiles.ts';
import { GLADE_STOPS, STOPS, UNLOCKABLES, type GladeStop, type GladeStopId } from '../content.ts';
import { botsUnlocked, crossroadsOpen, gladeOpen, gladeOpenedAt, gladeUnlocked, gladeWon, isUnlocked, stopOpen } from './progress.ts';
import { defaultSave, type SaveData, type SavedMatch } from './save.ts';

const KEY = 'ten-charms.dev';
/** Set when Dev Mode is turned off during a match that only Dev Mode opened, until that match ends. */
const LINGER_KEY = 'ten-charms.dev.lingering';

/** The link's word is never stored. Only this salted, slow digest of it is, so the public code can't reveal it. */
export const DEV_SALT = 'ten-charms/dev-mode/v1';
export const DEV_ITERATIONS = 200_000;
export const DEV_DIGEST = '4fe843290bc922783b352b96d1b962363918af41a78ff40ecda27410a45d1338';

let on = false;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Reads the setting from storage. Called once at startup. */
export function readDevMode(): void {
  try {
    on = storage()?.getItem(KEY) === '1';
  } catch {
    on = false;
  }
}

export function devModeOn(): boolean {
  return on;
}

export async function digestOf(word: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(word), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(DEV_SALT), iterations: DEV_ITERATIONS }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True only for the exact word: no trimming, no change of case. */
export async function isDevWord(word: string): Promise<boolean> {
  if (word.length === 0) return false;
  try {
    return (await digestOf(word)) === DEV_DIGEST;
  } catch {
    return false;
  }
}

/**
 * At startup, when the address has a fragment: the right word turns Dev Mode on and leaves the address without it.
 * Anything else does nothing at all.
 */
export async function checkDevLink(): Promise<void> {
  const hash = location.hash;
  if (hash.length < 2) return;
  let word: string;
  try {
    word = decodeURIComponent(hash.slice(1));
  } catch {
    return;
  }
  if (!(await isDevWord(word))) return;
  on = true;
  try {
    storage()?.setItem(KEY, '1');
    storage()?.removeItem(LINGER_KEY);
  } catch { /* still on for this visit */ }
  history.replaceState(history.state, '', location.pathname + location.search);
}

/* ---------- What the screens may show and open ---------- */

export function canPlayStop(save: SaveData, stop: number): boolean {
  return on || stopOpen(save, stop);
}

export function canSeeGlade(save: SaveData): boolean {
  return on || gladeOpen(save);
}

export function canSeeCrossroads(save: SaveData): boolean {
  return on || crossroadsOpen(save);
}

export function canUse(save: SaveData, id: string): boolean {
  return on ? UNLOCKABLES.some((u) => u.id === id) : isUnlocked(save, id);
}

/** When a Glade stop opened, as gladeOpenedAt; in Dev Mode a stop still locked counts as open from the start. */
export function gladeOpenedAtAccess(save: SaveData, stop: GladeStop): number | null {
  const real = gladeOpenedAt(save, stop);
  return real === null && on ? -1 : real;
}

/** The open stop that gets the Play button, as gladePlayStop, over the stops the screens may open. */
export function gladePlayStopAccess(save: SaveData): GladeStopId | null {
  let best: GladeStopId | null = null;
  let bestAt = -Infinity;
  for (const s of GLADE_STOPS) {
    const at = gladeOpenedAtAccess(save, s);
    if (at === null || gladeWon(save, s.id)) continue;
    if (at > bestAt) { bestAt = at; best = s.id; }
  }
  return best;
}

export function botsAvailable(save: SaveData): BotId[] {
  return on ? [...STOPS.map((s) => s.featured), ...GLADE_STOPS.map((s) => s.featured)] : botsUnlocked(save);
}

/* ---------- Turning it off ---------- */

/** Whether a match could have been started without Dev Mode. */
export function reallyAllowed(save: SaveData, match: SavedMatch): boolean {
  const m = match.mode;
  if (m.kind === 'campaign') return stopOpen(save, m.stop);
  if (m.kind === 'glade') return gladeUnlocked(save, m.stop);
  if (m.kind === 'tower') return crossroadsOpen(save);
  const known = (id: string) => !UNLOCKABLES.some((u) => u.id === id) || isUnlocked(save, id);
  const variant = match.game.variant;
  const variantOpen = variant === 'sprint' || variant === 'choose' || variant === 'moonlit' ? isUnlocked(save, variant) : true;
  const bots = botsUnlocked(save);
  return isUnlocked(save, 'free-play') && variantOpen && match.lineup.every((b) => bots.includes(b)) && known(match.back) && known(match.cloth);
}

/**
 * Puts back what only Dev Mode allowed: equipped items locked without it go to their slot's default, and a remembered
 * place locked without it goes back to the garden, as the Journey would show then. Returns whether anything changed.
 */
export function applyRealLocks(save: SaveData): boolean {
  let changed = false;
  const defaults = defaultSave().equipped;
  for (const slot of ['back', 'cloth', 'music'] as const) {
    const id = save.equipped[slot];
    if (UNLOCKABLES.some((u) => u.id === id) && !isUnlocked(save, id)) {
      save.equipped[slot] = defaults[slot];
      changed = true;
    }
  }
  const last = save.glade.lastMap;
  if ((last === 'glade' && !gladeOpen(save)) || (last === 'crossroads' && !crossroadsOpen(save))) {
    save.glade.lastMap = 'garden';
    changed = true;
  }
  return changed;
}

/** A copy of the save as it would be without Dev Mode, for a backup code. With Dev Mode off it is the save itself. */
export function forExport(save: SaveData): SaveData {
  if (!on) return save;
  const copy = JSON.parse(JSON.stringify(save)) as SaveData;
  applyRealLocks(copy);
  return copy;
}

/** Turns Dev Mode off. Returns whether the save changed, so it is only written when it did. */
export function turnOffDevMode(save: SaveData): boolean {
  on = false;
  try {
    storage()?.removeItem(KEY);
    if (save.match && !reallyAllowed(save, save.match)) storage()?.setItem(LINGER_KEY, '1');
  } catch { /* off for this visit */ }
  return applyRealLocks(save);
}

/**
 * At a match's end: true if it was a match only Dev Mode opened and Dev Mode was turned off during it, so its end
 * screen offers only the way back. Clears the mark, so the lock applies again from here.
 */
export function takeLingering(): boolean {
  try {
    const s = storage();
    if (!s || s.getItem(LINGER_KEY) !== '1') return false;
    s.removeItem(LINGER_KEY);
    return true;
  } catch {
    return false;
  }
}
