// ChaCha20 keystream. Given a seed it is deterministic; given a crypto-random seed it is cryptographically strong.

function rotl(v: number, n: number): number {
  return (v << n) | (v >>> (32 - n));
}

function block(key: Uint32Array, nonce: number, counter: number, out: Uint32Array): void {
  const s = new Uint32Array(16);
  s[0] = 0x61707865; s[1] = 0x3320646e; s[2] = 0x79622d32; s[3] = 0x6b206574;
  s.set(key, 4);
  s[12] = counter; s[13] = 0; s[14] = nonce; s[15] = 0;
  const x = s.slice();
  const qr = (a: number, b: number, c: number, d: number) => {
    x[a] += x[b]; x[d] = rotl(x[d] ^ x[a], 16);
    x[c] += x[d]; x[b] = rotl(x[b] ^ x[c], 12);
    x[a] += x[b]; x[d] = rotl(x[d] ^ x[a], 8);
    x[c] += x[d]; x[b] = rotl(x[b] ^ x[c], 7);
  };
  for (let i = 0; i < 10; i++) {
    qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
    qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i++) out[i] = (x[i] + s[i]) >>> 0;
}

function seedToKey(seedHex: string): Uint32Array {
  const key = new Uint32Array(8);
  const hex = seedHex.padEnd(64, '0').slice(0, 64);
  for (let i = 0; i < 8; i++) key[i] = parseInt(hex.slice(i * 8, i * 8 + 8), 16) >>> 0;
  return key;
}

export type Rng = { next(): number; below(n: number): number };

/** A stream of 32-bit words from a seed. Different nonces give independent streams. */
export function createRng(seedHex: string, nonce = 0): Rng {
  const key = seedToKey(seedHex);
  const buf = new Uint32Array(16);
  let counter = 0;
  let pos = 16;
  const next = () => {
    if (pos === 16) { block(key, nonce, counter++, buf); pos = 0; }
    return buf[pos++];
  };
  return {
    next,
    /** Uniform integer in [0, n), by rejection so there is no modulo bias. */
    below(n: number) {
      const limit = Math.floor(0x100000000 / n) * n;
      let v = next();
      while (v >= limit) v = next();
      return v % n;
    },
  };
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.below(i + 1);
    const t = items[i]; items[i] = items[j]; items[j] = t;
  }
  return items;
}

/** A fresh 128-bit seed from the platform's cryptographic random source. */
export function newSeed(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Each round's seed comes from the match seed, so a match replays from one value. */
export function deriveRoundSeed(matchSeed: string, round: number): string {
  const rng = createRng(matchSeed, 0x726f0000 + round);
  let out = '';
  for (let i = 0; i < 4; i++) out += rng.next().toString(16).padStart(8, '0');
  return out;
}
