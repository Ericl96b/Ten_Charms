// Overall and per-bot stats.
import { BOTS } from '../../content.ts';
import { BOT_IDS, GLADE_BOT_IDS } from '../../bots/profiles.ts';
import { canSeeCrossroads as crossroadsOpen, canSeeGlade as gladeOpen } from '../../meta/devmode.ts';
import { app } from '../app.ts';
import { icon, portraitEl } from '../art.ts';
import { h } from '../dom.ts';
import type { StatBotId } from '../../meta/save.ts';
import { bottomNav } from './journey.ts';

/** The day a climb ended, as the phone would write it. */
function day(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The Tower's records (TOWER_SPEC.md §11.2), shown once the Crossroads is open. */
function towerSection(): HTMLElement {
  const t = app.save.tower;
  const stat = (label: string, value: string | number) => h('div.stat', { 'data-stat': label }, h('b', null, value), h('small', null, label));
  const body = t.totals.climbs === 0
    ? [h('p.sheet-text', { 'data-testid': 'no-climbs' }, 'No climbs yet')]
    : [
      h('div.stat-grid', null,
        stat('Best floor', t.best),
        stat('Climbs', t.totals.climbs),
        stat('Floors cleared', t.totals.floorsCleared),
        stat('Guardians beaten', t.totals.guardiansBeaten),
      ),
      h('h3.sec.small', null, 'Recent climbs'),
      h('div.recent', { 'data-testid': 'recent-climbs' }, t.history.slice(0, 10).map((c) => h('div.recent-row', { 'data-new-best': c.newBest ? 'true' : 'false' },
        h('b', { html: `<span>Floor ${c.floor}</span>${c.newBest ? icon('flag') : ''}` }),
        h('span', null, day(c.endedAt)),
      ))),
    ];
  return h('section.tower-stats', { 'data-testid': 'tower-stats' }, h('h2.sec', null, 'The Tower'), ...body);
}

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
      h('div.bot-stats', null, ([...BOT_IDS, ...(gladeOpen(app.save) ? GLADE_BOT_IDS : [])] as StatBotId[]).map((id) => h('div.bot-stat', { 'data-bot': id },
        portraitEl(id, 'small'),
        h('b', null, BOTS[id].name),
        h('span', null, `${s.perBot[id].wins} wins · ${s.perBot[id].losses} losses`),
      ))),
      crossroadsOpen(app.save) ? towerSection() : null,
    ),
    bottomNav('stats'),
  );
}
