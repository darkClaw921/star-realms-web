import { describe, expect, it } from 'vitest'
import { asDefId } from '../src/ids'
import { CARDS, tradeDeckComposition } from '../src/cards/registry'
import {
  byDef, choose, chooseMany, inPlay, legalFor,
  pending, playIid, rowIid, run, scenario,
} from './scenario'

const D = asDefId

describe('Crisis: Heroes', () => {
  const heroes = [...CARDS.values()].filter((c) => c.set === 'crisis-heroes')

  it('is eight cards in twelve copies, all of type hero', () => {
    expect(heroes).toHaveLength(8)
    expect(tradeDeckComposition(undefined, ['crisis-heroes'])).toHaveLength(12)
    expect(heroes.every((c) => c.type === 'hero')).toBe(true)
    // Unaligned, so a Hero never feeds a faction count of its own.
    expect(heroes.every((c) => c.faction === 'unaligned')).toBe(true)
    // The whole ability is in the scrap slot; nothing to activate otherwise.
    expect(heroes.every((c) => c.primary.length === 0 && c.ally.length === 0)).toBe(true)
  })

  it('goes straight into play when bought, skipping the discard pile', () => {
    const s = scenario({
      me: { hand: [], trade: 5 },
      tradeRow: ['ram-pilot', 'cutter', 'scout', 'viper', 'explorer'],
    })
    const st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'ram-pilot') }).state
    expect(st.players.p1.inPlay.map((c) => c.def)).toEqual([D('ram-pilot')])
    expect(st.players.p1.discard).toHaveLength(0)
  })

  it('cannot be attacked, and does not shield or count as a base', () => {
    const s = scenario({
      me: { hand: [], combat: 20 },
      them: { inPlay: [inPlay('ram-pilot')] },
    })
    const acts = legalFor(s, 'p1')
    expect(acts.some((a) => a.t === 'ATTACK_BASE')).toBe(false)
    // No base in the way, so the face is open.
    expect(acts.some((a) => a.t === 'ATTACK_PLAYER')).toBe(true)
  })

  it('stays in play across turns until it is spent', () => {
    const s = scenario({ me: { hand: [], inPlay: [inPlay('ram-pilot')] } })
    let st = run(s, { t: 'END_TURN' }).state
    st = run(st, { t: 'END_TURN' }).state
    expect(st.players.p1.inPlay.map((c) => c.def)).toEqual([D('ram-pilot')])
    expect(st.players.p1.discard.some((c) => c.def === D('ram-pilot'))).toBe(false)
  })

  it('unlocks a faction ally from a single card, then leaves play', () => {
    // One Blob card in play. Its ally normally needs a second Blob card.
    const s = scenario({
      me: { hand: [], inPlay: [inPlay('blob-fighter'), inPlay('ram-pilot')], deck: ['scout'] },
    })
    expect(legalFor(s, 'p1').some(
      (a) => a.t === 'ACTIVATE' && a.slot === 'ally',
    )).toBe(false)

    const st = run(s, {
      t: 'ACTIVATE', card: playIid(s, 'p1', 'ram-pilot'), slot: 'scrap',
    }).state
    expect(st.players.p1.combat).toBe(2)
    expect(st.players.p1.allyUnlocked).toContain('blob')
    // Spent: gone from play, and Blob Wheel's ally is now available.
    expect(st.players.p1.inPlay.map((c) => c.def)).toEqual([D('blob-fighter')])
    expect(legalFor(st, 'p1').some(
      (a) => a.t === 'ACTIVATE' && a.slot === 'ally',
    )).toBe(true)
  })
})

