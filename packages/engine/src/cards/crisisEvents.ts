import type { Effect } from '../effects'
import type { Spec } from './types'

/**
 * CRISIS: EVENTS -- twelve cards, eight distinct.
 *
 * An Event never sits in the trade row. Per the publisher's contents page:
 * "Each Event card has a potentially game changing effect as soon as the card
 * enters the Trade Row. After it has its effect, it immediately gets replaced
 * with the next card in the Trade Deck."
 *
 * So an event is never bought, never owned and never in anyone's deck: it is
 * turned up, resolved, scrapped, and the slot is filled from the next card down
 * -- which may itself be an event.
 *
 * Every event is worded "each player ...", which is why they are written with
 * EACH_PLAYER rather than as a pile of two-sided special cases. The effects are
 * stored in `primary`, and the refill reads them there; there is no other slot
 * an event could use.
 */

const trade = (n: number): Effect => ({ k: 'GAIN_TRADE', n })
const authority = (n: number): Effect => ({ k: 'GAIN_AUTHORITY', n })
const draw = (n: number): Effect => ({ k: 'DRAW', n })
const lose = (n: number): Effect => ({ k: 'LOSE_AUTHORITY', n })
const each = (...then: Effect[]): Effect => ({ k: 'EACH_PLAYER', then })

/** Events have no faction, no cost, no defense and only the one slot. */
const event = (name: string, copies: number, primary: Effect[], text: string): Spec => ({
  name, faction: 'unaligned', cost: 0, type: 'event',
  defense: null, copies, role: 'trade_deck',
  primary,
  text: { primary: text, ally: '', scrap: '' },
})

export const CRISIS_EVENTS: Record<string, Spec> = {
  'black-hole': event('Black Hole', 1,
    [each({ k: 'DISCARD_OR_LOSE', max: 2, per: 4 })],
    'Each player may discard up to two cards. For each card less than two that a ' +
    'player discards, that player loses {authority:4}'),
  bombardment: event('Bombardment', 1,
    [each({ k: 'DESTROY_OWN_BASE_OR_LOSE', n: 6 })],
    'Each player either destroys a base they control or loses {authority:6}'),
  comet: event('Comet', 2,
    [each({ k: 'SCRAP_FROM_ZONES', zones: ['hand', 'discard'], min: 0, max: 2 })],
    'Each player may scrap up to two cards in their hand or discard pile.'),
  'galactic-summit': event('Galactic Summit', 1,
    [each(authority(7))],
    'Each player gains {authority:7}'),
  quasar: event('Quasar', 2,
    [each(draw(2))],
    'Each player draws two cards.'),
  supernova: event('Supernova', 1,
    [each(lose(5)), { k: 'SCRAP_WHOLE_TRADE_ROW' }],
    'Each player loses {authority:5} Scrap all cards in the trade row.'),
  'trade-mission': event('Trade Mission', 2,
    // Asymmetric: the active player gets the tempo, everyone else gets cards.
    // EACH_PLAYER would be wrong here, so it is written out.
    [
      trade(4),
      { k: 'REDIRECT_NEXT_ACQUIRED', redirect: { filter: 'ship', dest: 'deck_top', optional: true } },
      { k: 'OPPONENT_DRAW', n: 2 },
    ],
    'The player currently taking their turn gains {trade:4} and may put the next ship ' +
    'they acquire this turn on top of their deck. Each other player draws two cards.'),
  'warp-jump': event('Warp Jump', 2,
    [each({ k: 'DRAW_THEN_TOPDECK', draw: 3, back: 2 })],
    'Each player draws three cards, then puts two of those cards back on top of ' +
    'their deck in any order.'),
}
