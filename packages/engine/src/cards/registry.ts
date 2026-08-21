import { asDefId, type CardDefId } from '../ids'
import type { Effect } from '../effects'
import { buildDefs, type CardDef, type CardRegistry, type SetId, type Spec } from './types'
import { COLONY_WARS } from './colonyWars'
import { CRISIS_BASES, CRISIS_FLEETS } from './crisis'
import { CRISIS_EVENTS } from './crisisEvents'
import { CRISIS_HEROES } from './crisisHeroes'
import { UNITED_ASSAULT, UNITED_COMMAND } from './united'
import { UNITED_HEROES } from './unitedHeroes'
import {
  HIGH_ALERT_FIRST_STRIKE, HIGH_ALERT_HEROES, HIGH_ALERT_INVASION,
  HIGH_ALERT_REQUISITION, HIGH_ALERT_TECH,
} from './highAlert'
import { FRONTIERS_PROMOS } from './frontiersPromos'
import { PROMO_PACK_1, STELLAR_ALLIES, YEAR_TWO_PROMOS } from './promos'
import { FRONTIERS } from './frontiers'

/**
 * THE BASE SET.
 *
 * Composition verified card-by-card against the publisher's own Card Gallery
 * spreadsheet (Wise Wizard Games maintains it "for the purpose of verifying
 * product contents"): 46 distinct trade-deck cards, 80 copies, exactly 20 per
 * faction. Card statistics and mechanics are facts, not copyrightable expression.
 *
 * Four corrections applied that fan sources get wrong:
 *   - Command Ship's ally destroys a base MANDATORILY (no "you may").
 *   - Fleet HQ carries official errata: "Whenever you play a ship, gain 1 Combat"
 *     -- a TRIGGERED ability, not the pre-errata static "all your ships get +1".
 *   - Blob Wheel has 3 copies (the wiki says 2; Blob would not total 20).
 *   - Battle Pod's trade-row scrap is optional ("You may scrap...").
 */

// ---- effect shorthands ------------------------------------------------------
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
const chooseOne = (...branches: { label: string; then: Effect[] }[]): Effect =>
  ({ k: 'CHOOSE_ONE', branches })
const topdeckNextShip = (): Effect =>
  ({ k: 'REDIRECT_NEXT_ACQUIRED', redirect: { filter: 'ship', dest: 'deck_top', optional: true } })


