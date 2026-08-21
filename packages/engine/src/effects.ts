import type { CardDefId, Faction, Zone } from './ids'

/**
 * THE EFFECT VOCABULARY.
 *
 * Effects are serializable DATA DESCRIPTORS, never closures. This is the single
 * decision that determines whether expansions are data or a rewrite: the
 * resolution stack lives inside GameState, so anything on it must survive
 * JSON.stringify -> parse -> continue. A closure cannot.
 *
 * Every effect here is exercised by the base set. Where an effect looks
 * over-general (PER, IF), it is because the base set already needs it and
 * generality costs nothing.
 *
 * VERSIONED: bump EFFECT_VOCABULARY_VERSION when the shape of any variant
 * changes, so stored replays can be refused rather than silently misread.
 */
export const EFFECT_VOCABULARY_VERSION = 1

/** Conditions evaluated against the state at resolution time. */
export type Condition =
  /** Embassy Yacht: "If you have two or more bases in play". Outposts are bases. */
  | { c: 'BASES_IN_PLAY_AT_LEAST'; n: number }

/** Counters that PER can multiply an effect by. */
export type CounterRef =
  /**
   * Blob World. Counts Blob cards PLAYED FROM HAND this turn -- not cards already
   * in play, not cards acquired, and not a Stealth Needle copy (per official FAQ,
   * the copy happens after the card enters play).
   */
  | { counter: 'faction_played_this_turn'; faction: Faction }

/** Where an acquired card is routed. Acquisition is not hard-wired to the discard pile. */
export type AcquireDest = 'discard' | 'deck_top'

export type Effect =
  // ---- resource gains -------------------------------------------------------
  | { k: 'GAIN_TRADE'; n: number }
  | { k: 'GAIN_COMBAT'; n: number }
  | { k: 'GAIN_AUTHORITY'; n: number }
  | { k: 'DRAW'; n: number }

  // ---- interaction ----------------------------------------------------------
  /** "Target opponent discards a card." The OPPONENT chooses which. */
  | { k: 'OPPONENT_DISCARD'; n: number }
  /**
   * "Destroy target base." min:0 means the printed text says "you may".
   * Legal targets respect the outpost shield -- see legal.ts.
   */
  | { k: 'DESTROY_BASE'; min: 0 | 1; max: 1 }

  // ---- scrapping ------------------------------------------------------------
  /**
   * "Scrap a card in your hand or discard pile" (min 1) or
   * "You may scrap a card in your hand or discard pile" (min 0).
   * Machine Base restricts zones to ['hand'] only.
   */
  | { k: 'SCRAP_FROM_ZONES'; zones: readonly Zone[]; min: number; max: number }
  /** Battle Pod / Blob Destroyer. min:0 when the text says "you may". */
  | { k: 'SCRAP_TRADE_ROW'; min: 0 | 1; max: 1 }
  /**
   * Brain World: "Scrap up to two cards from your hand and/or discard pile.
   * Draw a card for each card scrapped this way." The draw count is coupled to
   * the actual number scrapped, which is why this is not SEQ[SCRAP, DRAW].
   */
  | { k: 'SCRAP_THEN_DRAW'; zones: readonly Zone[]; max: number }
  /**
   * Recycling Station: "discard up to two cards, then draw that many cards."
   * All discards happen BEFORE any draw -- if the deck empties during the draws,
   * the reshuffled discard pile already contains the cards just discarded.
   */
  | { k: 'DISCARD_THEN_DRAW'; max: number }

  // ---- acquisition ----------------------------------------------------------
  /** Blob Carrier: "Acquire any ship for free and put it on top of your deck." */
  | { k: 'ACQUIRE_FREE'; filter: 'ship' | 'any'; maxCost: number | null; dest: AcquireDest }
  /**
   * Freighter / Central Office. Arms a pending redirection consumed by the next
   * qualifying acquisition. Multiple copies STACK (official ruling): each
   * acquisition consumes exactly one, and unused ones expire at end of turn.
   */
  | { k: 'TOPDECK_NEXT_ACQUIRED'; filter: 'ship'; min: 0 | 1 }

  // ---- Stealth Needle -------------------------------------------------------
  /**
   * "Copy another ship you've played this turn." Only a ship, only one played
   * this turn. Gains that ship's primary/ally/scrap and its faction IN ADDITION
   * to Machine Cult. With no legal target the card still enters play, as a plain
   * Machine Cult ship with no abilities -- never block the play.
   */
  | { k: 'COPY_SHIP' }

  // ---- control flow ---------------------------------------------------------
  /** The printed "OR" on Trading Post, Barter World, Blob World, Patrol Mech, ... */
  | { k: 'CHOOSE_ONE'; branches: readonly EffectBranch[] }
  /** Wraps a composite optional clause. Selections carry their own min/max instead. */
  | { k: 'MAY'; label: string; then: readonly Effect[] }
  | { k: 'IF'; cond: Condition; then: readonly Effect[] }
  /** Repeat `then` once per unit of `ref`. Blob World's draw. */
  | { k: 'PER'; ref: CounterRef; then: readonly Effect[] }
  | { k: 'SEQ'; effects: readonly Effect[] }

  // ── Frontiers Challenges: the script bosses ───────────────────────────────
  // A boss turn is pushed onto the resolution stack like any other effect, so a
  // step that asks the player something (a forced discard) suspends the boss
  // mid-turn and resumes when they answer -- exactly as a card ability does.
  /** Expands into the current boss's Order of Play. */
  | { k: 'BOSS_TURN' }
  /** Closes the boss's turn once its Order of Play has fully resolved. */
  | { k: 'BOSS_END_TURN' }
  /** Spends all the boss's combat using the rulebook targeting algorithm. */
  | { k: 'BOSS_ATTACK' }
  /** Automatons: assimilate the trade row's far card, then grow the count. */
  | { k: 'BOSS_ASSIMILATE' }
  /** Nemesis Beast: scrap the far card face down; combat equals the pile. */
  | { k: 'BOSS_NEMESIS_STEP' }
  /** Dimensional Horror: feed the far card to a tentacle and grow. */
  | { k: 'BOSS_HORROR_STEP' }
  /** Pirates of the Dark Star: the revealed card decides what is done to you. */
  | { k: 'BOSS_PIRATE_STEP' }

export interface EffectBranch {
  readonly label: string
  readonly then: readonly Effect[]
}

/**
 * A triggered ability -- the fourth kind, alongside primary / ally / scrap.
 *
 * Without this Fleet HQ cannot be expressed: its errata'd text is "Whenever you
 * play a ship, gain 1 Combat", which fires an unbounded number of times per turn
 * and so does not fit a once-per-turn activated slot.
 */
export interface Trigger {
  readonly on: 'PLAY_SHIP' | 'PLAY_BASE' | 'ACQUIRE'
  readonly effects: readonly Effect[]
}

/** Which ability slot an effect came from. Drives once-per-turn bookkeeping. */
export type AbilitySlot = 'primary' | 'ally' | 'scrap' | 'trigger'

/** Copy-source for Stealth Needle; null on every other card. */
export interface CopyState {
  readonly copiedDef: CardDefId
}
