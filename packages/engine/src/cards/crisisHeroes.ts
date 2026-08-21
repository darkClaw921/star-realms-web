import type { Effect } from '../effects'
import type { Faction } from '../ids'
import type { Spec } from './types'

/**
 * CRISIS: HEROES -- twelve cards, eight distinct.
 *
 * A Hero is a card type, not a ship or a base. Per the publisher's own contents
 * page: "When you acquire a Hero, it goes directly into play instead of into
 * your discard pile. Then the Hero awaits your command." So:
 *
 *   - buying one puts it in the play area, skipping the discard pile;
 *   - it cannot be attacked or destroyed, because it is not a base;
 *   - it stays across turns until you scrap it;
 *   - its whole ability sits in the SCRAP slot, which is what spends it.
 *
 * Every Hero grants an ally of one faction. "Gain a Blob Ally" unlocks the
 * faction outright rather than pretending to be a second Blob card -- that is
 * what lets a single Hero switch on abilities that normally need two cards.
 *
 * Heroes are Unaligned, so they never feed a faction count themselves.
 */

const combat = (n: number): Effect => ({ k: 'GAIN_COMBAT', n })
const authority = (n: number): Effect => ({ k: 'GAIN_AUTHORITY', n })
const draw = (n: number): Effect => ({ k: 'DRAW', n })
const oppDiscard = (n: number): Effect => ({ k: 'OPPONENT_DISCARD', n })
const ally = (faction: Faction): Effect => ({ k: 'GAIN_ALLY', faction })
const scrapHandDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand', 'discard'], min, max })
const scrapHand = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand'], min, max })

const ALLY_TEXT: Record<Faction, string> = {
  blob: 'Gain a Blob Ally (until end of turn, you may use all of your Blob ally abilities).',
  machine_cult: 'Gain a Machine Cult Ally (until end of turn, you may use all of your ' +
    'Machine Cult ally abilities).',
  star_empire: 'Gain a Star Empire Ally (until end of turn, you may use all of your ' +
    'Star Empire ally abilities).',
  trade_federation: 'Gain a Trade Federation Ally (until end of turn, you may use all of ' +
    'your Trade Federation ally abilities).',
  unaligned: '',
}

/** Every Hero has the same shape: no primary, no ally, one scrap ability. */
const hero = (
  name: string, cost: number, copies: number, faction: Faction,
  extra: readonly Effect[], extraText: string,
): Spec => ({
  name, faction: 'unaligned', cost, type: 'hero',
  defense: null, copies, role: 'trade_deck',
  primary: [],
  scrap: [ally(faction), ...extra],
  text: {
    primary: '',
    ally: '',
    scrap: [ALLY_TEXT[faction], extraText].filter(Boolean).join(' '),
  },
})

export const CRISIS_HEROES: Record<string, Spec> = {
  'admiral-rasmusson': hero('Admiral Rasmusson', 2, 1, 'star_empire', [draw(1)], 'Draw a card.'),
  'blob-overlord': hero('Blob Overlord', 2, 1, 'blob', [combat(4)], '{combat:4}'),
  'ceo-torres': hero('CEO Torres', 2, 1, 'trade_federation', [authority(7)], '{authority:7}'),
  'cunning-captain': hero('Cunning Captain', 1, 2, 'star_empire',
    [oppDiscard(1)], 'Target opponent discards a card.'),
  'high-priest-lyle': hero('High Priest Lyle', 2, 1, 'machine_cult',
    [scrapHandDiscard(0, 1)], 'You may scrap a card from your hand or discard pile.'),
  'ram-pilot': hero('Ram Pilot', 1, 2, 'blob', [combat(2)], '{combat:2}'),
  'special-ops-director': hero('Special Ops Director', 1, 2, 'trade_federation',
    [authority(4)], '{authority:4}'),
  'war-elder': hero('War Elder', 1, 2, 'machine_cult',
    [scrapHand(0, 1)], 'You may scrap a card from your hand.'),
}
