import type { Effect } from '../effects'
import type { Spec } from './types'

/**
 * THE CRISIS MINI-EXPANSIONS.
 *
 * Four packs of twelve cards, sold separately and shuffled INTO the trade deck
 * rather than replacing it -- which is why each is its own SetId: owning
 * Bases & Battleships does not mean owning Events.
 *
 * This file holds the two packs made of ordinary ships and bases. Heroes and
 * Events introduce new card TYPES and live in their own files, because the
 * difference is a rules difference, not a data one.
 *
 * Contents verified against the publisher's Card Gallery spreadsheet. Note that
 * unlike a base set these packs are NOT balanced 20-per-faction: twelve cards
 * spread unevenly is the printed contents, and the data test checks the printed
 * counts rather than imposing a symmetry that is not there.
 *
 * One Card Gallery slip, corrected here: Mega Mech is listed with a "Star Empire
 * Ally". It is a Machine Cult ship and its ally is the ordinary same-faction
 * one; our model derives the ally faction from the card, so the printed card is
 * what we get.
 */

const trade = (n: number): Effect => ({ k: 'GAIN_TRADE', n })
const combat = (n: number): Effect => ({ k: 'GAIN_COMBAT', n })
const authority = (n: number): Effect => ({ k: 'GAIN_AUTHORITY', n })
const draw = (n: number): Effect => ({ k: 'DRAW', n })
const oppDiscard = (n: number): Effect => ({ k: 'OPPONENT_DISCARD', n })
const scrapHandDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand', 'discard'], min, max })
const chooseOne = (...branches: { label: string; then: Effect[] }[]): Effect =>
  ({ k: 'CHOOSE_ONE', branches })
/** "Draw a card, then discard a card" -- the Star Empire filter. */
const drawThenDiscard = (): Effect =>
  ({ k: 'SEQ', effects: [draw(1), { k: 'SELF_DISCARD', n: 1 }] })

export const CRISIS_BASES: Record<string, Spec> = {
  'construction-hauler': {
    name: 'Construction Hauler', faction: 'trade_federation', cost: 6, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [authority(3), trade(2), draw(1)],
    // "directly into play" skips the discard pile AND the deck: the base is
    // defending on the turn you buy it.
    ally: [{
      k: 'REDIRECT_NEXT_ACQUIRED',
      redirect: { filter: 'base', dest: 'in_play', optional: false },
    }],
    text: {
      primary: '{authority:3} {trade:2} Draw a card.',
      ally: 'Put the next base you acquire this turn directly into play.',
      scrap: '',
    },
  },
  'defense-bot': {
    name: 'Defense Bot', faction: 'machine_cult', cost: 2, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [
      combat(1),
      scrapHandDiscard(0, 1),
      { k: 'IF', cond: { c: 'BASES_IN_PLAY_AT_LEAST', n: 2 }, then: [combat(8)] },
    ],
    text: {
      primary: '{combat:1} You may scrap a card in your hand or discard pile. ' +
        'If you control two or more bases, gain {combat:8}',
      ally: '', scrap: '',
    },
  },
  'fighter-base': {
    // No primary at all: the whole card is its ally ability, so there is nothing
    // to activate until a second Star Empire card is in play.
    name: 'Fighter Base', faction: 'star_empire', cost: 3, type: 'outpost',
    defense: 5, copies: 2, role: 'trade_deck',
    primary: [], ally: [oppDiscard(1)],
    text: { primary: '', ally: 'Target opponent discards a card.', scrap: '' },
  },
  'imperial-trader': {
    name: 'Imperial Trader', faction: 'star_empire', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [trade(3), draw(1)], ally: [combat(4)],
    text: { primary: '{trade:3} Draw a card.', ally: '{combat:4}', scrap: '' },
  },
  'mega-mech': {
    name: 'Mega Mech', faction: 'machine_cult', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(6), { k: 'RETURN_BASE_TO_HAND', min: 0 }], ally: [draw(1)],
    text: {
      primary: "{combat:6} You may return target base from play to its owner's hand.",
      ally: 'Draw a card.', scrap: '',
    },
  },
  obliterator: {
    name: 'Obliterator', faction: 'blob', cost: 6, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(7), {
      k: 'IF', cond: { c: 'OPPONENT_BASES_AT_LEAST', n: 2 }, then: [combat(6)],
    }],
    ally: [draw(1)],
    text: {
      primary: '{combat:7} If your opponent has two or more bases in play, ' +
        'gain an additional {combat:6}',
      ally: 'Draw a card.', scrap: '',
    },
  },
  'trade-raft': {
    name: 'Trade Raft', faction: 'trade_federation', cost: 1, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(1)], ally: [draw(1)], scrap: [trade(1)],
    text: { primary: '{trade:1}', ally: 'Draw a card.', scrap: '{trade:1}' },
  },
  'trade-wheel': {
    name: 'Trade Wheel', faction: 'blob', cost: 3, type: 'base',
    defense: 5, copies: 2, role: 'trade_deck',
    primary: [trade(1)], ally: [combat(2)],
    text: { primary: '{trade:1}', ally: '{combat:2}', scrap: '' },
  },
}

