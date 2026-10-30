// Original music, composed in code and played by a small music-box synth.
// Each track is a chord plan expanded into melody and accompaniment by a fixed rule, so it loops exactly.
export type Instrument = 'box' | 'harp' | 'harpsichord' | 'pulse';

export type Track = {
  bpm: number;
  beats: number;
  barSeconds: number;
  bars: number;
  chords: number[][];
  scale: number[];
  lead: Instrument;
  bass: Instrument;
  level: number;
  pulse?: boolean;
};

const NAMES: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

/** "Am" to the MIDI notes of its triad, around middle C. */
function chord(name: string): number[] {
  const minor = name.endsWith('m');
  const root = NAMES[minor ? name.slice(0, -1) : name];
  return [60 + root, 60 + root + (minor ? 3 : 4), 60 + root + 7];
}

function build(plan: string[]): number[][] {
  return plan.map(chord);
}

const repeat = (list: string[], n: number) => Array.from({ length: n }, () => list).flat();

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

function track(bpm: number, beats: number, plan: string[], scale: number[], lead: Instrument, bass: Instrument, level: number, pulse = false): Track {
  return { bpm, beats, barSeconds: (60 / bpm) * beats, bars: plan.length, chords: build(plan), scale, lead, bass, level, pulse };
}

const MAP_PLAN = [...repeat(['C', 'Am', 'F', 'G'], 4), ...repeat(['F', 'G', 'Em', 'Am'], 2), ...repeat(['C', 'G', 'F', 'C'], 2)];
const WALTZ_PLAN = [
  ...repeat(['F', 'Dm', 'A#', 'C'], 6), ...repeat(['Dm', 'A#', 'F', 'C'], 2), ...repeat(['A#', 'C', 'Am', 'Dm'], 2),
  ...repeat(['F', 'A#', 'F', 'C'], 2), ...repeat(['F', 'Dm', 'A#', 'C'], 2), ...repeat(['A#', 'C', 'F', 'F'], 2),
];
const BOX_PLAN = [
  ...repeat(['G', 'Em', 'C', 'D'], 6), ...repeat(['C', 'D', 'Bm', 'Em'], 2), ...repeat(['Am', 'D', 'G', 'G'], 2),
  ...repeat(['Em', 'C', 'G', 'D'], 2), ...repeat(['G', 'Em', 'C', 'D'], 2), ...repeat(['C', 'D', 'G', 'G'], 2),
];
const BOSS_PLAN = [
  ...repeat(['Am', 'F', 'Dm', 'E'], 4), ...repeat(['Dm', 'Am', 'E', 'Am'], 2), ...repeat(['F', 'G', 'C', 'E'], 2),
  ...repeat(['Am', 'Dm', 'E', 'Am'], 2),
];

export const MUSIC = {
  map: track(88, 4, MAP_PLAN, MAJOR, 'box', 'harp', 0.8),
  waltz: track(100, 3, WALTZ_PLAN, MAJOR, 'harp', 'harp', 0.75),
  musicbox: track(104, 3, BOX_PLAN, MAJOR, 'box', 'box', 0.75),
  boss: track(92, 4, BOSS_PLAN, MINOR, 'harpsichord', 'harp', 0.7),
  tension: track(92, 4, BOSS_PLAN, MINOR, 'pulse', 'pulse', 0.55, true),
} as const;

const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);

function note(c: AudioContext, out: AudioNode, t: number, m: number, inst: Instrument, vel: number): void {
  const f = midi(m);
  const g = c.createGain();
  const peak = Math.max(vel, 0.0002);
  const decay = inst === 'box' ? 1.5 : inst === 'harp' ? 1.3 : inst === 'harpsichord' ? 0.75 : 0.22;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  g.connect(out);
  const o = c.createOscillator();
  o.type = inst === 'harpsichord' ? 'sawtooth' : inst === 'pulse' ? 'square' : 'sine';
  o.frequency.value = f;
  if (inst === 'harpsichord' || inst === 'pulse') {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = inst === 'pulse' ? 500 : 1900;
    o.connect(lp);
    lp.connect(g);
  } else {
    o.connect(g);
  }
  o.start(t);
  o.stop(t + decay + 0.03);
  if (inst === 'box') {
    const o2 = c.createOscillator();
    const g2 = c.createGain();
    o2.frequency.value = f * 3;
    g2.gain.setValueAtTime(peak * 0.16, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o2.connect(g2);
    g2.connect(out);
    o2.start(t);
    o2.stop(t + 0.42);
  }
}

/** A repeatable pseudo-random value for a position in the track, so every loop plays alike. */
function hash(a: number, b: number): number {
  let x = (a * 374761393 + b * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 0xffffffff;
}

function snap(m: number, tones: number[]): number {
  let best = tones[0];
  for (const t of tones) if (Math.abs(t - m) < Math.abs(best - m)) best = t;
  return best;
}

/** Schedules one bar. Low note counts keep this cheap, and the melody moves by small steps. */
export function nextNotes(c: AudioContext, out: AudioNode, tr: Track, bar: number, start: number): void {
  const beat = tr.barSeconds / tr.beats;
  const ch = tr.chords[bar];
  const lv = tr.level;
  note(c, out, start, ch[0] - 24, tr.bass, 0.12 * lv);

  if (tr.pulse) {
    for (let i = 0; i < tr.beats * 2; i++) note(c, out, start + (i * beat) / 2, ch[0] - 12 + (i % 2 ? 7 : 0), 'pulse', (i % 2 ? 0.05 : 0.08) * lv);
    return;
  }

  // Accompaniment: the chord broken across the beats.
  for (let i = 1; i < tr.beats; i++) note(c, out, start + i * beat, ch[(i - 1) % 3] - 12, tr.bass, 0.06 * lv);

  // Melody: four-bar phrases with rests, resolving to a chord tone at each bar line.
  const phrase = Math.floor(bar / 4);
  const inPhrase = bar % 4;
  const tones = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[0] + 24, ch[1], ch[2]];
  let pitch = snap(72 + Math.floor(hash(phrase, 3) * 8), tones);
  for (let i = 0; i < tr.beats; i++) {
    const r = hash(bar, i);
    if (inPhrase === 3 && i > 0) break;
    if (r < 0.22 && i !== 0) continue;
    const move = Math.floor(hash(phrase * 7 + inPhrase, i) * 5) - 2;
    pitch = i === 0 ? snap(pitch + move, tones) : stepInScale(pitch, move, tr.scale);
    note(c, out, start + i * beat, pitch, tr.lead, (i === 0 ? 0.16 : 0.11) * lv);
    if (r > 0.82 && i < tr.beats - 1) {
      note(c, out, start + (i + 0.5) * beat, stepInScale(pitch, 1, tr.scale), tr.lead, 0.08 * lv);
    }
  }
}

function stepInScale(m: number, steps: number, scale: number[]): number {
  const octave = Math.floor(m / 12);
  const pc = m % 12;
  let index = scale.findIndex((s) => s >= pc);
  if (index < 0) index = 0;
  const total = index + steps;
  const wrapped = ((total % scale.length) + scale.length) % scale.length;
  const shift = Math.floor(total / scale.length);
  return Math.min(88, Math.max(62, (octave + shift) * 12 + scale[wrapped]));
}
