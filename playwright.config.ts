import { defineConfig } from '@playwright/test';
import { ALONE, DEFAULT_WORKERS, LAST, REAL_SPEED, SERIAL, TRIAL_MATCH } from './tests/e2e/stages.ts';

const viewports = [
  { name: 'se', width: 375, height: 667 },
  { name: 'ref', width: 390, height: 844 },
  { name: 'max', width: 440, height: 956 },
];

/** Set by scripts/gate.mjs and scripts/test-target.mjs. With none set, everything runs one at a time. */
const stage = process.env.TC_STAGE;
const parallel = stage === 'parallel' || stage === 'targeted';
const filters = {
  parallel: { grepInvert: [SERIAL, ALONE, LAST] },
  targeted: { grepInvert: [LAST] },
  serial: { grep: SERIAL },
  alone: { grep: ALONE },
  last: { grep: LAST },
}[stage ?? ''] ?? {};

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 180_000,
  retries: 0,
  fullyParallel: parallel,
  workers: parallel ? Number(process.env.TC_WORKERS ?? DEFAULT_WORKERS) : 1,
  ...filters,
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
  projects: [
    ...viewports.map((v) => ({
      name: v.name,
      use: { viewport: { width: v.width, height: v.height } },
      testIgnore: [...(v.name === 'max' ? [] : [REAL_SPEED]), ...(v.name === 'ref' ? [] : [TRIAL_MATCH])],
    })),
    {
      name: 'android',
      testIgnore: [REAL_SPEED, TRIAL_MATCH],
      use: {
        browserName: 'chromium' as const,
        isMobile: true,
        viewport: { width: 412, height: 892 },
        userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36',
        // No real audio device, so a glitch on this machine can't surface as a console error.
        launchOptions: { args: ['--disable-audio-output'] },
      },
    },
  ],
  webServer: [
    { command: 'node scripts/serve.mjs dist-dev 4174', port: 4174, reuseExistingServer: true },
    { command: 'node scripts/serve.mjs dist 4175', port: 4175, reuseExistingServer: true },
  ],
});
