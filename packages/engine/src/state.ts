import type { CardDefId, CardInstance, CardIid, Faction, PlayerId } from './ids'
import type { AbilitySlot, AcquireDest, AcquireRedirect, Effect, EffectBranch } from './effects'
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
  /**
   * The Colossus: the faction chosen as it was played. A real faction for every
   * purpose -- other cards' ally conditions see it, and so does its own count.
   */
  chosenFaction: Faction | null
  /** Once-per-turn bookkeeping, cleared at the start of the controller's turn. */
  used: {
    primary: boolean
    /**
     * Up to four ally slots. Four is the printed ceiling: Promo Pack 1's
     * Mercenary Garrison carries one ability per faction, and no card in any set
     * carries more. Named slots rather than a list because the ACTIVATE action
     * is part of the wire protocol and of every stored replay.
     */
    ally: boolean
    ally2: boolean
    ally3: boolean
    ally4: boolean
    doubleAlly: boolean
    scrap: boolean
  }
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
   * Armed "put the next card you acquire this turn somewhere else" effects, in
   * the order they were armed. These STACK (official ruling): each qualifying
   * acquisition consumes exactly one, the player picks which when more than one
   * matches, and unused ones expire at end of turn.
   */
  pendingRedirects: AcquireRedirect[]
  /** Cards this player has scrapped this turn. Reclamation Station reads it. */
  scrappedThisTurn: number
  /**
   * Ally abilities already used this turn, in order. Stellar Allies' Needle
   * Lancer copies one of them, so the list has to survive the card that used it
   * leaving play -- which is why it stores definitions and slots, not instances.
   */
  alliesUsedThisTurn: {
    iid: CardIid
    def: CardDefId
    slot: 'ally' | 'ally2' | 'ally3' | 'ally4' | 'doubleAlly'
  }[]
  /**
   * High Alert's Stealth: factions you count as having an extra card of this
   * turn. Phantom cards -- they satisfy ally conditions and nothing else, and
   * they are cleared with the rest of the per-turn bookkeeping.
   */
  phantomFactions: Faction[]
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
  /**
   * Which armed redirect to spend on the card just acquired. `dests` is parallel
   * to the choice's BRANCH options, and `redirects` indexes back into the
   * player's armed list so exactly the chosen one is consumed.
   */
  | { c: 'REDIRECT'; iid: CardIid; dests: readonly AcquireDest[]; redirects: readonly number[] }
  /** One card discarded for Supply Depot; the branch decides trade or combat. */
  | { c: 'DISCARD_RESOURCE'; per: number }
  /** Black Hole: the penalty depends on how far short of `max` the answer was. */
  | { c: 'DISCARD_OR_LOSE'; max: number; per: number }
  /** Bombardment: declining to destroy a base is choosing the authority loss. */
  | { c: 'DESTROY_OR_LOSE'; n: number }
  /** Stealth: how many phantom cards of the chosen faction to add. */
  | { c: 'PHANTOM'; n: number }
  /** The Colossus: which in-play card the chosen faction is being pinned to. */
  | { c: 'OWN_FACTION'; iid: CardIid }
  /** Midgate Station: the resource is worth the discards plus this. */
  | { c: 'DISCARD_PLUS'; plus: number }
  /** Needle Lancer: the ally abilities on offer, parallel to the branch options. */
  | { c: 'COPY_ALLY'; used: readonly { def: CardDefId; slot: string }[] }

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
  /**
   * Patience Rewarded: cards set aside from the trade row, which stay buyable
   * for the rest of the game "as if they were in the trade row". Public, and a
   * separate list rather than extra row slots -- the row has a fixed size and
   * refills, and these do neither.
   */
  setAside: CardInstance[]
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
