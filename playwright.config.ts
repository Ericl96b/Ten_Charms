import { defineConfig } from '@playwright/test';

const viewports = [
  { name: 'se', width: 375, height: 667 },
  { name: 'ref', width: 390, height: 844 },
  { name: 'max', width: 440, height: 956 },
];

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/artifacts',
  use: {
    browserName: 'webkit',
    hasTouch: true,
    isMobile: false,
    deviceScaleFactor: 2,
    baseURL: 'http://localhost:4174/',
    actionTimeout: 15_000,
    trace: 'off',
    video: 'off',
  },
  projects: viewports.map((v) => ({
    name: v.name,
    use: { viewport: { width: v.width, height: v.height } },
  })),
  webServer: [
    { command: 'node scripts/serve.mjs dist-dev 4174', port: 4174, reuseExistingServer: true },
    { command: 'node scripts/serve.mjs dist 4175', port: 4175, reuseExistingServer: true },
  ],
});
