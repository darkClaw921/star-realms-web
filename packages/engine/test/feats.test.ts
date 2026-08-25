import { describe, expect, it } from 'vitest'
import type { CardDefId } from '../src/ids'
import {
  featEarned, featProgress, featSource, RUN_LADDER, runNode, runSetup, runStartCarry,
  type FeatSpec,
} from '../src/run'
import { createGame } from '../src/setup'
import { emptyTally, type GameState } from '../src/state'
import { run } from './scenario'

const fight = (seed = 'feat'): GameState => {
  const node = runNode(1)
  if (!node) throw new Error('no node 1')
  return createGame({
    matchId: 'f', seed, firstPlayer: 'p1', scenario: runSetup(node, runStartCarry()),
  })
}

const src = (over: Partial<ReturnType<typeof featSource>> = {}): ReturnType<typeof featSource> => ({
  tally: emptyTally(), turn: 1, basesDestroyed: 0, authority: 50, ...over,
})

describe('reading a feat', () => {
  it('counts up, and is met exactly on the number', () => {
    const f: FeatSpec = { k: 'BUYS_TURN', n: 3 }
    expect(featProgress(f, src({ tally: { ...emptyTally(), buys: 2 } })).met).toBe(false)
    const at3 = featProgress(f, src({ tally: { ...emptyTally(), buys: 3 } }))
    expect(at3).toEqual({ have: 3, need: 3, met: true })
  })

  it('counts the turn in progress, not only finished ones', () => {
    const f: FeatSpec = { k: 'DAMAGE_TURN', n: 7 }
    // Seven now, four on the best finished turn: the current turn wins.
    expect(featProgress(f, src({ tally: { ...emptyTally(), dmg: 7, dmgBest: 4 } })).have).toBe(7)
    // ...and the other way round.
    expect(featProgress(f, src({ tally: { ...emptyTally(), dmg: 1, dmgBest: 9 } })).have).toBe(9)
  })

  it('turns two of them the other way round: finishing EARLY and finishing HIGH', () => {
    expect(featProgress({ k: 'BY_TURN', n: 12 }, src({ turn: 9 })).met).toBe(true)
    expect(featProgress({ k: 'BY_TURN', n: 12 }, src({ turn: 13 })).met).toBe(false)
    expect(featProgress({ k: 'AUTHORITY_END', n: 25 }, src({ authority: 25 })).met).toBe(true)
    expect(featProgress({ k: 'AUTHORITY_END', n: 25 }, src({ authority: 24 })).met).toBe(false)
  })

  it('reads bases from the count the engine already kept', () => {
    expect(featProgress({ k: 'BASES', n: 2 }, src({ basesDestroyed: 2 })).met).toBe(true)
  })
})

describe('what the fight counts', () => {
  it('counts damage that LANDED, and only against the enemy', () => {
    const s = fight()
    const armed = structuredClone(s)
    armed.players.p1.combat = 6
    const hit = run(armed, { t: 'ATTACK_PLAYER', amount: 6 })
    expect(hit.state.tally.p1.dmg).toBe(6)
    expect(hit.state.tally.p2.dmg).toBe(0)
  })

  it('rolls the turn into the best turn at the START of your next one', () => {
    const s = fight()
    const armed = structuredClone(s)
    armed.players.p1.combat = 4
    let st = run(armed, { t: 'ATTACK_PLAYER', amount: 4 }).state
    expect(st.tally.p1).toMatchObject({ dmg: 4, dmgBest: 0 })
    // Your own turn end must NOT roll it: the fight can end on the enemy's turn
    // and the number still has to be there afterwards.
    st = run(st, { t: 'END_TURN' }).state
    expect(st.tally.p1).toMatchObject({ dmg: 4, dmgBest: 0 })
    st = run(st, { t: 'END_TURN' }).state
    expect(st.tally.p1).toMatchObject({ dmg: 0, dmgBest: 4 })
    // A worse turn afterwards does not lower the best.
    const again = structuredClone(st)
    again.players.p1.combat = 1
    const later = run(again, { t: 'ATTACK_PLAYER', amount: 1 }).state
    expect(featProgress({ k: 'DAMAGE_TURN', n: 4 }, featSource(later)).have).toBe(4)
  })

  it('counts a card you PAID for, not one an ability handed you', () => {
    const s = fight()
    const armed = structuredClone(s)
    armed.tradeRow = [{ iid: 'r1' as never, def: 'cutter' as CardDefId }, null, null, null, null]
    armed.players.p1.trade = 9
    const bought = run(armed, { t: 'BUY_CARD', card: 'r1' as never })
    expect(bought.state.tally.p1.buys).toBe(1)
    // The Explorer is bought too, and counts.
    const explored = run(bought.state, { t: 'BUY_EXPLORER' })
    expect(explored.state.tally.p1.buys).toBe(2)
  })

  it('counts scrapping all fight, where scrappedThisTurn only counts this one', () => {
    const s = fight()
    const armed = structuredClone(s)
    armed.players.p1.hand = [{ iid: 'h1' as never, def: 'explorer' as CardDefId }]
    armed.players.p1.trade = 0
    let st = run(armed, { t: 'PLAY_CARD', card: 'h1' as never }).state
    st = run(st, { t: 'ACTIVATE', card: 'h1' as never, slot: 'scrap' }).state
    expect(st.tally.p1.scrapped).toBe(1)
    expect(st.players.p1.scrappedThisTurn).toBe(1)
    st = run(st, { t: 'END_TURN' }, { t: 'END_TURN' }).state
    expect(st.players.p1.scrappedThisTurn).toBe(0)
    expect(st.tally.p1.scrapped).toBe(1)
  })

  it('does not count the trade row being scrapped -- nobody owns those cards', () => {
    const s = fight()
    const before = s.tally.p1.scrapped
    // Fleeting Opportunities scraps a row card every turn and belongs to nobody.
    const v = createGame({
      matchId: 'f', seed: 'row', firstPlayer: 'p1', variant: 'fleeting-opportunities',
    })
    expect(v.scrapHeap.length).toBeGreaterThan(0)
    expect(v.tally.p1.scrapped).toBe(0)
    expect(before).toBe(0)
  })
})

describe('the ladder asks something of every fight', () => {
  it('every node carries a feat, and every kind is reachable', () => {
    const kinds = new Set(RUN_LADDER.map((n) => n.feat.k))
    expect(RUN_LADDER.every((n) => n.feat.n > 0)).toBe(true)
    expect(kinds.size).toBeGreaterThanOrEqual(5)
  })

  it('featEarned reads a finished fight', () => {
    const s = fight()
    const armed = structuredClone(s)
    armed.players.p1.combat = 12
    const hit = run(armed, { t: 'ATTACK_PLAYER', amount: 12 }).state
    expect(featEarned(hit, { k: 'DAMAGE_TURN', n: 12 })).toBe(true)
    expect(featEarned(hit, { k: 'DAMAGE_TURN', n: 13 })).toBe(false)
  })
})
