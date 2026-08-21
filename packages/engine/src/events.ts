import type { CardDefId, CardIid, Faction, PlayerId, Zone } from './ids'
import type { AbilitySlot } from './effects'

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
  | { e: 'ACQUIRE'; player: PlayerId; def: CardDefId; dest: 'discard' | 'deck_top'; cost: number }
  | { e: 'TRADE_ROW_REFILL'; def: CardDefId | null; slot: number }
  | { e: 'TENTACLE_DESTROYED'; faction: Faction; defense: number }
  | { e: 'BASE_DESTROYED'; owner: PlayerId; iid: CardIid; def: CardDefId; by: 'combat' | 'effect' }
  | { e: 'ATTACK_PLAYER'; attacker: PlayerId; target: PlayerId; n: number }
  | { e: 'COPY_SHIP'; player: PlayerId; iid: CardIid; copied: CardDefId }
  | { e: 'ALLY_UNLOCKED'; player: PlayerId; faction: Faction }
  | { e: 'RESHUFFLE'; player: PlayerId; n: number }
  | { e: 'CHOICE_AUTO_RESOLVED'; player: PlayerId; label: string }
  | { e: 'FIZZLE'; label: string }
  | { e: 'GAME_OVER'; winner: PlayerId }
