import type { Effect, Trigger } from '../effects'
import type { Faction } from '../ids'
import type { Spec } from './types'

/**
 * STAR REALMS: COLONY WARS -- the 80-card trade deck (43 distinct cards).
 *
 * Every name, faction, type, cost, defense, copy count and ability text comes
 * from the publisher's own Card Gallery spreadsheet (Wise Wizard Games maintains
 * it "for the purpose of verifying product contents"). Counts total 80, exactly
 * 20 per faction, which is what the data test enforces.
 *
 * Colony Wars is a STANDALONE base set, not an add-on: it ships its own Scouts,
 * Vipers and Explorers. We do not duplicate those -- they are identical to the
 * core set's and share their ids -- so enabling Colony Wars adds exactly the 80
 * trade-deck cards and nothing else.
 *
 * Four mechanics arrive here that the core set and Frontiers never needed, and
 * each one is a genuine rules axis rather than a reskin:
 *
 *   - ACQUIRE TO HAND. Leviathan and Moonwurm hand you a card you can play the
 *     same turn. That is a different resource from topdecking, which is why
 *     AcquireDest grew a third value instead of being reused.
 *   - ACQUIRE_SELF triggers. "When you acquire this card, if you've played a
 *     <faction> card this turn, you may put this card directly into your hand."
 *     The trigger fires on the card being bought, not on anything in play.
 *   - COPY A BASE. Stealth Tower differs from Stealth Needle on every axis: a
 *     base rather than a ship, ANY base in play including the opponent's, and it
 *     need not have been played this turn.
 *   - FACTION-FILTERED PLAY TRIGGERS. Command Center fires on Star Empire ships
 *     only, so Trigger gained an optional faction filter.
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
const scrapHand = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand'], min, max })
const scrapDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['discard'], min, max })
const chooseOne = (...branches: { label: string; then: Effect[] }[]): Effect =>
  ({ k: 'CHOOSE_ONE', branches })
const acquireFree = (maxCost: number | null, dest: 'discard' | 'hand'): Effect =>
  ({ k: 'ACQUIRE_FREE', filter: 'any', maxCost, dest, min: 1 })
const redirect = (dest: 'deck_top' | 'hand'): Effect =>
  ({ k: 'REDIRECT_NEXT_ACQUIRED', redirect: { filter: 'any', dest, optional: false } })

/**
 * "When you acquire this card, if you've played a <faction> card this turn, you
 * may put this card directly into your hand."
 *
 * The four cards carrying it are the reason acquisition has a trigger point at
 * all. Note the condition reads cards PLAYED, so buying two of them in one turn
 * does not make the second one qualify.
 */
const acquireToHand = (faction: Faction): Trigger => ({
  on: 'ACQUIRE_SELF',
  effects: [{
    k: 'IF',
    cond: { c: 'FACTION_PLAYED_THIS_TURN', faction, n: 1 },
    then: [{ k: 'MAY', label: 'Put it into your hand', then: [{ k: 'MOVE_SELF_TO_HAND' }] }],
  }],
})

const ACQUIRE_TO_HAND_TEXT = (faction: string): string =>
  `When you acquire this card, if you've played a ${faction} card this turn, ` +
  'you may put this card directly into your hand.'

