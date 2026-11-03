// Game content in one place: the title, the roster, every line of dialogue, unlocks, and Charms.
import type { BotId } from './bots/profiles.ts';
import type { GladeStopId } from './meta/save.ts';

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
  /** Map 1's match intro text. The Glade's bots have none in the spec, so theirs is empty and not shown. */
  blurb: string;
};

export const BOTS: Record<BotId, BotInfo> = {
  pip: { id: 'pip', name: 'Pip', letter: 'P', species: 'Sleepy hedgehog', epithet: 'The Dozing Dealer', color: '#C9B4E6', ink: '#3E2361', pips: 1, blurb: 'Plays slow and sweet. Perfect for learning the ropes.' },
  marigold: { id: 'marigold', name: 'Marigold', letter: 'M', species: 'Squirrel', epithet: 'The Hoarder', color: '#F6C46B', ink: '#5B2340', pips: 2, blurb: "Never lets go of a Wild. Hoards until it's almost too late." },
  briar: { id: 'briar', name: 'Briar', letter: 'B', species: 'Fox', epithet: 'The Troublemaker', color: '#EE9A7C', ink: '#5B2340', pips: 3, blurb: "Skips whoever's winning. Races to go out." },
  hoot: { id: 'hoot', name: 'Professor Hoot', letter: 'H', species: 'Owl', epithet: 'The Card Counter', color: '#A9C7B5', ink: '#26443A', pips: 4, blurb: "Watches every discard. Won't feed you what you need." },
  nightshade: { id: 'nightshade', name: 'Nightshade', letter: 'N', species: 'Moth-winged witch queen', epithet: 'The Moth Queen', color: '#3A1640', ink: '#F5B8C8', pips: 5, blurb: 'Sees every pattern, wastes no move. The final duel.' },
  lumi: { id: 'lumi', name: 'Lumi', letter: 'L', species: 'Firefly', epithet: 'The Glowbug', color: '#F7E08A', ink: '#5B2340', pips: 3, blurb: '' },
  mallow: { id: 'mallow', name: 'Mallow', letter: 'M', species: 'Bunny', epithet: 'The Quick Hop', color: '#F4C9D6', ink: '#5B2340', pips: 3, blurb: '' },
  velvet: { id: 'velvet', name: 'Velvet', letter: 'V', species: 'Fruit bat', epithet: 'The Night Dancer', color: '#C8B6E2', ink: '#3E2361', pips: 4, blurb: '' },
  fennel: { id: 'fennel', name: 'Fennel', letter: 'F', species: 'Frog', epithet: 'The Pond Keeper', color: '#B7D9A8', ink: '#26443A', pips: 3, blurb: '' },
  sable: { id: 'sable', name: 'Sable', letter: 'S', species: 'Raccoon', epithet: 'The Collector', color: '#C9C2CC', ink: '#3A2F3D', pips: 4, blurb: '' },
  mossback: { id: 'mossback', name: 'Old Mossback', letter: 'O', species: 'Tortoise', epithet: 'The Patient', color: '#A9C7B5', ink: '#26443A', pips: 4, blurb: '' },
  lunaria: { id: 'lunaria', name: 'Lunaria', letter: 'L', species: 'Fog-weaver fairy queen', epithet: 'The Fog Weaver', color: '#E6D9F2', ink: '#5B2340', pips: 5, blurb: '' },
  puff: { id: 'puff', name: 'Puff', letter: 'P', species: 'Fog wisp', epithet: "Lunaria's Wisp", color: '#F4EEF8', ink: '#5B2340', pips: 0, blurb: '' },
  haze: { id: 'haze', name: 'Haze', letter: 'H', species: 'Fog wisp', epithet: "Lunaria's Wisp", color: '#F4EEF8', ink: '#5B2340', pips: 0, blurb: '' },
};

/** Lunaria's full title, for the boss plate and her intro. */
export const LUNARIA_TITLE = 'Lady Lunaria, the Fog Weaver';

