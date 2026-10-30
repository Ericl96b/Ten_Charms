// Startup: the shell, the install helper, the splash, then the map or the match in progress.
import { TITLE } from './content.ts';
import { requestPersistence } from './meta/save.ts';
import { app, initShell, persist, show } from './ui/app.ts';
import { icon, petalSvg, roseIllustration } from './ui/art.ts';
import { resumePending, setHidden, sfx, unlockAudio } from './ui/audio/audio.ts';
import { h, wait } from './ui/dom.ts';
import { SPRING, animate, fx, setFxLayer } from './ui/fx/motion.ts';
import { noteToast } from './ui/overlays.ts';
import { journey, resumeMatch } from './ui/screens/journey.ts';
import { installDevHooks } from './dev/hooks.ts';

const WEEK = 7 * 24 * 60 * 60 * 1000;

function standalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function globalListeners(): void {
  let unlocked = false;
  document.addEventListener('pointerdown', (e) => {
    if (!unlocked) { unlocked = true; }
    unlockAudio();
    setTimeout(resumePending, 40);
    const btn = (e.target as Element).closest?.('button');
    if (btn) {
      fx('ui.buttonPress');
      sfx('tap');
    }
  }, true);
  document.addEventListener('visibilitychange', () => setHidden(document.hidden));
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  // Keeps iOS from rubber-banding the page, while still letting real scrollers scroll.
  document.addEventListener('touchmove', (e) => {
    if (!(e.target as Element).closest?.('.page-scroll,.map-scroll,.laid,.sheet-body,.opps,textarea')) e.preventDefault();
  }, { passive: false });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

function rotateCard(): void {
  document.body.append(h('div.rotate-card', { 'data-testid': 'rotate-card', 'aria-live': 'polite' },
    h('div.rotate-art', { html: roseIllustration() }),
    h('p', null, 'Please turn your phone upright'),
  ));
}

function installHelper(): Promise<void> {
  const last = app.save.install.dismissedAt;
  if (standalone() || Date.now() - last < WEEK) return Promise.resolve();
  return new Promise((resolve) => {
    const step = (n: number, ic: string, text: string) => h('li', null, h('span.step-n', null, n), h('span.step-art', { html: ic }), h('span', null, text));
    const shareIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M6 11H5v10h14V11h-1"/></svg>';
    const plusIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
    const card = h('div.overlay-screen.install', { 'data-testid': 'install-helper' },
      h('div.install-card', null,
        h('div.install-rose', { html: roseIllustration() }),
        h('h1.title', null, 'Add to Home Screen'),
        h('p.sheet-text', null, 'Keep the garden one tap away, full screen, and ready to play offline.'),
        h('ol.install-steps', null,
          step(1, shareIcon, 'Tap Share'),
          step(2, plusIcon, 'Tap Add to Home Screen'),
          step(3, icon('check'), 'Tap Add'),
        ),
        h('button.btn.primary.wide', {
          'data-testid': 'install-later',
          onclick: () => {
            app.save.install.dismissedAt = Date.now();
            persist();
            card.remove();
            resolve();
          },
        }, 'Maybe later'),
      ),
    );
    document.getElementById('overlays')!.append(card);
  });
}

function splash(): Promise<void> {
  return new Promise((resolve) => {
    const petals = Array.from({ length: 8 }, (_, i) => h('i.splash-petal', { html: petalSvg(i % 2 ? 'var(--rose-blush)' : 'var(--rose-bloom)'), style: `left:${8 + i * 12}%;--d:${i * 90}ms` }));
    const el = h('div.overlay-screen.splash', { 'data-testid': 'splash' },
      petals,
      h('div.splash-logo', null, h('div.splash-rose', { html: roseIllustration() }), h('h1.splash-title', null, TITLE)),
    );
    document.getElementById('overlays')!.append(el);
    void animate(el.querySelector('.splash-logo')!, [{ transform: 'scale(.8)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { ms: 500, ease: SPRING, ambient: true });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      void animate(el, [{ opacity: 1 }, { opacity: 0 }], { ms: 220, ambient: true }).then(() => {
        el.remove();
      });
      resolve();
    };
    el.addEventListener('pointerdown', finish);
    void wait(1500).then(finish);
  });
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  let tapped = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (tapped) location.reload();
  });
  void navigator.serviceWorker.register('sw.js').then((reg) => {
    // A version that finished installing during an earlier session applies now, at launch.
    if (reg.waiting && navigator.serviceWorker.controller) {
      tapped = true;
      reg.waiting.postMessage('SKIP_WAITING');
      return;
    }
    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      incoming?.addEventListener('statechange', () => {
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          const toast = noteToast('A new bloom is ready. Tap to update.', () => {
            tapped = true;
            toast.remove();
            incoming.postMessage('SKIP_WAITING');
          }, true);
        }
      });
    });
  }).catch(() => { /* still playable without offline support */ });
}

async function boot(): Promise<void> {
  initShell();
  requestPersistence();
  globalListeners();
  rotateCard();
  registerServiceWorker();
  if (__DEV__) installDevHooks();
  const host = h('div.fx-layer');
  app.root.append(host);
  setFxLayer(host);
  const saved = app.save.match;
  // Paint the home screen behind the splash so nothing flashes.
  if (!saved) show(journey(), 'map', 'none');
  await installHelper();
  await splash();
  if (saved) resumeMatch(saved);
}

void boot();
