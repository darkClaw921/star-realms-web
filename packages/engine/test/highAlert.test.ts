import { describe, expect, it } from 'vitest'
import { CARDS, cardDef, tradeDeckComposition } from '../src/cards/registry'
import { costFor } from '../src/helpers'
import { asDefId } from '../src/ids'
import {
  byDef, choose, decline, handIid, inPlay, legalFor,
  pending, playIid, rowIid, run, scenario,
} from './scenario'

const D = asDefId

describe('High Alert data integrity', () => {
  const packs = [
    { set: 'high-alert-first-strike' as const, distinct: 18, copies: 22 },
    { set: 'high-alert-tech' as const, distinct: 8, copies: 12 },
    { set: 'high-alert-requisition' as const, distinct: 8, copies: 12 },
    { set: 'high-alert-invasion' as const, distinct: 8, copies: 12 },
    { set: 'high-alert-heroes' as const, distinct: 12, copies: 12 },
  ]

  for (const pack of packs) {
    const cards = [...CARDS.values()].filter((c) => c.set === pack.set)

    it(`${pack.set} is ${pack.distinct} cards in ${pack.copies} copies`, () => {
      expect(cards).toHaveLength(pack.distinct)
      expect(tradeDeckComposition(undefined, [pack.set])).toHaveLength(pack.copies)
    })

    it(`${pack.set} collides with no other set`, () => {
      const others = new Set(
        [...CARDS.values()].filter((c) => c.set !== pack.set).map((c) => c.id),
      )
      for (const c of cards) expect(others.has(c.id), c.name).toBe(false)
    })
  }

  it('gives every Tech a price to activate and nothing else to do', () => {
    const tech = [...CARDS.values()].filter((c) => c.type === 'tech')
    expect(tech).toHaveLength(10)   // eight in the Tech pack, two in First Strike
    for (const c of tech) {
      expect(c.primaryCost, c.name).toBeGreaterThan(0)
      expect(c.primary.length, c.name).toBeGreaterThan(0)
      expect(c.ally.length + c.scrap.length, c.name).toBe(0)
      expect(c.faction, c.name).toBe('unaligned')
      expect(c.defense, c.name).toBeNull()
    }
  })

  it('discounts against the right faction and never below zero', () => {
    const armory = cardDef(D('the-armory'))
    expect(armory.discount).toEqual({ faction: 'star_empire', per: 1 })
    expect(costFor(armory, [])).toBe(7)
    expect(costFor(armory, [{ def: D('imperial-fighter') }])).toBe(6)
    // Eight Star Empire cards would take a 7-cost card to -1; it floors at 0.
    expect(costFor(armory, Array(8).fill({ def: D('imperial-fighter') }))).toBe(0)
    // Another faction does nothing.
    expect(costFor(armory, [{ def: D('cutter') }])).toBe(7)
  })

  it('counts a dual-faction card towards the discount', () => {
    const corsair = cardDef(D('corsair'))
    // Alliance Transport is Star Empire AND Trade Federation.
    expect(costFor(corsair, [{ def: D('alliance-transport') }])).toBe(2)
  })
})

describe('board-dependent cost', () => {
  it('is offered and charged at the discounted price, not the printed one', () => {
    const s = scenario({
      me: { hand: [], inPlay: [inPlay('imperial-fighter'), inPlay('survey-ship')], trade: 5 },
      tradeRow: ['the-armory', 'ram', 'scout', 'viper', 'explorer'],
    })
    // Printed cost 7, two Star Empire cards in play, so it costs 5.
    expect(legalFor(s, 'p1').some(
      (a) => a.t === 'BUY_CARD' && a.card === rowIid(s, 'the-armory'),
    )).toBe(true)
    const st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'the-armory') }).state
    expect(st.players.p1.trade).toBe(0)
    expect(st.players.p1.discard.some((c) => c.def === D('the-armory'))).toBe(true)
  })

  it('is not offered when the board does not pay for it', () => {
    const s = scenario({
      me: { hand: [], trade: 5 },
      tradeRow: ['the-armory', 'ram', 'scout', 'viper', 'explorer'],
    })
    expect(legalFor(s, 'p1').some(
      (a) => a.t === 'BUY_CARD' && a.card === rowIid(s, 'the-armory'),
    )).toBe(false)
  })
})