export type LineTrigger =
  | 'laysDown' | 'skipped' | 'goesOut' | 'playsSkip' | 'loses' | 'wins'
  | 'humanLays' | 'humanTakesDiscard' | 'humanGoesOut' | 'intro' | 'humanNearWin'
  | 'takesDiscard' | 'introLifted' | 'humanHitsCrown';

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
  lumi: {
    laysDown: 'Look at me glow!', skipped: 'Aw, my light went out.', playsSkip: 'Sorry! Bright idea, though.', goesOut: 'Lights out!',
    humanLays: 'Ooh, sparkly!', loses: 'You light the way. Again?', wins: 'I glowed for it!',
  },
  mallow: {
    laysDown: 'Hop, hop, done!', skipped: 'Hey! I was mid-hop!', playsSkip: 'Wait right there!', goesOut: 'Zoom!',
    humanTakesDiscard: 'That was my carrot…', loses: 'Best two out of three?', wins: 'Quick paws win!',
  },
  velvet: {
    playsSkip: 'Hang around a while, darling.', laysDown: 'Simply fang-tastic.', skipped: 'Rude. Elegant, but rude.',
    humanGoesOut: "I wasn't even upside down for that.", loses: "I'll be back at dusk.", wins: 'The night favors me.',
  },
  fennel: {
    laysDown: 'Ribbit. Right on cue.', skipped: "I'll just sit on my lily pad.", humanTakesDiscard: 'Hm. That one was mine.', goesOut: 'Splash!',
    loses: 'Well hopped.', wins: 'Patience, like a pond.',
  },
  sable: {
    takesDiscard: 'Finders keepers.', laysDown: 'Everything I need, I found.', skipped: 'Hey, I was busy shopping.',
    playsSkip: "You won't miss one turn. Probably.", loses: "I'll pocket that lesson.", wins: "One player's trash…",
  },
  mossback: {
    laysDown: 'Slow and certain.', skipped: "I've waited longer.", playsSkip: 'Patience, young one.', humanLays: 'Mm. Well grown.',
    loses: "You've grown quick. Go on, then.", wins: 'The long road wins again.',
  },
  lunaria: {
    intro: "Lost in my fog, little rose? Let's see you play blind.", introLifted: 'The sun came up, but my crown still has thorns.',
    laysDown: 'Woven, every thread.', playsSkip: 'Wait in the mist.', skipped: 'Clever. The fog remembers.', humanHitsCrown: 'Mind the thorns, dear.',
    humanNearWin: 'The fog grows thin. How brave of you.', loses: 'Then let there be morning.', wins: 'Back into the mist with you.',
  },
  puff: { playsSkip: 'Poof!', laysDown: 'Puff puff!', skipped: 'Pfft.' },
  haze: { playsSkip: 'Shhh…', laysDown: 'Hazy… done.', skipped: '…!' },
};

export type Stop = { featured: BotId; lineup: BotId[]; format: string };

export const STOPS: Stop[] = [
  { featured: 'pip', lineup: ['pip'], format: '1-vs-1' },
  { featured: 'marigold', lineup: ['marigold', 'pip'], format: '3 players' },
  { featured: 'briar', lineup: ['briar', 'marigold', 'pip'], format: '4 players' },
  { featured: 'hoot', lineup: ['hoot', 'briar', 'marigold'], format: '4 players' },
  { featured: 'nightshade', lineup: ['nightshade'], format: '1-vs-1 duel' },
];

export type { GladeStopId };

export type GladeStop = {
  id: GladeStopId;
  /** The place on the map. */
  place: string;
  featured: BotId;
  /** Opponents in seat order, clockwise from the human: left, top, right. */
  lineup: BotId[];
  format: string;
  /** The stops whose win opens this one. Any one of them is enough. */
  opensAfter: GladeStopId[];
  /** The most rounds for 2 and 3 stars, from the simulation in SIMULATION_MAP2.md. */
  stars: { two: number; three: number };
};

export const GLADE_STOPS: GladeStop[] = [
  { id: 'g1', place: 'Firefly Clearing', featured: 'lumi', lineup: ['lumi', 'briar'], format: '3 players', opensAfter: [], stars: { two: 14, three: 13 } },
  { id: 'a1', place: 'Lantern Lane', featured: 'mallow', lineup: ['mallow', 'lumi', 'marigold'], format: '4 players', opensAfter: ['g1'], stars: { two: 16, three: 15 } },
  { id: 'a2', place: 'Lantern Lane', featured: 'velvet', lineup: ['velvet', 'mallow', 'briar'], format: '4 players', opensAfter: ['a1'], stars: { two: 17, three: 16 } },
  { id: 'b1', place: 'Lily Pond', featured: 'fennel', lineup: ['fennel', 'lumi', 'marigold'], format: '4 players', opensAfter: ['g1'], stars: { two: 17, three: 16 } },
  { id: 'b2', place: 'Lily Pond', featured: 'sable', lineup: ['sable', 'fennel', 'briar'], format: '4 players', opensAfter: ['b1'], stars: { two: 17, three: 16 } },
  { id: 'g2', place: 'The Old Stones', featured: 'mossback', lineup: ['mossback', 'velvet', 'sable'], format: '4 players', opensAfter: ['a2', 'b2'], stars: { two: 17, three: 16 } },
  // Puff sits to the human's left and feeds Lunaria, across the top; Haze sits to the right, just before the human.
  { id: 'g3', place: "The Weaver's Bower", featured: 'lunaria', lineup: ['puff', 'lunaria', 'haze'], format: '4 players', opensAfter: ['g2'], stars: { two: 14, three: 13 } },
];