export const CRISIS_FLEETS: Record<string, Spec> = {
  'border-fort': {
    name: 'Border Fort', faction: 'machine_cult', cost: 4, type: 'outpost',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [chooseOne(
      { label: '{trade:1}', then: [trade(1)] },
      { label: '{combat:2}', then: [combat(2)] },
    )],
    ally: [scrapHandDiscard(1, 1)],
    text: {
      primary: '{trade:1} OR {combat:2}',
      ally: 'Scrap a card in your hand or discard pile.', scrap: '',
    },
  },
  'capitol-world': {
    name: 'Capitol World', faction: 'trade_federation', cost: 8, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [authority(6), draw(1)],
    text: { primary: '{authority:6} Draw a card.', ally: '', scrap: '' },
  },
  'cargo-launch': {
    name: 'Cargo Launch', faction: 'star_empire', cost: 1, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [draw(1)], scrap: [trade(1)],
    text: { primary: 'Draw a card.', ally: '', scrap: '{trade:1}' },
  },
  'customs-frigate': {
    name: 'Customs Frigate', faction: 'trade_federation', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    // "You may acquire" -- optional, so min is 0 and declining is legal.
    primary: [{ k: 'ACQUIRE_FREE', filter: 'ship', maxCost: 4, dest: 'deck_top', min: 0 }],
    ally: [combat(4)], scrap: [draw(1)],
    text: {
      primary: 'You may acquire a ship of cost four or less for free and put it on top of your deck.',
      ally: '{combat:4}', scrap: 'Draw a card.',
    },
  },
  'death-world': {
    name: 'Death World', faction: 'blob', cost: 7, type: 'base',
    defense: 6, copies: 1, role: 'trade_deck',
    // The draw is coupled to actually scrapping ("if you do"), and the eligible
    // cards exclude Blob -- Death World does not eat its own.
    primary: [combat(4), {
      k: 'SCRAP_THEN_DRAW',
      zones: ['hand', 'discard'],
      max: 1,
      factions: ['trade_federation', 'machine_cult', 'star_empire'],
    }],
    text: {
      primary: '{combat:4} You may scrap a Trade Federation, Machine Cult, or Star Empire ' +
        'card from your hand or discard pile. If you do, draw a card.',
      ally: '', scrap: '',
    },
  },
  'patrol-bot': {
    name: 'Patrol Bot', faction: 'machine_cult', cost: 2, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [chooseOne(
      { label: '{trade:2}', then: [trade(2)] },
      { label: '{combat:4}', then: [combat(4)] },
    )],
    ally: [scrapHandDiscard(1, 1)],
    text: {
      primary: '{trade:2} OR {combat:4}',
      ally: 'Scrap a card in your hand or discard pile.', scrap: '',
    },
  },
  'spike-pod': {
    name: 'Spike Pod', faction: 'blob', cost: 1, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(3), { k: 'SCRAP_TRADE_ROW', min: 0, max: 2 }],
    scrap: [combat(2)],
    text: {
      primary: '{combat:3} You may scrap up to two cards currently in the trade row.',
      ally: '', scrap: '{combat:2}',
    },
  },
  'star-fortress': {
    name: 'Star Fortress', faction: 'star_empire', cost: 7, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [combat(3), drawThenDiscard()], ally: [drawThenDiscard()],
    text: {
      primary: '{combat:3} Draw a card, then discard a card.',
      ally: 'Draw a card, then discard a card.', scrap: '',
    },
  },
}
