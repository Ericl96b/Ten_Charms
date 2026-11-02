// Targeted runs for the fix-and-retest loop. These never replace the gate.
// Usage: node scripts/test-target.mjs failed
//        node scripts/test-target.mjs file 09-table
//        node scripts/test-target.mjs project max
//        node scripts/test-target.mjs baseline
import { spawnSync } from 'node:child_process';

const [mode, ...rest] = process.argv.slice(2);
const args = { failed: ['--last-failed'], file: rest, project: rest.map((p) => `--project=${p}`), baseline: ['06-visual'] }[mode];
if (!args) {
  console.error('Usage: test-target.mjs failed | file <name> | project <name> | baseline');
  process.exit(2);
}

// Always test what's in the code now, never an old build. Each build takes a few seconds.
for (const build of [[], ['--dev']]) {
  const res = spawnSync(process.execPath, ['scripts/build.mjs', ...build], { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

const env = { ...process.env, TC_STAGE: mode === 'baseline' ? '' : 'targeted', VISUAL_DIR: mode === 'baseline' ? 'baseline' : process.env.VISUAL_DIR };
if (mode === 'baseline') delete env.TC_STAGE;
if (env.VISUAL_DIR === undefined) delete env.VISUAL_DIR;
const res = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...args], { stdio: 'inherit', env });
process.exit(res.status ?? 1);
