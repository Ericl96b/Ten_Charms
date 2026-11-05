// 95% intervals for the refinement report.
const Z = 1.959964;

export type Interval = { value: number; lo: number; hi: number };

/** A rate as a fraction, with a Wilson interval. */
export function rate(k: number, n: number): Interval {
  if (n === 0) return { value: NaN, lo: NaN, hi: NaN };
  const p = k / n;
  const d = 1 + (Z * Z) / n;
  const c = (p + (Z * Z) / (2 * n)) / d;
  const h = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / d;
  return { value: p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

/** Running sums of one value, so workers can send back sums and the mean and its interval can still be found. */
export type Sums = { n: number; s: number; ss: number };
export const sums = (): Sums => ({ n: 0, s: 0, ss: 0 });
export function add(t: Sums, x: number): void { t.n++; t.s += x; t.ss += x * x; }
export function merge(a: Sums, b: Sums): void { a.n += b.n; a.s += b.s; a.ss += b.ss; }

export function mean(t: Sums): Interval {
  if (t.n === 0) return { value: NaN, lo: NaN, hi: NaN };
  const m = t.s / t.n;
  const v = t.n > 1 ? Math.max(0, (t.ss - t.n * m * m) / (t.n - 1)) : 0;
  const h = Z * Math.sqrt(v / t.n);
  return { value: m, lo: m - h, hi: m + h };
}

export function meanOf(values: readonly number[]): Interval {
  const t = sums();
  for (const v of values) add(t, v);
  return mean(t);
}

/** Paired sums of two values per unit, for a ratio of totals (Σx / Σy). */
export type Pair = { n: number; x: number; y: number; xx: number; yy: number; xy: number };
export const pairSums = (): Pair => ({ n: 0, x: 0, y: 0, xx: 0, yy: 0, xy: 0 });
export function addPair(t: Pair, x: number, y: number): void { t.n++; t.x += x; t.y += y; t.xx += x * x; t.yy += y * y; t.xy += x * y; }
export function mergePair(a: Pair, b: Pair): void { a.n += b.n; a.x += b.x; a.y += b.y; a.xx += b.xx; a.yy += b.yy; a.xy += b.xy; }

/** Σx / Σy with a delta-method interval; also returns the variance, for combining ratios. */
export function ratio(t: Pair): Interval & { variance: number } {
  if (t.n < 2 || t.y === 0) return { value: NaN, lo: NaN, hi: NaN, variance: NaN };
  const r = t.x / t.y;
  const mx = t.x / t.n, my = t.y / t.n;
  const vx = (t.xx - t.n * mx * mx) / (t.n - 1);
  const vy = (t.yy - t.n * my * my) / (t.n - 1);
  const cxy = (t.xy - t.n * mx * my) / (t.n - 1);
  const variance = Math.max(0, (vx - 2 * r * cxy + r * r * vy) / (t.n * my * my));
  const h = Z * Math.sqrt(variance);
  return { value: r, lo: r - h, hi: r + h, variance };
}

/** One ratio divided by another from independent samples, with an interval on the log scale. */
export function ratioOfRatios(a: Pair, b: Pair): Interval {
  const ra = ratio(a), rb = ratio(b);
  if (!Number.isFinite(ra.value) || !Number.isFinite(rb.value) || ra.value <= 0 || rb.value <= 0) return { value: NaN, lo: NaN, hi: NaN };
  const v = ra.variance / (ra.value * ra.value) + rb.variance / (rb.value * rb.value);
  const q = ra.value / rb.value;
  const h = Z * Math.sqrt(v);
  return { value: q, lo: q * Math.exp(-h), hi: q * Math.exp(h) };
}

/** The value a fraction of the way through the sorted list, by the nearest-rank rule. */
export function percentile(values: readonly number[], at: number): number {
  if (values.length === 0) return NaN;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(at * v.length) - 1))];
}

export function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

/** A histogram of whole numbers, kept small for sending between threads: counts by value. */
export type Histogram = Record<number, number>;
export function bump(h: Histogram, v: number): void { h[v] = (h[v] ?? 0) + 1; }
export function mergeHist(a: Histogram, b: Histogram): void { for (const [k, c] of Object.entries(b)) a[Number(k)] = (a[Number(k)] ?? 0) + c; }
export function histPercentile(h: Histogram, at: number): number {
  const keys = Object.keys(h).map(Number).sort((a, b) => a - b);
  const total = keys.reduce((n, k) => n + h[k], 0);
  if (total === 0) return NaN;
  const want = Math.max(1, Math.ceil(at * total));
  let seen = 0;
  for (const k of keys) { seen += h[k]; if (seen >= want) return k; }
  return keys[keys.length - 1];
}
export function histSums(h: Histogram): Sums {
  const t = sums();
  for (const [k, c] of Object.entries(h)) { const v = Number(k); t.n += c; t.s += v * c; t.ss += v * v * c; }
  return t;
}
