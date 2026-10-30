// Sound. Effects and music are synthesized at runtime. A file dropped in assets/audio
// named after a sound id (see SOUND_IDS and MUSIC_IDS) replaces the synthesized version.
import { eventLog } from '../fx/motion.ts';
import { MUSIC, nextNotes, type Track } from './music.ts';
import { SYNTH, type SoundId } from './sfx.ts';

export { SOUND_IDS, type SoundId } from './sfx.ts';
export type MusicId = 'map' | 'waltz' | 'musicbox' | 'boss';

let ctx: AudioContext | null = null;
let sfxBus: GainNode | null = null;
let musicBus: GainNode | null = null;
let sfxVolume = 0.8;
let musicVolume = 0.5;
const buffers = new Map<string, AudioBuffer>();
const playing = new Map<string, number>();

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  sfxBus = ctx.createGain();
  musicBus = ctx.createGain();
  sfxBus.gain.value = sfxVolume;
  musicBus.gain.value = musicVolume;
  sfxBus.connect(ctx.destination);
  musicBus.connect(ctx.destination);
  void loadFiles();
  return ctx;
}

async function loadFiles(): Promise<void> {
  for (const [id, url] of Object.entries(__AUDIO_FILES__)) {
    try {
      const res = await fetch(url);
      const data = await res.arrayBuffer();
      if (ctx) buffers.set(id, await ctx.decodeAudioData(data));
    } catch { /* the synthesized version stays in use */ }
  }
  // A dropped-in music file takes over from the synthesized track as soon as it is ready.
  if (current) { const id = current; current = null; playMusic(id); }
}

/** iOS needs a tap before any sound can play. */
export function unlockAudio(): void {
  const c = ensureContext();
  if (c && c.state !== 'running') void c.resume();
}

export function setVolumes(music: number, sfxLevel: number): void {
  musicVolume = music;
  sfxVolume = sfxLevel;
  if (ctx && sfxBus && musicBus) {
    sfxBus.gain.setTargetAtTime(sfxLevel, ctx.currentTime, 0.03);
    musicBus.gain.setTargetAtTime(music, ctx.currentTime, 0.03);
  }
}

export function sfx(id: SoundId, opts: { step?: number; quiet?: number } = {}): void {
  if (__DEV__) eventLog.push({ kind: 'sound', name: id, at: Date.now() });
  const c = ctx;
  if (!c || !sfxBus || c.state !== 'running') return;
  const count = playing.get(id) ?? 0;
  if (count >= 3) return;
  // Slight pitch variation keeps repeats from sounding mechanical; `step` raises it by scale steps.
  const pitch = (1 + (Math.random() - 0.5) * 0.1) * 2 ** ((opts.step ?? 0) * (2 / 12));
  const out = c.createGain();
  out.gain.value = opts.quiet ?? 1;
  out.connect(sfxBus);
  playing.set(id, count + 1);
  const buffer = buffers.get(id);
  let length: number;
  if (buffer) {
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = pitch;
    src.connect(out);
    src.start();
    length = buffer.duration;
  } else {
    length = SYNTH[id](c, out, c.currentTime, pitch);
  }
  setTimeout(() => {
    playing.set(id, Math.max(0, (playing.get(id) ?? 1) - 1));
    out.disconnect();
  }, length * 1000 + 100);
}

/* ---------- Music ---------- */

const CROSSFADE = 0.8;
const LOOKAHEAD = 1.2;

type Voice = { gain: GainNode; track: Track; bar: number; beatTime: number; timer: number; src?: AudioBufferSourceNode };

let current: MusicId | null = null;
let voice: Voice | null = null;
let tension: Voice | null = null;

function startVoice(track: Track, startTime: number, level: number, fade: number): Voice {
  const c = ctx!;
  const gain = c.createGain();
  gain.gain.value = 0.0001;
  gain.gain.setValueAtTime(0.0001, c.currentTime);
  gain.gain.linearRampToValueAtTime(level, c.currentTime + fade);
  gain.connect(musicBus!);
  const v: Voice = { gain, track, bar: 0, beatTime: startTime, timer: 0 };
  const tick = () => {
    if (c.state === 'running') {
      while (v.beatTime < c.currentTime + LOOKAHEAD) {
        nextNotes(c, gain, track, v.bar, v.beatTime);
        v.beatTime += track.barSeconds;
        v.bar = (v.bar + 1) % track.bars;
      }
    }
  };
  tick();
  v.timer = window.setInterval(tick, 300);
  return v;
}

function stopVoice(v: Voice, fade: number): void {
  const c = ctx!;
  clearInterval(v.timer);
  v.gain.gain.cancelScheduledValues(c.currentTime);
  v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.0001), c.currentTime);
  v.gain.gain.linearRampToValueAtTime(0.0001, c.currentTime + fade);
  v.src?.stop(c.currentTime + fade + 0.05);
  setTimeout(() => v.gain.disconnect(), fade * 1000 + 3000);
}

function startFileVoice(id: string, level: number, fade: number): Voice {
  const c = ctx!;
  const gain = c.createGain();
  gain.gain.value = 0.0001;
  gain.gain.linearRampToValueAtTime(level, c.currentTime + fade);
  gain.connect(musicBus!);
  const src = c.createBufferSource();
  src.buffer = buffers.get(id)!;
  src.loop = true;
  src.connect(gain);
  src.start();
  return { gain, track: MUSIC.map, bar: 0, beatTime: 0, timer: 0, src };
}

export function playMusic(id: MusicId): void {
  if (__DEV__) eventLog.push({ kind: 'sound', name: `music.${id}`, at: Date.now() });
  if (current === id) return;
  const previous = current;
  current = id;
  const c = ensureContext();
  if (!c || c.state !== 'running') { pendingStart = true; return; }
  if (voice) stopVoice(voice, CROSSFADE);
  if (tension && (previous !== id)) { stopVoice(tension, CROSSFADE); tension = null; }
  voice = buffers.has(`music-${id}`) ? startFileVoice(`music-${id}`, 1, CROSSFADE) : startVoice(MUSIC[id], c.currentTime + 0.05, 1, CROSSFADE);
}

let pendingStart = false;

/** Starts whatever should already be playing once a first tap has unlocked sound. */
export function resumePending(): void {
  if (!pendingStart || !ctx || ctx.state !== 'running') return;
  pendingStart = false;
  if (current) {
    const id = current;
    current = null;
    playMusic(id);
  }
}

/** Layers the tension track over the boss theme, on the same bar grid so the two stay in sync. */
export function setTension(on: boolean): void {
  if (__DEV__ && on) eventLog.push({ kind: 'sound', name: 'music.tension', at: Date.now() });
  const c = ctx;
  if (!c || c.state !== 'running' || !voice) return;
  if (on && !tension) {
    if (buffers.has('music-tension')) tension = startFileVoice('music-tension', 0.9, 2);
    else {
      tension = startVoice(MUSIC.tension, voice.beatTime, 0.9, 2);
      tension.bar = voice.bar % MUSIC.tension.bars;
    }
  } else if (!on && tension) {
    stopVoice(tension, CROSSFADE);
    tension = null;
  }
}

/** Sound stops when the app is hidden and picks up again on return. */
export function setHidden(hidden: boolean): void {
  if (!ctx) return;
  if (hidden) void ctx.suspend();
  else void ctx.resume();
}
