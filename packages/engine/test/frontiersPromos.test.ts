import { describe, expect, it } from 'vitest'
import { CARDS, tradeDeckComposition } from '../src/cards/registry'
import { asDefId } from '../src/ids'
import {
  byDef, choose, chooseMany, decline, handIid, inPlay, legalFor,
  pending, playIid, rowIid, run, scenario,
} from './scenario'

const D = asDefId

describe('Frontiers Kickstarter promo data integrity', () => {
  const cards = [...CARDS.values()].filter((c) => c.set === 'frontiers-promos')

  it('is 25 cards in 40 copies', () => {
    // The pack is sold as 41 cards; the extra one is the thank-you card, which
    // is not a card you can draw.
    expect(cards).toHaveLength(25)
    expect(tradeDeckComposition(undefined, ['frontiers-promos'])).toHaveLength(40)
  })

  it('collides with no other set', () => {
    const others = new Set(
      [...CARDS.values()].filter((c) => c.set !== 'frontiers-promos').map((c) => c.id),
    )
    for (const c of cards) expect(others.has(c.id), c.name).toBe(false)
  })

  it('gives every docking card a faction that matches its own', () => {
    const docking = cards.filter((c) => c.docking)
    expect(docking).toHaveLength(4)   // one per faction
    for (const c of docking) expect(c.docking, c.name).toBe(c.faction)
  })
})

describe('self-scrapping allies', () => {
  it('removes the card from play as part of the ability', () => {
    const s = scenario({
      me: { hand: ['plague-pod', 'blob-fighter'], deck: ['scout'] },
    })
    let st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'plague-pod') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-fighter') },
    ).state
    expect(st.players.p1.trade).toBe(2)

    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'plague-pod'), slot: 'ally' }).state
    // Blob Fighter's own 3, plus the Pod's 6.
    expect(st.players.p1.combat).toBe(9)
    expect(st.players.p1.inPlay.some((c) => c.def === D('plague-pod'))).toBe(false)
    // Out of the game, not into the discard pile.
    expect(st.scrapHeap.some((c) => c.def === D('plague-pod'))).toBe(true)
    expect(st.players.p1.discard.some((c) => c.def === D('plague-pod'))).toBe(false)
  })
})

describe('Docking', () => {
  it('keeps the card in hand while the right base is standing', () => {
    const s = scenario({
      me: {
        hand: ['sentinel', 'scout'],
        inPlay: [inPlay('blob-wheel')],
        // Enough deck that the next hand is drawn without reshuffling what was
        // just discarded, which would put it straight back into hand.
        deck: ['viper', 'viper', 'viper', 'viper', 'viper', 'viper'],
      },
    })
    const st = run(s, { t: 'END_TURN' }).state
    // The Scout is discarded; the Sentinel docks at the Blob base and stays.
    expect(st.players.p1.discard.map((c) => c.def)).toEqual([D('scout')])
    expect(st.players.p1.hand.some((c) => c.def === D('sentinel'))).toBe(true)
  })

  it('discards it like anything else with no base of that faction', () => {
    const s = scenario({
      me: {
        hand: ['sentinel'],
        inPlay: [inPlay('barter-world')],
        deck: ['viper', 'viper', 'viper', 'viper', 'viper', 'viper'],
      },
    })
    const st = run(s, { t: 'END_TURN' }).state
    expect(st.players.p1.discard.map((c) => c.def)).toEqual([D('sentinel')])
    expect(st.players.p1.hand.some((c) => c.def === D('sentinel'))).toBe(false)
  })
})

describe('Converter', () => {
  it('pays out on every scrap from hand or discard, without limit', () => {
    const s = scenario({
      me: {
        hand: ['recycle-bot', 'scout', 'viper'],
        inPlay: [inPlay('converter')],
        discard: ['scout'],
      },
    })
    // Recycle Bot's primary scraps one card from hand.
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'recycle-bot') }).state
    st = run(st, choose(st, byDef('scout'))).state
    expect(st.players.p1.combat).toBe(2)

    // Converter's own ally scraps another: it watches itself too. One card left
    // in hand, so the mandatory choice auto-resolves.
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'converter'), slot: 'ally' }).state
    expect(st.players.p1.combat).toBe(4)
  })

  it('does not fire on trade row scrapping, which has no owner', () => {
    const s = scenario({
      me: { hand: ['blob-miner'], inPlay: [inPlay('converter')] },
      tradeRow: ['cutter', 'ram', 'scout', 'viper', 'explorer'],
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-miner') }).state
    st = run(st, choose(st, byDef('cutter'))).state
    expect(st.players.p1.combat).toBe(0)
  })
})

