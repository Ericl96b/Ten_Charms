// Game content in one place: the title, the roster, every line of dialogue, unlocks, and Charms.
import type { BotId } from './bots/profiles.ts';

export const TITLE = 'Ten Charms';

export type BotInfo = {
  id: BotId;
  name: string;
  letter: string;
  species: string;
  epithet: string;
  color: string;
  ink: string;
  pips: number;
  blurb: string;
};

export const BOTS: Record<BotId, BotInfo> = {
  pip: { id: 'pip', name: 'Pip', letter: 'P', species: 'Sleepy hedgehog', epithet: 'The Dozing Dealer', color: '#C9B4E6', ink: '#3E2361', pips: 1, blurb: 'Plays slow and sweet. Perfect for learning the ropes.' },
  marigold: { id: 'marigold', name: 'Marigold', letter: 'M', species: 'Squirrel', epithet: 'The Hoarder', color: '#F6C46B', ink: '#5B2340', pips: 2, blurb: "Never lets go of a Wild. Hoards until it's almost too late." },
  briar: { id: 'briar', name: 'Briar', letter: 'B', species: 'Fox', epithet: 'The Troublemaker', color: '#EE9A7C', ink: '#5B2340', pips: 3, blurb: "Skips whoever's winning. Races to go out." },
  hoot: { id: 'hoot', name: 'Professor Hoot', letter: 'H', species: 'Owl', epithet: 'The Card Counter', color: '#A9C7B5', ink: '#26443A', pips: 4, blurb: "Watches every discard. Won't feed you what you need." },
  nightshade: { id: 'nightshade', name: 'Nightshade', letter: 'N', species: 'Moth-winged witch queen', epithet: 'The Moth Queen', color: '#3A1640', ink: '#F5B8C8', pips: 5, blurb: 'Sees every pattern, wastes no move. The final duel.' },
};

export type LineTrigger =
  | 'laysDown' | 'skipped' | 'goesOut' | 'playsSkip' | 'loses' | 'wins'
  | 'humanLays' | 'humanTakesDiscard' | 'humanGoesOut' | 'intro' | 'humanNearWin';

export const LINES: Record<BotId, Partial<Record<LineTrigger, string>>> = {
  pip: {
    laysDown: 'Oh! I did a thing.', skipped: 'Mmh… was napping anyway.', goesOut: 'Is it bedtime yet?',
    humanLays: 'Ooh, pretty.', loses: 'That was nice. Again tomorrow?', wins: 'I won? I should nap more often.',
  },
  marigold: {
    laysDown: "Finally! I've been saving these.", skipped: 'Hey! Paws off my turn!', goesOut: 'All tucked away!',
    humanTakesDiscard: 'Ooh, I was eyeing that one…', loses: "I'll stash better next time.", wins: 'Good things come to those who hoard.',
  },
  briar: {
    playsSkip: 'Sit this one out, petal.', laysDown: 'Too easy.', skipped: 'Cute. Very cute.',
    humanGoesOut: '…Lucky draw.', loses: 'Fine. Rematch. Now.', wins: "Told you I'm trouble.",
  },
  hoot: {
    laysDown: 'Precisely as calculated.', skipped: 'Hoo. A bold choice.', playsSkip: "Forgive me. It's simply optimal.",
    humanLays: 'Hm. Noted.', loses: 'Fascinating. I shall revise my notes.', wins: 'Every card tells a story.',
  },
  nightshade: {
    intro: "So, you've charmed my little garden friends. Now charm me.", laysDown: 'The moths remember every card.',
    playsSkip: 'Not this turn, little rose.', skipped: 'How daring.', humanLays: 'Hmm. Promising.',
    humanNearWin: 'Careful now. The night is long.', loses: 'Well played. The garden is yours… for now.', wins: 'Come back when your petals have thorns.',
  },
};

export type Stop = { featured: BotId; lineup: BotId[]; format: string };

export const STOPS: Stop[] = [
  { featured: 'pip', lineup: ['pip'], format: '1-vs-1' },
  { featured: 'marigold', lineup: ['marigold', 'pip'], format: '3 players' },
  { featured: 'briar', lineup: ['briar', 'marigold', 'pip'], format: '4 players' },
  { featured: 'hoot', lineup: ['hoot', 'briar', 'marigold'], format: '4 players' },
  { featured: 'nightshade', lineup: ['nightshade'], format: '1-vs-1 duel' },
];

