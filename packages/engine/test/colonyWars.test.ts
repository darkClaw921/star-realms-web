import { describe, expect, it } from 'vitest'
import { asDefId } from '../src/ids'
import {
  byBranch, byDef, choose, chooseMany, decline, handIid, inPlay, legalFor,
  pending, playIid, rowIid, run, scenario,
} from './scenario'

const D = asDefId

/**
 * Colony Wars mechanics that the core set and Frontiers never exercised.
 *
 * The plain cards (gain N, ally draws a card) are covered by the data test and
 * the fuzzer; what is worth pinning down here is the four new rules axes, plus
 * the two conditionals that are easy to get backwards.
 */

describe('acquire straight into hand', () => {
  it("Leviathan's ally hands you the card, playable the same turn", () => {
    const s = scenario({
      me: { hand: ['leviathan', 'predator'], trade: 0 },
      tradeRow: ['solar-skiff', 'peacekeeper', 'scout', 'viper', 'explorer'],
    })
    // Two Blob cards -> ally unlocked.
    let st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'leviathan') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'predator') },
    ).state
    // Leviathan's own primary asks about destroying a base first.
    if (pending(st)?.prompt === 'DESTROY_BASE') st = run(st, decline(st)).state

    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'leviathan'), slot: 'ally' }).state
    expect(pending(st)?.prompt).toBe('ACQUIRE_FREE')
    // Peacekeeper costs 6, over the limit of three, so it is not even offered.
    expect(() => run(st, choose(st, byDef('peacekeeper')))).toThrow()

    st = run(st, choose(st, byDef('solar-skiff'))).state
    expect(st.players.p1.hand.some((c) => c.def === D('solar-skiff'))).toBe(true)
    expect(st.players.p1.discard.some((c) => c.def === D('solar-skiff'))).toBe(false)
    // And it really is playable now, which is the whole point of the destination.
    expect(legalFor(st, 'p1').some(
      (a) => a.t === 'PLAY_CARD' && a.card === handIid(st, 'p1', 'solar-skiff'),
    )).toBe(true)
  })
})

describe('"when you acquire this card" triggers', () => {
  it('offers Plasma Vent to hand only after a Blob card has been played', () => {
    const s = scenario({
      me: { hand: ['predator'], trade: 20 },
      tradeRow: ['plasma-vent', 'cutter', 'scout', 'viper', 'explorer'],
    })
    // Bought cold: the condition fails, so nothing is asked and it lands in the
    // discard pile like any other purchase.
    const cold = run(s, { t: 'BUY_CARD', card: rowIid(s, 'plasma-vent') }).state
    expect(pending(cold)).toBeNull()
    expect(cold.players.p1.discard.some((c) => c.def === D('plasma-vent'))).toBe(true)

    // Bought after playing a Blob card: the "you may" appears.
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'predator') }).state
    st = run(st, { t: 'BUY_CARD', card: rowIid(st, 'plasma-vent') }).state
    expect(pending(st)?.prompt).toBe('MAY')
    st = run(st, choose(st, (o: { o: string }) => o.o === 'CONFIRM')).state
    expect(st.players.p1.hand.some((c) => c.def === D('plasma-vent'))).toBe(true)
    expect(st.players.p1.discard.some((c) => c.def === D('plasma-vent'))).toBe(false)
  })

  it('lets you decline and keep the card in the discard pile', () => {
    const s = scenario({
      me: { hand: ['predator'], trade: 20 },
      tradeRow: ['plasma-vent', 'cutter', 'scout', 'viper', 'explorer'],
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'predator') }).state
    st = run(st, { t: 'BUY_CARD', card: rowIid(st, 'plasma-vent') }).state
    st = run(st, decline(st)).state
    expect(st.players.p1.discard.some((c) => c.def === D('plasma-vent'))).toBe(true)
  })
})