export function gladeStop(id: GladeStopId): GladeStop {
  return GLADE_STOPS.find((s) => s.id === id)!;
}

export type UnlockType = 'back' | 'cloth' | 'music' | 'mode';
export type Requirement =
  | { kind: 'default' } | { kind: 'stop'; stop: number } | { kind: 'stars'; stars: number }
  | { kind: 'glade'; stop: GladeStopId } | { kind: 'gladeStars'; stars: number };
export type Unlockable = { id: string; name: string; type: UnlockType; req: Requirement };

const stop = (n: number): Requirement => ({ kind: 'stop', stop: n });
const glade = (id: GladeStopId): Requirement => ({ kind: 'glade', stop: id });

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
  { id: 'lantern-glow', name: 'Lantern Glow', type: 'back', req: glade('g1') },
  { id: 'moonlit', name: 'Moonlit Phases', type: 'mode', req: glade('g1') },
  { id: 'bunny-hop', name: 'Bunny Hop', type: 'back', req: glade('a1') },
  { id: 'lily-pad', name: 'Lily Pad', type: 'back', req: glade('b1') },
  { id: 'firefly-meadow', name: 'Firefly Meadow', type: 'cloth', req: glade('a2') },
  { id: 'trinket-quilt', name: 'Trinket Quilt', type: 'cloth', req: glade('b2') },
  { id: 'moonlight-waltz', name: 'Moonlight Waltz', type: 'music', req: glade('g2') },
  { id: 'mistveil', name: 'Mistveil', type: 'cloth', req: glade('g3') },
  { id: 'dawn-bloom', name: 'Dawn Bloom', type: 'back', req: glade('g3') },
  { id: 'sunrise-garden', name: 'Sunrise Garden', type: 'cloth', req: { kind: 'gladeStars', stars: 21 } },
];

export const TYPE_LABEL: Record<UnlockType, string> = { back: 'Card back', cloth: 'Tablecloth', music: 'Music', mode: 'Mode' };

export function requirementText(req: Requirement): string {
  if (req.kind === 'default') return 'Yours from the start';
  if (req.kind === 'stars') return req.stars === 15 ? 'Earn all 15 stars' : `Earn ${req.stars} stars`;
  if (req.kind === 'gladeStars') return `Earn all ${req.stars} Moonlit Glade stars`;
  if (req.kind === 'glade') {
    const s = GLADE_STOPS.find((x) => x.id === req.stop)!;
    return `Win ${s.place} (${BOTS[s.featured].name})`;
  }
  return `Win Stop ${req.stop} (${BOTS[STOPS[req.stop - 1].featured].name})`;
}

const MOONLIT_FINALE = 10;

export type CharmId =
  | 'first-bloom' | 'wild-at-heart' | 'not-today' | 'clean-sweep' | 'perfect-teatime'
  | 'rainbow' | 'steady-hands' | 'comeback' | 'garden-champion' | 'bouquet'
  | 'fog-walker' | 'dawnbringer' | 'both-paths' | 'thornproof' | 'moonlit-mastery';

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
  { id: 'fog-walker', name: 'Fog Walker', text: 'Win any Moonlit Glade stop with 3 stars while fogged' },
  { id: 'dawnbringer', name: 'Dawnbringer', text: 'Lift the fog' },
  { id: 'both-paths', name: 'Both Paths', text: 'Win both stops on Lantern Lane and both on Lily Pond' },
  { id: 'thornproof', name: 'Thornproof', text: 'Beat Lunaria without being skipped during the match' },
  // Built from the number, like every stage label.
  { id: 'moonlit-mastery', name: 'Moonlit Mastery', text: `Complete Moonlit Phase ${MOONLIT_FINALE}` },
];

/** The Charms that belong to the Moonlit Glade, shown under their own heading. */
export const GLADE_CHARMS: readonly CharmId[] = ['fog-walker', 'dawnbringer', 'both-paths', 'thornproof', 'moonlit-mastery'];
