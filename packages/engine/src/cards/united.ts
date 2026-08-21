import type { Effect } from '../effects'
import type { Spec } from './types'

/**
 * STAR REALMS: UNITED -- the Assault and Command packs.
 *
 * United's idea is the DUAL-FACTION card: it belongs to two factions at once,
 * counts as both for every ally condition (its own and other cards'), and may
 * carry a separate ally ability for each.
 *
 * The printed wording distinguishes two shapes, and the difference is real:
 *
 *   - "{Star Empire Ally}: ..." plus "{Trade Federation Ally}: ..." -- two
 *     abilities, each pinned to one faction, and both usable in the same turn.
 *   - "{Alliance Ally (Star Empire or Trade Federation)}: ..." -- ONE ability
 *     that either faction switches on. That is the unpinned slot, which is also
 *     what an ordinary single-faction card uses.
 *
 * The pack names are the faction pairs: Alliance = Star Empire + Trade
 * Federation, Union = Blob + Star Empire, Unity = Blob + Machine Cult,
 * Coalition = Machine Cult + Trade Federation.
 *
 * Contents verified against the publisher's Card Gallery spreadsheet: eight
 * cards in twelve copies per pack, plus a rules card we do not model.
 */

const trade = (n: number): Effect => ({ k: 'GAIN_TRADE', n })
const combat = (n: number): Effect => ({ k: 'GAIN_COMBAT', n })
const authority = (n: number): Effect => ({ k: 'GAIN_AUTHORITY', n })
const draw = (n: number): Effect => ({ k: 'DRAW', n })
const oppDiscard = (n: number): Effect => ({ k: 'OPPONENT_DISCARD', n })
const scrapTradeRow = (min: 0 | 1, max = 1): Effect => ({ k: 'SCRAP_TRADE_ROW', min, max })
const scrapHandDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand', 'discard'], min, max })
const chooseOne = (...branches: { label: string; then: Effect[] }[]): Effect =>
  ({ k: 'CHOOSE_ONE', branches })

export const UNITED_ASSAULT: Record<string, Spec> = {
  'alliance-transport': {
    name: 'Alliance Transport',
    faction: 'star_empire', faction2: 'trade_federation',
    cost: 2, type: 'ship', defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(2)],
    ally: [oppDiscard(1)], allyFaction: 'star_empire',
    ally2: [authority(4)], ally2Faction: 'trade_federation',
    text: {
      primary: '{trade:2}',
      ally: 'Target opponent discards a card.',
      ally2: '{authority:4}',
      scrap: '',
    },
  },
  'blob-bot': {
    name: 'Blob Bot',
    faction: 'blob', faction2: 'machine_cult',
    cost: 3, type: 'ship', defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(5)],
    ally: [trade(2)], allyFaction: 'blob',
    ally2: [scrapHandDiscard(1, 1)], ally2Faction: 'machine_cult',
    text: {
      primary: '{combat:5}',
      ally: '{trade:2}',
      ally2: 'Scrap a card in your hand or discard pile.',
      scrap: '',
    },
  },
  'coalition-messenger': {
    // One ability, either faction: the unpinned slot.
    name: 'Coalition Messenger',
    faction: 'machine_cult', faction2: 'trade_federation',
    cost: 3, type: 'ship', defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(2)],
    ally: [{ k: 'TOPDECK_FROM_DISCARD', filter: 'any', maxCost: 5, min: 1, max: 1 }],
    text: {
      primary: '{trade:2}',
      ally: 'Choose a card of cost five or less in your discard pile and put it ' +
        'on top of your deck.',
      scrap: '',
    },
  },
  'embassy-base': {
    name: 'Embassy Base',
    faction: 'star_empire', faction2: 'trade_federation',
    cost: 8, type: 'base', defense: 6, copies: 1, role: 'trade_deck',
    primary: [draw(2), { k: 'SELF_DISCARD', n: 1 }],
    text: { primary: 'Draw two cards, then discard a card.', ally: '', scrap: '' },
  },
  'exchange-point': {
    name: 'Exchange Point',
    faction: 'blob', faction2: 'machine_cult',
    cost: 6, type: 'base', defense: 7, copies: 1, role: 'trade_deck',
    primary: [combat(2)],
    ally: [{ k: 'SCRAP_FROM_ZONES', zones: ['hand', 'discard', 'tradeRow'], min: 1, max: 1 }],
    text: {
      primary: '{combat:2}',
      ally: 'Scrap a card in your hand, your discard pile, or the trade row.',
      scrap: '',
    },
  },
  'lookout-post': {
    name: 'Lookout Post',
    faction: 'machine_cult', faction2: 'trade_federation',
    cost: 7, type: 'outpost', defense: 6, copies: 1, role: 'trade_deck',
    primary: [draw(1)],
    text: { primary: 'Draw a card.', ally: '', scrap: '' },
  },
  'trade-star': {
    name: 'Trade Star',
    faction: 'blob', faction2: 'star_empire',
    cost: 1, type: 'ship', defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(2)], scrap: [combat(2)],
    text: { primary: '{trade:2}', ally: '', scrap: '{combat:2}' },
  },
  'union-stronghold': {
    name: 'Union Stronghold',
    faction: 'blob', faction2: 'star_empire',
    cost: 5, type: 'base', defense: 5, copies: 1, role: 'trade_deck',
    primary: [combat(3)],
    ally: [scrapTradeRow(1)], allyFaction: 'blob',
    ally2: [oppDiscard(1)], ally2Faction: 'star_empire',
    text: {
      primary: '{combat:3}',
      ally: 'Scrap a card in the trade row.',
      ally2: 'Target opponent discards a card.',
      scrap: '',
    },
  },
}

