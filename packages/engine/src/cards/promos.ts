import type { Effect } from '../effects'
import type { Spec } from './types'

/**
 * STELLAR ALLIES AND THE PROMO PACKS.
 *
 * Three small sets that add no new card type but three new rules shapes:
 *
 *   - Needle Lancer copies an ally ability used earlier this turn, which is why
 *     the engine remembers which ones were used rather than only that they were.
 *   - Mercenary Garrison carries FOUR ally abilities, one per faction. It is the
 *     card that fixes the ceiling at four ally slots.
 *   - The promo bases ask "if you played a base this turn (including this one)",
 *     a condition the base set never needed.
 *
 * Stellar Allies completes United's faction pairs: Alignment (Machine Cult +
 * Star Empire) and Pact (Blob + Trade Federation) are the two United left out.
 *
 * Contents verified against the publisher's Card Gallery spreadsheet. Each pack
 * ships one rules or advertisement card that is not a card you can draw.
 */

const trade = (n: number): Effect => ({ k: 'GAIN_TRADE', n })
const combat = (n: number): Effect => ({ k: 'GAIN_COMBAT', n })
const authority = (n: number): Effect => ({ k: 'GAIN_AUTHORITY', n })
const draw = (n: number): Effect => ({ k: 'DRAW', n })
const oppDiscard = (n: number): Effect => ({ k: 'OPPONENT_DISCARD', n })
const destroyBase = (min: 0 | 1): Effect => ({ k: 'DESTROY_BASE', min, max: 1 })
const scrapTradeRow = (min: 0 | 1, max = 1): Effect => ({ k: 'SCRAP_TRADE_ROW', min, max })
const scrapHandDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand', 'discard'], min, max })
const scrapDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['discard'], min, max })
const chooseOne = (...branches: { label: string; then: Effect[] }[]): Effect =>
  ({ k: 'CHOOSE_ONE', branches })
const drawThenDiscard = (): Effect =>
  ({ k: 'SEQ', effects: [draw(1), { k: 'SELF_DISCARD', n: 1 }] })
/** "If you played a base this turn (including this one), ..." */
const ifBasePlayed = (...then: Effect[]): Effect =>
  ({ k: 'IF', cond: { c: 'BASE_PLAYED_THIS_TURN' }, then })

const IF_BASE = 'If you played a base this turn (including this one), '

