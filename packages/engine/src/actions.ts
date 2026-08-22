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
  | {
      t: 'ACTIVATE'; card: CardIid
      slot:
        | 'primary' | 'ally' | 'ally2' | 'ally3' | 'ally4' | 'doubleAlly' | 'scrap' | 'splinter'
    }
  | { t: 'BUY_CARD'; card: CardIid }
  | { t: 'BUY_EXPLORER' }
  | { t: 'ATTACK_PLAYER'; amount: number }
  /** Gambit: "you may reveal any Gambits ... during your Main Phase". */
  | { t: 'REVEAL_GAMBIT'; card: CardIid }
  /** United: claim a mission whose objective is currently met. */
  | { t: 'CLAIM_MISSION'; card: CardIid }
  | { t: 'ATTACK_BASE'; base: CardIid }
  | { t: 'RESOLVE_CHOICE'; choiceId: ChoiceId; selected: readonly ChoiceOption[] }
  /** Challenges only: scrap the whole trade row. Once per challenge. */
  | { t: 'MULLIGAN_ROW' }
  /**
   * Dimensional Horror only: spend combat equal to ONE card's cost to shoot it
   * off a tentacle. The tentacle is named too, so a card cannot be attacked in
   * the wrong pile.
   */
  | { t: 'ATTACK_TENTACLE'; faction: Faction; card: CardIid }
  /**
   * Co-op: hand part of your Trade or Combat pool to a teammate. "Players may,
   * as many times as they like each turn, transfer any amount of their Trade
   * and/or Combat to a teammate's pool" -- the Hydra rule that lets a team
   * gang up on one expensive card or one big base.
   */
  | { t: 'TRANSFER'; to: PlayerId; what: 'trade' | 'combat'; n: number }
  | { t: 'END_TURN' }

/** An action plus who is attempting it. Built by the server, never by the client. */
export interface Command {
  readonly actor: PlayerId
  readonly action: Action
}
