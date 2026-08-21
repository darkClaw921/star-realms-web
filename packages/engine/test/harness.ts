import type { Action } from '../src/actions'
import { cardDef } from '../src/cards/registry'
import { enumerateLegalActions } from '../src/legal'
import { reduce } from '../src/reduce'
import { nextInt, seedRng, type RngState } from '../src/rng'
import { createGame } from '../src/setup'
import { actorOf, type GameState } from '../src/state'
import { redact } from '../src/view'

/** Test-side RNG, deliberately separate from the engine's own stream. */
export class Picker {
  private s: RngState
  constructor(seed: string) { this.s = seedRng(seed) }
  int(n: number): number {
    const [v, next] = nextInt(this.s, n)
    this.s = next
    return v
  }
  pick<T>(xs: readonly T[]): T { return xs[this.int(xs.length)] as T }
}

/**
 * A mildly aggressive random policy.
 *
 * Uniform-random play almost never attacks, so games would run to the command cap
 * without ever exercising the win path. Weighting attacks and turn-ends makes
 * fuzzed games actually finish while still covering everything else.
 */
export function weightedPick(actions: readonly Action[], p: Picker): Action {
  const attacks = actions.filter((a) => a.t === 'ATTACK_PLAYER' || a.t === 'ATTACK_BASE')
  if (attacks.length > 0 && p.int(100) < 45) {
    const face = attacks.filter((a) => a.t === 'ATTACK_PLAYER')
    if (face.length > 0 && p.int(100) < 70) {
      // Hit for as much as possible; partial hits are legal but rarely useful.
      return face.reduce((best, a) =>
        (a as { amount: number }).amount > (best as { amount: number }).amount ? a : best)
    }
    return p.pick(attacks)
  }
  const end = actions.find((a) => a.t === 'END_TURN')
  if (end && p.int(100) < 12) return end
  const others = actions.filter((a) => a.t !== 'END_TURN')
  return others.length > 0 ? p.pick(others) : (end ?? p.pick(actions))
}

export interface Step {
  readonly before: GameState
  readonly seat: 'p1' | 'p2'
  readonly action: Action
  readonly legal: readonly Action[]
  readonly after: GameState
}

/** Drive a full random game, invoking `onStep` after every applied command. */
export function playRandomGame(
  seed: string,
  onStep: (s: Step) => void,
  maxCommands = 4000,
): GameState {
  let state = createGame({ matchId: `m-${seed}`, seed, firstPlayer: 'p1' })
  const p = new Picker(`driver-${seed}`)

  for (let i = 0; i < maxCommands && state.phase !== 'gameOver'; i++) {
    const seat = actorOf(state)
    const view = redact(state, seat)
    const legal = enumerateLegalActions(view, seat)
    if (legal.length === 0) break
    const action = weightedPick(legal, p)
    const before = state
    const { state: after } = reduce(state, { actor: seat, action })
    onStep({ before, seat, action, legal, after })
    state = after
  }
  return state
}

export { cardDef }
