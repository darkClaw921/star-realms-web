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
export const EFFECT_VOCABULARY_VERSION = 2

/** Conditions evaluated against the state at resolution time. */
export type Condition =
  /** Embassy Yacht: "If you have two or more bases in play". Outposts are bases. */
  | { c: 'BASES_IN_PLAY_AT_LEAST'; n: number }
  /** Colony Wars' Lancer: "If an opponent controls a base". Outposts are bases. */
  | { c: 'OPPONENT_HAS_BASE' }
  /**
   * Colony Wars' acquire-to-hand cards: "if you've played a Blob card this turn".
   * Reads the same counter Blob World does, so a Stealth Needle copy does not
   * satisfy it -- the copy is not a card played.
   */
  | { c: 'FACTION_PLAYED_THIS_TURN'; faction: Faction; n: number }

/** Counters that PER can multiply an effect by. */
export type CounterRef =
  /**
   * Blob World. Counts Blob cards PLAYED FROM HAND this turn -- not cards already
   * in play, not cards acquired, and not a Stealth Needle copy (per official FAQ,
   * the copy happens after the card enters play).
   */
  | { counter: 'faction_played_this_turn'; faction: Faction }

/**
 * Where an acquired card is routed. Acquisition is not hard-wired to the discard
 * pile: Blob Carrier tops the deck, and Colony Wars routes cards straight into
 * hand, which is a real tempo difference and not a reskin of topdecking.
 */
export type AcquireDest = 'discard' | 'deck_top' | 'hand'

/**
 * An armed "put the next card you acquire this turn somewhere other than the
 * discard pile" effect.
 *
 * One shape rather than a counter per destination, because Colony Wars adds a
 * third axis (ship / base / either) and a second destination (hand), and the
 * cross-product of counters would be six fields that must all be reset in the
 * same two places.
 */
