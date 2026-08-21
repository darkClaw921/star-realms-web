import type { Effect } from '../effects'
import type { Spec } from './types'

/**
 * THE FRONTIERS KICKSTARTER PROMO PACK.
 *
 * Twenty-five playable cards plus a thank-you card, and the most mechanically
 * adventurous pack in the game. Four ideas arrive with it:
 *
 *   - SELF-SCRAPPING ALLIES. "Scrap this card from play. <something big>." The
 *     card pays for itself and is gone. Distinct from the scrap slot, where the
 *     card volunteers itself; here the scrapping is the price of the ability.
 *   - DOCKING. "During the discard phase, if you have a <faction> base in play,
 *     set this card aside. At the end of the draw phase, return it to your
 *     hand." A card that never leaves your hand while you hold the right base.
 *   - A SCRAP WATCHER. Converter fires every time you scrap from hand or
 *     discard, without limit -- the second unbounded trigger in the game after
 *     Fleet HQ.
 *   - A CHOSEN FACTION. The Colossus picks its faction as it is played, and
 *     really has it: other cards' ally conditions see it, and so does its own
 *     per-faction draw.
 *
 * The events in the pack are wider than Crisis': they look four cards deep, set
 * a card aside for the rest of the game, or hand out two allies of every faction
 * at once.
 *
 * Contents verified against the publisher's Card Gallery spreadsheet.
 */

const trade = (n: number): Effect => ({ k: 'GAIN_TRADE', n })
const combat = (n: number): Effect => ({ k: 'GAIN_COMBAT', n })
const authority = (n: number): Effect => ({ k: 'GAIN_AUTHORITY', n })
const draw = (n: number): Effect => ({ k: 'DRAW', n })
const oppDiscard = (n: number): Effect => ({ k: 'OPPONENT_DISCARD', n })
const destroyBase = (min: 0 | 1): Effect => ({ k: 'DESTROY_BASE', min, max: 1 })
const scrapHand = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand'], min, max })
const scrapHandDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand', 'discard'], min, max })
const scrapDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['discard'], min, max })
const chooseOne = (...branches: { label: string; then: Effect[] }[]): Effect =>
  ({ k: 'CHOOSE_ONE', branches })
const each = (...then: Effect[]): Effect => ({ k: 'EACH_PLAYER', then })
const self: Effect = { k: 'SCRAP_SELF' }

const DOCK_TEXT = (faction: string): string =>
  `Docking: during the discard phase, if you have a ${faction} base in play, set ` +
  'this card aside. At the end of the draw phase, return it to your hand.'

const event = (name: string, copies: number, primary: Effect[], text: string): Spec => ({
  name, faction: 'unaligned', cost: 0, type: 'event',
  defense: null, copies, role: 'trade_deck',
  primary, text: { primary: text, ally: '', scrap: '' },
})

