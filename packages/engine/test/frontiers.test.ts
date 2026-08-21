import { describe, expect, it } from 'vitest'
import { asDefId } from '../src/ids'
import { IllegalActionError } from '../src/reduce'
import {
  byBranch, byDef, choose, chooseMany, decline, handIid, inPlay, legalFor,
  pending, playIid, rowIid, run, scenario,
} from './scenario'

const D = asDefId

describe('Double Ally', () => {
  it('needs three cards of the faction, not two', () => {
    // Two Blob cards: ally is live, double ally is not.
    const two = scenario({
      me: { hand: ['stinger', 'crusher'] },
    })
    let st = run(two,
      { t: 'PLAY_CARD', card: handIid(two, 'p1', 'stinger') },
      { t: 'PLAY_CARD', card: handIid(two, 'p1', 'crusher') },
    ).state
    expect(st.players.p1.allyUnlocked).toContain('blob')
    expect(st.players.p1.doubleAllyUnlocked).not.toContain('blob')

    const three = scenario({
      me: { hand: ['hive-queen', 'stinger', 'crusher'] },
    })
    st = run(three,
      { t: 'PLAY_CARD', card: handIid(three, 'p1', 'hive-queen') },
      { t: 'PLAY_CARD', card: handIid(three, 'p1', 'stinger') },
      { t: 'PLAY_CARD', card: handIid(three, 'p1', 'crusher') },
    ).state
    expect(st.players.p1.doubleAllyUnlocked).toContain('blob')
  })

  it('is a separate slot: both ally and double ally fire the same turn', () => {
    const s = scenario({ me: { hand: ['hive-queen', 'stinger', 'crusher'] } })
    let st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'hive-queen') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'stinger') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'crusher') },
    ).state
    // Primary: 7 combat. Stinger 3, Crusher 6 -> 16 before any ally.
    const before = st.players.p1.combat
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'hive-queen'), slot: 'ally' }).state
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'hive-queen'), slot: 'doubleAlly' }).state
    expect(st.players.p1.combat).toBe(before + 6)
  })

  it('is refused while only two of the faction are in play', () => {
    const s = scenario({ me: { hand: ['hive-queen', 'stinger'] } })
    const st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'hive-queen') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'stinger') },
    ).state
    const q = playIid(st, 'p1', 'hive-queen')
    expect(legalFor(st, 'p1')).not.toContainEqual({ t: 'ACTIVATE', card: q, slot: 'doubleAlly' })
    expect(() => run(st, { t: 'ACTIVATE', card: q, slot: 'doubleAlly' }))
      .toThrow(IllegalActionError)
  })

  it('stays available for the turn even after the third card leaves play', () => {
    // Trigger-then-use, the same rule the single ally follows.
    const s = scenario({ me: { hand: ['hive-queen', 'stinger', 'crusher'] } })
    let st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'hive-queen') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'stinger') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'crusher') },
    ).state
    // Stinger scraps itself for trade, dropping Blob back to two in play.
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'stinger'), slot: 'scrap' }).state
    expect(st.players.p1.inPlay.filter((c) => c.def === D('stinger'))).toHaveLength(0)
    const before = st.players.p1.combat
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'hive-queen'), slot: 'doubleAlly' }).state
    expect(st.players.p1.combat).toBe(before + 3)
  })

  it('resets at end of turn', () => {
    const s = scenario({ me: { hand: ['hive-queen', 'stinger', 'crusher'] } })
    let st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'hive-queen') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'stinger') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'crusher') },
    ).state
    st = run(st, { t: 'END_TURN' }).state
    expect(st.players.p1.doubleAllyUnlocked).toHaveLength(0)
  })
})

describe('Pulverizer: scrap the row for its cost in combat', () => {
  it('gains combat equal to the scrapped card cost and refills the row', () => {
    const s = scenario({
      me: { hand: ['pulverizer'] },
      tradeRow: ['blob-alpha', 'stinger', 'cutter', 'ram', 'explorer'],
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'pulverizer') }).state
    expect(pending(st)?.prompt).toBe('SCRAP_ROW_FOR_COMBAT')
    st = run(st, choose(st, byDef('blob-alpha'))).state // cost 6
    expect(st.players.p1.combat).toBe(6)
    expect(st.tradeRow.filter(Boolean)).toHaveLength(5)
    expect(st.tradeRow.some((c) => c?.def === D('blob-alpha'))).toBe(false)
  })
})

