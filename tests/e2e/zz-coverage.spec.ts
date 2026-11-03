import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { LOG_DIR, expect, test } from './helpers.ts';

/** Every animation event in the design, and every sound event. All must fire somewhere in the suite. */
const FX = [
  'ambient.petals', 'ambient.candle', 'ambient.steam', 'ambient.wildSheen', 'ambient.handBreathing', 'ambient.pileInvite',
  'card.select', 'card.drag', 'card.dragWildTrail', 'card.drop', 'card.draw', 'card.takeDiscard', 'card.discard', 'hand.reflow',
  'group.slotFly', 'group.slotValid', 'group.layReady',
  'lay.fly', 'lay.ringSweep', 'lay.burst', 'lay.flash', 'lay.banner', 'lay.trackFill', 'lay.coinFlip', 'lay.settle', 'lay.panelCompact', 'lay.botLay',
  'hit.human', 'hit.bot', 'skip.onHer', 'skip.shake', 'skip.onBot', 'skip.frost',
  'out.human', 'out.shake', 'out.confetti', 'out.bot',
  'round.flipHands', 'round.tally', 'round.medallionFlip', 'round.screen',
  'invalid.shake', 'invalid.tooltip',
  'victory.bloom', 'victory.star', 'victory.unlock', 'victory.charm', 'loss.petals',
  'ui.buttonPress', 'ui.odometer', 'ui.sheet', 'ui.charmToast', 'ui.turnGlow', 'ui.botThinking', 'ui.reshuffle', 'ui.deal', 'ui.bubble', 'ui.expression',
  'boss.intro', 'boss.darken', 'boss.clothFade', 'boss.mothsIn', 'boss.portrait', 'boss.line', 'boss.moths', 'boss.tension', 'boss.victory',
  'fog.clouds', 'fog.wispPuff', 'fog.lift', 'fog.bloom', 'glade.fireflies', 'glade.reveal', 'map.switch', 'crown.thornBlock',
  'lunaria.intro', 'lunaria.mist', 'lunaria.threads', 'lunaria.portrait', 'lunaria.wispsIn', 'lunaria.dissolve',
];

const SOUNDS = [
  'tap', 'select', 'dragStart', 'drop', 'draw', 'takeDiscard', 'discard', 'deal', 'slotValid', 'layReady', 'layDown', 'oppLayDown', 'hit',
  'skipOnHer', 'skipPlayed', 'goOutHer', 'goOutBot', 'tally', 'phaseAdvance', 'invalid', 'reshuffle', 'star', 'unlock', 'charm', 'victory', 'defeat', 'bossIntro',
  'music.map', 'music.waltz', 'music.boss',
  'fogLift', 'thornBlock', 'wispPuff', 'pageTurn', 'music.gladeFog', 'music.gladeLift', 'music.lunaria', 'music.moonwaltz',
];

test('11. juice coverage: every animation and sound event fired during the suite', ({}, info) => {
  // Each worker keeps its own log, so read them all.
  const files = existsSync(LOG_DIR) ? readdirSync(LOG_DIR).filter((f) => f.startsWith(`events-${info.project.name}-`)) : [];
  expect(files.length).toBeGreaterThan(0);
  const seen = new Set(files.flatMap((f) => readFileSync(`${LOG_DIR}/${f}`, 'utf8').split('\n')));
  const missing = [...FX.filter((n) => !seen.has(`fx:${n}`)), ...SOUNDS.filter((n) => !seen.has(`sound:${n}`))];
  expect(missing).toEqual([]);
});