export const FRONTIERS_PROMOS: Record<string, Spec> = {
  // ─────────────────────────── ships and bases ────────────────────────────
  assimilator: {
    name: 'Assimilator', faction: 'machine_cult', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [
      chooseOne(
        { label: '{trade:5}', then: [trade(5)] },
        { label: '{combat:8}', then: [combat(8)] },
      ),
      scrapHandDiscard(0, 1),
    ],
    ally: [self, { k: 'STEAL_FROM_DISCARD', n: 1 }],
    text: {
      primary: '{trade:5} OR {combat:8} You may scrap a card in your hand or discard pile.',
      ally: "Scrap this card from play. Move a card from an opponent's discard pile to yours.",
      scrap: '',
    },
  },
  'assur-4': {
    name: 'Assur 4', faction: 'trade_federation', cost: 5, type: 'base',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [authority(5)], ally: [trade(2)], doubleAlly: [draw(1)],
    text: {
      primary: '{authority:5}', ally: '{trade:2}', doubleAlly: 'Draw a card.', scrap: '',
    },
  },
  'blockade-runner': {
    name: 'Blockade Runner', faction: 'star_empire', cost: 1, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [{ k: 'DISCARD_THEN_DRAW', max: 2 }],
    ally: [self, draw(1), oppDiscard(1)],
    text: {
      primary: 'Discard up to two cards, then draw that many cards.',
      ally: 'Scrap this card from play. Draw a card. Target opponent discards a card.',
      scrap: '',
    },
  },
  'cargo-rocket': {
    name: 'Cargo Rocket', faction: 'trade_federation', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [authority(3), combat(2), trade(1)],
    ally: [self, {
      k: 'REDIRECT_NEXT_ACQUIRED',
      redirect: { filter: 'ship', dest: 'deck_top', optional: false },
    }],
    text: {
      primary: '{authority:3} {combat:2} {trade:1}',
      ally: 'Scrap this card from play. Put the next ship you acquire this turn on ' +
        'top of your deck.',
      scrap: '',
    },
  },
  converter: {
    name: 'Converter', faction: 'machine_cult', cost: 5, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    // A watcher, not an activated ability: it fires every time, without limit.
    primary: [],
    triggers: [{ on: 'SCRAP_OWN', effects: [combat(2)] }],
    ally: [scrapHand(1, 1)], doubleAlly: [scrapDiscard(1, 1)],
    text: {
      primary: 'Whenever you scrap a card from your hand or discard pile, gain {combat:2}',
      ally: 'Scrap a card from your hand.',
      doubleAlly: 'Scrap a card from your discard pile.',
      scrap: '',
    },
  },
  demolisher: {
    name: 'Demolisher', faction: 'star_empire', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(6), draw(1)],
    ally: [self, draw(2), oppDiscard(2)],
    text: {
      primary: '{combat:6} Draw a card.',
      ally: 'Scrap this card from play. Draw two cards. Target opponent discards two cards.',
      scrap: '',
    },
  },
  'freight-raft': {
    name: 'Freight Raft', faction: 'trade_federation', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    docking: 'trade_federation',
    primary: [trade(2), authority(4)],
    text: {
      primary: `{trade:2} {authority:4} ${DOCK_TEXT('Trade Federation')}`,
      ally: '', scrap: '',
    },
  },
  'imperial-defender': {
    name: 'Imperial Defender', faction: 'star_empire', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    docking: 'star_empire',
    primary: [combat(1), draw(1)],
    text: {
      primary: `{combat:1} Draw a card. ${DOCK_TEXT('Star Empire')}`, ally: '', scrap: '',
    },
  },
  'midgate-station': {
    name: 'Midgate Station', faction: 'star_empire', cost: 5, type: 'outpost',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [{ k: 'DISCARD_FOR_RESOURCE_PLUS', plus: 1 }],
    ally: [oppDiscard(1)], doubleAlly: [draw(1)],
    text: {
      primary: 'Discard any number of cards. Gain {trade:1} or {combat:1} for each card ' +
        'discarded, plus one.',
      ally: 'Target opponent discards a card.',
      doubleAlly: 'Draw a card.',
      scrap: '',
    },
  },
  'plague-pod': {
    name: 'Plague Pod', faction: 'blob', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(2)], ally: [self, combat(6)],
    text: {
      primary: '{trade:2}',
      ally: 'Scrap this card from play. {combat:6}', scrap: '',
    },
  },
  'recycle-bot': {
    name: 'Recycle Bot', faction: 'machine_cult', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(1), scrapHand(0, 1)],
    ally: [self, scrapHandDiscard(1, 1)],
    text: {
      primary: '{trade:1} You may scrap a card in your hand.',
      ally: 'Scrap this card from play. Scrap a card in your hand or discard pile.',
      scrap: '',
    },
  },
  sentinel: {
    name: 'Sentinel', faction: 'blob', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    docking: 'blob',
    primary: [combat(5)],
    text: { primary: `{combat:5} ${DOCK_TEXT('Blob')}`, ally: '', scrap: '' },
  },
  'spawning-wurm': {
    name: 'Spawning Wurm', faction: 'blob', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(8), destroyBase(0)],
    ally: [self, combat(8)],
    text: {
      primary: '{combat:8} You may destroy target base.',
      ally: 'Scrap this card from play. {combat:8}', scrap: '',
    },
  },
  'swarming-point': {
    name: 'Swarming Point', faction: 'blob', cost: 5, type: 'base',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [combat(3)], ally: [combat(3)], doubleAlly: [combat(3)],
    text: {
      primary: '{combat:3}', ally: '{combat:3}', doubleAlly: '{combat:3}', scrap: '',
    },
  },
  'temple-guardian': {
    name: 'Temple Guardian', faction: 'machine_cult', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    docking: 'machine_cult',
    primary: [chooseOne(
      { label: '{trade:2}', then: [trade(2)] },
      { label: '{combat:4}', then: [combat(4)] },
    )],
    text: {
      primary: `{trade:2} OR {combat:4} ${DOCK_TEXT('Machine Cult')}`, ally: '', scrap: '',
    },
  },
  'the-colossus': {
    name: 'The Colossus', faction: 'unaligned', cost: 9, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    // The faction is chosen first, so the draw that follows can count it.
    primary: [combat(10), { k: 'CHOOSE_OWN_FACTION' }],
    triggers: [],
    text: {
      primary: '{combat:10} Choose a faction as you play The Colossus. The Colossus has ' +
        'that faction. Draw a card for each card of that faction you have in play ' +
        '(including The Colossus).',
      ally: '', scrap: '',
    },
  },
  'trade-envoy': {
    name: 'Trade Envoy', faction: 'trade_federation', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [trade(3), authority(5), draw(1)],
    ally: [self, {
      k: 'REDIRECT_NEXT_ACQUIRED',
      redirect: { filter: 'any', dest: 'hand', optional: false },
    }],
    text: {
      primary: '{trade:3} {authority:5} Draw a card.',
      ally: 'Scrap this card from play. Put the next ship or base you acquire this ' +
        'turn into your hand.',
      scrap: '',
    },
  },

  // ────────────────────────────── events ──────────────────────────────────
  mobilization: event('Mobilization', 1,
    [each({ k: 'SCRY_MANY', n: 4 })],
    'Each player may look at the top four cards of their deck, put any number of ' +
    'those cards into their discard pile, then put the remaining cards back on top ' +
    'of their deck in any order.'),
  'powerful-backing': event('Powerful Backing', 2,
    [
      trade(1),
      // "Two allies of every faction" is two phantom cards each, not an unlock:
      // two is what a DOUBLE ally needs, and phantoms are what count for it.
      { k: 'GAIN_PHANTOM', faction: 'machine_cult', n: 2 },
      { k: 'GAIN_PHANTOM', faction: 'star_empire', n: 2 },
      { k: 'GAIN_PHANTOM', faction: 'trade_federation', n: 2 },
      { k: 'GAIN_PHANTOM', faction: 'blob', n: 2 },
      { k: 'OPPONENT_EFFECT', then: [authority(5)] },
    ],
    'The player currently taking their turn gains {trade:1} and two allies of every ' +
    'faction. Each other player gains {authority:5}'),
  'recon-mission': event('Recon Mission', 2,
    [each({ k: 'ACQUIRE_EXPLORER_FREE', dest: 'hand', min: 0 })],
    'Each player may acquire an Explorer for free and put it into their hand.'),
  superflare: event('Superflare', 1,
    [each({ k: 'SHUFFLE_DISCARD_INTO_DECK' }, draw(1))],
    'Each player shuffles their discard pile into their deck, then draws a card.'),
  'supply-run': event('Supply Run', 2,
    [each(chooseOne(
      {
        label: 'Acquire an Explorer for free, on top of your deck',
        then: [{ k: 'ACQUIRE_EXPLORER_FREE', dest: 'deck_top', min: 1 }],
      },
      {
        label: 'Put a card from your discard pile on top of your deck',
        then: [{ k: 'DISCARD_TO_DECK_TOP', min: 1 }],
      },
    ))],
    'Each player may either acquire an Explorer for free and put it on top of their ' +
    'deck, or put a card from their discard pile on top of their deck.'),
  'tactical-maneuver': event('Tactical Maneuver', 2,
    [
      chooseOne(
        { label: '{trade:2}', then: [trade(2)] },
        { label: '{combat:4}', then: [combat(4)] },
      ),
      {
        k: 'OPPONENT_EFFECT',
        then: [chooseOne(
          { label: '{authority:6}', then: [authority(6)] },
          { label: 'Draw a card', then: [draw(1)] },
        )],
      },
    ],
    'The player currently taking their turn gains {trade:2} or {combat:4} Each other ' +
    'player gains {authority:6} or draws a card.'),
  'patience-rewarded': event('Patience Rewarded', 1,
    [each({ k: 'SET_ASIDE_FROM_ROW', min: 0 })],
    'Each player may scrap a card in the trade row, then set it aside. For the rest ' +
    'of the game, players may acquire the card they set aside as if it were in the ' +
    'trade row.'),
  wormhole: event('Wormhole', 1,
    [each(chooseOne(
      {
        label: 'Put a card from your discard pile into your hand',
        then: [{ k: 'DISCARD_TO_HAND', min: 1 }],
      },
      { label: 'Draw a card', then: [draw(1)] },
    ))],
    'Each player may either put a card from their discard pile into their hand or ' +
    'draw a card.'),
}