export const STELLAR_ALLIES: Record<string, Spec> = {
  'alignment-bot': {
    name: 'Alignment Bot',
    faction: 'machine_cult', faction2: 'star_empire',
    cost: 1, type: 'ship', defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(2)],
    scrap: [chooseOne(
      { label: 'Scrap a card from your discard pile', then: [scrapDiscard(1, 1)] },
      {
        label: '{combat:2} Target opponent discards a card',
        then: [combat(2), oppDiscard(1)],
      },
    )],
    text: {
      primary: '{trade:2}', ally: '',
      scrap: 'Scrap a card from your discard pile OR {combat:2} and target opponent ' +
        'discards a card.',
    },
  },
  'missile-silo': {
    name: 'Missile Silo',
    faction: 'machine_cult', faction2: 'star_empire',
    cost: 6, type: 'outpost', defense: 5, copies: 1, role: 'trade_deck',
    primary: [combat(3)],
    ally: [oppDiscard(1)], allyFaction: 'star_empire',
    ally2: [destroyBase(1)], ally2Faction: 'machine_cult',
    text: {
      primary: '{combat:3}',
      ally: 'Target opponent discards a card.',
      ally2: 'Destroy target base.',
      scrap: '',
    },
  },
  'needle-lancer': {
    name: 'Needle Lancer',
    faction: 'machine_cult', faction2: 'star_empire',
    cost: 3, type: 'ship', defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(5)],
    ally: [{ k: 'COPY_USED_ALLY' }],
    text: {
      primary: '{combat:5}',
      ally: "Copy an ally ability that you've already used this turn.",
      scrap: '',
    },
  },
  'pact-pod': {
    name: 'Pact Pod',
    faction: 'blob', faction2: 'trade_federation',
    cost: 2, type: 'ship', defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(2)],
    ally: [combat(5)], allyFaction: 'blob',
    ally2: [trade(1)], ally2Faction: 'trade_federation',
    text: { primary: '{trade:2}', ally: '{combat:5}', ally2: '{trade:1}', scrap: '' },
  },
  'pact-warship': {
    name: 'Pact Warship',
    faction: 'blob', faction2: 'trade_federation',
    cost: 4, type: 'ship', defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(5)],
    ally: [destroyBase(1)], allyFaction: 'blob',
    ally2: [authority(5)], ally2Faction: 'trade_federation',
    text: {
      primary: '{combat:5}', ally: 'Destroy target base.', ally2: '{authority:5}', scrap: '',
    },
  },
  'summit-site': {
    name: 'Summit Site',
    faction: 'blob', faction2: 'trade_federation',
    cost: 8, type: 'base', defense: 6, copies: 1, role: 'trade_deck',
    primary: [draw(2)],
    text: { primary: 'Draw two cards.', ally: '', scrap: '' },
  },
  'the-citadel': {
    name: 'The Citadel',
    faction: 'machine_cult', faction2: 'star_empire',
    cost: 7, type: 'outpost', defense: 7, copies: 1, role: 'trade_deck',
    primary: [oppDiscard(1), scrapHandDiscard(0, 1)],
    text: {
      primary: 'Target opponent discards a card. You may scrap a card in your hand ' +
        'or discard pile.',
      ally: '', scrap: '',
    },
  },
  'trade-hive': {
    name: 'Trade Hive',
    faction: 'blob', faction2: 'trade_federation',
    cost: 5, type: 'base', defense: 4, copies: 1, role: 'trade_deck',
    primary: [trade(2)], ally: [draw(1)],
    text: { primary: '{trade:2}', ally: 'Draw a card.', scrap: '' },
  },
}

export const PROMO_PACK_1: Record<string, Spec> = {
  'battle-barge': {
    name: 'Battle Barge', faction: 'star_empire', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(5), oppDiscard(1), {
      k: 'IF',
      cond: { c: 'BASES_IN_PLAY_AT_LEAST', n: 2 },
      then: [combat(3), { k: 'RETURN_BASE_TO_HAND', min: 0 }],
    }],
    text: {
      primary: '{combat:5} Target opponent discards a card. If you have two or more ' +
        "bases in play, gain an additional {combat:3} and you may return target base " +
        "in play to its owner's hand.",
      ally: '', scrap: '',
    },
  },
  'battle-screecher': {
    name: 'Battle Screecher', faction: 'blob', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(5), scrapTradeRow(0, 5)], ally: [trade(2)],
    text: {
      primary: '{combat:5} You may scrap up to five cards currently in the trade row.',
      ally: '{trade:2}', scrap: '',
    },
  },
  'breeding-site': {
    name: 'Breeding Site', faction: 'blob', cost: 4, type: 'base',
    defense: 7, copies: 1, role: 'trade_deck',
    primary: [ifBasePlayed(combat(5))],
    text: { primary: `${IF_BASE}gain {combat:5}`, ally: '', scrap: '' },
  },
  'fortress-oblivion': {
    name: 'Fortress Oblivion', faction: 'machine_cult', cost: 3, type: 'outpost',
    defense: 4, copies: 2, role: 'trade_deck',
    primary: [ifBasePlayed(scrapHandDiscard(0, 1))],
    text: {
      primary: `${IF_BASE}you may scrap a card in your hand or discard pile.`,
      ally: '', scrap: '',
    },
  },
  megahauler: {
    name: 'Megahauler', faction: 'trade_federation', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [authority(5), {
      k: 'ACQUIRE_FREE', filter: 'ship', maxCost: null, dest: 'deck_top', min: 0,
    }],
    ally: [draw(1)],
    text: {
      primary: '{authority:5} You may acquire any ship without paying its cost and put ' +
        'it on top of your deck.',
      ally: 'Draw a card.', scrap: '',
    },
  },
  'mercenary-garrison': {
    // The card that fixes the ally-slot ceiling at four: one ability per
    // faction, and it is Unaligned, so every slot has to be pinned explicitly.
    name: 'Mercenary Garrison', faction: 'unaligned', cost: 4, type: 'outpost',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [],
    ally: [combat(2)], allyFaction: 'star_empire',
    ally2: [scrapHandDiscard(1, 1)], ally2Faction: 'machine_cult',
    ally3: [authority(3)], ally3Faction: 'trade_federation',
    ally4: [scrapTradeRow(0, 2)], ally4Faction: 'blob',
    text: {
      primary: '',
      ally: '{combat:2}',
      ally2: 'Scrap a card from your hand or discard pile.',
      ally3: '{authority:3}',
      ally4: 'Scrap up to two cards currently in the trade row.',
      scrap: '',
    },
  },
  'security-craft': {
    name: 'Security Craft', faction: 'trade_federation', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(4), authority(3)], ally: [trade(3)],
    text: { primary: '{combat:4} {authority:3}', ally: '{trade:3}', scrap: '' },
  },
  'starbase-omega': {
    name: 'Starbase Omega', faction: 'star_empire', cost: 4, type: 'base',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [ifBasePlayed(draw(1))],
    text: { primary: `${IF_BASE}draw a card.`, ally: '', scrap: '' },
  },
  starmarket: {
    name: 'Starmarket', faction: 'trade_federation', cost: 4, type: 'base',
    defense: 6, copies: 2, role: 'trade_deck',
    primary: [ifBasePlayed(chooseOne(
      { label: '{authority:5}', then: [authority(5)] },
      { label: '{trade:3}', then: [trade(3)] },
    ))],
    text: { primary: `${IF_BASE}gain {authority:5} OR {trade:3}`, ally: '', scrap: '' },
  },
  'the-ark': {
    name: 'The Ark', faction: 'machine_cult', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(5), { k: 'SCRAP_THEN_DRAW', zones: ['hand', 'discard'], max: 2 }],
    scrap: [destroyBase(1)],
    text: {
      primary: '{combat:5} You may scrap up to two cards in your hand and/or discard ' +
        'pile. For each card scrapped this way, draw a card.',
      ally: '', scrap: 'Destroy target base.',
    },
  },
}

