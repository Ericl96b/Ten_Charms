// Where the tests get Dev Mode's secret word: the TC_DEV_WORD environment variable, or else the untracked file
// private/dev-mode-word.txt. The word itself is never printed or written anywhere.
//   node scripts/dev-word.ts           checks that the word is available
//   node scripts/dev-word.ts --digest  prints the digest for src/meta/devmode.ts
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const WORD_FILE = 'private/dev-mode-word.txt';

export const MISSING = `Dev Mode's secret word is not available. Set TC_DEV_WORD, or put the word alone on one line in ${WORD_FILE} `
  + '(untracked). The Dev Mode tests need it and never skip without it.';

/** The word, or null when neither source has it. */
export function devWord(): string | null {
  const env = process.env.TC_DEV_WORD;
  if (env) return env;
  if (!existsSync(WORD_FILE)) return null;
  const word = readFileSync(WORD_FILE, 'utf8').replace(/\r?\n$/, '');
  return word.length > 0 ? word : null;
}

/** The word, or an error with a clear message. */
export function requireDevWord(): string {
  const word = devWord();
  if (!word) throw new Error(MISSING);
  return word;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const word = devWord();
  if (!word) {
    console.error(MISSING);
    process.exit(1);
  }
  if (process.argv.includes('--digest')) {
    const { digestOf } = await import('../src/meta/devmode.ts');
    console.log(await digestOf(word));
  } else {
    console.log("Dev Mode's secret word is available.");
  }
}