const defs: Record<string, Spec> = {
  // ══════════════════════════ TRADE FEDERATION (20) ══════════════════════════
  'federation-shuttle': {
    name: 'Federation Shuttle', faction: 'trade_federation', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(2)], ally: [authority(4)],
    text: { primary: '{trade:2}', ally: '{authority:4}', scrap: '' },
  },
  cutter: {
    name: 'Cutter', faction: 'trade_federation', cost: 2, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [authority(4), trade(2)], ally: [combat(4)],
    text: { primary: '{authority:4} {trade:2}', ally: '{combat:4}', scrap: '' },
  },
  'embassy-yacht': {
    // No ally and no scrap ability. The conditional draw is part of the PRIMARY --
    // a common implementation mistake is to model it as an ally trigger.
    name: 'Embassy Yacht', faction: 'trade_federation', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [authority(3), trade(2), { k: 'IF', cond: { c: 'BASES_IN_PLAY_AT_LEAST', n: 2 }, then: [draw(2)] }],
    text: { primary: '{authority:3} {trade:2} If you have two or more bases in play, draw two cards.', ally: '', scrap: '' },
  },
  freighter: {
    name: 'Freighter', faction: 'trade_federation', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(4)], ally: [topdeckNextShip()],
    text: { primary: '{trade:4}', ally: 'You may put the next ship you acquire this turn on top of your deck.', scrap: '' },
  },
  'trade-escort': {
    name: 'Trade Escort', faction: 'trade_federation', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [authority(4), combat(4)], ally: [draw(1)],
    text: { primary: '{authority:4} {combat:4}', ally: 'Draw a card.', scrap: '' },
  },
  flagship: {
    // Note the unusual split for Trade Federation: the authority is on the ALLY.
    name: 'Flagship', faction: 'trade_federation', cost: 6, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(5), draw(1)], ally: [authority(5)],
    text: { primary: '{combat:5} Draw a card.', ally: '{authority:5}', scrap: '' },
  },
  'command-ship': {
    name: 'Command Ship', faction: 'trade_federation', cost: 8, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [authority(4), combat(5), draw(2)],
    ally: [destroyBase(1)], // MANDATORY -- see header note.
    text: { primary: '{authority:4} {combat:5} Draw two cards.', ally: 'Destroy target base.', scrap: '' },
  },
  'trading-post': {
    name: 'Trading Post', faction: 'trade_federation', cost: 3, type: 'outpost',
    defense: 4, copies: 2, role: 'trade_deck',
    primary: [chooseOne({ label: '{authority:1}', then: [authority(1)] }, { label: '{trade:1}', then: [trade(1)] })],
    scrap: [combat(3)],
    text: { primary: '{authority:1} OR {trade:1}', ally: '', scrap: '{combat:3}' },
  },
  'barter-world': {
    name: 'Barter World', faction: 'trade_federation', cost: 4, type: 'base',
    defense: 4, copies: 2, role: 'trade_deck',
    primary: [chooseOne({ label: '{authority:2}', then: [authority(2)] }, { label: '{trade:2}', then: [trade(2)] })],
    scrap: [combat(5)],
    text: { primary: '{authority:2} OR {trade:2}', ally: '', scrap: '{combat:5}' },
  },
  'defense-center': {
    name: 'Defense Center', faction: 'trade_federation', cost: 5, type: 'outpost',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [chooseOne({ label: '{authority:3}', then: [authority(3)] }, { label: '{combat:2}', then: [combat(2)] })],
    ally: [combat(2)],
    text: { primary: '{authority:3} OR {combat:2}', ally: '{combat:2}', scrap: '' },
  },
  'port-of-call': {
    name: 'Port of Call', faction: 'trade_federation', cost: 6, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [trade(3)],
    scrap: [draw(1), destroyBase(0)], // draw MANDATORY, destruction optional
    text: { primary: '{trade:3}', ally: '', scrap: 'Draw a card. You may destroy target base.' },
  },
  'central-office': {
    name: 'Central Office', faction: 'trade_federation', cost: 7, type: 'base',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [trade(2), topdeckNextShip()], ally: [draw(1)],
    text: { primary: '{trade:2} You may put the next ship you acquire this turn on top of your deck.', ally: 'Draw a card.', scrap: '' },
  },

  // ═════════════════════════════════ BLOB (20) ═══════════════════════════════
  'blob-fighter': {
    name: 'Blob Fighter', faction: 'blob', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(3)], ally: [draw(1)],
    text: { primary: '{combat:3}', ally: 'Draw a card.', scrap: '' },
  },
  'trade-pod': {
    name: 'Trade Pod', faction: 'blob', cost: 2, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(3)], ally: [combat(2)],
    text: { primary: '{trade:3}', ally: '{combat:2}', scrap: '' },
  },
  'battle-pod': {
    name: 'Battle Pod', faction: 'blob', cost: 2, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(4), scrapTradeRow(0)], ally: [combat(2)],
    text: { primary: '{combat:4} You may scrap a card in the trade row.', ally: '{combat:2}', scrap: '' },
  },
  ram: {
    name: 'Ram', faction: 'blob', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(5)], ally: [combat(2)], scrap: [trade(3)],
    text: { primary: '{combat:5}', ally: '{combat:2}', scrap: '{trade:3}' },
  },
  'blob-wheel': {
    name: 'Blob Wheel', faction: 'blob', cost: 3, type: 'base',
    defense: 5, copies: 3, role: 'trade_deck',
    primary: [combat(1)], scrap: [trade(3)],
    text: { primary: '{combat:1}', ally: '', scrap: '{trade:3}' },
  },
  'blob-destroyer': {
    name: 'Blob Destroyer', faction: 'blob', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(6)],
    ally: [destroyBase(0), scrapTradeRow(0)], // "and/or" = two independent optional clauses
    text: { primary: '{combat:6}', ally: 'You may destroy target base and/or scrap a card in the trade row.', scrap: '' },
  },
  'the-hive': {
    name: 'The Hive', faction: 'blob', cost: 5, type: 'base',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [combat(3)], ally: [draw(1)],
    text: { primary: '{combat:3}', ally: 'Draw a card.', scrap: '' },
  },
  'battle-blob': {
    name: 'Battle Blob', faction: 'blob', cost: 6, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(8)], ally: [draw(1)], scrap: [combat(4)],
    text: { primary: '{combat:8}', ally: 'Draw a card.', scrap: '{combat:4}' },
  },
  'blob-carrier': {
    name: 'Blob Carrier', faction: 'blob', cost: 6, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(7)],
    ally: [{ k: 'ACQUIRE_FREE', filter: 'ship', maxCost: null, dest: 'deck_top', min: 1 }],
    text: { primary: '{combat:7}', ally: 'Acquire any ship for free and put it on top of your deck.', scrap: '' },
  },
  mothership: {
    name: 'Mothership', faction: 'blob', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(6), draw(1)], ally: [draw(1)],
    text: { primary: '{combat:6} Draw a card.', ally: 'Draw a card.', scrap: '' },
  },
  'blob-world': {
    name: 'Blob World', faction: 'blob', cost: 8, type: 'base',
    defense: 7, copies: 1, role: 'trade_deck',
    primary: [chooseOne(
      { label: '{combat:5}', then: [combat(5)] },
      { label: 'Draw a card for each Blob card played this turn', then: [{ k: 'PER', ref: { counter: 'faction_played_this_turn', faction: 'blob' }, then: [draw(1)] }] },
    )],
    text: { primary: "{combat:5} OR Draw a card for each Blob card that you've played this turn.", ally: '', scrap: '' },
  },

  // ═════════════════════════════ STAR EMPIRE (20) ════════════════════════════
  'imperial-fighter': {
    name: 'Imperial Fighter', faction: 'star_empire', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(2), oppDiscard(1)], ally: [combat(2)],
    text: { primary: '{combat:2} Target opponent discards a card.', ally: '{combat:2}', scrap: '' },
  },
  corvette: {
    name: 'Corvette', faction: 'star_empire', cost: 2, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(1), draw(1)], ally: [combat(2)],
    text: { primary: '{combat:1} Draw a card.', ally: '{combat:2}', scrap: '' },
  },
  'survey-ship': {
    name: 'Survey Ship', faction: 'star_empire', cost: 3, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(1), draw(1)], scrap: [oppDiscard(1)],
    text: { primary: '{trade:1} Draw a card.', ally: '', scrap: 'Target opponent discards a card.' },
  },
  'imperial-frigate': {
    name: 'Imperial Frigate', faction: 'star_empire', cost: 3, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(4), oppDiscard(1)], ally: [combat(2)], scrap: [draw(1)],
    text: { primary: '{combat:4} Target opponent discards a card.', ally: '{combat:2}', scrap: 'Draw a card.' },
  },
  'recycling-station': {
    name: 'Recycling Station', faction: 'star_empire', cost: 4, type: 'outpost',
    defense: 4, copies: 2, role: 'trade_deck',
    primary: [chooseOne(
      { label: '{trade:1}', then: [trade(1)] },
      { label: 'Discard up to two cards, then draw that many', then: [{ k: 'DISCARD_THEN_DRAW', max: 2 }] },
    )],
    text: { primary: '{trade:1} OR discard up to two cards, then draw that many cards.', ally: '', scrap: '' },
  },
  'space-station': {
    name: 'Space Station', faction: 'star_empire', cost: 4, type: 'outpost',
    defense: 4, copies: 2, role: 'trade_deck',
    primary: [combat(2)], ally: [combat(2)], scrap: [trade(4)],
    text: { primary: '{combat:2}', ally: '{combat:2}', scrap: '{trade:4}' },
  },
  'war-world': {
    name: 'War World', faction: 'star_empire', cost: 5, type: 'outpost',
    defense: 4, copies: 1, role: 'trade_deck',
    primary: [combat(3)], ally: [combat(4)],
    text: { primary: '{combat:3}', ally: '{combat:4}', scrap: '' },
  },
  battlecruiser: {
    name: 'Battlecruiser', faction: 'star_empire', cost: 6, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(5), draw(1)], ally: [oppDiscard(1)], scrap: [draw(1), destroyBase(0)],
    text: { primary: '{combat:5} Draw a card.', ally: 'Target opponent discards a card.', scrap: 'Draw a card. You may destroy target base.' },
  },
  'royal-redoubt': {
    name: 'Royal Redoubt', faction: 'star_empire', cost: 6, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [combat(3)], ally: [oppDiscard(1)],
    text: { primary: '{combat:3}', ally: 'Target opponent discards a card.', scrap: '' },
  },
  dreadnaught: {
    name: 'Dreadnaught', faction: 'star_empire', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(7), draw(1)], scrap: [combat(5)],
    text: { primary: '{combat:7} Draw a card.', ally: '', scrap: '{combat:5}' },
  },
  'fleet-hq': {
    // Post-errata. The pre-errata static "All of your ships get 1 Combat" is what
    // stale fan sources still show -- do not "correct" this back.
    name: 'Fleet HQ', faction: 'star_empire', cost: 8, type: 'base',
    defense: 8, copies: 1, role: 'trade_deck',
    primary: [],
    triggers: [{ on: 'PLAY_SHIP', effects: [combat(1)] }],
    text: { primary: 'Whenever you play a ship, gain {combat:1}.', ally: '', scrap: '' },
  },

  // ════════════════════════════ MACHINE CULT (20) ════════════════════════════
  'trade-bot': {
    name: 'Trade Bot', faction: 'machine_cult', cost: 1, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(1), scrapHandDiscard(0, 1)], ally: [combat(2)],
    text: { primary: '{trade:1} You may scrap a card in your hand or discard pile.', ally: '{combat:2}', scrap: '' },
  },
  'missile-bot': {
    name: 'Missile Bot', faction: 'machine_cult', cost: 2, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [combat(2), scrapHandDiscard(0, 1)], ally: [combat(2)],
    text: { primary: '{combat:2} You may scrap a card in your hand or discard pile.', ally: '{combat:2}', scrap: '' },
  },
  'supply-bot': {
    name: 'Supply Bot', faction: 'machine_cult', cost: 3, type: 'ship',
    defense: null, copies: 3, role: 'trade_deck',
    primary: [trade(2), scrapHandDiscard(0, 1)], ally: [combat(2)],
    text: { primary: '{trade:2} You may scrap a card in your hand or discard pile.', ally: '{combat:2}', scrap: '' },
  },
  'patrol-mech': {
    name: 'Patrol Mech', faction: 'machine_cult', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [chooseOne({ label: '{trade:3}', then: [trade(3)] }, { label: '{combat:5}', then: [combat(5)] })],
    ally: [scrapHandDiscard(1, 1)], // MANDATORY once activated -- no "you may" printed
    text: { primary: '{trade:3} OR {combat:5}', ally: 'Scrap a card in your hand or discard pile.', scrap: '' },
  },
  'stealth-needle': {
    name: 'Stealth Needle', faction: 'machine_cult', cost: 4, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [{ k: 'COPY_SHIP' }],
    text: { primary: "Copy another ship you've played this turn. Stealth Needle has that ship's faction in addition to Machine Cult.", ally: '', scrap: '' },
  },
  'battle-mech': {
    name: 'Battle Mech', faction: 'machine_cult', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(4), scrapHandDiscard(0, 1)], ally: [draw(1)],
    text: { primary: '{combat:4} You may scrap a card in your hand or discard pile.', ally: 'Draw a card.', scrap: '' },
  },
  'missile-mech': {
    name: 'Missile Mech', faction: 'machine_cult', cost: 6, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(6), destroyBase(0)], ally: [draw(1)],
    text: { primary: '{combat:6} You may destroy target base.', ally: 'Draw a card.', scrap: '' },
  },
  'battle-station': {
    // No primary ability at all -- a pure defensive wall with one scrap action.
    name: 'Battle Station', faction: 'machine_cult', cost: 3, type: 'outpost',
    defense: 5, copies: 2, role: 'trade_deck',
    primary: [], scrap: [combat(5)],
    text: { primary: '', ally: '', scrap: '{combat:5}' },
  },
  'mech-world': {
    // No primary to activate: the wildcard is a continuous static property.
    name: 'Mech World', faction: 'machine_cult', cost: 5, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [], factionWildcard: true,
    text: { primary: 'Counts as an ally for all factions.', ally: '', scrap: '' },
  },
  junkyard: {
    name: 'Junkyard', faction: 'machine_cult', cost: 6, type: 'outpost',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [scrapHandDiscard(1, 1)], // mandatory once you choose to activate
    text: { primary: 'Scrap a card in your hand or discard pile.', ally: '', scrap: '' },
  },
  'machine-base': {
    // Strict order: draw FIRST, then scrap. Hand only -- the discard pile is not
    // a legal source here, unlike Junkyard and Brain World.
    name: 'Machine Base', faction: 'machine_cult', cost: 7, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [draw(1), scrapHand(1, 1)],
    text: { primary: 'Draw a card, then scrap a card from your hand.', ally: '', scrap: '' },
  },
  'brain-world': {
    name: 'Brain World', faction: 'machine_cult', cost: 8, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [{ k: 'SCRAP_THEN_DRAW', zones: ['hand', 'discard'], max: 2 }],
    text: { primary: 'Scrap up to two cards from your hand and/or discard pile. Draw a card for each card scrapped this way.', ally: '', scrap: '' },
  },

  // ═══════════════════════════ STARTERS & EXPLORER ═══════════════════════════
  scout: {
    name: 'Scout', faction: 'unaligned', cost: 0, type: 'ship',
    defense: null, copies: 0, role: 'starter',
    primary: [trade(1)],
    text: { primary: '{trade:1}', ally: '', scrap: '' },
  },
  viper: {
    name: 'Viper', faction: 'unaligned', cost: 0, type: 'ship',
    defense: null, copies: 0, role: 'starter',
    primary: [combat(1)],
    text: { primary: '{combat:1}', ally: '', scrap: '' },
  },
  explorer: {
    name: 'Explorer', faction: 'unaligned', cost: 2, type: 'ship',
    defense: null, copies: 0, role: 'explorer',
    primary: [trade(2)], scrap: [combat(2)],
    text: { primary: '{trade:2}', ally: '', scrap: '{combat:2}' },
  },
}