describe('Neural Nexus: scrap from hand or discard for its cost', () => {
  it('converts the scrapped card cost into combat', () => {
    const s = scenario({
      me: {
        hand: ['blob-alpha'],
        discard: ['scout'],
        inPlay: [inPlay('neural-nexus')],
      },
    })
    let st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'neural-nexus'), slot: 'primary' }).state
    expect(pending(st)?.prompt).toBe('SCRAP_FOR_COMBAT')
    st = run(st, choose(st, byDef('blob-alpha'))).state
    expect(st.players.p1.combat).toBe(6)
    expect(st.scrapHeap.some((c) => c.def === D('blob-alpha'))).toBe(true)
  })
})

describe('Warpgate Cruiser: discard any number for combat', () => {
  it('pays two combat per card discarded, and zero is allowed', () => {
    const s = scenario({ me: { hand: ['warpgate-cruiser', 'scout', 'scout', 'viper'] } })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'warpgate-cruiser') }).state
    expect(pending(st)?.prompt).toBe('DISCARD_FOR_COMBAT')
    expect(pending(st)?.min).toBe(0)
    st = run(st, chooseMany(st, [byDef('scout'), byDef('viper')])).state
    expect(st.players.p1.combat).toBe(4)

    const none = scenario({ me: { hand: ['warpgate-cruiser', 'scout'] } })
    let st2 = run(none, { t: 'PLAY_CARD', card: handIid(none, 'p1', 'warpgate-cruiser') }).state
    st2 = run(st2, decline(st2)).state
    expect(st2.players.p1.combat).toBe(0)
  })
})

describe('Reclamation Station: combat for everything scrapped this turn', () => {
  it('counts the cards you scrapped, including itself', () => {
    const s = scenario({
      me: {
        hand: ['plasma-bot', 'scout'],
        discard: ['viper'],
        inPlay: [inPlay('reclamation-station')],
      },
    })
    // Plasma Bot scraps one from hand; Reclamation Station's primary scraps one
    // from the discard pile. That is two, plus the Station itself makes three.
    // Plasma Bot's scrap is optional, so it asks. The Station's is mandatory
    // with one card in the pile, so it resolves itself.
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'plasma-bot') }).state
    st = run(st, choose(st, byDef('scout'))).state
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'reclamation-station'), slot: 'primary' }).state
    expect(st.players.p1.scrappedThisTurn).toBe(2)

    const before = st.players.p1.combat
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'reclamation-station'), slot: 'scrap' }).state
    expect(st.players.p1.combat).toBe(before + 9)
  })

  it('does not count trade row scrapping, which belongs to nobody', () => {
    const s = scenario({
      me: { hand: ['blob-miner'] },
      tradeRow: ['cutter', 'ram', 'scout', 'viper', 'explorer'],
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-miner') }).state
    st = run(st, choose(st, byDef('cutter'))).state
    expect(st.players.p1.scrappedThisTurn).toBe(0)
  })

  it('resets between turns', () => {
    const s = scenario({ me: { hand: ['plasma-bot', 'scout'] } })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'plasma-bot') }).state
    st = run(st, choose(st, byDef('scout'))).state
    expect(st.players.p1.scrappedThisTurn).toBe(1)
    st = run(st, { t: 'END_TURN' }).state
    expect(st.players.p1.scrappedThisTurn).toBe(0)
  })
})

describe('Mobile Market: back from the scrap heap', () => {
  it('returns to the discard pile at end of turn', () => {
    const s = scenario({ me: { hand: [], inPlay: [inPlay('mobile-market')] } })
    let st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'mobile-market'), slot: 'scrap' }).state
    expect(st.scrapHeap.some((c) => c.def === D('mobile-market'))).toBe(true)
    expect(st.players.p1.discard.some((c) => c.def === D('mobile-market'))).toBe(false)

    st = run(st, { t: 'END_TURN' }).state
    expect(st.scrapHeap.some((c) => c.def === D('mobile-market'))).toBe(false)
    expect(st.players.p1.discard.some((c) => c.def === D('mobile-market'))).toBe(true)
  })
})