describe('Crisis: Events', () => {
  const events = [...CARDS.values()].filter((c) => c.set === 'crisis-events')

  it('is eight cards in twelve copies, all of type event', () => {
    expect(events).toHaveLength(8)
    expect(tradeDeckComposition(undefined, ['crisis-events'])).toHaveLength(12)
    expect(events.every((c) => c.type === 'event')).toBe(true)
  })

  /**
   * Events are turned up by the refill, never bought, so a scenario cannot place
   * one in the row -- it has to be put on top of the trade deck and shaken out
   * by emptying a slot.
   */
  const withEventOnTop = (event: string) => {
    const s = scenario({
      me: { hand: [], trade: 20 },
      tradeRow: ['cutter', 'ram', 'scout', 'viper', 'explorer'],
    })
    s.tradeDeck = [{ iid: 'ev000000' as never, def: D(event) },
      { iid: 'nx000000' as never, def: D('blob-fighter') }, ...s.tradeDeck]
    return s
  }

  it('resolves the instant it is turned up and never occupies a slot', () => {
    const s = withEventOnTop('galactic-summit')
    const st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'cutter') }).state
    expect(st.players.p1.authority).toBe(57)
    expect(st.players.p2.authority).toBe(57)
    expect(st.tradeRow.some((c) => c && c.def === D('galactic-summit'))).toBe(false)
    // The slot is filled from the next card down, not left empty.
    expect(st.tradeRow.filter(Boolean)).toHaveLength(5)
    expect(st.scrapHeap.some((c) => c.def === D('galactic-summit'))).toBe(true)
  })

  it('Quasar deals two cards to each player', () => {
    const s = withEventOnTop('quasar')
    s.players.p1.deck = [{ iid: 'a1' as never, def: D('scout') }, { iid: 'a2' as never, def: D('scout') }]
    s.players.p2.deck = [{ iid: 'b1' as never, def: D('scout') }, { iid: 'b2' as never, def: D('scout') }]
    s.players.p2.hand = []
    const st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'cutter') }).state
    expect(st.players.p1.hand).toHaveLength(2)
    expect(st.players.p2.hand).toHaveLength(2)
  })

  it('Supernova hits both players and clears the trade row', () => {
    const s = withEventOnTop('supernova')
    const st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'cutter') }).state
    expect(st.players.p1.authority).toBe(45)
    expect(st.players.p2.authority).toBe(45)
    // Everything that was in the row is scrapped, then the row refills.
    expect(st.tradeRow.some((c) => c && c.def === D('ram'))).toBe(false)
    expect(st.scrapHeap.some((c) => c.def === D('ram'))).toBe(true)
  })

  it('Black Hole charges for every card short of two', () => {
    const s = withEventOnTop('black-hole')
    s.players.p1.hand = [{ iid: 'h1' as never, def: D('scout') }]
    s.players.p2.hand = []
    let st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'cutter') }).state

    // Active player first. One card discarded: one short, so 4 authority.
    expect(pending(st)?.actor).toBe('p1')
    st = run(st, choose(st, byDef('scout'))).state
    expect(st.players.p1.authority).toBe(46)
    // The opponent had nothing to discard: two short, so the full 8, and no
    // prompt -- an empty hand is not an escape from the penalty.
    expect(st.players.p2.authority).toBe(42)
  })

  it('Bombardment lets each player pick the base or the authority', () => {
    const s = withEventOnTop('bombardment')
    s.players.p1.inPlay = [inPlay('barter-world')]
    let st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'cutter') }).state

    expect(pending(st)?.prompt).toBe('DESTROY_OWN_BASE_OR_LOSE')
    st = run(st, choose(st, byDef('barter-world'))).state
    expect(st.players.p1.inPlay).toHaveLength(0)
    expect(st.players.p1.authority).toBe(50)
    // Self-inflicted: it must not count towards a "destroy enemy bases" goal.
    expect(st.basesDestroyed.p1).toBe(0)
    // The opponent has no base, so they simply pay.
    expect(st.players.p2.authority).toBe(44)
  })

  it('Warp Jump puts back only cards it just drew', () => {
    const s = withEventOnTop('warp-jump')
    s.players.p1.hand = [{ iid: 'keep1' as never, def: D('viper') }]
    s.players.p1.deck = ['a', 'b', 'c'].map((x) => ({ iid: x as never, def: D('scout') }))
    s.players.p2.hand = []
    s.players.p2.deck = ['d', 'e', 'f'].map((x) => ({ iid: x as never, def: D('scout') }))
    let st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'cutter') }).state

    const c = pending(st)!
    expect(c.prompt).toBe('TOPDECK_FROM_HAND')
    expect([c.min, c.max]).toEqual([2, 2])
    // The card already in hand is not one of "those cards".
    expect(c.n).toBe(3)
    expect(() => run(st, chooseMany(st, [byDef('viper'), byDef('scout')]))).toThrow()

    st = run(st, chooseMany(st, [
      (o: { o: string; iid?: string }) => o.iid === 'a',
      (o: { o: string; iid?: string }) => o.iid === 'b',
    ])).state
    expect(st.players.p1.hand.map((x) => x.iid).sort()).toEqual(['c', 'keep1'])
    // Selection order is deck order: the last one chosen ends up on top.
    expect(st.players.p1.deck[0]?.iid).toBe('b')
  })

  it('Trade Mission is asymmetric: trade for the active player, cards for the other', () => {
    const s = withEventOnTop('trade-mission')
    s.players.p2.hand = []
    s.players.p2.deck = ['d', 'e'].map((x) => ({ iid: x as never, def: D('scout') }))
    const st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'cutter') }).state
    // 20 trade, minus the Cutter's 2, plus the event's 4.
    expect(st.players.p1.trade).toBe(22)
    expect(st.players.p1.pendingRedirects).toHaveLength(1)
    expect(st.players.p2.hand).toHaveLength(2)
  })
})