export const CARDS: CardRegistry = new Map([
  ...buildDefs(defs, 'core'),
  ...buildDefs(FRONTIERS, 'frontiers'),
  ...buildDefs(COLONY_WARS, 'colony-wars'),
  ...buildDefs(CRISIS_BASES, 'crisis-bases'),
  ...buildDefs(CRISIS_FLEETS, 'crisis-fleets'),
  ...buildDefs(CRISIS_HEROES, 'crisis-heroes'),
  ...buildDefs(CRISIS_EVENTS, 'crisis-events'),
  ...buildDefs(UNITED_ASSAULT, 'united-assault'),
  ...buildDefs(UNITED_COMMAND, 'united-command'),
  ...buildDefs(UNITED_HEROES, 'united-heroes'),
  ...buildDefs(HIGH_ALERT_FIRST_STRIKE, 'high-alert-first-strike'),
  ...buildDefs(HIGH_ALERT_TECH, 'high-alert-tech'),
  ...buildDefs(HIGH_ALERT_REQUISITION, 'high-alert-requisition'),
  ...buildDefs(HIGH_ALERT_INVASION, 'high-alert-invasion'),
  ...buildDefs(HIGH_ALERT_HEROES, 'high-alert-heroes'),
  ...buildDefs(STELLAR_ALLIES, 'stellar-allies'),
  ...buildDefs(PROMO_PACK_1, 'promo-1'),
  ...buildDefs(YEAR_TWO_PROMOS, 'promo-year-2'),
  ...buildDefs(FRONTIERS_PROMOS, 'frontiers-promos'),
])

