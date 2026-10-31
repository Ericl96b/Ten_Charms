// Prepared table positions for the layout tests, built with the dev patch hook.
import { patch, startMatch, tap } from './helpers.ts';
import type { Page } from '@playwright/test';

export const LINEUPS = {
  worst: ['briar', 'marigold', 'pip'],
  two: ['briar', 'marigold'],
  duel: ['marigold'],
} as const;

export type FixtureName = keyof typeof LINEUPS;

const HELPERS = `
  const n = (id, num, suit) => ({ id, kind: 'num', num, suit });
  const wild = (id) => ({ id, kind: 'wild' });
  const inSet = (c, num) => ({ card: c, num });
  const SUITS = ['rose', 'moss', 'honey', 'moonstone'];
  const upTo = (phase) => Array.from({ length: phase - 1 }, (_, i) => i + 1);
`;

/** Each laid-down row, for whichever of these bots is seated. */
const ROWS = `
  const seatOf = (bot) => match.lineup.indexOf(bot) + 1;
  const groups = [];
  const seat = (bot, phase, cards) => {
    const s = seatOf(bot);
    if (s === 0) return;
    const p = game.players[s];
    p.phase = phase; p.completed = upTo(phase); p.laidDown = true; p.pendingSkip = false;
    p.hand = cards;
  };
  seat('briar', 9, [n(9001, 1, 'rose'), n(9002, 2, 'rose')]);
  seat('marigold', 5, [n(9003, 3, 'rose')]);
  seat('pip', 8, [n(9004, 4, 'moss'), n(9005, 5, 'moss'), n(9006, 6, 'moss')]);

  if (seatOf('briar')) {
    game.players[seatOf('briar')].pendingSkip = true;
    groups.push({ id: 101, owner: seatOf('briar'), type: 'set', num: 11, cards: [
      inSet(n(1001, 11, 'rose'), 11), inSet(n(1002, 11, 'moss'), 11), inSet(wild(1003), 11), inSet(n(1004, 11, 'honey'), 11), inSet(n(1005, 11, 'moonstone'), 11),
    ] });
    groups.push({ id: 102, owner: seatOf('briar'), type: 'set', num: 6, cards: [
      inSet(n(1006, 6, 'rose'), 6), inSet(n(1007, 6, 'moss'), 6), inSet(n(1008, 6, 'honey'), 6),
    ] });
  }
  if (seatOf('marigold')) {
    groups.push({ id: 103, owner: seatOf('marigold'), type: 'run', num: 3, cards: [3,4,5,6,7,8,9,10,11,12].map((v, i) =>
      inSet(v === 4 ? wild(1100) : n(1100 + i, v, SUITS[i % 4]), v)) });
  }
  if (seatOf('pip')) {
    groups.push({ id: 104, owner: seatOf('pip'), type: 'color', suit: 'rose', cards: [2,3,5,7,9,10,11,12].map((v, i) =>
      ({ card: n(1200 + i, v, 'rose'), suit: 'rose' })).concat([{ card: wild(1299), suit: 'rose' }]) });
  }
  groups.push({ id: 105, owner: 0, type: 'set', num: 8, cards: [
    inSet(n(1301, 8, 'moss'), 8), inSet(n(1302, 8, 'moonstone'), 8), inSet(n(1303, 8, 'honey'), 8), inSet(wild(1304), 8), inSet(n(1305, 8, 'rose'), 8),
  ] });
  groups.push({ id: 106, owner: 0, type: 'set', num: 3, cards: [
    inSet(n(1306, 3, 'rose'), 3), inSet(n(1307, 3, 'honey'), 3), inSet(n(1308, 3, 'moss'), 3), inSet(n(1309, 3, 'moonstone'), 3),
  ] });
`;

const POSITION = HELPERS + ROWS + `
  const me = game.players[0];
  me.phase = 7; me.completed = upTo(7); me.laidDown = true; me.pendingSkip = false; me.score = 145;
  me.hand = [n(1401, 2, 'moonstone'), n(1402, 12, 'honey'), n(1403, 4, 'moss'), { id: 1404, kind: 'skip' }, n(1405, 11, 'rose')];
  game.groups = groups;
  game.round = 10; game.current = 0; game.stage = 'play';
  game.discardPile = [n(1501, 1, 'honey')];
  game.drawPile = game.drawPile.slice(0, 38);
  match.ui.sort = 'custom';
  match.ui.order = [1401, 1402, 1403, 1404, 1405];
  match.ui.slots = [[], []];
`;

/** Round 10, everyone down, her turn after drawing, with the Moonstone 2 selected to hit Marigold's run. */
export async function openFixture(page: Page, name: FixtureName): Promise<void> {
  await startMatch(page, { lineup: [...LINEUPS[name]], seed: 'd3'.repeat(16), botSeed: 'd4'.repeat(16) });
  await patch(page, POSITION);
  await tap(page, '.hc[data-id="1401"]');
}

/** A row counts only when its label and all its cards are fully inside the laid-down area. */
export function visibleRows(page: Page): Promise<number> {
  return page.evaluate(() => {
    const area = document.querySelector('.laid')!.getBoundingClientRect();
    const inside = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.top >= area.top - 0.5 && r.bottom <= area.bottom + 0.5;
    };
    return [...document.querySelectorAll('.laid-row')].filter((row) => inside(row.querySelector('.laid-label')!) && [...row.querySelectorAll('.card')].every(inside)).length;
  });
}

/** Stands in for a notched phone. Playwright's own safe-area insets are always zero. */
export async function simulateInsets(page: Page, top: number, bottom: number): Promise<void> {
  await page.addInitScript(([t, b]) => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.setProperty('--sat', `${t}px`);
      document.documentElement.style.setProperty('--sab', `${b}px`);
    });
  }, [top, bottom]);
}