describe('Stealth Tower', () => {
  // Two candidate bases, so the copy choice is a real one rather than a
  // degenerate single option that would auto-resolve.
  const board = () => scenario({
    me: { hand: ['stealth-tower'], inPlay: [inPlay('storage-silo')], trade: 0 },
    them: { inPlay: [inPlay('barter-world')] },
  })

  it('copies an ENEMY base on play and leaves its own activation unspent', () => {
    const s = board()
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'stealth-tower') }).state
    expect(pending(st)?.prompt).toBe('COPY_BASE')
    st = run(st, choose(st, byDef('barter-world'))).state

    const tower = st.players.p1.inPlay.find((c) => c.def === D('stealth-tower'))!
    expect(tower.copiedDef).toBe(D('barter-world'))
    // The copy resolves nothing by itself: it is Barter World's ACTIVATED
    // primary that the tower now has, and the copying did not spend it.
    expect(st.players.p1.authority).toBe(50)
    expect(tower.used.primary).toBe(false)
    expect(legalFor(st, 'p1').some(
      (a) => a.t === 'ACTIVATE' && a.card === tower.iid && a.slot === 'primary',
    )).toBe(true)

    // And the copied ability really works.
    st = run(st, { t: 'ACTIVATE', card: tower.iid, slot: 'primary' }).state
    st = run(st, choose(st, byBranch(0))).state    // {authority:2}
    expect(st.players.p1.authority).toBe(52)
  })

  it('does not count as a card played of the copied faction', () => {
    // Publisher FAQ: the copy happens after it enters play, so it never feeds
    // the "cards played this turn" counters.
    const s = board()
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'stealth-tower') }).state
    st = run(st, choose(st, byDef('barter-world'))).state
    expect(st.players.p1.factionPlayedThisTurn.trade_federation).toBe(0)
    expect(st.players.p1.factionPlayedThisTurn.machine_cult).toBe(1)
  })

  it('drops the copy when its own turn ends, not at the start of the next', () => {
    const s = board()
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'stealth-tower') }).state
    st = run(st, choose(st, byDef('barter-world'))).state
    st = run(st, { t: 'END_TURN' }).state
    // It is now the opponent's turn: a copied outpost left standing would shield
    // p1 through exactly the attack the printed wording excludes.
    expect(st.players.p1.inPlay.find((c) => c.def === D('stealth-tower'))!.copiedDef).toBeNull()
  })
})

describe('faction-filtered play triggers', () => {
  it('Command Center fires on Star Empire ships and stays silent on others', () => {
    const s = scenario({
      me: { hand: ['star-barge', 'solar-skiff'], inPlay: [inPlay('command-center')] },
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'solar-skiff') }).state
    expect(st.players.p1.combat).toBe(0)   // Trade Federation: no trigger

    st = run(st, { t: 'PLAY_CARD', card: handIid(st, 'p1', 'star-barge') }).state
    expect(st.players.p1.combat).toBe(2)   // Star Empire: fires
  })
})

describe('conditional bonuses', () => {
  it('Lancer adds combat only while the opponent controls a base', () => {
    const bare = scenario({ me: { hand: ['lancer'] } })
    expect(run(bare, { t: 'PLAY_CARD', card: handIid(bare, 'p1', 'lancer') })
      .state.players.p1.combat).toBe(4)

    const blockaded = scenario({
      me: { hand: ['lancer'] },
      them: { inPlay: [inPlay('barter-world')] },
    })
    expect(run(blockaded, { t: 'PLAY_CARD', card: handIid(blockaded, 'p1', 'lancer') })
      .state.players.p1.combat).toBe(6)
  })

  it('Central Station pays out only at three bases, counting itself', () => {
    const two = scenario({
      me: { hand: [], inPlay: [inPlay('central-station'), inPlay('storage-silo')] },
    })
    let st = run(two, { t: 'ACTIVATE', card: playIid(two, 'p1', 'central-station'), slot: 'primary' }).state
    expect(st.players.p1.trade).toBe(2)
    expect(st.players.p1.authority).toBe(50)

    const three = scenario({
      me: {
        hand: [],
        inPlay: [inPlay('central-station'), inPlay('storage-silo'), inPlay('stellar-reef')],
        deck: ['scout'],
      },
    })
    st = run(three, { t: 'ACTIVATE', card: playIid(three, 'p1', 'central-station'), slot: 'primary' }).state
    expect(st.players.p1.trade).toBe(2)
    expect(st.players.p1.authority).toBe(54)
    expect(st.players.p1.hand).toHaveLength(1)
  })
})

