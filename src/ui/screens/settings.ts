// Settings, Backup & Restore, Reset, and Credits.
import { clearSave, defaultSave, exportCode, importCode, type SaveData, type Settings } from '../../meta/save.ts';
import { saveSummary } from '../../meta/progress.ts';
import { app, applySettings, persist, show } from '../app.ts';
import { icon } from '../art.ts';
import { sfx } from '../audio/audio.ts';
import { h } from '../dom.ts';
import { SOFT, animate } from '../fx/motion.ts';
import { confirmSheet, invalid, noteToast, openSheet } from '../overlays.ts';
import { CREDITS } from '../../credits.ts';
import { journey } from './journey.ts';

function row(label: string, control: HTMLElement): HTMLElement {
  return h('div.set-row', null, h('span.set-label', null, label), control);
}

function slider(key: 'music' | 'sfx', testid: string): HTMLElement {
  const input = h('input.slider', { type: 'range', min: 0, max: 100, step: 1, value: String(Math.round(app.save.settings[key] * 100)), 'aria-label': key === 'music' ? 'Music volume' : 'Sound effects volume', 'data-testid': testid }) as HTMLInputElement;
  const value = h('span.set-value', null, `${input.value}%`);
  input.addEventListener('input', () => {
    app.save.settings[key] = Number(input.value) / 100;
    value.textContent = `${input.value}%`;
    applySettings();
    persist();
  });
  input.addEventListener('change', () => { if (key === 'sfx') sfx('tap'); });
  return h('div.slider-wrap', null, input, value);
}

function segmented<K extends keyof Settings>(key: K, options: [Settings[K], string][], testid: string): HTMLElement {
  const box = h('div.seg', { 'data-testid': testid });
  const draw = () => {
    box.textContent = '';
    for (const [value, label] of options) {
      box.append(h('button.seg-btn', {
        class: app.save.settings[key] === value ? 'on' : '',
        'data-value': String(value),
        onclick: () => { app.save.settings[key] = value; applySettings(); persist(); draw(); },
      }, label));
    }
  };
  draw();
  return box;
}

const onOff = (key: 'reducedMotion' | 'hints' | 'confirmDiscard', testid: string) => segmented(key, [[false, 'Off'], [true, 'On']], testid);

export function settingsScreen(inMatch: boolean): void {
  const screen = h('div.overlay-screen.page-screen.settings', { 'data-testid': 'settings-screen', 'data-screen': 'settings' });
  const close = () => {
    void animate(screen, [{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], { ms: 220, ease: 'ease-in' }).then(() => screen.remove());
  };
  screen.append(
    h('div.page-top', null,
      h('button.round-btn', { 'aria-label': 'Back', html: icon('back'), onclick: close, 'data-testid': 'settings-back' }),
      h('h1.game-title', null, 'Settings'),
      h('i.spacer'),
    ),
    h('div.page-scroll', null,
      row('Music volume', slider('music', 'music-volume')),
      row('Sound effects volume', slider('sfx', 'sfx-volume')),
      row('Bot speed', segmented('botSpeed', [['relaxed', 'Relaxed'], ['normal', 'Normal'], ['brisk', 'Brisk']], 'bot-speed')),
      row('Animation speed', segmented('animSpeed', [['normal', 'Normal'], ['fast', 'Fast']], 'anim-speed')),
      row('Reduced motion', onOff('reducedMotion', 'reduced-motion')),
      row('Gentle hints', onOff('hints', 'hints')),
      row('Confirm discard', onOff('confirmDiscard', 'confirm-discard')),
      h('button.btn.secondary.wide', { 'data-testid': 'backup', onclick: () => backupSheet() }, 'Backup & Restore'),
      h('button.btn.secondary.wide', { 'data-testid': 'credits', onclick: () => creditsSheet() }, 'Credits & licenses'),
      inMatch ? null : h('button.btn.ghost.wide', { 'data-testid': 'reset', onclick: () => resetFlow(close) }, 'Reset all progress'),
    ),
  );
  document.getElementById('overlays')!.append(screen);
  void animate(screen, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { ms: 320, ease: SOFT, fill: 'backwards' });
}

function backupSheet(): void {
  const code = exportCode(app.save);
  const box = h('textarea.code-box', { readonly: 'readonly', 'data-testid': 'export-code', 'aria-label': 'Your backup code' }, code) as HTMLTextAreaElement;
  const paste = h('textarea.code-box', { placeholder: 'Paste a backup code here', 'data-testid': 'import-code', 'aria-label': 'Paste a backup code' }) as HTMLTextAreaElement;
  const share = 'share' in navigator
    ? h('button.btn.secondary', { 'data-testid': 'share', onclick: () => { void navigator.share({ text: code }).catch(() => {}); } }, 'Share')
    : null;
  const importBtn = h('button.btn.primary.wide', { 'data-testid': 'import' }, 'Restore from code');
  const sheet = openSheet([
    h('p.sheet-text', null, 'This code holds your stars, Charms, stats and settings. Keep it somewhere safe.'),
    box,
    h('div.sheet-actions', null,
      h('button.btn.secondary', {
        'data-testid': 'copy',
        onclick: () => {
          box.select();
          const done = () => noteToast('Copied');
          if (navigator.clipboard) void navigator.clipboard.writeText(code).then(done, () => done());
          else { document.execCommand('copy'); done(); }
        },
      }, 'Copy'),
      share,
    ),
    h('h3.sec', null, 'Restore'),
    paste,
    importBtn,
  ], { title: 'Backup & Restore', className: 'tall' });
  importBtn.addEventListener('click', () => {
    const data = importCode(paste.value);
    if (!data) { invalid(paste, "That code doesn't look right."); return; }
    confirmImport(data, sheet.close);
  });
}

function confirmImport(data: SaveData, closeOuter: () => Promise<void>): void {
  confirmSheet('Restore this backup?', `${saveSummary(data)}. This replaces what's on this phone.`, 'Restore', () => {
    app.save = { ...data, match: null };
    persist();
    applySettings();
    void closeOuter();
    document.querySelector('[data-testid="settings-screen"]')?.remove();
    show(journey(), 'map');
    noteToast('Your garden is restored.');
  });
}

function resetFlow(closeSettings: () => void): void {
  confirmSheet('Reset all progress?', 'Stars, Charms, unlocks and stats will all be erased.', 'Continue', () => {
    const input = h('input.text-input', { type: 'text', placeholder: 'RESET', 'data-testid': 'reset-input', autocapitalize: 'characters', 'aria-label': 'Type RESET to confirm' }) as HTMLInputElement;
    const go = h('button.btn.primary.wide', { 'data-testid': 'reset-confirm' }, 'Erase everything');
    const s = openSheet([h('p.sheet-text', null, 'Type RESET to confirm.'), input, go], { title: 'Are you sure?' });
    go.addEventListener('click', () => {
      if (input.value !== 'RESET') { invalid(input, 'Type RESET to confirm.'); return; }
      clearSave();
      app.save = defaultSave();
      persist();
      applySettings();
      void s.close();
      closeSettings();
      show(journey(), 'map');
    });
  });
}

function creditsSheet(): void {
  openSheet(h('div.credits', { 'data-testid': 'credits-list' }, CREDITS.map((c) =>
    h('div.credit', null, h('b', null, c.item), h('small', null, `${c.source} · ${c.license}`)),
  )), { title: 'Credits & licenses', className: 'tall' });
}
