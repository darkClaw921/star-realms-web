import type { AbilitySlot, AcquireDest } from './effects'
import type { CardDefId, CardIid, Faction, PlayerId, Zone } from './ids'

/**
 * WHAT HAPPENED. Events are the causal script the UI animates from and the game
 * log narrates. They are redacted per viewer before they leave the server.
 */
export type GameEvent =
  | { e: 'TURN_START'; player: PlayerId; turn: number }
  | { e: 'TURN_END'; player: PlayerId }
  /**
   * A turn the Boss was owed and did not take, from the difficulty's grace.
   *
   * Its own event rather than a TURN_START, because a log that narrates the
   * skipped turn as the Boss's turn says the exact opposite of what happened:
   * on Beginner the player is owed three turns in a row, and reading "Turn 2:
   * Boss" between them is how a working grace period looks broken.
   */
  | { e: 'TURN_SKIPPED'; player: PlayerId; turn: number }
  | { e: 'PLAY_CARD'; player: PlayerId; iid: CardIid; def: CardDefId }
  | { e: 'ABILITY_USED'; player: PlayerId; iid: CardIid; def: CardDefId; slot: AbilitySlot }
  | { e: 'GAIN'; player: PlayerId; what: 'trade' | 'combat' | 'authority'; n: number }
  | { e: 'AUTHORITY_LOST'; player: PlayerId; n: number }
  /** `defs` is omitted for a viewer who may not see which cards were drawn. */
  | { e: 'DRAW'; player: PlayerId; n: number; defs: CardDefId[] | null }
  | { e: 'DISCARD'; player: PlayerId; iid: CardIid | null; def: CardDefId | null }
  | { e: 'SCRAP'; from: Zone; owner: PlayerId | null; iid: CardIid | null; def: CardDefId | null }
  | { e: 'ACQUIRE'; player: PlayerId; def: CardDefId; dest: AcquireDest; cost: number }
  | { e: 'TRADE_ROW_REFILL'; def: CardDefId | null; slot: number }
  /** Dimensional Horror: a card was swallowed by a tentacle. */
  | { e: 'TENTACLE_FED'; faction: Faction; def: CardDefId }
  /** Dimensional Horror: a card in a tentacle was shot off it. */
  | { e: 'TENTACLE_HIT'; faction: Faction; def: CardDefId; cost: number }
  /** Frontiers (Repair Mech): a base goes from the discard pile to the deck top. */
  | { e: 'TOPDECK'; player: PlayerId; iid: CardIid; def: CardDefId }
  /** Frontiers (Mobile Market): back from the scrap heap at end of turn. */
  | { e: 'RETURN_FROM_SCRAP'; player: PlayerId; iid: CardIid; def: CardDefId }
  /** Crisis' Mega Mech: a base leaves play for its owner's HAND, not the scrap heap. */
  | { e: 'RETURN_TO_HAND'; owner: PlayerId; iid: CardIid; def: CardDefId }
  /** Crisis: an event turned up in the trade row and resolved on the spot. */
  | { e: 'EVENT'; def: CardDefId }
  /** Docking: the card went back to hand instead of being discarded. */
  | { e: 'DOCKED'; player: PlayerId; iid: CardIid; def: CardDefId }
  /** Patience Rewarded: a trade row card is now buyable for the rest of the game. */
  | { e: 'SET_ASIDE'; def: CardDefId }
  /** Gambit: a face-down card is now face up and applying. */
  | { e: 'GAMBIT_REVEALED'; player: PlayerId; iid: CardIid; def: CardDefId }
  /** United: a mission's objective was met and its reward claimed. */
  | { e: 'MISSION_COMPLETE'; player: PlayerId; def: CardDefId }
  | { e: 'BASE_DESTROYED'; owner: PlayerId; iid: CardIid; def: CardDefId; by: 'combat' | 'effect' }
  | { e: 'ATTACK_PLAYER'; attacker: PlayerId; target: PlayerId; n: number }
  | { e: 'COPY_SHIP'; player: PlayerId; iid: CardIid; copied: CardDefId }
  | { e: 'ALLY_UNLOCKED'; player: PlayerId; faction: Faction; double?: boolean }
  | { e: 'RESHUFFLE'; player: PlayerId; n: number }
  | { e: 'CHOICE_AUTO_RESOLVED'; player: PlayerId; label: string }
  | { e: 'FIZZLE'; label: string }
  /** Co-op: a player's own Authority hit zero and they are out of the game. */
  | { e: 'ELIMINATED'; player: PlayerId }
  /** Co-op: a teammate handed over part of their Trade or Combat pool. */
  | { e: 'TRANSFER'; from: PlayerId; to: PlayerId; what: 'trade' | 'combat'; n: number }
  // ── Забег ─────────────────────────────────────────────────────────────────
  | { e: 'WAGER_TAKEN'; player: PlayerId; id: string }
  | { e: 'WAGER_WON'; player: PlayerId; id: string }
  | { e: 'WAGER_LOST'; player: PlayerId; id: string; n: number }
  | { e: 'CARD_UPGRADED'; player: PlayerId; iid: CardIid; def: CardDefId; level: number }
  | { e: 'GAME_OVER'; winner: PlayerId }
