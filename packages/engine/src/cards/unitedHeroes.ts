import type { Effect } from '../effects'
import type { Faction } from '../ids'
import type { Spec } from './types'

/**
 * STAR REALMS: UNITED -- the Heroes pack.
 *
 * United's Heroes differ from Crisis' in one way that matters: they have a
 * PRIMARY ability as well as a scrap ability, and per the publisher FAQ, "when
 * a Hero from the United expansion is acquired, you do what is listed as their
 * primary ability. You only use the primary ability at that moment, so you do
 * not get to use it every turn."
 *
 * So the primary fires once, on acquisition, and the Hero then sits in play
 * holding its scrap ability for whichever turn you want it. Every one of them
 * grants a faction ally on both halves, which is what makes a Hero worth a slot:
 * it can switch a faction on in the turn you buy it AND again later.
 *
 * Contents verified against the publisher's Card Gallery spreadsheet: eight
 * cards in thirteen copies, plus a rules card we do not model.
 */

const combat = (n: number): Effect => ({ k: 'GAIN_COMBAT', n })
const authority = (n: number): Effect => ({ k: 'GAIN_AUTHORITY', n })
const draw = (n: number): Effect => ({ k: 'DRAW', n })
const oppDiscard = (n: number): Effect => ({ k: 'OPPONENT_DISCARD', n })
const ally = (faction: Faction): Effect => ({ k: 'GAIN_ALLY', faction })
const scrapHandDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand', 'discard'], min, max })
const scrapTradeRow = (min: 0 | 1, max = 1): Effect => ({ k: 'SCRAP_TRADE_ROW', min, max })

const ALLY_TEXT: Record<Faction, string> = {
  blob: 'Gain a Blob Ally.',
  machine_cult: 'Gain a Machine Cult Ally.',
  star_empire: 'Gain a Star Empire Ally.',
  trade_federation: 'Gain a Trade Federation Ally.',
  unaligned: '',
}

const hero = (
  name: string, cost: number, copies: number, faction: Faction,
  onAcquire: readonly Effect[], onAcquireText: string,
  onScrap: readonly Effect[], onScrapText: string,
): Spec => ({
  name, faction: 'unaligned', cost, type: 'hero',
  defense: null, copies, role: 'trade_deck',
  primary: [ally(faction), ...onAcquire],
  scrap: [ally(faction), ...onScrap],
  text: {
    primary: `${ALLY_TEXT[faction]} ${onAcquireText}`.trim(),
    ally: '',
    scrap: `${ALLY_TEXT[faction]} ${onScrapText}`.trim(),
  },
})

export const UNITED_HEROES: Record<string, Spec> = {
  'ceo-shaner': hero('CEO Shaner', 5, 1, 'trade_federation',
    [{ k: 'ACQUIRE_FREE', filter: 'any', maxCost: 3, dest: 'deck_top', min: 0 }],
    'You may acquire a ship or base of cost three or less for free and put it on top of your deck.',
    [draw(1)], 'Draw a card.'),
  'chairman-haygan': hero('Chairman Haygan', 3, 2, 'trade_federation',
    [authority(4)], '{authority:4}',
    [authority(4)], '{authority:4}'),
  'chancellor-hartman': hero('Chancellor Hartman', 4, 2, 'machine_cult',
    [scrapHandDiscard(0, 1)], 'You may scrap a card in your hand or discard pile.',
    [scrapHandDiscard(0, 1)], 'You may scrap a card in your hand or discard pile.'),
  'commander-klik': hero('Commander Klik', 4, 2, 'star_empire',
    [{ k: 'DISCARD_THEN_DRAW', max: 1 }], 'You may discard a card. If you do, draw a card.',
    [{ k: 'DISCARD_THEN_DRAW', max: 1 }], 'You may discard a card. If you do, draw a card.'),
  'commodore-zhang': hero('Commodore Zhang', 5, 1, 'star_empire',
    [combat(4), oppDiscard(1)], '{combat:4} Target opponent discards a card.',
    [draw(1)], 'Draw a card.'),
  'confessor-morris': hero('Confessor Morris', 5, 1, 'machine_cult',
    [scrapHandDiscard(0, 2)], 'You may scrap up to two cards in your hand and/or discard pile.',
    [draw(1)], 'Draw a card.'),
  'hive-lord': hero('Hive Lord', 5, 1, 'blob',
    // "Any number" is the whole row, so the maximum is the row's size.
    [combat(5), scrapTradeRow(0, 5)],
    '{combat:5} Scrap any number of cards currently in the trade row.',
    [draw(1)], 'Draw a card.'),
  screecher: hero('Screecher', 3, 2, 'blob',
    [combat(2), scrapTradeRow(0)],
    '{combat:2} You may scrap a card in the trade row.',
    [combat(2), scrapTradeRow(0)],
    '{combat:2} You may scrap a card in the trade row.'),
}