export function cardDef(id: CardDefId): CardDef {
  const d = CARDS.get(id)
  if (!d) throw new Error(`Unknown card definition: ${id}`)
  return d
}

export const SCOUT = asDefId('scout')
export const VIPER = asDefId('viper')
export const EXPLORER = asDefId('explorer')

/** The 80-card trade deck, as a flat list of definition ids with duplicates. */
/**
 * The trade deck as a flat list of card ids, one entry per physical copy.
 *
 * `only` restricts it to a subset -- a campaign mission fighting one faction
 * should not be offering the other three. Copy counts stay as printed, so a
 * restricted deck is a real subset of the real deck rather than a reweighted
 * one.
 */
export function tradeDeckComposition(
  only?: readonly CardDefId[],
  sets: readonly SetId[] = ['core'],
): CardDefId[] {
  const allow = only ? new Set<string>(only) : null
  const enabled = new Set<SetId>(sets)
  const out: CardDefId[] = []
  for (const def of CARDS.values()) {
    if (def.role !== 'trade_deck') continue
    if (!enabled.has(def.set)) continue
    if (allow && !allow.has(def.id)) continue
    for (let i = 0; i < def.copies; i++) out.push(def.id)
  }
  return out
}

/** Every set the registry knows about, in the order they should be offered. */
export const ALL_SETS: readonly SetId[] = [
  'core', 'frontiers', 'colony-wars',
  'crisis-bases', 'crisis-fleets', 'crisis-heroes', 'crisis-events',
  'united-assault', 'united-command', 'united-heroes',
  'high-alert-first-strike', 'high-alert-tech', 'high-alert-requisition',
  'high-alert-invasion', 'high-alert-heroes',
  'stellar-allies', 'promo-1', 'promo-year-2', 'frontiers-promos',
]
