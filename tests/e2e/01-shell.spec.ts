import { spawn } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('starts on browsers with strict element names, as iOS Safari 26 and older may be', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    const original = document.createElement;
    document.createElement = function (this: Document, name: string, options?: ElementCreationOptions) {
      if (!/^[a-z][a-z0-9-]*$/i.test(name)) throw new DOMException(`Bad element name: ${name}`, 'InvalidCharacterError');
      return original.call(this, name, options);
    } as typeof document.createElement;
  });
  await page.goto('http://localhost:4175/');
  await expect(page.locator('[data-testid="install-helper"]')).toBeVisible();
  await page.locator('[data-testid="install-later"]').click({ force: true });
  await expect(page.locator('[data-testid="stop-1"] button').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('a startup failure shows a message instead of a blank screen', async ({ page }) => {
  const message = page.locator('[data-testid="startup-failed"]');
  const detail = page.locator('[data-testid="startup-error"]');

  // The script throws as it runs.
  await page.route('**/app.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("boom on load")' }));
  await page.goto('http://localhost:4175/');
  await expect(message).toContainText("Ten Charms couldn't start");
  await expect(detail).toContainText('boom on load');
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();

  // The script never arrives.
  await page.unroute('**/app.js');
  await page.route('**/app.js', (route) => route.abort());
  await page.goto('http://localhost:4175/');
  await expect(detail).toContainText('Could not load');
  await page.unroute('**/app.js');
});

test('a failure later in startup also shows the message', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ten-charms.save', JSON.stringify({ schema: 1, install: { dismissedAt: Date.now() } }));
    Element.prototype.animate = () => { throw new Error('boom in splash'); };
  });
  await page.goto('http://localhost:4175/');
  await expect(page.locator('[data-testid="startup-error"]')).toContainText('boom in splash');
});

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
  // The fog's screenshot freeze is a test hook too.
  expect(js).not.toContain('freezeFog');
  const css = await (await request.get('http://localhost:4175/app.css')).text();
  expect(js + css).not.toMatch(/fonts\.googleapis|https?:\/\/(?!www\.w3\.org)/);
});

test('an update shows the toast, never reloads on its own, and applies on tap', async ({ page }, info) => {
  // Its own site and port for each worker, because it rewrites the site's files.
  const site = `test-results/update-site-${info.parallelIndex}`;
  const port = 4180 + info.parallelIndex;
  rmSync(site, { recursive: true, force: true });
  cpSync('dist', site, { recursive: true });
  const server = spawn(process.execPath, ['scripts/serve.mjs', site, String(port)], { stdio: 'ignore' });
  try {
    await expect(async () => { await fetch(`http://localhost:${port}/`); }).toPass({ timeout: 15_000 });
    await page.addInitScript(() => {
      if (!localStorage.getItem('ten-charms.save')) localStorage.setItem('ten-charms.save', JSON.stringify({ schema: 1, install: { dismissedAt: Date.now() } }));
    });
    await page.goto(`http://localhost:${port}/`);
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
