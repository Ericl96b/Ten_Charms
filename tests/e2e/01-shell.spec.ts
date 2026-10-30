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
