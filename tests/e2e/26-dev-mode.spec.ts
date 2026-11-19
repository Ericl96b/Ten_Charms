// Dev Mode (Change Request 05): the secret link, every lock it opens, turning it off, and proof that it changes nothing
// for a phone that never opened the link. The word comes from outside the repo (scripts/dev-word.ts) and only ever
// enters the page as an argument, never in a title, an address the runner logs, or a message.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { requireDevWord } from '../../scripts/dev-word.ts';
import { expect, openApp, patch, prepare, tap, test } from './helpers.ts';
import { beginFloor, forceFloor, openIntro, settled, towerSave } from './tower-helpers.ts';

const WORD = requireDevWord();
const DIR = 'qa-screenshots/cr05/dev-on';
const STOP_IDS = ['g1', 'a1', 'a2', 'b1', 'b2', 'g2', 'g3'];
/** A fixed install time, so two saves made in one test compare byte for byte. In the future, so the install helper stays away. */
const FIXED = { install: { dismissedAt: 4_102_444_800_000 } };

const raw = (page: Page) => page.evaluate(() => localStorage.getItem('ten-charms.save'));
const flag = (page: Page) => page.evaluate(() => localStorage.getItem('ten-charms.dev'));
const save = (page: Page) => page.evaluate(() => (window as any).__TC__.getSave());
const hasWord = (page: Page) => page.evaluate((w) => location.href.includes(w) || location.href.includes(encodeURIComponent(w)), WORD);

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => '__TC__' in window);
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  await page.waitForSelector('[data-screen="journey"], [data-screen="table"]');
}

/** Reopens the app at its address with this fragment (or none), as a link would. */
async function openWith(page: Page, fragment: string | null): Promise<void> {
  await page.evaluate((f) => history.replaceState(null, '', location.pathname + (f === null ? '' : `#${f}`)), fragment);
  await page.reload();
  await ready(page);
}

const openWithWord = (page: Page) => page.evaluate((w) => encodeURIComponent(w), WORD).then((f) => openWith(page, f));

/** A fresh save, with Dev Mode on. */
async function freshDev(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
  await openApp(page, { tutorial: { done: true, seen: [] }, ...FIXED, ...extra });
  await openWithWord(page);
  expect(await flag(page)).toBe('1');
}

/** Fixes the random choices and hides the layers that drift by the clock, as the visual captures do. */
async function steady(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let seed = 0x5eed;
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '.ambient, .bubble, .toast, .fx-layer, .petal, .splash-petal { visibility: hidden !important; }';
      document.head.append(style);
    });
  });
}

/** Holds still every loop and drifting layer, then takes the picture. */
async function still(page: Page): Promise<Buffer> {
  // A mouse click elsewhere in the test leaves the pointer resting on whatever is now under it, hovered.
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(() => {
    (window as any).__TC__.freezeAmbient?.();
    for (const a of document.getAnimations()) if (a.effect?.getTiming().iterations === Infinity) a.cancel();
  });
  await page.waitForTimeout(450);
  return page.screenshot({ animations: 'disabled' });
}

async function openSettings(page: Page): Promise<void> {
  await tap(page, '[data-testid="settings"]');
  await page.waitForSelector('[data-testid="settings-screen"]');
  await page.waitForTimeout(400);
}

async function closeSettings(page: Page): Promise<void> {
  await tap(page, '[data-testid="settings-back"]');
  await page.waitForSelector('[data-testid="settings-screen"]', { state: 'detached' });
}

async function tab(page: Page, nav: 'journey' | 'free' | 'collection' | 'stats'): Promise<void> {
  await tap(page, `[data-testid="nav-${nav}"]`);
  await page.waitForSelector(`[data-screen="${nav}"]`);
  await settled(page);
}

async function toPlace(page: Page, place: 'garden' | 'glade' | 'crossroads'): Promise<void> {
  if ((await page.locator(`[data-screen="journey"][data-map="${place}"]`).count()) === 0) await tap(page, `[data-testid="map-${place}"]`);
  await page.waitForSelector(`[data-screen="journey"][data-map="${place}"]`);
  await settled(page);
}

/** Back to the map with no match, as the visual tests do between matches. */
const clearMatch = (page: Page) => page.evaluate(() => {
  const t = (window as any).__TC__;
  const s = t.getSave();
  s.match = null;
  t.loadSave(s);
});