export type UnlockType = 'back' | 'cloth' | 'music' | 'mode';
export type Requirement = { kind: 'default' } | { kind: 'stop'; stop: number } | { kind: 'stars'; stars: number };
export type Unlockable = { id: string; name: string; type: UnlockType; req: Requirement };

const stop = (n: number): Requirement => ({ kind: 'stop', stop: n });

export const UNLOCKABLES: Unlockable[] = [
  { id: 'rose-lattice', name: 'Rose Lattice', type: 'back', req: { kind: 'default' } },
  { id: 'clover-meadow', name: 'Clover Meadow', type: 'back', req: stop(1) },
  { id: 'honeycomb', name: 'Honeycomb', type: 'back', req: stop(3) },
  { id: 'owl-feather', name: 'Owl Feather', type: 'back', req: stop(4) },
  { id: 'moth-wing', name: 'Moth Wing', type: 'back', req: stop(5) },
  { id: 'starlight', name: 'Starlight', type: 'back', req: { kind: 'stars', stars: 15 } },
  { id: 'blush-gingham', name: 'Blush Gingham', type: 'cloth', req: { kind: 'default' } },
  { id: 'buttercream', name: 'Buttercream', type: 'cloth', req: stop(2) },
  { id: 'lavender-lace', name: 'Lavender Lace', type: 'cloth', req: { kind: 'stars', stars: 10 } },
  { id: 'midnight-garden', name: 'Midnight Garden', type: 'cloth', req: stop(5) },
  { id: 'garden-waltz', name: 'Garden Waltz', type: 'music', req: { kind: 'default' } },
  { id: 'music-box', name: 'Music Box', type: 'music', req: stop(5) },
  { id: 'free-play', name: 'Free Play', type: 'mode', req: stop(1) },
  { id: 'sprint', name: 'Sprint', type: 'mode', req: stop(5) },
  { id: 'choose', name: 'Choose Your Phase', type: 'mode', req: stop(5) },
];

export const TYPE_LABEL: Record<UnlockType, string> = { back: 'Card back', cloth: 'Tablecloth', music: 'Music', mode: 'Mode' };

export function requirementText(req: Requirement): string {
  if (req.kind === 'default') return 'Yours from the start';
  if (req.kind === 'stars') return req.stars === 15 ? 'Earn all 15 stars' : `Earn ${req.stars} stars`;
  return `Win Stop ${req.stop} (${BOTS[STOPS[req.stop - 1].featured].name})`;
}

export type CharmId =
  | 'first-bloom' | 'wild-at-heart' | 'not-today' | 'clean-sweep' | 'perfect-teatime'
  | 'rainbow' | 'steady-hands' | 'comeback' | 'garden-champion' | 'bouquet';

export const CHARMS: { id: CharmId; name: string; text: string }[] = [
  { id: 'first-bloom', name: 'First Bloom', text: 'Lay down your first phase' },
  { id: 'wild-at-heart', name: 'Wild at Heart', text: 'Lay down a phase using 2 or more Wilds' },
  { id: 'not-today', name: 'Not Today', text: 'Skip an opponent who has 3 or fewer cards and their phase down' },
  { id: 'clean-sweep', name: 'Clean Sweep', text: 'Go out on the same turn you lay down' },
  { id: 'perfect-teatime', name: 'Perfect Teatime', text: 'Finish a round with 0 points while your phase is completed' },
  { id: 'rainbow', name: 'Rainbow', text: 'Complete Phase 8 on your first attempt in a match' },
  { id: 'steady-hands', name: 'Steady Hands', text: 'Win a match without ever failing a phase two rounds in a row' },
  { id: 'comeback', name: 'Comeback', text: 'Win a match after being 2 or more phases behind the leader at any point' },
  { id: 'garden-champion', name: 'Garden Champion', text: 'Win Stop 5' },
  { id: 'bouquet', name: 'Bouquet', text: 'Earn all 15 stars' },
];
