import type { CardDefId, CardInstance, CardIid, Faction, PlayerId } from './ids'
import type { AbilitySlot, AcquireDest, Effect, EffectBranch } from './effects'
import type { PendingChoice } from './choices'
import type { RngState } from './rng'
import type { BossState } from './boss'
import type { ScenarioRules } from './scenario'

export const ENGINE_VERSION = 1

/** Starting authority for a standard 2-player game. */
export const STARTING_AUTHORITY = 50
export const TRADE_ROW_SIZE = 5
export const EXPLORER_PILE_SIZE = 10
export const HAND_SIZE = 5
/** The first player's very first hand only. */
export const FIRST_TURN_HAND_SIZE = 3
export const EXPLORER_COST = 2

// Re-exported so the many modules that already import it from here keep working.
export type { CardInstance }

export interface InPlayCard {
  readonly iid: CardIid
  readonly def: CardDefId
  /**
   * Stealth Needle only: the ship it copied. The Needle then has that ship's
   * abilities AND its faction, in addition to Machine Cult.
   */
  copiedDef: CardDefId | null
  /** Once-per-turn bookkeeping, cleared at the start of the controller's turn. */
  used: { primary: boolean; ally: boolean; doubleAlly: boolean; scrap: boolean }
  /** False for bases held over from a previous turn. */
  playedThisTurn: boolean
}

export interface PlayerState {
  authority: number
  /** index 0 = TOP. Order is secret even from its owner. */
  deck: CardInstance[]
  /** Secret from the opponent. */
  hand: CardInstance[]
  /** Public: discard piles are face up in Star Realms. */
  discard: CardInstance[]
  /** Ships played this turn plus all bases/outposts. Public. */
  inPlay: InPlayCard[]
  trade: number
  combat: number
  /**
   * Cards of each faction PLAYED FROM HAND this turn. Blob World reads this.
   * Not incremented by acquisitions, nor by a Stealth Needle copy (the copy
   * happens after the card has already entered play).
   */
  factionPlayedThisTurn: Record<Faction, number>
  /**
   * Factions whose ally condition has been met at some point this turn.
   * Once triggered, an ally ability stays available for the rest of the turn even
   * if the enabling card leaves play -- the rulebook is trigger-then-use.
   */
  allyUnlocked: Faction[]
  /**
   * Factions with THREE cards in play, which is what a Double Ally needs. Kept
   * separate from allyUnlocked, and like it, never un-unlocks once triggered.
   */
  doubleAllyUnlocked: Faction[]
  /**
   * Ships played from hand this turn, in order. Stealth Needle copies from this
   * list rather than from `inPlay`, because a ship played this turn and then
   * scrapped is still a legal copy target.
   */
  shipsPlayedThisTurn: CardInstance[]
  /**
   * Armed "put the next ship you acquire this turn on top of your deck" effects.
   * These STACK (official ruling): each qualifying acquisition consumes one, and
   * unused ones expire at end of turn.
   */
  pendingTopdeck: number
  /** Frontiers: same, for the next BASE acquired (Long Hauler). */
  pendingTopdeckBase: number
  /** Cards this player has scrapped this turn. Reclamation Station reads it. */
  scrappedThisTurn: number
  /** Cards that return from the scrap heap to the discard pile at end of turn. */
  returnAtEndOfTurn: CardIid[]
}

export interface EffectCtx {
  readonly controller: PlayerId
  readonly source: CardIid | null
  readonly slot: AbilitySlot
}

/**
 * Data a choice needs in order to apply its answer.
 *
 * This is the continuation, expressed as DATA. A closure would be the obvious
 * implementation and is exactly what must not be used: the resolution stack lives
 * inside GameState, so every frame has to survive JSON round-tripping,
 * persistence, replay and version migration.
 */
export type ChoiceCont =
  | { c: 'BRANCHES'; branches: readonly EffectBranch[] }
  | { c: 'ACQUIRE'; dest: AcquireDest }
  | { c: 'MAY'; then: readonly Effect[] }

/** One item on the resolution stack. Both variants are plain JSON. */
export type ResolutionFrame =
  | { f: 'effect'; effect: Effect; ctx: EffectCtx }
  | { f: 'choice'; choice: PendingChoice; cont?: ChoiceCont }

export interface GameState {
  readonly engineVersion: number
  readonly matchId: string
  /** Number of commands applied. Used for optimistic concurrency. */
  version: number
  turn: number
  activePlayer: PlayerId
  phase: 'main' | 'gameOver'
  players: Record<PlayerId, PlayerState>
  /**
   * Public. Always exactly TRADE_ROW_SIZE entries; a bought slot becomes null
   * until refilled. Fixed slots keep the UI's card animations stable, and match
   * the physical game where the replacement card fills the gap in place.
   */
  tradeRow: (CardInstance | null)[]
  /** Contents are derivable from public play; the ORDER is secret. */
  tradeDeck: CardInstance[]
  explorerPile: number
  /** Removed from the game. Public. */
  scrapHeap: CardInstance[]
  /** LIFO. Index 0 is the next thing to do. */
  resolution: ResolutionFrame[]
  /** SERVER ONLY. Must never appear in any PlayerView, event, log or error. */
  rng: RngState
  winner: PlayerId | null
  /**
   * Campaign rules in force, or null for a standard game. Public: both sides
   * must be able to see what they are playing under.
   */
  scenario: ScenarioRules | null
  /** Enemy bases each side has destroyed. Only a DESTROY_BASES objective reads
   *  it, but it is cheap and public, so it is always tracked. */
  basesDestroyed: Record<PlayerId, number>
  /** A Frontiers Challenge boss, or null. Entirely public. */
  boss: BossState | null
}

export function emptyFactionCounts(): Record<Faction, number> {
  return { trade_federation: 0, blob: 0, star_empire: 0, machine_cult: 0, unaligned: 0 }
}

/** The choice currently blocking resolution, if any. */
export function currentChoice(s: GameState): PendingChoice | null {
  const top = s.resolution[0]
  return top && top.f === 'choice' ? top.choice : null
}

/**
 * Who is allowed to act right now.
 *
 * Input ownership is NOT turn ownership: a forced discard is answered by the
 * non-active player. Authorization must consult this, never `activePlayer`.
 */
export function actorOf(s: GameState): PlayerId {
  return currentChoice(s)?.actor ?? s.activePlayer
}
