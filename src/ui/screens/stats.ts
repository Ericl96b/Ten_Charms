// Overall and per-bot stats.
import { BOTS } from '../../content.ts';
import { BOT_IDS } from '../../bots/profiles.ts';
import { app } from '../app.ts';
import { portraitEl } from '../art.ts';
import { h } from '../dom.ts';
import type { StatBotId } from '../../meta/save.ts';
import { bottomNav } from './journey.ts';

export function statsScreen(): HTMLElement {
  const s = app.save.stats;
  const rate = s.played > 0 ? Math.round((s.won / s.played) * 100) : 0;
  const stat = (label: string, value: string | number) => h('div.stat', { 'data-stat': label }, h('b', null, value), h('small', null, label));
  return h('div.screen.page-screen', { 'data-screen': 'stats' },
    h('div.page-top', null, h('h1.game-title', null, 'Stats')),
    h('div.page-scroll', null,
      h('div.stat-grid', { 'data-testid': 'stat-grid' },
        stat('Matches played', s.played),
        stat('Matches won', s.won),
        stat('Win rate', `${rate}%`),
        stat('Win streak', s.streak),
        stat('Best streak', s.bestStreak),
        stat('Phases completed', s.phases),
        stat('Fewest rounds to win', s.fewestRounds ?? '–'),
        stat('Times went out', s.wentOut),
        stat('Skips played', s.skipsPlayed),
        stat('Times skipped', s.timesSkipped),
        stat('Wilds used', s.wildsUsed),
      ),
      h('h2.sec', null, 'Against each opponent'),
      h('div.bot-stats', null, (BOT_IDS as readonly StatBotId[]).map((id) => h('div.bot-stat', { 'data-bot': id },
        portraitEl(id, 'small'),
        h('b', null, BOTS[id].name),
        h('span', null, `${s.perBot[id].wins} wins · ${s.perBot[id].losses} losses`),
      ))),
    ),
    bottomNav('stats'),
  );
}
