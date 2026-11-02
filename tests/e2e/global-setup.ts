import { readdirSync, rmSync } from 'node:fs';

/** Clears the logs of the last run. The gate does this once itself, since each of its stages is a separate run. */
export function clearLogs(): void {
  rmSync('test-results/juice', { recursive: true, force: true });
  rmSync('test-results/rows.log', { force: true });
  let names: string[] = [];
  try { names = readdirSync('test-results'); } catch { /* nothing to clear yet */ }
  for (const name of names) if (/^rows-\d+\.log$/.test(name)) rmSync(`test-results/${name}`, { force: true });
}

export default function globalSetup(): void {
  if (!process.env.TC_STAGE || process.env.TC_STAGE === 'targeted') clearLogs();
}
