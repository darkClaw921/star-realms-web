import type { Effect } from '../effects'
import type { Spec } from './types'

/**
 * STAR REALMS: FRONTIERS -- the 80-card trade deck (45 distinct cards).
 *
 * Every name, faction, type, cost, defense, copy count and ability text was
 * taken from the publisher's own Card Gallery spreadsheet (Wise Wizard Games
 * maintains it "for the purpose of verifying product contents"), cross-checked
 * against the contents list on page 2 of the Frontiers rulebook. Counts total
 * 80, exactly 20 per faction, which is the check the data test enforces.
 *
 * Frontiers introduces one genuinely new ability slot -- the Double Ally, which
 * needs TWO other cards of the faction rather than one. It is a separate slot
 * rather than a variant of `ally` because a card can use both in the same turn.
 *
 * One deliberate simplification, marked here rather than hidden: Imperial
 * Flagship's ally reads "target PLAYER discards a card", which by the printed
 * rules may target yourself. In a two-player game that is never a good play, so
 * it is modelled as the opponent discarding, like every other discard effect.
 */

const trade = (n: number): Effect => ({ k: 'GAIN_TRADE', n })
const combat = (n: number): Effect => ({ k: 'GAIN_COMBAT', n })
const authority = (n: number): Effect => ({ k: 'GAIN_AUTHORITY', n })
const draw = (n: number): Effect => ({ k: 'DRAW', n })
const oppDiscard = (n: number): Effect => ({ k: 'OPPONENT_DISCARD', n })
const destroyBase = (min: 0 | 1): Effect => ({ k: 'DESTROY_BASE', min, max: 1 })
const scrapTradeRow = (min: 0 | 1): Effect => ({ k: 'SCRAP_TRADE_ROW', min, max: 1 })
const scrapHandDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand', 'discard'], min, max })
const scrapHand = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand'], min, max })
const scrapDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['discard'], min, max })
const chooseOne = (...branches: { label: string; then: Effect[] }[]): Effect =>
  ({ k: 'CHOOSE_ONE', branches })
/** "Draw a card, then discard a card" -- the Star Empire filter in Frontiers. */
const drawThenDiscard = (): Effect =>
  ({ k: 'SEQ', effects: [draw(1), { k: 'SELF_DISCARD', n: 1 }] })

