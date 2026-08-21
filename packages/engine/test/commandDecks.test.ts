import { describe, expect, it } from 'vitest'
import { CARDS, cardDef } from '../src/cards/registry'
import { COMMAND_DECKS } from '../src/cards/commandDecks'
import { createGame } from '../src/setup'
import { asDefId } from '../src/ids'
import { inPlay, legalFor, playIid, run, scenario } from './scenario'

const D = asDefId

const game = (p1: string, p2?: string) => createGame({
  matchId: 'cd', seed: 'cd-seed', firstPlayer: 'p1',
  sets: ['core', 'command-decks'],
  commandDeck: p2 ? { p1, p2 } : { p1 },
})

describe('command deck data integrity', () => {
  it('is seven decks, each with a commander, a megaship and two gambits', () => {
    expect(COMMAND_DECKS).toHaveLength(7)
    for (const c of COMMAND_DECKS) {
      expect(cardDef(D(c.commander)).commander, c.name).toBeDefined()
      expect(cardDef(D(c.megaship)).role, c.name).toBe('trade_deck')
      expect(cardDef(D(c.megaship)).cost, c.name).toBe(8)
      expect(c.gambits, c.name).toHaveLength(2)
      for (const g of c.gambits) expect(cardDef(D(g)).role, g).toBe('gambit')
    }
  })

  it('gives every deck a twelve-card personal deck, or fourteen for the Lost Fleet', () => {
    for (const c of COMMAND_DECKS) {
      expect(c.deck.length, c.name).toBe(c.id === 'lost-fleet' ? 14 : 12)
      for (const id of c.deck) expect(cardDef(D(id)).role, id).toBe('command')
    }
  })

  it('keeps personal cards and commanders out of the trade deck', () => {
    const s = game('alliance', 'unity')
    const banned = new Set(['command', 'commander', 'gambit', 'token'])
    for (const c of [...s.tradeDeck, ...s.tradeRow.filter(Boolean)]) {
      const def = cardDef(c!.def)
      expect(banned.has(def.role), def.name).toBe(false)
    }
  })
})

describe('dealing a command deck', () => {
  it('replaces the starting deck, the authority and the hand size', () => {
    const s = game('lost-fleet')
    expect(s.players.p1.commander).toBe(D('high-admiral-jochum'))
    expect(s.players.p1.authority).toBe(72)
    expect(s.players.p1.handSize).toBe(7)
    // Fourteen cards, none of them a Scout or a Viper.
    const own = [...s.players.p1.deck, ...s.players.p1.hand]
    expect(own).toHaveLength(14)
    expect(own.some((c) => c.def === D('scout') || c.def === D('viper'))).toBe(false)
    // The first player still opens two cards short of their own hand size.
    expect(s.players.p1.hand).toHaveLength(5)

    // The other seat is untouched.
    expect(s.players.p2.authority).toBe(50)
    expect(s.players.p2.handSize).toBe(5)
  })

  it('deals its two gambits and shuffles its megaship into the trade deck', () => {
    const s = game('pact', 'union')
    expect(s.players.p1.gambits.map((c) => c.def).sort())
      .toEqual([D('newburg-s-game'), D('pact-dominion')].sort())
    const all = [...s.tradeDeck, ...s.tradeRow.filter(Boolean)].map((c) => c!.def)
    expect(all).toContain(D('super-carrier'))
    expect(all).toContain(D('meganaut'))
  })
})

describe('Unity Warcraft', () => {
  it('shifts what a base costs to break, in both directions', () => {
    const s = scenario({
      me: { hand: [], combat: 4 },
      them: { inPlay: [inPlay('barter-world')] },      // printed defence 4
    })
    // Bare: four combat is exactly enough.
    expect(legalFor(s, 'p1').some((a) => a.t === 'ATTACK_BASE')).toBe(true)

    const shielded = scenario({
      me: { hand: [], combat: 4 },
      them: { inPlay: [inPlay('barter-world')] },
    })
    shielded.players.p2.gambitsInPlay = [inPlay('unity-warcraft')]
    // Their gambit: +1 to their own bases, so four is no longer enough.
    expect(legalFor(shielded, 'p1').some((a) => a.t === 'ATTACK_BASE')).toBe(false)

    const weakened = scenario({
      me: { hand: [], combat: 3 },
      them: { inPlay: [inPlay('barter-world')] },
    })
    weakened.players.p1.gambitsInPlay = [inPlay('unity-warcraft')]
    // My gambit: -1 to theirs, so three is enough.
    expect(legalFor(weakened, 'p1').some((a) => a.t === 'ATTACK_BASE')).toBe(true)
  })
})