export interface AcquireRedirect {
  readonly filter: 'ship' | 'base' | 'any'
  readonly dest: 'deck_top' | 'hand'
  /** The printed text says "you may". Freighter does; Factory World does not. */
  readonly optional: boolean
}

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
  /**
   * Battle Pod / Blob Destroyer. min:0 when the text says "you may".
   * Colony Wars' Ravager scraps up to TWO, which is why max is not fixed at 1.
   */
  | { k: 'SCRAP_TRADE_ROW'; min: number; max: number }
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
   * Freighter / Central Office / Factory World. Arms a pending redirection
   * consumed by the next qualifying acquisition. Multiple copies STACK (official
   * ruling): each acquisition consumes exactly one, and unused ones expire at
   * end of turn.
   */
  | { k: 'REDIRECT_NEXT_ACQUIRED'; redirect: AcquireRedirect }

  // ---- Stealth Needle -------------------------------------------------------
  /**
   * "Copy another ship you've played this turn." Only a ship, only one played
   * this turn. Gains that ship's primary/ally/scrap and its faction IN ADDITION
   * to Machine Cult. With no legal target the card still enters play, as a plain
   * Machine Cult ship with no abilities -- never block the play.
   */
  | { k: 'COPY_SHIP' }
  /**
   * Colony Wars' Stealth Tower. Same idea as the Needle, one axis different in
   * each direction: it copies a BASE, the base may be ANY base in play including
   * the opponent's, and the base need not have been played this turn.
   */
  | { k: 'COPY_BASE' }

  // ---- control flow ---------------------------------------------------------
  /** The printed "OR" on Trading Post, Barter World, Blob World, Patrol Mech, ... */
  | { k: 'CHOOSE_ONE'; branches: readonly EffectBranch[] }
  /** Wraps a composite optional clause. Selections carry their own min/max instead. */
  | { k: 'MAY'; label: string; then: readonly Effect[] }
  | { k: 'IF'; cond: Condition; then: readonly Effect[] }
  /** Repeat `then` once per unit of `ref`. Blob World's draw. */
  | { k: 'PER'; ref: CounterRef; then: readonly Effect[] }
  | { k: 'SEQ'; effects: readonly Effect[] }

  // ── Frontiers ─────────────────────────────────────────────────────────────
  /** Pulverizer: scrap a trade row card and gain combat equal to its cost. */
  | { k: 'SCRAP_TRADE_ROW_FOR_COMBAT'; min: 0 | 1; max: 1 }
  /** Neural Nexus: scrap from hand or discard, gain combat equal to its cost. */
  | { k: 'SCRAP_FOR_COMBAT'; zones: readonly Zone[]; min: 0 | 1; max: 1 }
  /** Repair Mech: put a base from your discard pile on top of your deck. */
  | { k: 'TOPDECK_BASE_FROM_DISCARD'; min: 0 | 1 }
  /** Warpgate Cruiser: discard any number of cards, gaining combat for each. */
  | { k: 'DISCARD_FOR_COMBAT'; per: number }
  /**
   * "Draw a card, then discard a card" -- the Star Empire filter. Mandatory and
   * self-targeting, so it is not OPPONENT_DISCARD and not optional.
   */
  | { k: 'SELF_DISCARD'; n: number }
  /** Reclamation Station: combat for every card you have scrapped this turn. */
  | { k: 'COMBAT_PER_SCRAPPED'; per: number }
  /** Mobile Market: at end of turn it comes back from the scrap heap. */
  | { k: 'RETURN_SELF_AT_END_OF_TURN' }

  // ── Colony Wars ───────────────────────────────────────────────────────────
  /**
   * "You may put this card directly into your hand" on the card just acquired.
   * Only ever reached from an ACQUIRE_SELF trigger, where ctx.source is the
   * freshly acquired instance sitting in the discard pile.
   */
  | { k: 'MOVE_SELF_TO_HAND' }
  /**
   * Supply Depot: "Discard up to 2 cards. Gain 2 Trade or 2 Combat for each card
   * discarded this way." The choice is per card, so a mixed split is legal.
   */
  | { k: 'DISCARD_FOR_TRADE_OR_COMBAT'; max: number; per: number }

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
  /** Automatons: play cards off the trade deck up to the Assimilation Count. */
  | { k: 'BOSS_ASSIMILATE' }
  /** Automatons: "after the Boss attacks, add 1 to the Assimilation Count". */
  | { k: 'BOSS_GROW' }
  /** Nemesis Beast: scrap the far card face down; combat equals the pile. */
  | { k: 'BOSS_NEMESIS_STEP' }
  /** Dimensional Horror: feed the far card to a tentacle and grow. */
  | { k: 'BOSS_HORROR_STEP' }
  /** Pirates of the Dark Star: the revealed card decides what is done to you. */
  | { k: 'BOSS_PIRATE_STEP' }
  /** Nemesis Beast, green: destroy a base, or gain combat if there is none. */
  | { k: 'DESTROY_BASE_OR_COMBAT'; n: number }
  /** Nemesis Beast, red: a RANDOM card from the hand goes on top of the deck. */
  | { k: 'TOPDECK_RANDOM_FROM_HAND'; n: number }
  /** Dimensional Horror, red: a Scout or Viper goes on top of your deck. */
  | { k: 'TOPDECK_STARTER'; n: number }
  /** Dimensional Horror, blue: every base the other side has, at once. */
  | { k: 'DESTROY_ALL_ENEMY_BASES' }

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
  /**
   * PLAY_SHIP / PLAY_BASE fire on OTHER cards entering play, watched by a card
   * already there (Fleet HQ).
   *
   * The two SELF forms fire on the card itself, and exist because a base has no
   * on-play slot at all: its `primary` is an activated ability the player spends
   * a click on. PLAY_SELF is how Stealth Tower copies "after it enters play"
   * (publisher FAQ) while leaving its primary free -- so the copied base's own
   * ability is still available that turn, which is the whole point of copying an
   * outpost. ACQUIRE_SELF fires on the card being bought, for Colony Wars'
   * "when you acquire this card" clause.
   */
  readonly on: 'PLAY_SHIP' | 'PLAY_BASE' | 'PLAY_SELF' | 'ACQUIRE_SELF'
  /** Colony Wars' Command Center fires only on ships of one faction. */
  readonly faction?: Faction
  readonly effects: readonly Effect[]
}

/** Which ability slot an effect came from. Drives once-per-turn bookkeeping. */
export type AbilitySlot = 'primary' | 'ally' | 'doubleAlly' | 'scrap' | 'trigger'

/** Copy-source for Stealth Needle and Stealth Tower; null on every other card. */
export interface CopyState {
  readonly copiedDef: CardDefId
}
