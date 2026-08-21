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
  /**
   * Colony Wars' Lancer ("if an opponent controls a base", n = 1) and Crisis'
   * Obliterator ("if your opponent has two or more bases in play", n = 2).
   * Outposts are bases.
   */
  | { c: 'OPPONENT_BASES_AT_LEAST'; n: number }
  /**
   * Colony Wars' acquire-to-hand cards: "if you've played a Blob card this turn".
   * Reads the same counter Blob World does, so a Stealth Needle copy does not
   * satisfy it -- the copy is not a card played.
   */
  | { c: 'FACTION_PLAYED_THIS_TURN'; faction: Faction; n: number }
  /** Promo bases: "if you played a base this turn (including this one)". */
  | { c: 'BASE_PLAYED_THIS_TURN' }
  /** Viper Bot: "if you've scrapped a card from your hand or discard pile". */
  | { c: 'SCRAPPED_THIS_TURN'; n: number }

/** Counters that PER can multiply an effect by. */
export type CounterRef =
  /**
   * Blob World. Counts Blob cards PLAYED FROM HAND this turn -- not cards already
   * in play, not cards acquired, and not a Stealth Needle copy (per official FAQ,
   * the copy happens after the card enters play).
   */
  | { counter: 'faction_played_this_turn'; faction: Faction }
  /**
   * High Alert's Lunar Landing: "for each Trade Federation card you have IN
   * PLAY" -- standing bases included, not just what you played this turn.
   */
  | { counter: 'faction_in_play'; faction: Faction }

/**
 * Where an acquired card is routed. Acquisition is not hard-wired to the discard
 * pile: Blob Carrier tops the deck, and Colony Wars routes cards straight into
 * hand, which is a real tempo difference and not a reskin of topdecking.
 */
