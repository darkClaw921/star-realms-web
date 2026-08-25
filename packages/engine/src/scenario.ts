import type { CardDefId, PlayerId } from './ids'

/**
 * Scenario rules: the part of a campaign mission the engine has to keep
 * enforcing for the whole game, as opposed to the part that only shapes the
 * opening position.
 *
 * Deliberately narrow. A mission is DATA, never code, for the same reason card
 * abilities are: it has to survive JSON round-tripping, replay and version
 * migration. Anything a mission wants that this cannot express should become a
 * new variant here, so the vocabulary stays reviewable, rather than an escape
 * hatch that takes a function.
 */
export type Objective =
  /** The printed game: reduce the opponent to zero authority. */
  | { k: 'AUTHORITY' }
  /** Hold out. Reaching this turn number without dying is a win. */
  | { k: 'SURVIVE'; turns: number }
  /** Break the blockade: destroy this many enemy bases. */
  | { k: 'DESTROY_BASES'; n: number }
  /** Win the peace: climb to this much authority. */
  | { k: 'REACH_AUTHORITY'; n: number }
  /** Dimensional Horror: it has no authority, only tentacles. */
  | { k: 'DESTROY_TENTACLES' }

export interface ScenarioRules {
  readonly id: string
  /** Whose objective it is. The other side always wins by authority. */
  readonly hero: PlayerId
  readonly objective: Objective
  /**
   * Combat and trade handed to a side at the start of each of its turns.
   *
   * This is how a boss gets to be a boss without inventing a second kind of
   * card: it is simply better funded every turn. Applied at TURN_START, so it
   * behaves like any other gain and is spent or lost by the same rules.
   */
  readonly turnStartCombat: Partial<Record<PlayerId, number>>
  readonly turnStartTrade: Partial<Record<PlayerId, number>>
  /**
   * A standing discount on every price this side pays.
   *
   * Read only by `costFor`, which is the one place a price may be decided --
   * so the trade row, the set-aside cards, the scrap heap and the UI all agree
   * about it without any of them knowing it exists. The Explorer pile is
   * deliberately outside: it has no `costFor` call and a one-trade Explorer is
   * a different game.
   */
  readonly buyDiscount?: Partial<Record<PlayerId, number>>
}

/** The opening position. Applied once, by createGame, and then forgotten. */
export interface ScenarioSetup {
  readonly rules: ScenarioRules
  /** Overrides STARTING_AUTHORITY per side. */
  readonly authority: Partial<Record<PlayerId, number>>
  /** Replaces the 8 Scout / 2 Viper starting deck. */
  readonly starterDeck: Partial<Record<PlayerId, readonly CardDefId[]>>
  /** Bases already standing when the game opens. */
  readonly startingBases: Partial<Record<PlayerId, readonly CardDefId[]>>
  /**
   * Restricts the trade deck to these cards, at their printed copy counts.
   * null means the full 80-card deck.
   */
  readonly tradeDeckOnly: readonly CardDefId[] | null
  /**
   * Sides whose personal deck must NOT be shuffled. Blob Assault stacks its
   * boss deck in a printed order, and that order is the challenge.
   */
  readonly unshuffled?: readonly PlayerId[]
  /** Cards that start in a discard pile rather than a deck. */
  readonly startingDiscard?: Partial<Record<PlayerId, readonly CardDefId[]>>
  /** Overrides the five-card hand. A Legendary Commander sets the base; this wins. */
  readonly handSize?: Partial<Record<PlayerId, number>>
  /**
   * Cards that open face up BESIDE the board rather than on it -- the revealed
   * gambit zone, where a permanent modifier can watch play, pay at the start of
   * a turn, or wait to be activated.
   *
   * Separate from `startingBases` because these are not bases: nothing attacks
   * them, they are never destroyed, and they never occupy the play area.
   */
  readonly startingSideCards?: Partial<Record<PlayerId, readonly CardDefId[]>>
}

export function noScenarioCounters(): Partial<Record<PlayerId, number>> {
  return { p1: 0, p2: 0 }
}