describe('Pact Dominion', () => {
  it('fires on the first authority gain of the turn and not the second', () => {
    const s = scenario({ me: { hand: ['cutter', 'federation-shuttle'] } })
    s.players.p1.gambitsInPlay = [inPlay('pact-dominion')]
    // Cutter gains 4 authority and 2 trade.
    let st = run(s, { t: 'PLAY_CARD', card: s.players.p1.hand[0]!.iid }).state
    expect(st.players.p1.authority).toBe(54)
    expect(st.players.p1.combat).toBe(3)

    // The Shuttle's ally gains more authority; the gambit does not fire again.
    st = run(st, { t: 'PLAY_CARD', card: st.players.p1.hand[0]!.iid }).state
    st = run(st, {
      t: 'ACTIVATE', card: playIid(st, 'p1', 'federation-shuttle'), slot: 'ally',
    }).state
    expect(st.players.p1.authority).toBe(58)
    expect(st.players.p1.combat).toBe(3)
  })
})

describe('Splinter', () => {
  it('needs three matching Shards played this turn, and spends them', () => {
    const s = scenario({
      me: { hand: ['assault-shard', 'assault-shard', 'assault-shard'], deck: ['recon-shard'] },
    })
    let st = run(s, { t: 'PLAY_CARD', card: s.players.p1.hand[0]!.iid }).state
    expect(legalFor(st, 'p1').some((a) => a.t === 'ACTIVATE' && a.slot === 'splinter')).toBe(false)
    st = run(st, { t: 'PLAY_CARD', card: st.players.p1.hand[0]!.iid }).state
    expect(legalFor(st, 'p1').some((a) => a.t === 'ACTIVATE' && a.slot === 'splinter')).toBe(false)
    st = run(st, { t: 'PLAY_CARD', card: st.players.p1.hand[0]!.iid }).state

    const act = legalFor(st, 'p1').find((a) => a.t === 'ACTIVATE' && a.slot === 'splinter')
    expect(act).toBeDefined()
    // Three primaries already resolved.
    expect(st.players.p1.combat).toBe(3)

    st = run(st, act!).state
    // Plus the Splinter payout, and the three Shards are gone from play.
    expect(st.players.p1.combat).toBe(7)
    expect(st.players.p1.inPlay).toHaveLength(0)
    expect(st.players.p1.discard).toHaveLength(3)
  })

  it('lets a Command Shard stand in for a missing third', () => {
    const s = scenario({
      me: { hand: ['recon-shard', 'recon-shard', 'command-shard'], deck: [] },
    })
    let st = s
    for (let i = 0; i < 3; i++) {
      st = run(st, { t: 'PLAY_CARD', card: st.players.p1.hand[0]!.iid }).state
    }
    const act = legalFor(st, 'p1').find((a) => a.t === 'ACTIVATE' && a.slot === 'splinter')
    expect(act).toBeDefined()
    st = run(st, act!).state
    expect(st.players.p1.authority).toBe(55)
    expect(st.players.p1.inPlay).toHaveLength(0)
  })
})

describe('Federation Scout', () => {
  it('discounts the next card of its faction and nothing else', () => {
    const s = scenario({
      // Federation Scout is UNALIGNED with a pinned Trade Federation ally, so
      // it needs two real Trade Federation cards beside it, not one.
      me: { hand: ['federation-scout', 'cutter', 'federation-shuttle'], trade: 0 },
      tradeRow: ['ram', 'trade-escort', 'scout', 'viper', 'explorer'],
    })
    let st = run(s,
      { t: 'PLAY_CARD', card: s.players.p1.hand[0]!.iid },
      { t: 'PLAY_CARD', card: s.players.p1.hand[1]!.iid },
      { t: 'PLAY_CARD', card: s.players.p1.hand[2]!.iid },
    ).state
    st = run(st, {
      t: 'ACTIVATE', card: playIid(st, 'p1', 'federation-scout'), slot: 'ally',
    }).state
    expect(st.players.p1.pendingDiscounts).toEqual([{ faction: 'trade_federation', n: 1 }])

    // Trade Escort costs 5; with the discount, 4.
    const before = st.players.p1.trade
    st = run(st, {
      t: 'BUY_CARD',
      card: st.tradeRow.find((c) => c && c.def === D('trade-escort'))!.iid,
    }).state
    expect(before - st.players.p1.trade).toBe(4)
    expect(st.players.p1.pendingDiscounts).toHaveLength(0)
  })
})

describe('registry', () => {
  it('collides with no other set', () => {
    const cards = [...CARDS.values()].filter((c) => c.set === 'command-decks')
    const others = new Set(
      [...CARDS.values()].filter((c) => c.set !== 'command-decks').map((c) => c.id),
    )
    for (const c of cards) expect(others.has(c.id), c.name).toBe(false)
  })

  it('adds nothing to an ordinary trade deck', () => {
    const s = createGame({ matchId: 'x', seed: 'y', firstPlayer: 'p1', sets: ['core', 'command-decks'] })
    // The megaships only enter when a command deck is actually chosen.
    for (const c of s.tradeDeck) expect(cardDef(c.def).set).toBe('core')
  })
})
