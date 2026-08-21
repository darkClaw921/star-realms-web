import { describe, expect, it } from 'vitest'
import { nextInt, nextU32, seedRng, shuffle } from '../src/rng'
import { createGame } from '../src/setup'

describe('seeded RNG', () => {
  /**
   * GOLDEN TEST. These numbers pin the generator itself. If this test ever fails,
   * every stored replay has silently become unreplayable -- that is exactly the
   * failure this file exists to make loud.
   */
  it('produces a stable stream for a fixed seed', () => {
    let s = seedRng('star-realms-golden')
    const out: number[] = []
    for (let i = 0; i < 8; i++) {
      const [v, next] = nextU32(s)
      out.push(v)
      s = next
    }
    expect(out).toMatchInlineSnapshot(`
      [
        546195456,
        1776622862,
        2607702066,
        2997833574,
        3417653151,
        3187046955,
        2717457725,
        1571384148,
      ]
    `)
  })

  it('is unbiased over a small range', () => {
    let s = seedRng('bias-check')
    const counts = [0, 0, 0, 0, 0, 0]
    for (let i = 0; i < 60_000; i++) {
      const [v, next] = nextInt(s, 6)
      counts[v] = (counts[v] ?? 0) + 1
      s = next
    }
    // Rejection sampling, not `% n`: every bucket should sit near 10,000.
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(600)
  })

  it('shuffles without mutating its input', () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8])
    const [out] = shuffle(seedRng('shuffle'), input)
    expect(out).toHaveLength(8)
    expect([...out].sort((a, b) => a - b)).toEqual([...input])
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('makes a whole game reproducible from its seed alone', () => {
    const a = createGame({ matchId: 'm', seed: 'repro', firstPlayer: 'p1' })
    const b = createGame({ matchId: 'm', seed: 'repro', firstPlayer: 'p1' })
    expect(a).toEqual(b)
    const c = createGame({ matchId: 'm', seed: 'repro-2', firstPlayer: 'p1' })
    expect(c.players.p1.deck.map((x) => x.def)).not.toEqual(a.players.p1.deck.map((x) => x.def))
  })
})
