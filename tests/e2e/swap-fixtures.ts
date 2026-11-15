// Saves recorded on the game from before Change Request 04, each holding a match in progress (tests/fixtures/pre-cr04).
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect } from './helpers.ts';

export type Fixture = { name: string; save: Record<string, any> };

export const OLD_LIST_FIXTURES = ['glade-a2-fogged', 'glade-g3-boss', 'free-moonlit'] as const;
export const TRIAL_FIXTURES = ['free-trialA', 'free-trialB', 'free-trialC'] as const;
export const RETIRED = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
export const NEW_LIST = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30];

export function fixture(name: string): Record<string, any> {
  return JSON.parse(readFileSync(`tests/fixtures/pre-cr04/${name}.json`, 'utf8'));
}

/** The match as the update should load it: unchanged, except that a Trial A match is now a Moonlit Phases match. */
export function expectedGame(name: string): Record<string, any> {
  const game = fixture(name).match.game;
  if (game.variant === 'trialA') game.variant = 'moonlit';
  return game;
}

/** Puts the prepared save on the device before the game first loads, once, as if she'd had it before the update. */
export async function openWithFixture(page: Page, name: string): Promise<void> {
  const save = fixture(name);
  // The install helper was dismissed just now, as every test's save does, so it never covers the table.
  save.install = { dismissedAt: Date.now() };
  await page.addInitScript((text) => {
    if (!localStorage.getItem('ten-charms.save')) localStorage.setItem('ten-charms.save', text);
  }, JSON.stringify(save));
  await page.goto('/');
  await waitForResumedTable(page);
}

export async function waitForResumedTable(page: Page): Promise<void> {
  await page.waitForFunction(() => '__TC__' in window, null, { timeout: 15_000 });
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await page.waitForSelector('[data-screen="table"]', { timeout: 15_000 });
  await page.waitForFunction(() => (window as any).__TC__.state() !== null, null, { timeout: 15_000 });
  await page.waitForFunction(() => (window as any).__TC__.idle(), null, { timeout: 60_000 });
}

/** What the table shows, as text and order: the Phase Panel, the chips, the laid-down rows and the hand. */
export async function tableView(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const text = (sel: string) => [...document.querySelectorAll(sel)].map((e) => (e as HTMLElement).innerText.trim());
    return {
      panel: text('.panel'),
      medallion: document.querySelector('[data-testid="medallion"]')?.getAttribute('aria-label') ?? null,
      slots: text('[data-testid^="slot-"]'),
      chips: text('.chip'),
      laid: text('.laid-row'),
      hand: [...document.querySelectorAll('.hc[data-id]')].map((e) => e.getAttribute('data-id')),
      fogged: document.querySelector('.table-screen')?.classList.contains('fogged') ?? null,
    };
  });
}

export async function gameAndUi(page: Page): Promise<{ game: any; ui: any }> {
  return page.evaluate(() => { const t = (window as any).__TC__; return { game: t.state(), ui: t.ui() }; });
}

export { expect };