describe('The Colossus', () => {
  it('takes the chosen faction for real, and draws once per card of it', () => {
    const s = scenario({
      me: {
        hand: ['the-colossus'],
        inPlay: [inPlay('blob-fighter'), inPlay('blob-wheel'), inPlay('cutter')],
        deck: ['scout', 'scout', 'scout', 'scout'],
      },
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'the-colossus') }).state
    expect(st.players.p1.combat).toBe(10)
    expect(pending(st)?.prompt).toBe('CHOOSE_FACTION')
    st = run(st, choose(st, (o: { o: string; label?: string }) => o.label === 'blob')).state

    const colossus = st.players.p1.inPlay.find((c) => c.def === D('the-colossus'))!
    expect(colossus.chosenFaction).toBe('blob')
    // A real faction: the Blob Fighter's ally is now on.
    expect(st.players.p1.allyUnlocked).toContain('blob')
  })
})

describe('Midgate Station', () => {
  it('pays the discards plus one, as a single resource choice', () => {
    const s = scenario({
      me: { hand: ['scout', 'viper'], inPlay: [inPlay('midgate-station')] },
    })
    let st = run(s, {
      t: 'ACTIVATE', card: playIid(s, 'p1', 'midgate-station'), slot: 'primary',
    }).state
    st = run(st, chooseMany(st, [byDef('scout'), byDef('viper')])).state
    // ONE choice for the whole lot, unlike Supply Depot's per-card split.
    expect(pending(st)?.prompt).toBe('CHOOSE_BRANCH')
    st = run(st, choose(st, (o: { o: string; index?: number }) => o.index === 1)).state
    expect(st.players.p1.combat).toBe(3)
  })

  it('still pays one for discarding nothing', () => {
    const s = scenario({ me: { hand: [], inPlay: [inPlay('midgate-station')] } })
    let st = run(s, {
      t: 'ACTIVATE', card: playIid(s, 'p1', 'midgate-station'), slot: 'primary',
    }).state
    st = run(st, choose(st, (o: { o: string; index?: number }) => o.index === 0)).state
    expect(st.players.p1.trade).toBe(1)
  })
})

describe('Patience Rewarded', () => {
  it('leaves a card buyable for the rest of the game, outside the row', () => {
    const s = scenario({
      me: { hand: [], trade: 20 },
      tradeRow: ['cutter', 'ram', 'scout', 'viper', 'explorer'],
    })
    s.tradeDeck = [
      { iid: 'ev000000' as never, def: D('patience-rewarded') },
      { iid: 'nx000000' as never, def: D('blob-fighter') },
      ...s.tradeDeck,
    ]
    // Emptying a slot turns the event up.
    let st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'cutter') }).state
    expect(pending(st)?.prompt).toBe('SET_ASIDE_FROM_ROW')
    st = run(st, choose(st, byDef('ram'))).state
    // The opponent's half is optional and can simply be declined.
    if (pending(st)) st = run(st, decline(st)).state

    expect(st.setAside.map((c) => c.def)).toEqual([D('ram')])
    expect(st.tradeRow.some((c) => c && c.def === D('ram'))).toBe(false)
    // The row is refilled, so setting a card aside does not shrink it.
    expect(st.tradeRow.filter(Boolean)).toHaveLength(5)

    const aside = st.setAside[0]!.iid
    expect(legalFor(st, 'p1').some((a) => a.t === 'BUY_CARD' && a.card === aside)).toBe(true)
    st = run(st, { t: 'BUY_CARD', card: aside }).state
    expect(st.setAside).toHaveLength(0)
    expect(st.players.p1.discard.some((c) => c.def === D('ram'))).toBe(true)
  })
})

describe('Tactical Maneuver', () => {
  it('gives each side its own choice', () => {
    const s = scenario({
      me: { hand: [], trade: 20 },
      them: { hand: [], deck: ['scout'] },
      tradeRow: ['cutter', 'ram', 'scout', 'viper', 'explorer'],
    })
    s.tradeDeck = [
      { iid: 'ev000000' as never, def: D('tactical-maneuver') },
      { iid: 'nx000000' as never, def: D('blob-fighter') },
      ...s.tradeDeck,
    ]
    let st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'cutter') }).state
    expect(pending(st)?.actor).toBe('p1')
    st = run(st, choose(st, (o: { o: string; index?: number }) => o.index === 1)).state
    expect(st.players.p1.combat).toBe(4)

    // Their half is theirs to answer.
    expect(pending(st)?.actor).toBe('p2')
    st = run(st, choose(st, (o: { o: string; index?: number }) => o.index === 1)).state
    expect(st.players.p2.hand).toHaveLength(1)
  })
})