export const YEAR_TWO_PROMOS: Record<string, Spec> = {
  'bounty-hunter': {
    name: 'Bounty Hunter', faction: 'trade_federation', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(7)], ally: [authority(5)],
    text: { primary: '{combat:7}', ally: '{authority:5}', scrap: '' },
  },
  'cargo-mech': {
    name: 'Cargo Mech', faction: 'machine_cult', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [trade(4), scrapHandDiscard(0, 1)], ally: [destroyBase(1)],
    text: {
      primary: '{trade:4} You may scrap a card in your hand or discard pile.',
      ally: 'Destroy target base.', scrap: '',
    },
  },
  'imperial-smuggler': {
    name: 'Imperial Smuggler', faction: 'star_empire', cost: 2, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(3), drawThenDiscard()], scrap: [trade(2)],
    text: {
      primary: '{combat:3} Draw a card, then discard a card.', ally: '', scrap: '{trade:2}',
    },
  },
  knightstar: {
    name: 'Knightstar', faction: 'star_empire', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(6), {
      k: 'IF', cond: { c: 'OPPONENT_BASES_AT_LEAST', n: 1 }, then: [combat(3)],
    }],
    ally: [draw(1)],
    text: {
      primary: '{combat:6} If an opponent has a base in play, gain an additional {combat:3}',
      ally: 'Draw a card.', scrap: '',
    },
  },
  'probe-bot': {
    name: 'Probe Bot', faction: 'machine_cult', cost: 2, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(1), scrapHandDiscard(0, 1)], ally: [draw(1)], scrap: [combat(3)],
    text: {
      primary: '{trade:1} You may scrap a card in your hand or discard pile.',
      ally: 'Draw a card.', scrap: '{combat:3}',
    },
  },
  'war-kite': {
    name: 'War Kite', faction: 'blob', cost: 2, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(5)], scrap: [destroyBase(1)],
    text: { primary: '{combat:5}', ally: '', scrap: 'Destroy target base.' },
  },
}