export const UNITED_COMMAND: Record<string, Spec> = {
  'alliance-frigate': {
    name: 'Alliance Frigate',
    faction: 'star_empire', faction2: 'trade_federation',
    cost: 3, type: 'ship', defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(4)],
    ally: [combat(3)], allyFaction: 'star_empire',
    ally2: [authority(5)], ally2Faction: 'trade_federation',
    text: {
      primary: '{combat:4}', ally: '{combat:3}', ally2: '{authority:5}', scrap: '',
    },
  },
  'alliance-landing': {
    name: 'Alliance Landing',
    faction: 'star_empire', faction2: 'trade_federation',
    cost: 5, type: 'outpost', defense: 5, copies: 1, role: 'trade_deck',
    primary: [trade(2)], ally: [combat(2)],
    text: { primary: '{trade:2}', ally: '{combat:2}', scrap: '' },
  },
  'assault-pod': {
    name: 'Assault Pod',
    faction: 'blob', faction2: 'star_empire',
    cost: 2, type: 'ship', defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(3)], ally: [draw(1)],
    text: { primary: '{combat:3}', ally: 'Draw a card.', scrap: '' },
  },
  'coalition-fortress': {
    name: 'Coalition Fortress',
    faction: 'trade_federation', faction2: 'machine_cult',
    cost: 6, type: 'outpost', defense: 6, copies: 1, role: 'trade_deck',
    primary: [trade(2)],
    ally: [chooseOne(
      { label: '{combat:2}', then: [combat(2)] },
      { label: '{authority:3}', then: [authority(3)] },
    )],
    text: { primary: '{trade:2}', ally: '{combat:2} OR {authority:3}', scrap: '' },
  },
  'coalition-freighter': {
    name: 'Coalition Freighter',
    faction: 'trade_federation', faction2: 'machine_cult',
    cost: 4, type: 'ship', defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(3)],
    ally: [{
      k: 'REDIRECT_NEXT_ACQUIRED',
      redirect: { filter: 'ship', dest: 'deck_top', optional: true },
    }],
    allyFaction: 'trade_federation',
    ally2: [scrapHandDiscard(1, 1)], ally2Faction: 'machine_cult',
    text: {
      primary: '{trade:3}',
      ally: 'Put the next ship you acquire this turn on top of your deck.',
      ally2: 'Scrap a card in your hand or discard pile.',
      scrap: '',
    },
  },
  'union-cluster': {
    name: 'Union Cluster',
    faction: 'blob', faction2: 'star_empire',
    cost: 8, type: 'base', defense: 8, copies: 1, role: 'trade_deck',
    primary: [combat(4)], ally: [draw(1)],
    text: { primary: '{combat:4}', ally: 'Draw a card.', scrap: '' },
  },
  'unity-fighter': {
    name: 'Unity Fighter',
    faction: 'blob', faction2: 'machine_cult',
    cost: 1, type: 'ship', defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(3), scrapTradeRow(0)],
    scrap: [scrapHandDiscard(0, 1)],
    text: {
      primary: '{combat:3} You may scrap a card in the trade row.',
      ally: '',
      scrap: 'You may scrap a card in your hand or discard pile.',
    },
  },
  'unity-station': {
    name: 'Unity Station',
    faction: 'blob', faction2: 'machine_cult',
    cost: 7, type: 'outpost', defense: 6, copies: 1, role: 'trade_deck',
    primary: [scrapHandDiscard(1, 1), scrapTradeRow(0)],
    ally: [combat(4)],
    text: {
      primary: 'Scrap a card in your hand or discard pile. You may scrap a card ' +
        'in the trade row.',
      ally: '{combat:4}', scrap: '',
    },
  },
}