export const COLONY_WARS: Record<string, Spec> = {
  // ═══════════════════════════════ BLOB (20) ═══════════════════════════════
  bioformer: {
    name: 'Bioformer', faction: 'blob', cost: 4, type: 'base',
    defense: 4, copies: 2, role: 'trade_deck',
    primary: [combat(3)], scrap: [trade(3)],
    text: { primary: '{combat:3}', ally: '', scrap: '{trade:3}' },
  },
  'cargo-pod': {
    name: 'Cargo Pod', faction: 'blob', cost: 3, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(3)], ally: [combat(3)], scrap: [combat(3)],
    text: { primary: '{trade:3}', ally: '{combat:3}', scrap: '{combat:3}' },
  },
  leviathan: {
    name: 'Leviathan', faction: 'blob', cost: 8, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(9), draw(1), destroyBase(0)],
    ally: [acquireFree(3, 'hand')],
    text: {
      primary: '{combat:9} Draw a card. You may destroy target base.',
      ally: 'Acquire a card of cost three or less for free and put it into your hand.',
      scrap: '',
    },
  },
  moonwurm: {
    name: 'Moonwurm', faction: 'blob', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(8), draw(1)],
    ally: [acquireFree(2, 'hand')],
    text: {
      primary: '{combat:8} Draw a card.',
      ally: 'Acquire a card of cost two or less for free and put it into your hand.',
      scrap: '',
    },
  },
  parasite: {
    name: 'Parasite', faction: 'blob', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [chooseOne(
      { label: '{combat:6}', then: [combat(6)] },
      { label: 'Acquire a card of cost six or less for free', then: [acquireFree(6, 'discard')] },
    )],
    ally: [draw(1)],
    text: {
      primary: '{combat:6} OR acquire a card of cost six or less for free.',
      ally: 'Draw a card.', scrap: '',
    },
  },
  'plasma-vent': {
    name: 'Plasma Vent', faction: 'blob', cost: 6, type: 'base',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [combat(4)], scrap: [destroyBase(1)],
    triggers: [acquireToHand('blob')],
    text: {
      primary: `{combat:4} ${ACQUIRE_TO_HAND_TEXT('Blob')}`,
      ally: '', scrap: 'Destroy target base.',
    },
  },
  predator: {
    name: 'Predator', faction: 'blob', cost: 2, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(4)], ally: [draw(1)],
    text: { primary: '{combat:4}', ally: 'Draw a card.', scrap: '' },
  },
  ravager: {
    name: 'Ravager', faction: 'blob', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(6), scrapTradeRow(0, 2)],
    text: {
      primary: '{combat:6} You may scrap up to two cards that are currently in the trade row.',
      ally: '', scrap: '',
    },
  },
  'stellar-reef': {
    name: 'Stellar Reef', faction: 'blob', cost: 2, type: 'base',
    defense: 3, copies: 3, role: 'trade_deck',
    primary: [trade(1)], scrap: [combat(3)],
    text: { primary: '{trade:1}', ally: '', scrap: '{combat:3}' },
  },
  swarmer: {
    name: 'Swarmer', faction: 'blob', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(3), scrapTradeRow(0)], ally: [combat(2)],
    text: {
      primary: '{combat:3} You may scrap a card in the trade row.',
      ally: '{combat:2}', scrap: '',
    },
  },

  // ═══════════════════════════ MACHINE CULT (20) ═══════════════════════════
  'battle-bot': {
    name: 'Battle Bot', faction: 'machine_cult', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(2), scrapHand(0, 1)], ally: [combat(2)],
    text: {
      primary: '{combat:2} You may scrap a card in your hand.',
      ally: '{combat:2}', scrap: '',
    },
  },
  'convoy-bot': {
    name: 'Convoy Bot', faction: 'machine_cult', cost: 3, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(4), scrapHandDiscard(0, 1)], ally: [combat(2)],
    text: {
      primary: '{combat:4} You may scrap a card in your hand or discard pile.',
      ally: '{combat:2}', scrap: '',
    },
  },
  'frontier-station': {
    name: 'Frontier Station', faction: 'machine_cult', cost: 6, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [chooseOne(
      { label: '{trade:2}', then: [trade(2)] },
      { label: '{combat:3}', then: [combat(3)] },
    )],
    text: { primary: '{trade:2} OR {combat:3}', ally: '', scrap: '' },
  },
  'mech-cruiser': {
    name: 'Mech Cruiser', faction: 'machine_cult', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(6), scrapHandDiscard(0, 1)], ally: [destroyBase(1)],
    text: {
      primary: '{combat:6} You may scrap a card in your hand or discard pile.',
      ally: 'Destroy target base.', scrap: '',
    },
  },
  'mining-mech': {
    name: 'Mining Mech', faction: 'machine_cult', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(3), scrapHandDiscard(0, 1)], ally: [combat(3)],
    text: {
      primary: '{trade:3} You may scrap a card in your hand or discard pile.',
      ally: '{combat:3}', scrap: '',
    },
  },
  'repair-bot': {
    name: 'Repair Bot', faction: 'machine_cult', cost: 2, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(2), scrapDiscard(0, 1)], scrap: [combat(2)],
    text: {
      primary: '{trade:2} You may scrap a card in your discard pile.',
      ally: '', scrap: '{combat:2}',
    },
  },
  'stealth-tower': {
    // The Needle's counterpart, and different on every axis: a BASE, ANY base in
    // play including the opponent's, and no "played this turn" restriction.
    //
    // The copy happens ON PLAY, not as an activated ability -- the publisher FAQ
    // says it "will become a copy of another base after it enters play". That is
    // why this is a PLAY_SELF trigger with an empty primary: spending the
    // tower's activation on the copying would lock out the copied base's own
    // ability for the turn, which is most of the reason to copy one.
    //
    // The copy lasts until the end of YOUR turn, so it is cleared with the rest
    // of the per-turn bookkeeping rather than surviving into the opponent's turn
    // -- which matters, because a copied outpost would otherwise shield you on
    // exactly the turn you are being attacked.
    name: 'Stealth Tower', faction: 'machine_cult', cost: 5, type: 'outpost',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [],
    triggers: [{ on: 'PLAY_SELF', effects: [{ k: 'COPY_BASE' }] }],
    text: {
      primary: 'Until your turn ends, Stealth Tower becomes a copy of any base in play. ' +
        "Stealth Tower has that base's faction in addition to Machine Cult.",
      ally: '', scrap: '',
    },
  },
  'the-incinerator': {
    name: 'The Incinerator', faction: 'machine_cult', cost: 8, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [scrapHandDiscard(0, 2)],
    ally: [{ k: 'COMBAT_PER_SCRAPPED', per: 2 }],
    text: {
      primary: 'Scrap up to two cards in your hand and/or discard pile.',
      ally: '{combat:2} for each card scrapped from your hand and/or discard pile this turn.',
      scrap: '',
    },
  },
  'the-oracle': {
    name: 'The Oracle', faction: 'machine_cult', cost: 4, type: 'outpost',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [scrapHand(1, 1)], ally: [combat(3)],
    text: { primary: 'Scrap a card in your hand.', ally: '{combat:3}', scrap: '' },
  },
  'the-wrecker': {
    name: 'The Wrecker', faction: 'machine_cult', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(6), scrapHandDiscard(0, 2)], ally: [draw(1)],
    text: {
      primary: '{combat:6} You may scrap up to two cards in your hand and/or discard pile.',
      ally: 'Draw a card.', scrap: '',
    },
  },
  'warning-beacon': {
    name: 'Warning Beacon', faction: 'machine_cult', cost: 2, type: 'outpost',
    defense: 2, copies: 3, role: 'trade_deck',
    primary: [combat(2)],
    triggers: [acquireToHand('machine_cult')],
    text: {
      primary: `{combat:2} ${ACQUIRE_TO_HAND_TEXT('Machine Cult')}`,
      ally: '', scrap: '',
    },
  },

  // ═══════════════════════════ STAR EMPIRE (20) ════════════════════════════
  'aging-battleship': {
    name: 'Aging Battleship', faction: 'star_empire', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(5)], ally: [draw(1)], scrap: [combat(2), draw(2)],
    text: { primary: '{combat:5}', ally: 'Draw a card.', scrap: '{combat:2} Draw two cards.' },
  },
  'command-center': {
    name: 'Command Center', faction: 'star_empire', cost: 4, type: 'outpost',
    defense: 4, copies: 2, role: 'trade_deck',
    primary: [trade(2)],
    triggers: [{ on: 'PLAY_SHIP', faction: 'star_empire', effects: [combat(2)] }],
    text: {
      primary: '{trade:2} Whenever you play a Star Empire ship, gain {combat:2}',
      ally: '', scrap: '',
    },
  },
  'emperors-dreadnaught': {
    name: "Emperor's Dreadnaught", faction: 'star_empire', cost: 8, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(8), draw(1), oppDiscard(1)],
    triggers: [acquireToHand('star_empire')],
    text: {
      primary: `{combat:8} Draw a card. Target opponent discards a card. ${ACQUIRE_TO_HAND_TEXT('Star Empire')}`,
      ally: '', scrap: '',
    },
  },
  falcon: {
    name: 'Falcon', faction: 'star_empire', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(2), draw(1)], scrap: [oppDiscard(1)],
    text: {
      primary: '{combat:2} Draw a card.',
      ally: '', scrap: 'Target opponent discards a card.',
    },
  },
  gunship: {
    name: 'Gunship', faction: 'star_empire', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(5), oppDiscard(1)], scrap: [trade(4)],
    text: {
      primary: '{combat:5} Target opponent discards a card.',
      ally: '', scrap: '{trade:4}',
    },
  },
  'heavy-cruiser': {
    name: 'Heavy Cruiser', faction: 'star_empire', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(4), draw(1)], ally: [draw(1)],
    text: { primary: '{combat:4} Draw a card.', ally: 'Draw a card.', scrap: '' },
  },
  'imperial-palace': {
    name: 'Imperial Palace', faction: 'star_empire', cost: 7, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [draw(1), oppDiscard(1)], ally: [combat(4)],
    text: {
      primary: 'Draw a card. Target opponent discards a card.',
      ally: '{combat:4}', scrap: '',
    },
  },
  lancer: {
    name: 'Lancer', faction: 'star_empire', cost: 2, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(4), { k: 'IF', cond: { c: 'OPPONENT_BASES_AT_LEAST', n: 1 }, then: [combat(2)] }],
    ally: [oppDiscard(1)],
    text: {
      primary: '{combat:4} If an opponent controls a base, gain an additional {combat:2}',
      ally: 'Target opponent discards a card.', scrap: '',
    },
  },
  'orbital-platform': {
    // "Discard a card. If you do, draw a card." -- structurally identical to
    // Recycling Station with a maximum of one, coupling included.
    name: 'Orbital Platform', faction: 'star_empire', cost: 3, type: 'base',
    defense: 4, copies: 3, role: 'trade_deck',
    primary: [{ k: 'DISCARD_THEN_DRAW', max: 1 }], ally: [combat(3)],
    text: { primary: 'Discard a card. If you do, draw a card.', ally: '{combat:3}', scrap: '' },
  },
  'star-barge': {
    name: 'Star Barge', faction: 'star_empire', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(2)], ally: [combat(2), oppDiscard(1)],
    text: {
      primary: '{trade:2}', ally: '{combat:2} Target opponent discards a card.', scrap: '',
    },
  },
  'supply-depot': {
    name: 'Supply Depot', faction: 'star_empire', cost: 6, type: 'outpost',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [{ k: 'DISCARD_FOR_TRADE_OR_COMBAT', max: 2, per: 2 }], ally: [draw(1)],
    text: {
      primary: 'Discard up to two cards. Gain {trade:2} or {combat:2} for each card discarded this way.',
      ally: 'Draw a card.', scrap: '',
    },
  },

  // ═════════════════════════ TRADE FEDERATION (20) ═════════════════════════
  'central-station': {
    name: 'Central Station', faction: 'trade_federation', cost: 4, type: 'base',
    defense: 5, copies: 2, role: 'trade_deck',
    primary: [trade(2), {
      k: 'IF', cond: { c: 'BASES_IN_PLAY_AT_LEAST', n: 3 }, then: [authority(4), draw(1)],
    }],
    text: {
      primary: '{trade:2} If you have three or more bases in play (including this one), ' +
        'gain {authority:4} and draw a card.',
      ally: '', scrap: '',
    },
  },
  'colony-seed-ship': {
    name: 'Colony Seed Ship', faction: 'trade_federation', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [trade(3), combat(3), authority(3)],
    triggers: [acquireToHand('trade_federation')],
    text: {
      primary: `{trade:3} {combat:3} {authority:3} ${ACQUIRE_TO_HAND_TEXT('Trade Federation')}`,
      ally: '', scrap: '',
    },
  },
  'factory-world': {
    name: 'Factory World', faction: 'trade_federation', cost: 8, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [trade(3), redirect('hand')],
    text: {
      primary: '{trade:3} Put the next ship or base you acquire this turn into your hand.',
      ally: '', scrap: '',
    },
  },
  'federation-shipyard': {
    name: 'Federation Shipyard', faction: 'trade_federation', cost: 6, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [trade(2)], ally: [redirect('deck_top')],
    text: {
      primary: '{trade:2}',
      ally: 'Put the next ship or base you acquire this turn on top of your deck.',
      scrap: '',
    },
  },
  'frontier-ferry': {
    name: 'Frontier Ferry', faction: 'trade_federation', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(3), authority(4)], scrap: [destroyBase(1)],
    text: { primary: '{trade:3} {authority:4}', ally: '', scrap: 'Destroy target base.' },
  },
  'loyal-colony': {
    name: 'Loyal Colony', faction: 'trade_federation', cost: 7, type: 'base',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [trade(3), combat(3), authority(3)],
    text: { primary: '{trade:3} {combat:3} {authority:3}', ally: '', scrap: '' },
  },
  'patrol-cutter': {
    name: 'Patrol Cutter', faction: 'trade_federation', cost: 3, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(2), combat(3)], ally: [authority(4)],
    text: { primary: '{trade:2} {combat:3}', ally: '{authority:4}', scrap: '' },
  },
  peacekeeper: {
    name: 'Peacekeeper', faction: 'trade_federation', cost: 6, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(6), authority(6)], ally: [draw(1)],
    text: { primary: '{combat:6} {authority:6}', ally: 'Draw a card.', scrap: '' },
  },
  'solar-skiff': {
    name: 'Solar Skiff', faction: 'trade_federation', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(2)], ally: [draw(1)],
    text: { primary: '{trade:2}', ally: 'Draw a card.', scrap: '' },
  },
  'storage-silo': {
    name: 'Storage Silo', faction: 'trade_federation', cost: 2, type: 'base',
    defense: 3, copies: 2, role: 'trade_deck',
    primary: [authority(2)], ally: [trade(2)],
    text: { primary: '{authority:2}', ally: '{trade:2}', scrap: '' },
  },
  'trade-hauler': {
    name: 'Trade Hauler', faction: 'trade_federation', cost: 2, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(3)], ally: [authority(3)],
    text: { primary: '{trade:3}', ally: '{authority:3}', scrap: '' },
  },
}
