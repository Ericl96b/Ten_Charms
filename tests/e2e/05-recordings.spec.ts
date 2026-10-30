import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { openApp, patch, startMatch, tap, test, waitIdle } from './helpers.ts';

// Short clips for the person reviewing the feel. One size is enough.
test.use({ video: { mode: 'on', size: { width: 390, height: 844 } } });

const READY = `
  const n = (id, num, suit) => ({ id, kind: 'num', num, suit: suit || 'rose' });
  const me = game.players[0];
  me.phase = 1; me.completed = []; me.laidDown = false; me.pendingSkip = false;
  game.groups = []; game.current = 0; game.stage = 'play';
  game.players[1].phase = 1;
  match.ui.slots = [[],[]];
`;

async function save(page: Page, name: string): Promise<void> {
  mkdirSync('qa-screenshots', { recursive: true });
  const video = page.video()!;
  await page.close();
  await video.saveAs(`qa-screenshots/recording-${name}.webm`);
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'ref', 'recorded at the reference size only');
});

test('recording: lay down', async ({ page }) => {
  await openApp(page);
  await startMatch(page, { lineup: ['pip'], seed: 'd1'.repeat(16), botSeed: 'd2'.repeat(16) });
  await patch(page, READY + `me.hand = [n(1,3),n(2,3,'moss'),n(3,3,'honey'),n(4,9),n(5,9,'moss'),n(6,9,'honey'),n(9,1),n(10,1)];`);
  await tap(page, '[data-testid="suggest"]');
  await page.waitForTimeout(700);
  await tap(page, '[data-testid="primary"]');
  await page.waitForTimeout(2200);
  await waitIdle(page);
  await save(page, 'lay-down');
});

test('recording: being skipped', async ({ page }) => {
  await openApp(page);
  await startMatch(page, { lineup: ['briar'], seed: 'd3'.repeat(16), botSeed: 'd4'.repeat(16) });
  await patch(page, READY + `
    me.completed = [1,2]; me.phase = 3;
    me.hand = [n(1,1),n(2,2),n(3,4),n(4,7)];
    game.players[1].hand = [{id:20,kind:'skip'},n(21,1),n(22,3),n(23,5)];
  `);
  await tap(page, '.hc[data-id="1"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForTimeout(3500);
  await save(page, 'skip');
});

test('recording: going out', async ({ page }) => {
  await openApp(page);
  await startMatch(page, { lineup: ['pip'], seed: 'd5'.repeat(16), botSeed: 'd6'.repeat(16) });
  await patch(page, READY + `
    me.laidDown = true; me.hand = [n(1,4)];
    game.groups = [{ id: 70, owner: 0, type: 'set', num: 3, cards: [1,2,3].map((v) => ({ card: n(60 + v, 3), num: 3 })) }];
    game.players[1].hand = [n(21,1),n(22,3),n(23,5),n(24,11)];
  `);
  await tap(page, '.hc[data-id="1"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="round-end"]', { timeout: 30_000 });
  await page.waitForTimeout(800);
  await save(page, 'going-out');
});

test('recording: victory', async ({ page }) => {
  await openApp(page);
  await startMatch(page, { lineup: ['pip'], seed: 'd7'.repeat(16), botSeed: 'd8'.repeat(16), mode: { kind: 'campaign', stop: 0 } });
  await page.locator('[data-testid="coach-skip"]').click({ timeout: 8000 }).catch(() => {});
  await waitIdle(page);
  await patch(page, `
    const me = game.players[0];
    me.completed = [1,2,3,4,5,6,7,8,9]; me.phase = 10; me.laidDown = true;
    me.hand = [{ id: 900, kind: 'num', num: 2, suit: 'rose' }];
    game.round = 12; game.current = 0; game.stage = 'play';
  `);
  await tap(page, '.hc[data-id="900"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="reveal"]', { timeout: 30_000 });
  await page.waitForTimeout(2200);
  await save(page, 'victory');
});

test('recording: boss intro', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.campaign.won = [true, true, true, true, false];
    s.tutorial.done = true;
    t.loadSave(s);
  });
  await tap(page, '[data-testid="stop-5"] .stop-btn');
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-testid="boss-intro"]');
  await page.waitForSelector('[data-testid="boss-intro"]', { state: 'detached', timeout: 15_000 });
  await page.waitForTimeout(1200);
  await save(page, 'boss-intro');
});
