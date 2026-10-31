import { rmSync } from 'node:fs';

export default function globalSetup(): void {
  rmSync('test-results/juice', { recursive: true, force: true });
  rmSync('test-results/rows.log', { force: true });
}