describe('Repair Mech: a base back on top of the deck', () => {
  it('offers only bases from the discard pile', () => {
    // Two bases in the discard pile, so the top-deck choice is a real one.
    const s = scenario({
      me: { hand: ['repair-mech'], discard: ['scout', 'spike-cluster', 'nesting-ground'] },
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'repair-mech') }).state
    // Choose the second branch: top-deck a base rather than take the trade.
    st = run(st, choose(st, byBranch(1))).state
    expect(pending(st)?.prompt).toBe('TOPDECK_BASE')
    // Only the bases are offered: the Scout in the discard pile is not one.
    expect(pending(st)?.n).toBe(2)
    st = run(st, choose(st, byDef('spike-cluster'))).state
    expect(st.players.p1.deck[0]?.def).toBe(D('spike-cluster'))
  })
})

describe('Long Hauler: top-deck the next BASE, not the next ship', () => {
  it('redirects a base and leaves a ship alone', () => {
    const s = scenario({
      me: { hand: [], inPlay: [inPlay('long-hauler')], trade: 10 },
      tradeRow: ['spike-cluster', 'stinger', 'scout', 'viper', 'explorer'],
    })
    let st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'long-hauler'), slot: 'scrap' }).state
    expect(st.players.p1.pendingRedirects).toEqual([
      { filter: 'base', dest: 'deck_top', optional: false },
    ])

    // Buying a ship must not consume it or offer the redirect.
    st = run(st, { t: 'BUY_CARD', card: rowIid(st, 'stinger') }).state
    expect(pending(st)).toBeNull()
    expect(st.players.p1.pendingRedirects).toHaveLength(1)

    // Long Hauler's text has no "you may", so with one armed redirect and one
    // destination there is nothing to decide and the choice auto-resolves.
    st = run(st, { t: 'BUY_CARD', card: rowIid(st, 'spike-cluster') }).state
    expect(pending(st)).toBeNull()
    expect(st.players.p1.deck[0]?.def).toBe(D('spike-cluster'))
    expect(st.players.p1.pendingRedirects).toHaveLength(0)
  })
})

describe('Star Empire filter: draw then discard', () => {
  it('draws first, so the drawn card can be the one discarded', () => {
    // Two cards left in hand after playing, so the discard is a real choice
    // rather than a degenerate one the engine resolves for us.
    const s = scenario({
      me: { hand: ['frontier-hawk', 'cutter'], deck: ['blob-alpha', 'scout', 'scout', 'scout', 'scout'] },
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'frontier-hawk') }).state
    expect(pending(st)?.prompt).toBe('DISCARD')
    // Blob Alpha was drawn, so it is available to discard: draw comes first.
    expect(() => choose(st, byDef('blob-alpha'))).not.toThrow()
    st = run(st, choose(st, byDef('blob-alpha'))).state
    expect(st.players.p1.discard.some((c) => c.def === D('blob-alpha'))).toBe(true)
    expect(st.players.p1.combat).toBe(3)
  })
})

describe('Gateship and Burrower: free acquisitions', () => {
  it('Gateship takes a card of cost 6 or less straight to the deck top', () => {
    const s = scenario({
      me: { hand: ['gateship'] },
      tradeRow: ['blob-alpha', 'transit-nexus', 'scout', 'viper', 'explorer'],
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'gateship') }).state
    expect(pending(st)?.prompt).toBe('ACQUIRE_FREE')
    // Transit Nexus costs 8 and must not be offered; Blob Alpha costs exactly 6.
    expect(() => choose(st, byDef('transit-nexus'))).toThrow()
    expect(() => choose(st, byDef('blob-alpha'))).not.toThrow()
    st = run(st, choose(st, byDef('blob-alpha'))).state
    expect(st.players.p1.deck[0]?.def).toBe(D('blob-alpha'))
  })
})

describe('the set switch', () => {
  it('a Frontiers card is a legal purchase when the set is dealt', () => {
    const s = scenario({
      me: { trade: 8, hand: [] },
      tradeRow: ['hive-queen', 'scout', 'viper', 'explorer', 'cutter'],
    })
    const st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'hive-queen') }).state
    expect(st.players.p1.discard.some((c) => c.def === D('hive-queen'))).toBe(true)
  })
})
