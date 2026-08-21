import type { CardIid, ChoiceId, Faction, PlayerId } from './ids'
import type { ChoiceOption } from './choices'

/**
 * CLIENT INTENTS. Clients send only these -- never events, never state deltas.
 *
 * `actor` is deliberately absent: on the server it is derived from the
 * authenticated socket-to-seat binding. Taking it from the payload would let
 * either client act as the other.
 */
export type Action =
  | { t: 'PLAY_CARD'; card: CardIid }
  /** Convenience: play every ship in hand, in the given order. */
  | { t: 'PLAY_ALL' }
  | { t: 'ACTIVATE'; card: CardIid; slot: 'primary' | 'ally' | 'scrap' }
  | { t: 'BUY_CARD'; card: CardIid }
  | { t: 'BUY_EXPLORER' }
  | { t: 'ATTACK_PLAYER'; amount: number }
  | { t: 'ATTACK_BASE'; base: CardIid }
  | { t: 'RESOLVE_CHOICE'; choiceId: ChoiceId; selected: readonly ChoiceOption[] }
  /** Challenges only: scrap the whole trade row. Once per challenge. */
  | { t: 'MULLIGAN_ROW' }
  /** Dimensional Horror only: spend combat on one of its tentacles. */
  | { t: 'ATTACK_TENTACLE'; faction: Faction }
  | { t: 'END_TURN' }

/** An action plus who is attempting it. Built by the server, never by the client. */
export interface Command {
  readonly actor: PlayerId
  readonly action: Action
}