export type AcquireDest =
  | 'discard' | 'deck_top' | 'hand' | 'in_play'
  /** Frontier Tug: the base you buy is shuffled into your deck, not discarded. */
  | 'deck_shuffle'

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
  /**
   * `in_play` is Crisis' Construction Hauler: the base you buy skips the discard
   * pile AND the deck and starts defending immediately. Only ever paired with
   * filter 'base' -- a ship put "into play" would be a ship whose primary never
   * resolved, which the printed cards never ask for.
   */
  readonly dest: 'deck_top' | 'hand' | 'in_play' | 'deck_shuffle'
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
  | { k: 'SCRAP_THEN_DRAW'; zones: readonly Zone[]; max: number; factions?: readonly Faction[] }
  /**
   * Recycling Station: "discard up to two cards, then draw that many cards."
   * All discards happen BEFORE any draw -- if the deck empties during the draws,
   * the reshuffled discard pile already contains the cards just discarded.
   */
  | { k: 'DISCARD_THEN_DRAW'; max: number }

  // ---- acquisition ----------------------------------------------------------
  /**
   * Blob Carrier: "Acquire any ship for free and put it on top of your deck."
   * `min` is 0 where the text says "you may" (Crisis' Customs Frigate).
   */
  | { k: 'ACQUIRE_FREE'; filter: 'ship' | 'base' | 'any'; maxCost: number | null; dest: AcquireDest; min: 0 | 1 }
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
  /**
   * Repair Mech ("a base") and United's Coalition Messenger ("a card of cost
   * five or less"). One effect with two knobs rather than two near-identical
   * ones, because the only difference between them is the filter.
   */
  | { k: 'TOPDECK_FROM_DISCARD'; filter: 'base' | 'any'; maxCost: number | null; min: number; max: number }
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

  // ── Crisis ────────────────────────────────────────────────────────────────
  /**
   * Mega Mech: "You may return target base from play to its owner's hand."
   *
   * Not destruction: the base goes to HAND, so its owner replays it for free
   * next turn. It also ignores the outpost shield, because returning is not an
   * attack -- the shield is worded against attacks and targeting by destruction.
   */
  | { k: 'RETURN_BASE_TO_HAND'; min: 0 | 1 }
  /**
   * Crisis' Heroes: "Gain a Blob Ally -- until end of turn, you may use all of
   * your Blob ally abilities."
   *
   * Unlocks the faction outright rather than adding a card of it, so it works
   * from a single card and, like every other ally unlock, survives the enabler
   * leaving play.
   */
  | { k: 'GAIN_ALLY'; faction: Faction }
  /**
   * Crisis' Events, every one of which is worded "each player ...".
   *
   * Resolves `then` once per player with THAT player as the controller, active
   * player first. Without it, every event would need its own two-sided handler.
   */
  | { k: 'EACH_PLAYER'; then: readonly Effect[] }
  /** Events deal in losses, which are not negative gains: authority floors at 0. */
  | { k: 'LOSE_AUTHORITY'; n: number }
  /**
   * Black Hole: "may discard up to two cards; for each card less than two that a
   * player discards, that player loses 4 Authority." The penalty is computed
   * from how many were actually discarded, so it cannot be SEQ of two effects.
   */
  | { k: 'DISCARD_OR_LOSE'; max: number; per: number }
  /** Bombardment: "either destroys a base they control or loses 6 Authority." */
  | { k: 'DESTROY_OWN_BASE_OR_LOSE'; n: number }
  /** Supernova: the whole trade row goes to the scrap heap. */
  | { k: 'SCRAP_WHOLE_TRADE_ROW' }
  /** Put N cards from hand back on top of your deck, in the player's order. */
  | { k: 'TOPDECK_FROM_HAND'; n: number }
  /**
   * Warp Jump: "draws three cards, then puts two of THOSE cards back on top of
   * their deck in any order."
   *
   * One effect rather than DRAW followed by TOPDECK_FROM_HAND, because "those
   * cards" is a real restriction: the cards already in hand are not eligible.
   * Building the choice from the cards this effect just drew keeps that exact,
   * and keeps it out of persistent state.
   */
  | { k: 'DRAW_THEN_TOPDECK'; draw: number; back: number }
  /** Trade Mission: the OTHER player draws, while the active one gets the trade. */
  | { k: 'OPPONENT_DRAW'; n: number }

  // ── High Alert ────────────────────────────────────────────────────────────
  /**
   * Stellar Link: "Look at the top two cards of your deck. Put one into your
   * discard pile and the other back on top of your deck."
   *
   * The cards are looked at, so they are shown only to their owner -- the same
   * redaction rule as a hand, and the reason this is one effect rather than a
   * draw followed by a discard.
   */
  | { k: 'SCRY'; n: number }
  /**
   * Stealth: "Choose a faction. You count as having an additional card of that
   * faction in play this turn."
   *
   * A phantom card, not a real one: it satisfies ally conditions and nothing
   * else -- it is not in play, cannot be attacked, and is gone at end of turn.
   */
  | { k: 'PHANTOM_FACTION'; n: number }

  // ── Stellar Allies ────────────────────────────────────────────────────────
  /**
   * Needle Lancer: "Copy an ally ability that you've already used this turn."
   *
   * Reads a per-turn list of definition + slot rather than of card instances,
   * so it still works when the card that used the ability has since been
   * scrapped -- which is exactly the line the card rewards.
   */
  | { k: 'COPY_USED_ALLY' }

  // ── Frontiers Kickstarter promos ──────────────────────────────────────────
  /**
   * "Scrap this card from play." Half the pack's ally abilities open with it:
   * the card pays for itself and is gone. Distinct from the scrap SLOT, which is
   * how a card volunteers itself -- here the scrapping is part of the effect.
   */
  | { k: 'SCRAP_SELF' }
  /**
   * The Colossus: "Choose a faction as you play The Colossus. The Colossus has
   * that faction." A real faction, not a phantom -- it counts for other cards'
   * ally conditions and for its own per-faction draw.
   */
  | { k: 'CHOOSE_OWN_FACTION' }
  /**
   * Midgate Station: "Discard any number of cards. Gain Trade or Combat equal to
   * the number of cards discarded plus 1." ONE choice of resource for the whole
   * lot, unlike Supply Depot's per-card split.
   */
  | { k: 'DISCARD_FOR_RESOURCE_PLUS'; plus: number }
  /** Assimilator: move a card from an opponent's discard pile to yours. */
  | { k: 'STEAL_FROM_DISCARD'; n: number }
  /** Superflare: shuffle your discard pile back into your deck. */
  | { k: 'SHUFFLE_DISCARD_INTO_DECK' }
  /** Wormhole: put a card from your discard pile into your hand. */
  | { k: 'DISCARD_TO_HAND'; min: 0 | 1 }
  /** Supply Run / Coalition Messenger's cousin: discard pile to the top of the deck. */
  | { k: 'DISCARD_TO_DECK_TOP'; min: 0 | 1 }
  /**
   * Mobilization: look at the top N, discard any number of them, put the rest
   * back on top in any order. A wider Stellar Link, so it shares its prompt.
   */
  | { k: 'SCRY_MANY'; n: number }
  /**
   * Recon Mission / Supply Run: an Explorer for nothing. Separate from
   * ACQUIRE_FREE because the Explorer pile is not the trade row -- it is never
   * refilled and never enters the row.
   */
  | { k: 'ACQUIRE_EXPLORER_FREE'; dest: AcquireDest; min: 0 | 1 }
  /**
   * The asymmetric half of an event: "each OTHER player ...". Resolves `then`
   * with the opponent as controller, which is what makes their half their own
   * choice rather than yours.
   */
  | { k: 'OPPONENT_EFFECT'; then: readonly Effect[] }
  /** Powerful Backing: phantom cards of a NAMED faction, with nothing to choose. */
  | { k: 'GAIN_PHANTOM'; faction: Faction; n: number }
  /**
   * Patience Rewarded: scrap a trade row card and set it aside, acquirable for
   * the rest of the game as if it were still in the row.
   */
  | { k: 'SET_ASIDE_FROM_ROW'; min: 0 | 1 }

  // ── Gambits ───────────────────────────────────────────────────────────────
  /** Wild Gambit: take a gambit at random from the pile nobody was dealt. */
  | { k: 'DRAW_GAMBIT'; n: number }
  /** Black Market: widen the trade row and give its revealer the discount. */
  | { k: 'OPEN_BLACK_MARKET' }
  /** Hidden Base: put a token card into play from outside any deck. */
  | { k: 'DEPLOY_TOKEN'; def: string }
  /** Triumphant Return: pay a scrapped card's cost to take it into hand. */
  | { k: 'BUY_FROM_SCRAP_HEAP'; min: 0 | 1 }

  // ── Missions ──────────────────────────────────────────────────────────────
  /**
   * Convert's reward: reveal the top three, one to hand, one to the discard
   * pile, one back on top. Three destinations, so it is three prompts in one
   * effect rather than a reuse of the two-way scry.
   */
  | { k: 'REVEAL_THREE_SPLIT' }

  // ── Command Decks ─────────────────────────────────────────────────────────
  /** Federation Scout: the next card of a faction costs less this turn. */
  | { k: 'DISCOUNT_NEXT_ACQUIRED'; faction: Faction; n: number }
  /**
   * "Scrap up to N, then gain X per card scrapped this way." The payout is
   * coupled to how many were actually scrapped, so it cannot be SEQ of two.
   */
  | { k: 'SCRAP_THEN_GAIN'; zones: readonly Zone[]; max: number; per: number
      what: 'trade' | 'combat' | 'authority' }
  /** Mech Battleship: draw as many as you scrapped, then discard as many. */
  | { k: 'SCRAP_DRAW_DISCARD'; zones: readonly Zone[]; max: number }
  /**
   * Re-fill the trade row, resolving any event that turns up. Pushed by the
   * refill itself when an event appears, so that the event can ask a question
   * and the refill resumes afterwards.
   */
  | { k: 'REFILL_TRADE_ROW' }

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
  readonly on:
    | 'PLAY_SHIP' | 'PLAY_BASE' | 'PLAY_SELF' | 'ACQUIRE_SELF' | 'SCRAP_OWN'
    /** Alignment Ingenuity: a ship or base used its own scrap ability. */
    | 'SCRAP_ABILITY'
    /** Splinter Tech: a Splinter ability was used. */
    | 'SPLINTER'
    /**
     * Coalition Efficiency: you are ABOUT to scrap from hand or discard, and may
     * take something else instead. A replacement, so it fires before the scrap
     * choice is offered rather than after it resolves.
     */
    | 'WOULD_SCRAP'
  /** Colony Wars' Command Center fires only on ships of one faction. */
  readonly faction?: Faction
  /** Veteran Pilots fires only on one specific card. */
  readonly cardId?: CardDefId
  readonly effects: readonly Effect[]
}

/** Which ability slot an effect came from. Drives once-per-turn bookkeeping. */
export type AbilitySlot =
  | 'primary' | 'ally' | 'ally2' | 'ally3' | 'ally4' | 'doubleAlly' | 'scrap'
  | 'splinter' | 'trigger'

/** Copy-source for Stealth Needle and Stealth Tower; null on every other card. */
export interface CopyState {
  readonly copiedDef: CardDefId
}
