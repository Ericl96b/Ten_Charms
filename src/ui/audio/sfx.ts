// Synthesized sound effects: soft chimes, ticks and swishes. Each returns its length in seconds.
export const SOUND_IDS = [
  'tap', 'select', 'dragStart', 'drop', 'draw', 'takeDiscard', 'discard', 'deal', 'slotValid', 'layReady', 'layDown',
  'oppLayDown', 'hit', 'skipOnHer', 'skipPlayed', 'goOutHer', 'goOutBot', 'tally', 'phaseAdvance', 'invalid', 'reshuffle',
  'star', 'unlock', 'charm', 'victory', 'defeat', 'bossIntro',
  'fogLift', 'thornBlock', 'wispPuff', 'pageTurn',
] as const;

export type SoundId = (typeof SOUND_IDS)[number];
type Synth = (c: AudioContext, out: AudioNode, t: number, p: number) => number;

let noiseBuffer: AudioBuffer | null = null;

function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function env(c: AudioContext, out: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

function tone(c: AudioContext, out: AudioNode, t: number, freq: number, dur: number, peak = 0.3, type: OscillatorType = 'sine', attack = 0.004): void {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.connect(env(c, out, t, peak, attack, dur));
  o.start(t);
  o.stop(t + attack + dur + 0.02);
}

function slide(c: AudioContext, out: AudioNode, t: number, from: number, to: number, dur: number, peak = 0.3, type: OscillatorType = 'sine'): void {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  o.connect(env(c, out, t, peak, 0.006, dur));
  o.start(t);
  o.stop(t + dur + 0.03);
}

/** A burst of filtered noise: the paper sounds of cards. */
function swish(c: AudioContext, out: AudioNode, t: number, freq: number, dur: number, peak = 0.25, q = 1, sweep = 1): void {
  const s = c.createBufferSource();
  s.buffer = noise(c);
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
  s.connect(f);
  f.connect(env(c, out, t, peak, 0.004, dur));
  s.start(t, Math.random() * 0.5, dur + 0.05);
}

/** A soft bell: a sine with one quiet overtone. */
function bell(c: AudioContext, out: AudioNode, t: number, freq: number, dur = 0.6, peak = 0.22): void {
  tone(c, out, t, freq, dur, peak);
  tone(c, out, t, freq * 2.76, dur * 0.4, peak * 0.14);
}

const NOTE = { C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568, C4: 261.63, E4: 329.63, G4: 392, A4: 440 };

export const SYNTH: Record<SoundId, Synth> = {
  tap(c, o, t, p) { tone(c, o, t, 1500 * p, 0.03, 0.09, 'triangle'); swish(c, o, t, 2600 * p, 0.02, 0.05); return 0.06; },
  select(c, o, t, p) { swish(c, o, t, 3800 * p, 0.05, 0.1, 1.2, 1.5); return 0.07; },
  dragStart(c, o, t, p) { swish(c, o, t, 1800 * p, 0.09, 0.09, 0.8, 1.6); return 0.11; },
  drop(c, o, t, p) { tone(c, o, t, 300 * p, 0.05, 0.14, 'triangle'); swish(c, o, t, 1200 * p, 0.04, 0.1); return 0.08; },
  draw(c, o, t, p) { swish(c, o, t, 3200 * p, 0.05, 0.14, 1.4); swish(c, o, t + 0.09, 2000 * p, 0.09, 0.12, 0.9, 1.5); return 0.2; },
  takeDiscard(c, o, t, p) { swish(c, o, t, 1500 * p, 0.14, 0.14, 0.8, 1.5); return 0.16; },
  discard(c, o, t, p) { swish(c, o, t, 2400 * p, 0.1, 0.13, 0.9, 0.6); tone(c, o, t + 0.12, 240 * p, 0.05, 0.13, 'triangle'); return 0.2; },
  deal(c, o, t, p) { swish(c, o, t, 3400 * p, 0.04, 0.12, 1.4); return 0.06; },
  slotValid(c, o, t, p) { bell(c, o, t, NOTE.E5 * p, 0.5); return 0.55; },
  layReady(c, o, t, p) {
    [NOTE.C6, NOTE.E6, NOTE.G6].forEach((f, i) => tone(c, o, t + i * 0.05, f * p, 0.7, 0.07));
    swish(c, o, t, 6000 * p, 0.5, 0.03, 2, 1.4);
    return 0.85;
  },
  layDown(c, o, t, p) {
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => bell(c, o, t + i * 0.035, f * p, 1.1, 0.16));
    swish(c, o, t, 1000 * p, 0.6, 0.11, 0.7, 3);
    return 1.3;
  },
  oppLayDown(c, o, t, p) { bell(c, o, t, NOTE.G5 * p, 0.6, 0.13); return 0.65; },
  hit(c, o, t, p) { tone(c, o, t, 660 * p, 0.17, 0.2, 'triangle'); return 0.2; },
  skipOnHer(c, o, t, p) {
    slide(c, o, t, 190 * p, 62 * p, 0.42, 0.32);
    for (let i = 0; i < 6; i++) tone(c, o, t + 0.28 + i * 0.16, 1500 * p, 0.018, 0.07 * (1 - i / 7), 'triangle');
    return 1.3;
  },
  skipPlayed(c, o, t, p) {
    swish(c, o, t, 900 * p, 0.25, 0.14, 1, 4);
    [NOTE.C6, NOTE.G6, NOTE.E6].forEach((f, i) => tone(c, o, t + 0.2 + i * 0.05, f * p, 0.25, 0.05));
    return 0.6;
  },
  goOutHer(c, o, t, p) {
    tone(c, o, t, 95 * p, 0.14, 0.42);
    swish(c, o, t, 500 * p, 0.05, 0.2);
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6].forEach((f, i) => bell(c, o, t + 0.13 + i * 0.07, f * p, 0.55, 0.11));
    return 1.1;
  },
  goOutBot(c, o, t, p) { tone(c, o, t, 150 * p, 0.09, 0.2); swish(c, o, t, 1300 * p, 0.25, 0.08, 0.7, 2.5); return 0.35; },
  tally(c, o, t, p) { tone(c, o, t, 1900 * p, 0.025, 0.08, 'triangle'); return 0.05; },
  phaseAdvance(c, o, t, p) { tone(c, o, t, 1400 * p, 0.3, 0.1, 'triangle'); tone(c, o, t + 0.09, 2100 * p, 0.45, 0.09); return 0.6; },
  invalid(c, o, t, p) { slide(c, o, t, 170 * p, 110 * p, 0.14, 0.26, 'triangle'); return 0.17; },
  reshuffle(c, o, t, p) {
    for (let i = 0; i < 14; i++) swish(c, o, t + i * 0.036, (2000 + i * 120) * p, 0.03, 0.09, 1.3);
    return 0.6;
  },
  star(c, o, t, p) { bell(c, o, t, NOTE.G5 * p, 0.7, 0.2); return 0.75; },
  unlock(c, o, t, p) {
    tone(c, o, t, 2300 * p, 0.09, 0.1, 'triangle');
    tone(c, o, t + 0.05, 3100 * p, 0.06, 0.06, 'triangle');
    [NOTE.C6, NOTE.E6, NOTE.G6, 2093].forEach((f, i) => tone(c, o, t + 0.16 + i * 0.07, f * p, 0.6, 0.06));
    return 1;
  },
  charm(c, o, t, p) { [NOTE.E6, NOTE.G6, 2093, 2637].forEach((f, i) => tone(c, o, t + i * 0.055, f * p, 0.3, 0.06)); return 0.55; },
  victory(c, o, t, p) {
    const line = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.G5, NOTE.C6, NOTE.E6];
    const at = [0, 0.18, 0.36, 0.54, 0.86, 1.04, 1.3];
    line.forEach((f, i) => bell(c, o, t + at[i], f * p, 0.9, 0.17));
    bell(c, o, t + 1.3, NOTE.C5 * p, 1.2, 0.12);
    return 2.6;
  },
  defeat(c, o, t, p) {
    [NOTE.A5, NOTE.E5, NOTE.C5, NOTE.A4, NOTE.E4].forEach((f, i) => tone(c, o, t + i * 0.2, f * p, 0.8, 0.14, 'triangle'));
    return 1.8;
  },
  bossIntro(c, o, t, p) {
    slide(c, o, t, 45 * p, 80 * p, 3, 0.26, 'sawtooth');
    tone(c, o, t, 55 * p, 3, 0.2);
    for (let i = 0; i < 16; i++) swish(c, o, t + 0.4 + i * 0.16, 700 + (i % 3) * 200, 0.07, 0.05, 1.2);
    return 3.2;
  },
  /** A rising airy swell, then a cascade of chimes. */
  fogLift(c, o, t, p) {
    swish(c, o, t, 400 * p, 1.6, 0.12, 0.6, 8);
    slide(c, o, t, 220 * p, 440 * p, 1.6, 0.08);
    [NOTE.C6, NOTE.G5, NOTE.E6, NOTE.C6, NOTE.G6, NOTE.E6, 2093].forEach((f, i) => bell(c, o, t + 1.2 + i * 0.11, f * p, 0.9, 0.1));
    return 2.8;
  },
  /** A soft, prickly rustle. */
  thornBlock(c, o, t, p) {
    for (let i = 0; i < 5; i++) swish(c, o, t + i * 0.035, (3200 + i * 300) * p, 0.03, 0.07, 3);
    tone(c, o, t, 260 * p, 0.08, 0.08, 'triangle');
    return 0.25;
  },
  /** A tiny soft poof. */
  wispPuff(c, o, t, p) { swish(c, o, t, 900 * p, 0.12, 0.05, 0.6, 0.5); return 0.14; },
  /** A light page-turn. */
  pageTurn(c, o, t, p) { swish(c, o, t, 2600 * p, 0.16, 0.1, 0.8, 1.8); swish(c, o, t + 0.08, 4200 * p, 0.08, 0.05, 1.2); return 0.25; },
};