/** Puts her one discard from winning, then wins, as the campaign test does. */
async function winHere(page: Page, round = 12): Promise<void> {
  await page.waitForFunction(() => (window as any).__TC__.idle(), null, { timeout: 60_000 });
  await patch(page, `
    const me = game.players[0];
    me.completed = [1,2,3,4,5,6,7,8,9]; me.phase = 10; me.laidDown = true;
    me.hand = [{ id: 900, kind: 'num', num: 2, suit: 'rose' }];
    game.round = ${round}; game.current = 0; game.stage = 'play';
  `);
  await tap(page, '.hc[data-id="900"]');
  await tap(page, '[data-testid="discard-btn"]');
  await page.waitForSelector('[data-testid="victory"]', { timeout: 30_000 });
}

/** Taps through a victory's reveals to its buttons. */
async function toEndButtons(page: Page): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (await page.locator('[data-testid="continue"]').count()) return;
    for (const id of ['reveal', 'reveal-charm']) if (await page.locator(`[data-testid="${id}"]`).count()) await page.locator(`[data-testid="${id}"]`).click({ force: true });
    await page.waitForTimeout(100);
  }
  throw new Error('the victory never reached its buttons');
}

/** No sideways scrolling, nothing past the screen's sides, and no two neighbours on top of each other. */
async function inLayout(page: Page): Promise<void> {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    const doc = document.scrollingElement!;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push('the page scrolls sideways');
    for (const el of document.querySelectorAll<HTMLElement>('.page-scroll, .map-scroll, .seg, .map-switch')) {
      if (el.scrollWidth > el.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX)) out.push(`${el.className} scrolls sideways`);
    }
    const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    for (const el of document.querySelectorAll<HTMLElement>('.map-top, .bottom-nav, .page-top, .xr-card, .xr-plate, .set-row, .item, .fp-bot, .seg-btn, .map-opt, .btn')) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${el.className} goes past the side (${Math.round(r.left)}–${Math.round(r.right)} of ${vw})`);
    }
    for (const sel of ['.item-grid', '.fp-bots', '.seg', '.map-switch', '.set-row', '.charm-grid']) {
      for (const box of document.querySelectorAll(sel)) {
        const kids = [...box.children].filter(shown).map((k) => ({ k, r: k.getBoundingClientRect() }));
        for (let i = 0; i < kids.length; i++) {
          for (let j = i + 1; j < kids.length; j++) {
            const a = kids[i].r, b = kids[j].r;
            if (a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5) out.push(`${sel}: two items overlap`);
          }
        }
        const p = box.getBoundingClientRect();
        for (const { r } of kids) if (r.left < p.left - 0.5 || r.right > p.right + 0.5) out.push(`${sel}: an item is clipped at the side`);
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
}

/* ---------- Turning it on and off ---------- */

test('dev mode: the secret link turns it on, leaves the address and the save as they were, and lasts', async ({ page }) => {
  await openApp(page, FIXED);
  expect(await flag(page)).toBeNull();
  const before = await raw(page);
  await openWithWord(page);
  expect(await flag(page)).toBe('1');
  expect(await hasWord(page)).toBe(false);
  expect(await page.evaluate(() => location.hash)).toBe('');
  expect(await raw(page)).toBe(before);
  await expect(page.locator('[data-testid="stop-2"]')).not.toHaveClass(/locked/);
  await page.reload();
  await ready(page);
  expect(await flag(page)).toBe('1');
  await expect(page.locator('[data-testid="stop-2"]')).not.toHaveClass(/locked/);
  expect(await raw(page)).toBe(before);
});

test('dev mode: a wrong, empty or wrong-case word does nothing at all', async ({ page }) => {
  await steady(page);
  await openApp(page, FIXED);
  const before = await raw(page);
  const plain = await still(page);
  const wrong = await page.evaluate((w) => [w.toUpperCase(), w[0].toUpperCase() + w.slice(1), `${w}x`, w.slice(1), 'x'].filter((x) => x !== w).map(encodeURIComponent), WORD);
  for (const fragment of [...wrong, '']) {
    await openWith(page, fragment);
    expect(await flag(page)).toBeNull();
    expect(await raw(page)).toBe(before);
    expect(await page.evaluate(() => location.hash.slice(1))).toBe(fragment);
    await expect(page.locator('[data-testid="stop-2"]')).toHaveClass(/locked/);
    expect((await still(page)).equals(plain)).toBe(true);
  }
});

test('dev mode: the Settings row is there only while it is on, last, and Turn off goes home and stays off', async ({ page }) => {
  await openApp(page, FIXED);
  await openSettings(page);
  await expect(page.locator('[data-testid="dev-off"]')).toHaveCount(0);
  await expect(page.getByText('Dev Mode')).toHaveCount(0);
  await closeSettings(page);

  await openWithWord(page);
  await toPlace(page, 'glade');
  await openSettings(page);
  const last = await page.evaluate(() => {
    const rows = document.querySelector('[data-testid="settings-screen"] .page-scroll')!.children;
    const end = rows[rows.length - 1] as HTMLElement;
    return { label: end.querySelector('.set-label')?.textContent, button: end.querySelector('[data-testid="dev-off"]')?.textContent };
  });
  expect(last).toEqual({ label: 'Dev Mode', button: 'Turn off' });
  await tap(page, '[data-testid="dev-off"]');
  await page.waitForSelector('[data-testid="settings-screen"]', { state: 'detached' });
  await page.waitForSelector('[data-screen="journey"]');
  await settled(page);
  expect(await flag(page)).toBeNull();
  await expect(page.locator('[data-testid="stop-2"]')).toHaveClass(/locked/);
  await page.reload();
  await ready(page);
  expect(await flag(page)).toBeNull();
  await expect(page.locator('[data-testid="stop-2"]')).toHaveClass(/locked/);
});

test('dev mode: Turn off during a match keeps the match on the table, as its last Settings row', async ({ page }) => {
  await freshDev(page);
  await tap(page, '[data-testid="stop-3"] .stop-btn');
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-screen="table"]');
  await page.waitForFunction(() => (window as any).__TC__.idle(), null, { timeout: 60_000 });
  await tap(page, '[data-testid="menu"]');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForSelector('[data-testid="settings-screen"]');
  const lastIsDev = await page.evaluate(() => {
    const rows = document.querySelector('[data-testid="settings-screen"] .page-scroll')!.children;
    return !!rows[rows.length - 1].querySelector('[data-testid="dev-off"]');
  });
  expect(lastIsDev).toBe(true);
  await tap(page, '[data-testid="dev-off"]');
  await page.waitForSelector('[data-testid="settings-screen"]', { state: 'detached' });
  expect(await flag(page)).toBeNull();
  await expect(page.locator('[data-screen="table"]')).toHaveCount(1);
  expect((await save(page)).match.mode).toEqual({ kind: 'campaign', stop: 2 });
});

/* ---------- What opens ---------- */

test('dev mode: every lock is open on a fresh save, with nothing earned and no reveal', async ({ page }) => {
  await freshDev(page);
  const start = await save(page);

  // 1. Rose Garden stops 2–5, each with its normal Match Intro.
  for (let i = 2; i <= 5; i++) {
    await expect(page.locator(`[data-testid="stop-${i}"]`)).not.toHaveClass(/locked/);
    await expect(page.locator(`[data-testid="stop-${i}"] .lock-badge`)).toHaveCount(0);
    await tap(page, `[data-testid="stop-${i}"] .stop-btn`);
    await expect(page.locator('[data-testid="match-intro"] [data-testid="begin"]')).toBeVisible();
    await page.locator('.backdrop').last().click({ position: { x: 5, y: 5 }, force: true });
    await page.waitForSelector('[data-testid="match-intro"]', { state: 'detached' });
  }
  // 2. The Moonlit Glade, with no padlock.
  await expect(page.locator('[data-testid="map-glade"]')).not.toHaveClass(/locked/);
  await expect(page.locator('[data-testid="map-glade"]')).toHaveAttribute('aria-label', 'Moonlit Glade, 0 of 21 stars');
  // 4. The Crossroads signpost.
  await expect(page.locator('[data-testid="map-crossroads"]')).toHaveAttribute('aria-label', 'The Crossroads');
  await expect(page.locator('[data-testid="map-crossroads"] .sign-lock')).toHaveCount(0);
  // 3. Every Glade stop, both lanes, the Old Stones and the boss.
  await toPlace(page, 'glade');
  for (const id of STOP_IDS) {
    await expect(page.locator(`[data-testid="glade-${id}"]`)).not.toHaveAttribute('data-state', 'locked');
    await tap(page, `[data-testid="glade-${id}"] .stop-btn`);
    await expect(page.locator('[data-testid="match-intro"] [data-testid="begin"]')).toBeVisible();
    await page.locator('.backdrop').last().click({ position: { x: 5, y: 5 }, force: true });
    await page.waitForSelector('[data-testid="match-intro"]', { state: 'detached' });
  }
  await expect(page.locator('[data-testid="glade-g1"]')).toHaveAttribute('data-state', 'current');
  // The Crossroads and Tower home. Map 3's gate still says it's being built.
  await toPlace(page, 'crossroads');
  await tap(page, '[data-testid="xr-gate"]');
  await expect(page.getByText('Map 3 is still being built. Check back soon!')).toBeVisible();
  await tap(page, '[data-testid="tower-enter"]');
  await page.waitForSelector('[data-screen="tower"].ready');
  await expect(page.locator('[data-testid="tower-floor"]')).toHaveText('Floor 1');
  await tap(page, '[data-testid="tower-back"]');
  await page.waitForSelector('[data-map="crossroads"]');
  // 5–9. Free Play, its variants, every opponent and every back and cloth.
  await tab(page, 'free');
  for (const v of ['standard', 'sprint', 'choose', 'moonlit', 'trialB', 'trialC']) await expect(page.locator(`[data-testid="fp-variant-${v}"]`)).toHaveCount(1);
  for (const b of ['pip', 'marigold', 'briar', 'hoot', 'nightshade', 'lumi', 'mallow', 'velvet', 'fennel', 'sable', 'mossback', 'lunaria']) await expect(page.locator(`[data-testid="fp-bot-${b}"]`)).toHaveCount(1);
  const items = await page.evaluate(() => [...document.querySelectorAll('.fp-items')].map((x) => x.children.length));
  // Every card back (10) and tablecloth (8) in the game.
  expect(items).toEqual([10, 8]);
  // 10–11. Collection: every item open, the Glade sections shown, and no Charm earned.
  await tab(page, 'collection');
  for (const t of ['back', 'cloth', 'music']) {
    await tap(page, `[data-testid="tab-${t}"]`);
    await expect(page.locator('.item[data-unlocked="0"]')).toHaveCount(0);
    await expect(page.locator('.glade-sec')).toHaveCount(1);
  }
  await tap(page, '[data-testid="tab-charms"]');
  await expect(page.locator('[data-testid="charm-grid-glade"]')).toHaveCount(1);
  await expect(page.locator('[data-earned="1"]')).toHaveCount(0);
  // 12–13. Stats: the Glade bots and the Tower.
  await tab(page, 'stats');
  await expect(page.locator('.bot-stat[data-bot="lunaria"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="tower-stats"]')).toHaveCount(1);

  // Nothing was marked as won, earned or seen, and no reveal played.
  const end = await save(page);
  expect(end.campaign).toEqual(start.campaign);
  expect(end.glade.winOrder).toEqual([]);
  expect(end.charms).toEqual([]);
  expect(end.stats).toEqual(start.stats);
  for (const k of ['revealSeen', 'fogLifted', 'liftScenePending']) expect(end.glade[k]).toBe(start.glade[k]);
  expect(end.tower.revealSeen).toBe(start.tower.revealSeen);
  expect(end.tower.best).toBe(0);
  const fired = await page.evaluate(() => (window as any).__TC__.events.map((e: { name: string }) => e.name));
  expect(fired).not.toContain('glade.reveal');
  expect(fired.filter((n: string) => /crossroads\.reveal/.test(n))).toEqual([]);
});

test('dev mode: How to Play shows the Moonlit and Tower sections on a fresh save', async ({ page }) => {
  await freshDev(page);
  await tap(page, '[data-testid="stop-1"] .stop-btn');
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-screen="table"]');
  await page.waitForFunction(() => (window as any).__TC__.idle(), null, { timeout: 60_000 });
  await tap(page, '[data-testid="menu"]');
  await page.getByRole('button', { name: 'How to Play' }).click();
  await page.waitForSelector('[data-testid="howto"]');
  await expect(page.locator('[data-testid="moonlit-phases"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="tower-howto"]')).toHaveCount(1);
});

test('dev mode: a match begins at every stop, on a Tower floor and on every Free Play variant', async ({ page }) => {
  test.setTimeout(240_000);
  await freshDev(page);
  const begun = async (mode: Record<string, unknown>, variant?: string) => {
    await page.waitForSelector('[data-screen="table"]');
    const s = await save(page);
    expect(s.match.mode).toEqual(mode);
    if (variant) expect(s.match.game.variant).toBe(variant);
    await clearMatch(page);
    await page.waitForSelector('[data-screen="journey"]');
    await settled(page);
  };
  for (let i = 1; i <= 5; i++) {
    await toPlace(page, 'garden');
    await tap(page, `[data-testid="stop-${i}"] .stop-btn`);
    await tap(page, '[data-testid="begin"]');
    await begun({ kind: 'campaign', stop: i - 1 }, 'standard');
  }
  for (const id of STOP_IDS) {
    await toPlace(page, 'glade');
    await tap(page, `[data-testid="glade-${id}"] .stop-btn`);
    await tap(page, '[data-testid="begin"]');
    await begun({ kind: 'glade', stop: id }, 'moonlit');
  }
  await toPlace(page, 'crossroads');
  await tap(page, '[data-testid="tower-enter"]');
  await page.waitForSelector('[data-screen="tower"].ready');
  await settled(page);
  await openIntro(page);
  await tap(page, '[data-testid="begin-floor"]');
  await begun({ kind: 'tower', floor: 1 }, 'tower');
  for (const v of ['standard', 'sprint', 'choose', 'moonlit', 'trialB', 'trialC']) {
    await tab(page, 'free');
    await tap(page, `[data-testid="fp-variant-${v}"]`);
    await tap(page, '[data-testid="fp-begin"]');
    await begun({ kind: 'free' }, v);
  }
});

test('dev mode: a Glade stop it opens plays fogged while the fog has not really lifted', async ({ page }) => {
  await freshDev(page);
  await toPlace(page, 'glade');
  await tap(page, '[data-testid="glade-b2"] .stop-btn');
  await expect(page.locator('[data-testid="rule-fog"]')).toHaveCount(1);
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-screen="table"]');
  expect((await save(page)).match.game.rules.fog).toBe(true);
  expect((await save(page)).glade.fogLifted).toBe(false);
});

test('dev mode: every Collection item can be previewed and equipped', async ({ page }) => {
  test.setTimeout(120_000);
  await freshDev(page);
  await tab(page, 'collection');
  for (const t of ['back', 'cloth', 'music'] as const) {
    await tap(page, `[data-testid="tab-${t}"]`);
    const ids = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.item')].map((x) => x.dataset.testid!.slice(5)));
    expect(ids.length).toBeGreaterThan(2);
    for (const id of ids) {
      await tap(page, `[data-testid="item-${id}"]`);
      await page.waitForSelector('.preview-large');
      const equip = page.locator('[data-testid="equip"]');
      if (await equip.isEnabled()) await tap(page, '[data-testid="equip"]');
      else await page.locator('.backdrop').last().click({ position: { x: 5, y: 5 }, force: true });
      await page.waitForSelector('.preview-large', { state: 'detached' });
      expect((await save(page)).equipped[t]).toBe(id);
    }
  }
});

/* ---------- Turning off with dev-only things in use ---------- */

test('dev mode: turning off puts back dev-only equipment and places', async ({ page }) => {
  for (const place of ['glade', 'crossroads'] as const) {
    await freshDev(page);
    await page.evaluate((p) => {
      const t = (window as any).__TC__;
      const s = t.getSave();
      s.equipped = { back: 'moth-wing', cloth: 'mistveil', music: 'moonlight-waltz' };
      s.glade.lastMap = p;
      t.loadSave(s);
    }, place);
    await page.waitForSelector(`[data-map="${place}"]`);
    await settled(page);
    await openSettings(page);
    await tap(page, '[data-testid="dev-off"]');
    await page.waitForSelector('[data-map="garden"]');
    const s = await save(page);
    expect(s.equipped).toEqual({ back: 'rose-lattice', cloth: 'blush-gingham', music: 'garden-waltz' });
    expect(s.glade.lastMap).toBe('garden');
    await page.reload();
    await ready(page);
    await expect(page.locator('[data-map="garden"]')).toHaveCount(1);
    await page.evaluate(() => localStorage.clear());
  }
});

test('dev mode: after turning off, every screen is exactly as it was before it was on', async ({ page }, info) => {
  test.setTimeout(150_000);
  type Screen = { shot: Buffer; dom: string };
  /** What is on screen: the picture, and the screens' markup, which holds every state a screen draws from. */
  const look = async (): Promise<Screen> => ({
    shot: await still(page),
    // Placements measured from the layout are rounded to a tenth of a point: two layouts of the same screen can differ
    // in the fifth decimal place, which nothing on screen can show. The pictures are compared exactly.
    dom: await page.evaluate(() => [document.getElementById('screens')!, document.getElementById('overlays')!]
      .map((el) => el.innerHTML.replace(/-?\d+\.\d+px/g, (v) => `${(Math.round(parseFloat(v) * 10) / 10).toFixed(1)}px`)).join(' | ')),
  });
  const tour = async (): Promise<Screen[]> => {
    const seen: Screen[] = [];
    await tab(page, 'journey');
    seen.push(await look());
    await tab(page, 'collection');
    for (const t of ['back', 'cloth', 'music', 'charms']) {
      await tap(page, `[data-testid="tab-${t}"]`);
      await page.waitForTimeout(200);
      seen.push(await look());
    }
    await tab(page, 'stats');
    seen.push(await look());
    await tab(page, 'journey');
    await openSettings(page);
    seen.push(await look());
    await closeSettings(page);
    return seen;
  };
  const same = (a: Screen[], b: Screen[], what: 'dom' | 'shot') => {
    expect(b.length).toBe(a.length);
    b.forEach((s, i) => {
      const ok = what === 'dom' ? s.dom === a[i].dom : s.shot.equals(a[i].shot);
      // Kept for a look when they differ.
      if (!ok) {
        mkdirSync('test-results/dev-mode-diff', { recursive: true });
        writeFileSync(`test-results/dev-mode-diff/${info.project.name}-${i + 1}-before.${what === 'dom' ? 'html' : 'png'}`, what === 'dom' ? a[i].dom : a[i].shot);
        writeFileSync(`test-results/dev-mode-diff/${info.project.name}-${i + 1}-after.${what === 'dom' ? 'html' : 'png'}`, what === 'dom' ? s.dom : s.shot);
      }
      expect(ok, `screen ${i + 1}: the ${what === 'dom' ? 'markup' : 'picture'} matches`).toBe(true);
    });
  };
  await steady(page);
  await openApp(page, { tutorial: { done: true, seen: [] }, ...FIXED });
  await page.evaluate(() => {
    // Some real progress, so the screens have something on them: Stop 1 won.
    const t = (window as any).__TC__;
    const s = t.getSave();
    s.campaign.won[0] = true;
    s.campaign.stars[0] = 2;
    t.loadSave(s);
  });
  // Each picture is taken on a freshly opened app. Chromium can smooth an edge a little differently depending on what
  // animated earlier on the page, which says nothing about what the app shows.
  await page.reload();
  await ready(page);
  const before = await tour();
  const savedBefore = await raw(page);

  await openWithWord(page);
  // Use what only Dev Mode opens, then turn it off.
  await tab(page, 'collection');
  await tap(page, '[data-testid="tab-back"]');
  await tap(page, '[data-testid="item-moth-wing"]');
  await page.locator('[data-testid="equip"]').click();
  await page.waitForSelector('.preview-large', { state: 'detached' });
  await tab(page, 'journey');
  await toPlace(page, 'glade');
  await openSettings(page);
  await tap(page, '[data-testid="dev-off"]');
  await page.waitForSelector('[data-map="garden"]');
  await settled(page);
  expect(await raw(page)).toBe(savedBefore);
  // Straight after turning off, without reopening: every screen is built exactly as before.
  same(before, await tour(), 'dom');
  // And reopened, as the player would next time, every screen looks exactly as before.
  await page.reload();
  await ready(page);
  same(before, await tour(), 'shot');
});

/* ---------- Counting ---------- */

test('dev mode flow: winning in Dev Mode records exactly what winning normally does', async ({ page }) => {
  test.setTimeout(150_000);
  const playStop1 = async (dev: boolean): Promise<string> => {
    await openApp(page, { tutorial: { done: true, seen: [] }, ...FIXED });
    if (dev) await openWithWord(page);
    await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
    await tap(page, '[data-testid="stop-1"] .stop-btn');
    await tap(page, '[data-testid="begin"]');
    await page.waitForSelector('[data-screen="table"]');
    await winHere(page);
    await toEndButtons(page);
    const s = await save(page);
    await page.evaluate(() => localStorage.clear());
    return JSON.stringify({ ...s, match: null });
  };
  const normal = await playStop1(false);
  const dev = await playStop1(true);
  expect(dev).toBe(normal);

  // A stop only Dev Mode opened records its win as any win does.
  await freshDev(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await tap(page, '[data-testid="stop-3"] .stop-btn');
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-screen="table"]');
  await winHere(page, 12);
  await toEndButtons(page);
  const s = await save(page);
  expect(s.campaign.won).toEqual([false, false, true, false, false]);
  expect(s.campaign.stars[2]).toBe(3);
  expect(s.stats.won).toBe(1);
  await expect(page.locator('[data-testid="rematch"]')).toHaveCount(1);
});

test('dev mode flow: a Tower floor won in Dev Mode records exactly what it does normally', async ({ page }) => {
  test.setTimeout(150_000);
  const floor = async (dev: boolean): Promise<string> => {
    await openApp(page, FIXED);
    await towerSave(page, { place: 'crossroads' });
    if (dev) await openWithWord(page);
    await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
    await page.evaluate(() => (window as any).__TC__.towerSet({ floor: 1, hearts: 3, seed: 'ab'.repeat(16) }));
    await page.evaluate(() => (window as any).__TC__.towerHome());
    await page.waitForSelector('[data-screen="tower"].ready');
    await settled(page);
    await openIntro(page);
    await beginFloor(page);
    await forceFloor(page, true);
    const s = await save(page);
    await page.evaluate(() => localStorage.clear());
    return JSON.stringify({ ...s, match: null, tower: { ...s.tower, climb: s.tower.climb && { ...s.tower.climb, attempt: null } } });
  };
  const normal = await floor(false);
  expect(await floor(true)).toBe(normal);
});

/* ---------- A match in progress when it turns off ---------- */

async function turnOffAtTable(page: Page): Promise<void> {
  await tap(page, '[data-testid="menu"]');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForSelector('[data-testid="settings-screen"]');
  await tap(page, '[data-testid="dev-off"]');
  await page.waitForSelector('[data-testid="settings-screen"]', { state: 'detached' });
}

test('dev mode flow: a dev-only match survives turning off and a reload, plays to the end, then is locked again', async ({ page }) => {
  test.setTimeout(150_000);
  await freshDev(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await tap(page, '[data-testid="stop-3"] .stop-btn');
  await tap(page, '[data-testid="begin"]');
  await page.waitForSelector('[data-screen="table"]');
  await page.waitForFunction(() => (window as any).__TC__.idle(), null, { timeout: 60_000 });
  await turnOffAtTable(page);
  await page.reload();
  await ready(page);
  await page.waitForSelector('[data-screen="table"]');
  expect((await save(page)).match.mode).toEqual({ kind: 'campaign', stop: 2 });
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await winHere(page);
  await toEndButtons(page);
  await expect(page.locator('[data-testid="rematch"]')).toHaveCount(0);
  expect((await save(page)).campaign.won[2]).toBe(true);
  await page.locator('[data-testid="continue"]').click();
  await page.waitForSelector('[data-screen="journey"]');
  await expect(page.locator('[data-testid="stop-2"]')).toHaveClass(/locked/);
  expect(await page.evaluate(() => localStorage.getItem('ten-charms.dev.lingering'))).toBeNull();
});

test('dev mode flow: a Tower floor in progress survives turning off, then offers only the way back', async ({ page }) => {
  test.setTimeout(150_000);
  await freshDev(page);
  await page.evaluate(() => (window as any).__TC__.setTestScale(0.05));
  await toPlace(page, 'crossroads');
  await tap(page, '[data-testid="tower-enter"]');
  await page.waitForSelector('[data-screen="tower"].ready');
  await settled(page);
  await openIntro(page);
  await beginFloor(page);
  await turnOffAtTable(page);
  await page.reload();
  await ready(page);
  await page.waitForSelector('[data-screen="table"]');
  await page.waitForFunction(() => (window as any).__TC__.idle(), null, { timeout: 60_000 });
  await forceFloor(page, true);
  await expect(page.locator('[data-testid="floor-result"] [data-testid="back-map"]')).toHaveCount(1);
  for (const id of ['climb', 'try-again', 'back-tower', 'see-climb']) await expect(page.locator(`[data-testid="floor-result"] [data-testid="${id}"]`)).toHaveCount(0);
  expect((await save(page)).tower.climb.floor).toBe(2);
  await tap(page, '[data-testid="back-map"]');
  await page.waitForSelector('[data-map="garden"]');
  await expect(page.locator('[data-testid="map-crossroads"] .sign-lock')).toHaveCount(1);
});

/* ---------- Backup & Restore ---------- */

test('dev mode: Backup & Restore work as before, and a code never carries Dev Mode', async ({ page }) => {
  const code = async (): Promise<string> => {
    await openSettings(page);
    await tap(page, '[data-testid="backup"]');
    const c = await page.locator('[data-testid="export-code"]').inputValue();
    await page.locator('.backdrop').last().click({ position: { x: 5, y: 5 }, force: true });
    await page.waitForTimeout(300);
    await closeSettings(page);
    return c;
  };
  await openApp(page, FIXED);
  const off = await code();
  await openWithWord(page);
  expect(await code()).toBe(off);
  const decoded = (c: string) => Buffer.from(c.slice(c.indexOf('.') + 1).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  expect(decoded(off)).not.toMatch(/ten-charms\.dev|"dev/);
  // Restoring with Dev Mode on keeps it on, and brings back exactly the code's progress.
  await openSettings(page);
  await tap(page, '[data-testid="backup"]');
  await page.locator('[data-testid="import-code"]').fill(off);
  await tap(page, '[data-testid="import"]');
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.waitForSelector('[data-screen="journey"]');
  expect(await flag(page)).toBe('1');
  const restored = await save(page);
  expect(restored.campaign.won).toEqual([false, false, false, false, false]);
});

/* ---------- The player's build ---------- */

test("dev mode: the player's build recognises the link too", async ({ page }) => {
  await prepare(page, FIXED);
  await page.goto('http://localhost:4175/');
  await page.waitForSelector('[data-screen="journey"]');
  await page.waitForSelector('[data-testid="splash"]', { state: 'detached', timeout: 15_000 });
  expect(await flag(page)).toBeNull();
  await page.evaluate((w) => history.replaceState(null, '', `${location.pathname}#${encodeURIComponent(w)}`), WORD);
  await page.reload();
  await page.waitForSelector('[data-screen="journey"]');
  await page.waitForFunction(() => localStorage.getItem('ten-charms.dev') === '1', null, { timeout: 15_000 });
  expect(await hasWord(page)).toBe(false);
  await expect(page.locator('[data-testid="stop-2"]')).not.toHaveClass(/locked/);
});