describe('Supply Depot', () => {
  it('pays per discarded card and allows a mixed split', () => {
    const s = scenario({
      me: { hand: ['scout', 'viper'], inPlay: [inPlay('supply-depot')] },
    })
    let st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'supply-depot'), slot: 'primary' }).state
    expect(pending(st)?.prompt).toBe('DISCARD_FOR_TRADE_OR_COMBAT')
    st = run(st, chooseMany(st, [byDef('scout'), byDef('viper')])).state

    // One choice per card, so trade and combat can be mixed.
    expect(pending(st)?.prompt).toBe('CHOOSE_BRANCH')
    st = run(st, choose(st, byBranch(0))).state   // {trade:2}
    expect(pending(st)?.prompt).toBe('CHOOSE_BRANCH')
    st = run(st, choose(st, byBranch(1))).state   // {combat:2}

    expect(st.players.p1.trade).toBe(2)
    expect(st.players.p1.combat).toBe(2)
    expect(st.players.p1.hand).toHaveLength(0)
    expect(st.players.p1.discard).toHaveLength(2)
  })
})

describe('Factory World', () => {
  it('routes the next acquisition into hand with no chance to decline', () => {
    const s = scenario({
      me: { hand: [], inPlay: [inPlay('factory-world')], trade: 10 },
      tradeRow: ['cutter', 'ram', 'scout', 'viper', 'explorer'],
    })
    let st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'factory-world'), slot: 'primary' }).state
    expect(st.players.p1.pendingRedirects).toEqual([
      { filter: 'any', dest: 'hand', optional: false },
    ])
    // Mandatory with a single destination: nothing to decide, so it resolves
    // without a prompt.
    st = run(st, { t: 'BUY_CARD', card: rowIid(st, 'cutter') }).state
    expect(pending(st)).toBeNull()
    expect(st.players.p1.hand.some((c) => c.def === D('cutter'))).toBe(true)
    expect(st.players.p1.pendingRedirects).toHaveLength(0)

    // One redirect, one acquisition: the second purchase is unaffected.
    st = run(st, { t: 'BUY_CARD', card: rowIid(st, 'ram') }).state
    expect(st.players.p1.discard.some((c) => c.def === D('ram'))).toBe(true)
  })

  it('lets the player pick when two redirects with different destinations are armed', () => {
    const s = scenario({
      me: {
        hand: [],
        inPlay: [inPlay('factory-world'), inPlay('federation-shipyard'), inPlay('storage-silo')],
        trade: 10,
      },
      tradeRow: ['cutter', 'ram', 'scout', 'viper', 'explorer'],
    })
    let st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'factory-world'), slot: 'primary' }).state
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'federation-shipyard'), slot: 'ally' }).state
    expect(st.players.p1.pendingRedirects).toHaveLength(2)

    st = run(st, { t: 'BUY_CARD', card: rowIid(st, 'cutter') }).state
    const c = pending(st)!
    expect(c.prompt).toBe('REDIRECT_ACQUIRED')
    expect(c.min).toBe(1)          // both are mandatory: one MUST be spent
    expect(c.n).toBe(2)

    st = run(st, choose(st, byBranch(1))).state    // the shipyard's deck_top
    expect(st.players.p1.deck[0]?.def).toBe(D('cutter'))
    // Exactly the chosen one is consumed, so Factory World's is still armed.
    expect(st.players.p1.pendingRedirects).toEqual([
      { filter: 'any', dest: 'hand', optional: false },
    ])
  })
})

describe('Ravager', () => {
  it('scraps up to two trade row cards, and may scrap none', () => {
    const s = scenario({
      me: { hand: ['ravager'] },
      tradeRow: ['cutter', 'ram', 'scout', 'viper', 'explorer'],
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'ravager') }).state
    const c = pending(st)!
    expect(c.prompt).toBe('SCRAP_TRADE_ROW')
    expect([c.min, c.max]).toEqual([0, 2])

    st = run(st, chooseMany(st, [byDef('cutter'), byDef('ram')])).state
    expect(st.scrapHeap.map((x) => x.def).sort())
      .toEqual([D('cutter'), D('ram')].sort())
    expect(st.players.p1.combat).toBe(6)
  })
})
