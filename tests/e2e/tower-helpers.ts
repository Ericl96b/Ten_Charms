// Shared set-up for the Tower's browser tests.
import type { Page } from '@playwright/test';
import { expect, tap } from './helpers.ts';

/** Both maps finished, or Map 2 up to (but not) Lunaria, on a chosen place. */
export async function towerSave(page: Page, opts: { lunaria?: boolean; place?: 'garden' | 'glade' | 'crossroads'; revealSeen?: boolean; tower?: Record<string, unknown> } = {}): Promise<void> {
  await page.evaluate((o) => {
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.match = null;
    s.tutorial.done = true;
    s.backupPrompted = true;
    s.campaign.won = [true, true, true, true, true];
    s.campaign.stars = [3, 3, 3, 3, 3];
    const order = ['g1', 'a1', 'b1', 'a2', 'b2', 'g2', ...(o.lunaria === false ? [] : ['g3'])];
    s.glade = { ...s.glade, winOrder: order, stars: Object.fromEntries(order.map((id: string) => [id, 3])), fogLifted: o.lunaria !== false, revealSeen: true, liftScenePending: false, lastMap: o.place ?? 'garden' };
    s.tower = { ...s.tower, revealSeen: o.revealSeen ?? true, ...(o.tower ?? {}) };
    t.loadSave(s);
  }, opts);
}


/** Waits until the screen before has faded out, so only one screen is up. */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('#screens > .screen').length === 1, null, { timeout: 10_000 });
}

/** A climb set up through the dev hook, then Tower home opened. */
export async function towerAt(page: Page, opts: Record<string, unknown>): Promise<void> {
  await page.evaluate((o) => (window as any).__TC__.towerSet(o), opts);
  await page.evaluate(() => (window as any).__TC__.towerHome());
  await page.waitForSelector('[data-screen="tower"].ready');
  await settled(page);
}

/** Opens the floor intro from Tower home and waits for the deal to settle. */
export async function openIntro(page: Page): Promise<void> {
  await tap(page, '[data-testid="tower-play"]');
  await page.waitForSelector('[data-testid="floor-intro"]');
  await page.waitForFunction(() => document.querySelectorAll('.ph-card.up').length === 3, null, { timeout: 10_000 });
}

/** Begins the floor and waits for the table, past any Guardian's intro. */
export async function beginFloor(page: Page): Promise<void> {
  await tap(page, '[data-testid="begin-floor"]');
  await page.waitForSelector('[data-screen="table"]');
  await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 20_000 });
  await page.waitForFunction(() => (window as any).__TC__.idle(), null, { timeout: 60_000 });
}

/** Ends the floor at the table, won or lost, and waits for its result. */
export async function forceFloor(page: Page, won: boolean): Promise<void> {
  await page.evaluate((w) => (window as any).__TC__.forceFloor(w), won);
  await page.waitForSelector('[data-testid="floor-result"]', { timeout: 20_000 });
}

export { expect };
