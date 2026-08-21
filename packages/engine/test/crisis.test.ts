import { describe, expect, it } from 'vitest'
import { asDefId } from '../src/ids'
import {
  byDef, choose, decline, handIid, inPlay, legalFor, pending, playIid, rowIid, run, scenario,
} from './scenario'

const D = asDefId

/**
 * The three Crisis rules that are not just numbers on a familiar shape.
 */

describe('Construction Hauler', () => {
  it('puts the next base bought straight into play, defending immediately', () => {
    const s = scenario({
      me: {
        hand: ['construction-hauler', 'cutter'],
        trade: 0,
      },
      tradeRow: ['barter-world', 'ram', 'scout', 'viper', 'explorer'],
    })
    // Two Trade Federation cards -> ally unlocked.
    let st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'construction-hauler') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'cutter') },
    ).state
    st = run(st, {
      t: 'ACTIVATE', card: playIid(st, 'p1', 'construction-hauler'), slot: 'ally',
    }).state

    const before = st.players.p1.inPlay.length
    st = run(st, { t: 'BUY_CARD', card: rowIid(st, 'barter-world') }).state
    expect(st.players.p1.inPlay).toHaveLength(before + 1)
    expect(st.players.p1.discard.some((c) => c.def === D('barter-world'))).toBe(false)

    // In play and usable this turn -- that is what "directly into play" buys you.
    const base = st.players.p1.inPlay.find((c) => c.def === D('barter-world'))!
    expect(legalFor(st, 'p1').some(
      (a) => a.t === 'ACTIVATE' && a.card === base.iid && a.slot === 'primary',
    )).toBe(true)

    // It was ACQUIRED, not played, so it feeds no faction-played counter.
    expect(st.players.p1.factionPlayedThisTurn.trade_federation).toBe(2)
  })
})

describe('Mega Mech', () => {
  it("returns a base to its owner's HAND and ignores the outpost shield", () => {
    const s = scenario({
      me: { hand: ['mega-mech'] },
      // An outpost standing guard: destruction would have to go through it, but
      // returning is not an attack, so the plain base is a legal target too.
      them: { inPlay: [inPlay('defense-center'), inPlay('barter-world')] },
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'mega-mech') }).state
    const c = pending(st)!
    expect(c.prompt).toBe('RETURN_BASE_TO_HAND')
    expect(c.min).toBe(0)          // "you may"
    expect(c.n).toBe(2)            // the outpost does NOT shield the plain base

    st = run(st, choose(st, byDef('barter-world'))).state
    expect(st.players.p1.combat).toBe(6)
    expect(st.players.p2.inPlay.map((x) => x.def)).toEqual([D('defense-center')])
    // To hand, not to the discard pile: its owner replays it for free.
    expect(st.players.p2.hand.some((x) => x.def === D('barter-world'))).toBe(true)
    expect(st.players.p2.discard.some((x) => x.def === D('barter-world'))).toBe(false)
  })

  it('may be declined, and fizzles with no base anywhere', () => {
    const s = scenario({ me: { hand: ['mega-mech'] } })
    const st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'mega-mech') }).state
    expect(pending(st)).toBeNull()
    expect(st.players.p1.combat).toBe(6)
  })
})

describe('Death World', () => {
  it('will not eat a Blob card, and the draw is coupled to the scrap', () => {
    const s = scenario({
      me: {
        hand: [],
        inPlay: [inPlay('death-world')],
        discard: ['blob-fighter', 'cutter'],
        deck: ['scout'],
      },
    })
    let st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'death-world'), slot: 'primary' }).state
    expect(st.players.p1.combat).toBe(4)

    const c = pending(st)!
    expect(c.prompt).toBe('SCRAP_THEN_DRAW')
    expect(c.n).toBe(1)            // only the Trade Federation card is offered
    expect(() => run(st, choose(st, byDef('blob-fighter')))).toThrow()

    st = run(st, choose(st, byDef('cutter'))).state
    expect(st.players.p1.hand).toHaveLength(1)
    expect(st.scrapHeap.some((x) => x.def === D('cutter'))).toBe(true)
  })

  it('draws nothing when you decline the scrap', () => {
    const s = scenario({
      me: { hand: [], inPlay: [inPlay('death-world')], discard: ['cutter'], deck: ['scout'] },
    })
    let st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'death-world'), slot: 'primary' }).state
    st = run(st, decline(st)).state
    expect(st.players.p1.hand).toHaveLength(0)
  })
})

describe('Customs Frigate', () => {
  it('may decline the free ship, unlike Blob Carrier', () => {
    const s = scenario({
      me: { hand: ['customs-frigate'] },
      tradeRow: ['ram', 'cutter', 'scout', 'viper', 'explorer'],
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'customs-frigate') }).state
    expect(pending(st)?.min).toBe(0)
    st = run(st, decline(st)).state
    expect(st.players.p1.deck.some((x) => x.def === D('ram'))).toBe(false)
  })
})

describe('Obliterator', () => {
  it('adds combat only at two or more enemy bases', () => {
    const one = scenario({
      me: { hand: ['obliterator'] }, them: { inPlay: [inPlay('barter-world')] },
    })
    expect(run(one, { t: 'PLAY_CARD', card: handIid(one, 'p1', 'obliterator') })
      .state.players.p1.combat).toBe(7)

    const two = scenario({
      me: { hand: ['obliterator'] },
      them: { inPlay: [inPlay('barter-world'), inPlay('defense-center')] },
    })
    expect(run(two, { t: 'PLAY_CARD', card: handIid(two, 'p1', 'obliterator') })
      .state.players.p1.combat).toBe(13)
  })
})
