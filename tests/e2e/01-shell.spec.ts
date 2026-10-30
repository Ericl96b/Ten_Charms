import { spawn } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('production manifest and service worker validate', async ({ request }) => {
  const manifest = await (await request.get('http://localhost:4175/manifest.webmanifest')).json();
  expect(manifest.name).toBe('Ten Charms');
  expect(manifest.short_name).toBe('Ten Charms');
  expect(manifest.display).toBe('standalone');
  expect(manifest.orientation).toBe('portrait');
  expect(manifest.theme_color).toBe('#FCEFE9');
  expect(manifest.background_color).toBe('#FCEFE9');
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  for (const s of ['180x180', '192x192', '512x512']) expect(sizes).toContain(s);
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) {
    const res = await request.get(`http://localhost:4175/${icon.src}`);
    expect(res.status()).toBe(200);
  }
  const sw = await (await request.get('http://localhost:4175/sw.js')).text();
  expect(sw).not.toContain('__VERSION__');
  const assets: string[] = JSON.parse(/const ASSETS = (\[.*\]);/.exec(sw)![1]);
  for (const a of assets) expect((await request.get(`http://localhost:4175/${a}`)).status(), a).toBe(200);
});

test('production build has no developer hooks and no outside network calls', async ({ request }) => {
  const js = await (await request.get('http://localhost:4175/app.js')).text();
  expect(js).not.toContain('__TC__');
  const css = await (await request.get('http://localhost:4175/app.css')).text();
  expect(js + css).not.toMatch(/fonts\.googleapis|https?:\/\/(?!www\.w3\.org)/);
});

test('an update shows the toast, never reloads on its own, and applies on tap', async ({ page }) => {
  const site = 'test-results/update-site';
  rmSync(site, { recursive: true, force: true });
  cpSync('dist', site, { recursive: true });
  const server = spawn(process.execPath, ['scripts/serve.mjs', site, '4176'], { stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 500));
    await page.addInitScript(() => {
      if (!localStorage.getItem('ten-charms.save')) localStorage.setItem('ten-charms.save', JSON.stringify({ schema: 1, install: { dismissedAt: Date.now() } }));
    });
    await page.goto('http://localhost:4176/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 });
    await page.evaluate(() => { (window as any).__sameLoad = true; });
    writeFileSync(`${site}/sw.js`, readFileSync(`${site}/sw.js`, 'utf8').replace(/ten-charms-\$\{VERSION\}/, 'ten-charms-next'));
    await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg!.update(); });
    const toast = page.locator('[data-testid="update-toast"]');
    await expect(toast).toHaveText('A new bloom is ready. Tap to update.', { timeout: 15_000 });
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as any).__sameLoad)).toBe(true);
    await toast.click();
    await page.waitForFunction(() => !(window as any).__sameLoad, null, { timeout: 15_000 });
  } finally {
    server.kill();
  }
});

test('shell loads offline with no console errors', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://localhost:4175/');
  await expect(page.locator('#app > *').first()).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#app > *').first()).toBeVisible();
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
