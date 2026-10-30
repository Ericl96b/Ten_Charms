import { rmSync } from 'node:fs';

export default function globalSetup(): void {
  rmSync('test-results/juice', { recursive: true, force: true });
}
