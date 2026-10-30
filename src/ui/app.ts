// The app shell: the save, the current screen, and the always-on layers.
import { defaultSave, loadSave, writeSave, type SaveData } from '../meta/save.ts';
import { playMusic, setVolumes, type MusicId } from './audio/audio.ts';
import { clear, h } from './dom.ts';
import { SOFT, animate, setMotion } from './fx/motion.ts';

export const app = {
  save: defaultSave() as SaveData,
  root: null as unknown as HTMLElement,
  screenHost: null as unknown as HTMLElement,
  current: null as HTMLElement | null,
  onLeave: null as (() => void) | null,
};

export function initShell(): void {
  app.save = loadSave();
  app.root = document.getElementById('app')!;
  clear(app.root);
  app.screenHost = h('div');
  app.screenHost.id = 'screens';
  const overlays = h('div');
  overlays.id = 'overlays';
  app.root.append(app.screenHost, overlays);
  applySettings();
}

export function persist(): void {
  writeSave(app.save);
}

export function applySettings(): void {
  const s = app.save.settings;
  setMotion(s.animSpeed === 'fast', s.reducedMotion);
  setVolumes(s.music, s.sfx);
}

/** Replaces the current screen. `mode` picks the transition. */
export function show(next: HTMLElement, music: MusicId | null, mode: 'fade' | 'none' = 'fade'): void {
  app.onLeave?.();
  app.onLeave = null;
  const old = app.current;
  app.current = next;
  app.screenHost.append(next);
  if (music) playMusic(music);
  if (mode === 'fade' && old) {
    void animate(next, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { ms: 240, ease: SOFT });
    void animate(old, [{ opacity: 1 }, { opacity: 0 }], { ms: 200, ease: 'linear' }).then(() => old.remove());
  } else {
    old?.remove();
  }
}
