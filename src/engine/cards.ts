import { SUITS, type Card } from './types.ts';

export function createDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of SUITS) {
      for (let num = 1; num <= 12; num++) deck.push({ id: id++, kind: 'num', num, suit });
    }
  }
  for (let i = 0; i < 8; i++) deck.push({ id: id++, kind: 'wild' });
  for (let i = 0; i < 4; i++) deck.push({ id: id++, kind: 'skip' });
  return deck;
}

export function cardPoints(card: Card): number {
  if (card.kind === 'wild') return 25;
  if (card.kind === 'skip') return 15;
  return card.num >= 10 ? 10 : 5;
}

export function handPoints(hand: readonly Card[]): number {
  let total = 0;
  for (const c of hand) total += cardPoints(c);
  return total;
}

const SUIT_NAME = { rose: 'Rose', moss: 'Moss', moonstone: 'Moonstone', honey: 'Honey' } as const;

export function cardLabel(card: Card): string {
  if (card.kind === 'wild') return 'Wild';
  if (card.kind === 'skip') return 'Skip';
  return `${SUIT_NAME[card.suit]} ${card.num}`;
}
