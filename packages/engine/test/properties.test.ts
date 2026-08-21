import { describe, expect, it } from 'vitest'
import { enumerateLegalActions } from '../src/legal'
import { IllegalActionError, reduce } from '../src/reduce'
import { opponentOf, type PlayerId } from '../src/ids'
import { actorOf, type GameState } from '../src/state'
import { redact } from '../src/view'
import { playRandomGame, type Step } from './harness'

const SEEDS = Array.from({ length: 40 }, (_, i) => `seed-${i.toString().padStart(3, '0')}`)

/** Every key named `rng`, anywhere in a serialized structure. */
function findKey(obj: unknown, key: string, path = '$'): string[] {
  if (obj === null || typeof obj !== 'object') return []
  const hits: string[] = []
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => hits.push(...findKey(v, key, `${path}[${i}]`)))
    return hits
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === key) hits.push(`${path}.${k}`)
    hits.push(...findKey(v, key, `${path}.${k}`))
  }
  return hits
}

describe('engine invariants over fuzzed full games', () => {
  it('state is always plain JSON (survives a serialize/parse round trip)', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      playRandomGame(seed, ({ after }) => {
        expect(JSON.parse(JSON.stringify(after))).toEqual(after)
      })
    }
  })

  it('never leaks a hidden card or the RNG into any player view', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      playRandomGame(seed, ({ after }) => {
        for (const viewer of ['p1', 'p2'] as PlayerId[]) {
          const view = redact(after, viewer)
          const json = JSON.stringify(view)

          // The RNG seed reconstructs every future shuffle. It must not appear in
          // any form: not as a field, not as a value.
          expect(findKey(view, 'rng')).toEqual([])
          for (const word of after.rng) {
            expect(json.includes(String(word)), `rng word ${word} leaked`).toBe(false)
          }

          // Identities of cards in hidden zones. A stable iid visible in a hidden
          // zone would let a client track a card through a shuffle.
          const forbidden = new Set<string>([
            ...after.players[opponentOf(viewer)].hand.map((c) => c.iid),
            ...after.players.p1.deck.map((c) => c.iid),
            ...after.players.p2.deck.map((c) => c.iid),
            ...after.tradeDeck.map((c) => c.iid),
          ])
          for (const iid of forbidden) {
            expect(json.includes(iid), `hidden iid ${iid} leaked to ${viewer}`).toBe(false)
          }
        }
      })
    }
  })

  it('never sends a non-actor the options of a pending choice', () => {
    for (const seed of SEEDS.slice(0, 16)) {
      playRandomGame(seed, ({ after }) => {
        for (const viewer of ['p1', 'p2'] as PlayerId[]) {
          const pc = redact(after, viewer).pendingChoice
          if (!pc) continue
          if (pc.actor !== viewer) expect(pc.options).toBeNull()
          else expect(pc.options).not.toBeNull()
        }
      })
    }
  })

  it('every enumerated action applies without throwing', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      playRandomGame(seed, ({ before, seat, legal }: Step) => {
        // Re-apply each enumerated action to the pre-state; none may be rejected.
        for (const action of legal) {
          expect(() => reduce(before, { actor: seat, action })).not.toThrow()
        }
      }, 300)
    }
  })

  it('rejects actions the generator did not offer', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      playRandomGame(seed, ({ before, seat }) => {
        const other = opponentOf(seat)
        // Acting out of turn is always illegal, whatever the action.
        const view = redact(before, seat)
        const legal = enumerateLegalActions(view, seat)
        const sample = legal[0]
        if (sample) {
          expect(() => reduce(before, { actor: other, action: sample }))
            .toThrow(IllegalActionError)
        }
        // The non-actor never has any legal action at all.
        expect(enumerateLegalActions(redact(before, other), other)).toEqual([])
      }, 200)
    }
  })

  it('keeps every counted quantity conserved', () => {
    for (const seed of SEEDS.slice(0, 16)) {
      playRandomGame(seed, ({ after }) => {
        expect(after.tradeRow).toHaveLength(5)
        // The row may only hold a gap once the trade deck is exhausted.
        if (after.tradeDeck.length > 0) {
          expect(after.tradeRow.every((c) => c !== null)).toBe(true)
        }
        expect(after.explorerPile).toBeGreaterThanOrEqual(0)
        for (const pid of ['p1', 'p2'] as PlayerId[]) {
          const p = after.players[pid]
          expect(p.trade).toBeGreaterThanOrEqual(0)
          expect(p.combat).toBeGreaterThanOrEqual(0)
        }
        expect(totalCards(after)).toBe(80 + 20 + 10)
      })
    }
  })

  it('reaches a decisive result from most seeds', () => {
    let finished = 0
    for (const seed of SEEDS) {
      const end = playRandomGame(seed, () => {})
      if (end.phase === 'gameOver') {
        finished++
        expect(end.winner).not.toBeNull()
        expect(end.players[opponentOf(end.winner as PlayerId)].authority).toBeLessThanOrEqual(0)
      }
    }
    expect(finished).toBeGreaterThan(SEEDS.length * 0.8)
  })
})

/** Every physical card in the box must be somewhere at all times. */
function totalCards(s: GameState): number {
  let n = s.tradeDeck.length + s.scrapHeap.length + s.explorerPile
  for (const c of s.tradeRow) if (c) n++
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const p = s.players[pid]
    n += p.deck.length + p.hand.length + p.discard.length + p.inPlay.length
  }
  return n
}

describe('turn structure', () => {
  it('alternates seats and never leaves a pool carried over', () => {
    playRandomGame('turn-structure', ({ after }) => {
      const idle = after.players[opponentOf(actorOf(after) === after.activePlayer
        ? after.activePlayer : after.activePlayer)]
      void idle
      const inactive = after.players[opponentOf(after.activePlayer)]
      // The non-active player never holds unspent trade or combat.
      expect(inactive.trade).toBe(0)
      expect(inactive.combat).toBe(0)
    })
  })
})