/* ---------- Captures ---------- */

test('dev mode: captures with it on, every element inside its normal layout', async ({ page }, info) => {
  test.setTimeout(120_000);
  mkdirSync(DIR, { recursive: true });
  const p = info.project.name;
  await freshDev(page);
  const capture = async (name: string) => {
    await inLayout(page);
    await still(page);
    await page.screenshot({ path: `${DIR}/${name}-${p}.png`, animations: 'disabled' });
  };
  await toPlace(page, 'garden');
  await capture('dev-journey-garden');
  await toPlace(page, 'glade');
  await capture('dev-journey-glade');
  await toPlace(page, 'crossroads');
  await page.waitForSelector('[data-map="crossroads"].ready');
  await capture('dev-journey-crossroads');
  await tab(page, 'free');
  await capture('dev-freeplay');
  await tab(page, 'collection');
  for (const t of ['back', 'cloth', 'music', 'charms']) {
    await tap(page, `[data-testid="tab-${t}"]`);
    await page.waitForTimeout(200);
    await capture(`dev-collection-${t}`);
  }
  await tab(page, 'journey');
  await openSettings(page);
  await page.evaluate(() => document.querySelector('[data-testid="settings-screen"] .page-scroll')!.scrollTo(0, 1e6));
  await capture('dev-settings');
});