describe('Tech', () => {
  it('goes straight into play and stays there when used', () => {
    const s = scenario({
      me: { hand: [], trade: 4 },
      tradeRow: ['missile-launcher', 'ram', 'scout', 'viper', 'explorer'],
    })
    let st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'missile-launcher') }).state
    expect(st.players.p1.inPlay.map((c) => c.def)).toEqual([D('missile-launcher')])
    expect(st.players.p1.discard).toHaveLength(0)

    // No trade left, so the ability is not offered yet.
    expect(st.players.p1.trade).toBe(0)
    expect(legalFor(st, 'p1').some((a) => a.t === 'ACTIVATE')).toBe(false)

    st = { ...st, players: { ...st.players, p1: { ...st.players.p1, trade: 3 } } }
    st = run(st, {
      t: 'ACTIVATE', card: playIid(st, 'p1', 'missile-launcher'), slot: 'primary',
    }).state
    expect(st.players.p1.trade).toBe(0)
    expect(st.players.p1.combat).toBe(3)
    // Unlike a Hero, it is not spent.
    expect(st.players.p1.inPlay.map((c) => c.def)).toEqual([D('missile-launcher')])
  })

  it('survives the end of turn and recharges', () => {
    const s = scenario({ me: { hand: [], inPlay: [inPlay('laser')], trade: 1 } })
    let st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'laser'), slot: 'primary' }).state
    expect(st.players.p1.combat).toBe(1)
    st = run(st, { t: 'END_TURN' }).state
    st = run(st, { t: 'END_TURN' }).state
    expect(st.players.p1.inPlay.map((c) => c.def)).toEqual([D('laser')])
    expect(st.players.p1.inPlay[0]!.used.primary).toBe(false)
  })

  it('cannot be attacked', () => {
    const s = scenario({
      me: { hand: [], combat: 20 },
      them: { inPlay: [inPlay('laser')] },
    })
    expect(legalFor(s, 'p1').some((a) => a.t === 'ATTACK_BASE')).toBe(false)
    expect(legalFor(s, 'p1').some((a) => a.t === 'ATTACK_PLAYER')).toBe(true)
  })
})

describe('Stealth', () => {
  it('adds a phantom card that satisfies an ally and nothing else', () => {
    const s = scenario({
      me: { hand: [], inPlay: [inPlay('stealth'), inPlay('blob-fighter')], trade: 2, deck: ['scout'] },
    })
    expect(legalFor(s, 'p1').some((a) => a.t === 'ACTIVATE' && a.slot === 'ally')).toBe(false)

    let st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'stealth'), slot: 'primary' }).state
    expect(pending(st)?.prompt).toBe('CHOOSE_FACTION')
    st = run(st, choose(st, (o: { o: string; label?: string }) => o.label === 'blob')).state

    expect(st.players.p1.phantomFactions).toEqual(['blob'])
    expect(legalFor(st, 'p1').some((a) => a.t === 'ACTIVATE' && a.slot === 'ally')).toBe(true)
    // A phantom is not a card in play: nothing new to attack, nothing new to count.
    expect(st.players.p1.inPlay).toHaveLength(2)

    st = run(st, { t: 'END_TURN' }).state
    expect(st.players.p1.phantomFactions).toEqual([])
  })
})

describe('Stellar Link', () => {
  it('shows two cards, discards the chosen one and leaves the other on top', () => {
    const s = scenario({
      me: {
        hand: [], inPlay: [inPlay('stellar-link')], trade: 2,
        deck: ['scout', 'viper', 'ram'],
      },
    })
    let st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'stellar-link'), slot: 'primary' }).state
    const c = pending(st)!
    expect(c.prompt).toBe('SCRY')
    expect(c.n).toBe(2)             // only the top two, never the third

    st = run(st, choose(st, byDef('scout'))).state
    expect(st.players.p1.discard.map((x) => x.def)).toEqual([D('scout')])
    // The unchosen card is on top, and the rest of the deck is untouched.
    expect(st.players.p1.deck.map((x) => x.def)).toEqual([D('viper'), D('ram')])
  })
})

describe('Lunar Landing', () => {
  it('pays out once per Trade Federation card in play, counting itself', () => {
    const s = scenario({
      me: {
        hand: [],
        inPlay: [inPlay('lunar-landing'), inPlay('cutter'), inPlay('blob-fighter')],
        deck: ['scout', 'scout', 'scout'],
      },
    })
    const st = run(s, {
      t: 'ACTIVATE', card: playIid(s, 'p1', 'lunar-landing'), slot: 'primary',
    }).state
    // Lunar Landing itself plus the Cutter; the Blob Fighter does not count.
    expect(st.players.p1.authority).toBe(52)
    expect(st.players.p1.hand).toHaveLength(2)
  })
})

describe('High Alert Heroes', () => {
  it('grants an ally of both factions of its pair', () => {
    const s = scenario({
      me: { hand: [], inPlay: [inPlay('cutter'), inPlay('imperial-fighter')], trade: 1 },
      tradeRow: ['doctor-clark', 'ram', 'scout', 'viper', 'explorer'],
    })
    const st = run(s, { t: 'BUY_CARD', card: rowIid(s, 'doctor-clark') }).state
    expect(st.players.p1.allyUnlocked).toContain('trade_federation')
    expect(st.players.p1.allyUnlocked).toContain('star_empire')
  })
})

describe('Blob Builder', () => {
  it('acquires a BASE for free, and ships are not offered', () => {
    const s = scenario({
      me: { hand: ['blob-builder', 'blob-fighter'] },
      tradeRow: ['barter-world', 'ram', 'scout', 'viper', 'explorer'],
    })
    let st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-builder') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-fighter') },
    ).state
    // Blob Builder's primary offers the optional trade-row scrap first.
    if (pending(st)?.prompt === 'SCRAP_TRADE_ROW') st = run(st, decline(st)).state
    expect(st.players.p1.trade).toBe(5)

    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'blob-builder'), slot: 'ally' }).state
    // The row holds one base and three ships plus an Explorer: only the base.
    expect(pending(st)).toBeNull()
    expect(st.players.p1.deck[0]?.def).toBe(D('barter-world'))
  })
})