export const FRONTIERS: Record<string, Spec> = {
  // ═══════════════════════════════ BLOB (20) ═══════════════════════════════
  'blob-alpha': {
    name: 'Blob Alpha', faction: 'blob', cost: 6, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(10)],
    text: { primary: '{combat:10}', ally: '', scrap: '' },
  },
  'blob-miner': {
    name: 'Blob Miner', faction: 'blob', cost: 2, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(3), scrapTradeRow(0)], scrap: [combat(2)],
    text: {
      primary: '{trade:3} You may scrap a card in the trade row.',
      ally: '', scrap: '{combat:2}',
    },
  },
  burrower: {
    name: 'Burrower', faction: 'blob', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(5)], ally: [draw(1)],
    scrap: [{ k: 'ACQUIRE_FREE', filter: 'any', maxCost: 4, dest: 'discard' }],
    text: {
      primary: '{combat:5}', ally: 'Draw a card.',
      scrap: 'Acquire a card of cost 4 or less for free.',
    },
  },
  crusher: {
    name: 'Crusher', faction: 'blob', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(6)], ally: [trade(2)],
    text: { primary: '{combat:6}', ally: '{trade:2}', scrap: '' },
  },
  'hive-queen': {
    name: 'Hive Queen', faction: 'blob', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(7), draw(1)], ally: [combat(3)], doubleAlly: [combat(3)],
    text: {
      primary: '{combat:7} Draw a card.',
      ally: '{combat:3}', doubleAlly: '{combat:3}', scrap: '',
    },
  },
  'infested-moon': {
    name: 'Infested Moon', faction: 'blob', cost: 6, type: 'base',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [combat(4)], ally: [draw(1)], doubleAlly: [draw(1)],
    text: {
      primary: '{combat:4}', ally: 'Draw a card.',
      doubleAlly: 'Draw a card.', scrap: '',
    },
  },
  'moonwurm-hatchling': {
    name: 'Moonwurm Hatchling', faction: 'blob', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [chooseOne(
      { label: '{trade:3}', then: [trade(3)] },
      { label: 'Destroy target base', then: [destroyBase(1)] },
    )],
    ally: [combat(3)], doubleAlly: [combat(3)],
    text: {
      primary: '{trade:3} OR destroy target base.',
      ally: '{combat:3}', doubleAlly: '{combat:3}', scrap: '',
    },
  },
  'nesting-ground': {
    name: 'Nesting Ground', faction: 'blob', cost: 4, type: 'base',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [trade(2)], ally: [combat(4)],
    text: { primary: '{trade:2}', ally: '{combat:4}', scrap: '' },
  },
  pulverizer: {
    name: 'Pulverizer', faction: 'blob', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [{ k: 'SCRAP_TRADE_ROW_FOR_COMBAT', min: 1, max: 1 }], ally: [draw(1)],
    text: {
      primary: 'Scrap a card in the trade row and gain {combat:0} equal to its cost.',
      ally: 'Draw a card.', scrap: '',
    },
  },
  'spike-cluster': {
    name: 'Spike Cluster', faction: 'blob', cost: 2, type: 'base',
    defense: 3, copies: 2, role: 'trade_deck',
    primary: [combat(2)], ally: [trade(1)],
    text: { primary: '{combat:2}', ally: '{trade:1}', scrap: '' },
  },
  stinger: {
    name: 'Stinger', faction: 'blob', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(3)], ally: [combat(3)], scrap: [trade(1)],
    text: { primary: '{combat:3}', ally: '{combat:3}', scrap: '{trade:1}' },
  },
  'swarm-cluster': {
    name: 'Swarm Cluster', faction: 'blob', cost: 8, type: 'base',
    defense: 8, copies: 1, role: 'trade_deck',
    primary: [combat(5)], ally: [combat(3)], doubleAlly: [combat(3)],
    text: {
      primary: '{combat:5}', ally: '{combat:3}',
      doubleAlly: '{combat:3}', scrap: '',
    },
  },

  // ════════════════════════════ MACHINE CULT (20) ════════════════════════════
  'builder-bot': {
    name: 'Builder Bot', faction: 'machine_cult', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(1), scrapDiscard(0, 1)], ally: [trade(1)], scrap: [combat(2)],
    text: {
      primary: '{trade:1} You may scrap a card in your discard pile.',
      ally: '{trade:1}', scrap: '{combat:2}',
    },
  },
  'conversion-yard': {
    name: 'Conversion Yard', faction: 'machine_cult', cost: 5, type: 'outpost',
    defense: 4, copies: 1, role: 'trade_deck',
    primary: [{ k: 'MAY', label: 'Scrap a card in your hand', then: [scrapHand(1, 1), combat(4)] }],
    text: {
      primary: 'You may scrap a card in your hand. If you do, gain {combat:4}.',
      ally: '', scrap: '',
    },
  },
  'defense-system': {
    name: 'Defense System', faction: 'machine_cult', cost: 4, type: 'outpost',
    defense: 5, copies: 2, role: 'trade_deck',
    primary: [combat(2)], ally: [combat(2)],
    text: { primary: '{combat:2}', ally: '{combat:2}', scrap: '' },
  },
  'destroyer-bot': {
    name: 'Destroyer Bot', faction: 'machine_cult', cost: 3, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(5), scrapDiscard(0, 1)],
    text: {
      primary: '{combat:5} You may scrap a card in your discard pile.',
      ally: '', scrap: '',
    },
  },
  'enforcer-mech': {
    name: 'Enforcer Mech', faction: 'machine_cult', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(5), scrapHandDiscard(0, 1)], ally: [destroyBase(1)], scrap: [draw(1)],
    text: {
      primary: '{combat:5} You may scrap a card in your hand or discard pile.',
      ally: 'Destroy target base.', scrap: 'Draw a card.',
    },
  },
  'integration-port': {
    name: 'Integration Port', faction: 'machine_cult', cost: 3, type: 'outpost',
    defense: 5, copies: 2, role: 'trade_deck',
    primary: [trade(1)],
    text: { primary: '{trade:1}', ally: '', scrap: '' },
  },
  'nanobot-swarm': {
    name: 'Nanobot Swarm', faction: 'machine_cult', cost: 8, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(5), draw(2), scrapHandDiscard(0, 2)],
    text: {
      primary: '{combat:5} Draw two cards. You may scrap up to two cards ' +
        'in your hand and/or discard pile.',
      ally: '', scrap: '',
    },
  },
  'neural-nexus': {
    name: 'Neural Nexus', faction: 'machine_cult', cost: 7, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [{ k: 'SCRAP_FOR_COMBAT', zones: ['hand', 'discard'], min: 1, max: 1 }],
    ally: [draw(1)],
    text: {
      primary: 'Scrap a card in your hand or discard pile and gain {combat:0} equal to its cost.',
      ally: 'Draw a card.', scrap: '',
    },
  },
  'plasma-bot': {
    name: 'Plasma Bot', faction: 'machine_cult', cost: 2, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(3), scrapHand(0, 1)], ally: [combat(2)],
    text: {
      primary: '{combat:3} You may scrap a card in your hand.',
      ally: '{combat:2}', scrap: '',
    },
  },
  'reclamation-station': {
    name: 'Reclamation Station', faction: 'machine_cult', cost: 6, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [scrapDiscard(1, 1)],
    scrap: [{ k: 'COMBAT_PER_SCRAPPED', per: 3 }],
    text: {
      primary: 'Scrap a card in your discard pile.',
      ally: '',
      scrap: 'Gain {combat:3} for each of your cards scrapped this turn, including this one.',
    },
  },
  'repair-mech': {
    name: 'Repair Mech', faction: 'machine_cult', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [chooseOne(
      { label: '{trade:3}', then: [trade(3)] },
      { label: 'Top-deck a base', then: [{ k: 'TOPDECK_BASE_FROM_DISCARD', min: 1 }] },
    )],
    ally: [scrapHandDiscard(0, 1)],
    text: {
      primary: '{trade:3} OR put a base from your discard pile on top of your deck.',
      ally: 'You may scrap a card in your hand or discard pile.', scrap: '',
    },
  },

  // ════════════════════════════ STAR EMPIRE (20) ════════════════════════════
  'captured-outpost': {
    name: 'Captured Outpost', faction: 'star_empire', cost: 3, type: 'outpost',
    defense: 3, copies: 2, role: 'trade_deck',
    primary: [drawThenDiscard()],
    text: { primary: 'Draw a card, then discard a card.', ally: '', scrap: '' },
  },
  'cargo-craft': {
    name: 'Cargo Craft', faction: 'star_empire', cost: 2, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(2), oppDiscard(1)], ally: [combat(4)],
    text: {
      primary: '{trade:2} Target opponent discards a card.',
      ally: '{combat:4}', scrap: '',
    },
  },
  'farm-ship': {
    name: 'Farm Ship', faction: 'star_empire', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(3), drawThenDiscard()], scrap: [combat(4)],
    text: {
      primary: '{trade:3} Draw a card, then discard a card.',
      ally: '', scrap: '{combat:4}',
    },
  },
  'frontier-hawk': {
    name: 'Frontier Hawk', faction: 'star_empire', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(3), drawThenDiscard()],
    text: { primary: '{combat:3} Draw a card, then discard a card.', ally: '', scrap: '' },
  },
  hammerhead: {
    name: 'Hammerhead', faction: 'star_empire', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(3), draw(1), oppDiscard(1)], ally: [drawThenDiscard()],
    text: {
      primary: '{combat:3} Draw a card. Target opponent discards a card.',
      ally: 'Draw a card, then discard a card.', scrap: '',
    },
  },
  'imperial-flagship': {
    name: 'Imperial Flagship', faction: 'star_empire', cost: 8, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(7), draw(2)], ally: [oppDiscard(1)],
    text: {
      primary: '{combat:7} Draw two cards.',
      ally: 'Target opponent discards a card.', scrap: '',
    },
  },
  'jamming-terminal': {
    name: 'Jamming Terminal', faction: 'star_empire', cost: 5, type: 'base',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [combat(2), oppDiscard(1)],
    text: {
      primary: '{combat:2} Target opponent discards a card.',
      ally: '', scrap: '',
    },
  },
  'light-cruiser': {
    name: 'Light Cruiser', faction: 'star_empire', cost: 3, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(4), oppDiscard(1)], ally: [combat(2)], doubleAlly: [draw(1)],
    text: {
      primary: '{combat:4} Target opponent discards a card.',
      ally: '{combat:2}', doubleAlly: 'Draw a card.', scrap: '',
    },
  },
  'orbital-gun-platform': {
    name: 'Orbital Gun Platform', faction: 'star_empire', cost: 4, type: 'outpost',
    defense: 4, copies: 2, role: 'trade_deck',
    primary: [combat(3)], scrap: [trade(3)],
    text: { primary: '{combat:3}', ally: '', scrap: '{trade:3}' },
  },
  'siege-fortress': {
    name: 'Siege Fortress', faction: 'star_empire', cost: 7, type: 'outpost',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [combat(5)], ally: [combat(4)],
    text: { primary: '{combat:5}', ally: '{combat:4}', scrap: '' },
  },
  'warpgate-cruiser': {
    name: 'Warpgate Cruiser', faction: 'star_empire', cost: 6, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [{ k: 'DISCARD_FOR_COMBAT', per: 2 }, draw(1)], ally: [draw(1)],
    text: {
      primary: 'Discard any number of cards and gain {combat:2} for each. Draw a card.',
      ally: 'Draw a card.', scrap: '',
    },
  },

  // ═════════════════════════ TRADE FEDERATION (20) ═════════════════════════
  'federation-battleship': {
    name: 'Federation Battleship', faction: 'trade_federation', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(5), authority(5), draw(1)], ally: [destroyBase(1)], scrap: [authority(10)],
    text: {
      primary: '{combat:5} {authority:5} Draw a card.',
      ally: 'Destroy target base.', scrap: '{authority:10}',
    },
  },
  'federation-cruiser': {
    name: 'Federation Cruiser', faction: 'trade_federation', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(5), authority(4)], ally: [combat(2), authority(2)],
    text: {
      primary: '{combat:5} {authority:4}',
      ally: '{combat:2} {authority:2}', scrap: '',
    },
  },
  'frontier-runner': {
    name: 'Frontier Runner', faction: 'trade_federation', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(2), authority(2)],
    text: { primary: '{trade:2} {authority:2}', ally: '', scrap: '' },
  },
  gateship: {
    name: 'Gateship', faction: 'trade_federation', cost: 6, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [{ k: 'ACQUIRE_FREE', filter: 'any', maxCost: 6, dest: 'deck_top' }],
    ally: [authority(5)],
    text: {
      primary: 'Acquire a ship or base of cost 6 or less for free and put it on top of your deck.',
      ally: '{authority:5}', scrap: '',
    },
  },
  'ion-station': {
    name: 'Ion Station', faction: 'trade_federation', cost: 5, type: 'outpost',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [trade(2)], ally: [trade(1)], doubleAlly: [combat(4), authority(4)],
    text: {
      primary: '{trade:2}', ally: '{trade:1}',
      doubleAlly: '{combat:4} {authority:4}', scrap: '',
    },
  },
  'long-hauler': {
    name: 'Long Hauler', faction: 'trade_federation', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(3)], ally: [trade(2)],
    scrap: [{ k: 'TOPDECK_NEXT_ACQUIRED', filter: 'base', min: 1 }],
    text: {
      primary: '{trade:3}', ally: '{trade:2}',
      scrap: 'Put the next base you acquire this turn on top of your deck.',
    },
  },
  'mobile-market': {
    name: 'Mobile Market', faction: 'trade_federation', cost: 4, type: 'outpost',
    defense: 4, copies: 2, role: 'trade_deck',
    primary: [trade(2)],
    scrap: [authority(2), draw(1), { k: 'RETURN_SELF_AT_END_OF_TURN' }],
    text: {
      primary: '{trade:2}', ally: '',
      scrap: '{authority:2} Draw a card. At end of turn Mobile Market returns ' +
        'from the scrap heap to your discard pile.',
    },
  },
  'orbital-shuttle': {
    name: 'Orbital Shuttle', faction: 'trade_federation', cost: 2, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(3), {
      k: 'IF', cond: { c: 'BASES_IN_PLAY_AT_LEAST', n: 2 }, then: [authority(4), draw(1)],
    }],
    text: {
      primary: '{trade:3} If you have two or more bases in play, {authority:4} and draw a card.',
      ally: '', scrap: '',
    },
  },
  'outland-station': {
    name: 'Outland Station', faction: 'trade_federation', cost: 3, type: 'base',
    defense: 4, copies: 3, role: 'trade_deck',
    primary: [chooseOne(
      { label: '{trade:1}', then: [trade(1)] },
      { label: '{authority:3}', then: [authority(3)] },
    )],
    scrap: [draw(1)],
    text: { primary: '{trade:1} OR {authority:3}', ally: '', scrap: 'Draw a card.' },
  },
  'patrol-boat': {
    name: 'Patrol Boat', faction: 'trade_federation', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(4), authority(3)], ally: [authority(2)],
    text: { primary: '{combat:4} {authority:3}', ally: '{authority:2}', scrap: '' },
  },
  'transit-nexus': {
    name: 'Transit Nexus', faction: 'trade_federation', cost: 8, type: 'base',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [combat(3), trade(4), authority(5)],
    text: { primary: '{combat:3} {trade:4} {authority:5}', ally: '', scrap: '' },
  },
}
