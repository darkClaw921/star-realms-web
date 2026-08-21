import type { AbilitySlot, AcquireDest } from './effects'
import type { CardDefId, CardIid, Faction, PlayerId, Zone } from './ids'

/**
 * WHAT HAPPENED. Events are the causal script the UI animates from and the game
 * log narrates. They are redacted per viewer before they leave the server.
 */
export type GameEvent =
  | { e: 'TURN_START'; player: PlayerId; turn: number }
  | { e: 'TURN_END'; player: PlayerId }
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
  | { e: 'BASE_DESTROYED'; owner: PlayerId; iid: CardIid; def: CardDefId; by: 'combat' | 'effect' }
  | { e: 'ATTACK_PLAYER'; attacker: PlayerId; target: PlayerId; n: number }
  | { e: 'COPY_SHIP'; player: PlayerId; iid: CardIid; copied: CardDefId }
  | { e: 'ALLY_UNLOCKED'; player: PlayerId; faction: Faction; double?: boolean }
  | { e: 'RESHUFFLE'; player: PlayerId; n: number }
  | { e: 'CHOICE_AUTO_RESOLVED'; player: PlayerId; label: string }
  | { e: 'FIZZLE'; label: string }
  | { e: 'GAME_OVER'; winner: PlayerId }
