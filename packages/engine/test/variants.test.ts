import { describe, expect, it } from 'vitest'
import { createGame } from '../src/setup'
import { SECONDHAND, VARIANTS, type VariantId } from '../src/variants'
import { CARDS, cardDef, EXPLORER, SCOUT, VIPER } from '../src/cards/registry'
import { costFor } from '../src/helpers'
import { asDefId } from '../src/ids'
import { legalFor, playIid, rowIid, run, scenario } from './scenario'

const D = asDefId

const game = (variant: VariantId) => createGame({
  matchId: 'v', seed: 'v-seed', firstPlayer: 'p1', variant,
})

describe('Arena scenarios', () => {
  it('carries thirteen of the twenty, and no invented ones', () => {
    // The other six have no rule text at any source we can reach -- the
    // publisher's whole archive, its pages, the community wiki and BGG were
    // searched -- so they are deliberately absent rather than guessed at.
    expect(VARIANTS).toHaveLength(13)
    // Three of the thirteen come from a secondary write-up rather than from the
    // publisher's own article, and say so.
    expect(SECONDHAND.every((v) => VARIANTS.includes(v))).toBe(true)
    expect(SECONDHAND).toHaveLength(3)
  })

  it('is absent by default, so an ordinary game is unchanged', () => {
    const s = createGame({ matchId: 'x', seed: 'y', firstPlayer: 'p1' })
    expect(s.variant).toBeNull()
    expect(s.players.p1.gambitsInPlay).toHaveLength(0)
  })
})

describe('scenarios that change the starting deck', () => {
  it('Frontier Expedition swaps two Scouts for two Explorers', () => {
    const s = game('frontier-expedition')
    const own = [...s.players.p1.deck, ...s.players.p1.hand].map((c) => c.def)
    expect(own.filter((d) => d === EXPLORER)).toHaveLength(2)
    expect(own.filter((d) => d === SCOUT)).toHaveLength(6)
    expect(own).toHaveLength(10)
  })

  it('Frantic Preparations removes one Scout and one Viper', () => {
    const s = game('frantic-preparations')
    const own = [...s.players.p1.deck, ...s.players.p1.hand].map((c) => c.def)
    expect(own).toHaveLength(8)
    expect(own.filter((d) => d === SCOUT)).toHaveLength(7)
    expect(own.filter((d) => d === VIPER)).toHaveLength(1)
  })
})

describe('scenarios with an ability', () => {
  it('gives both players the card, face up from the start', () => {
    const s = game('total-war')
    for (const pid of ['p1', 'p2'] as const) {
      expect(s.players[pid].gambitsInPlay.map((c) => c.def)).toEqual([D('sc-total-war')])
    }
  })

  it('Total War sells three combat for one trade, once a turn', () => {
    const s = game('total-war')
    let st = { ...s, players: { ...s.players, p1: { ...s.players.p1, trade: 2 } } }
    const card = st.players.p1.gambitsInPlay[0]!.iid
    st = run(st, { t: 'ACTIVATE', card, slot: 'primary' }).state
    expect(st.players.p1.trade).toBe(1)
    expect(st.players.p1.combat).toBe(3)
    // Once per turn.
    expect(legalFor(st, 'p1').some((a) => a.t === 'ACTIVATE' && a.card === card)).toBe(false)
  })

  it('Maximum Warp draws at the start of each turn without being asked', () => {
    const s = game('maximum-warp')
    const before = s.players.p2.hand.length
    const st = run(s, { t: 'END_TURN' }).state
    // p2's turn began: their hand is their five plus the scenario's card.
    expect(st.players.p2.hand.length).toBe(before + 1)
  })
})

describe('scenarios that are simply true', () => {
  it('Recruiting Drive tops the deck with ships and discounts bases', () => {
    const s = { ...game('recruiting-drive') }
    const base = cardDef(D('barter-world'))
    expect(costFor(base, [], { variant: s.variant, buyer: 'p1' })).toBe(base.cost - 1)

    const board = scenario({
      me: { hand: [], trade: 20 },
      tradeRow: ['ram', 'barter-world', 'scout', 'viper', 'explorer'],
    })
    board.variant = { id: 'recruiting-drive' }
    const st = run(board, { t: 'BUY_CARD', card: rowIid(board, 'ram') }).state
    expect(st.players.p1.deck[0]?.def).toBe(D('ram'))
    expect(st.players.p1.discard).toHaveLength(0)
  })

  it('Rushed Defenses puts bases into play and scraps them when destroyed', () => {
    const board = scenario({
      me: { hand: [], trade: 20 },
      tradeRow: ['barter-world', 'ram', 'scout', 'viper', 'explorer'],
    })
    board.variant = { id: 'rushed-defenses' }
    let st = run(board, { t: 'BUY_CARD', card: rowIid(board, 'barter-world') }).state
    expect(st.players.p1.inPlay.map((c) => c.def)).toEqual([D('barter-world')])

    st = run(st, { t: 'END_TURN' }).state
    // Combat is granted after the turn changes hands: the turn boundary wipes it.
    st = { ...st, players: { ...st.players, p2: { ...st.players.p2, combat: 10 } } }
    st = run(st, { t: 'ATTACK_BASE', base: playIid(st, 'p1', 'barter-world') }).state
    // Out of the game, not back into its owner's deck.
    expect(st.players.p1.discard.some((c) => c.def === D('barter-world'))).toBe(false)
    expect(st.scrapHeap.some((c) => c.def === D('barter-world'))).toBe(true)
  })

  it('Entrenched Loyalties assigns a faction per player and discounts it', () => {
    const s = game('entrenched-loyalties')
    expect(s.variant?.faction).toBeDefined()
    const mine = s.variant!.faction!.p1
    const card = [...CARDS.values()].find((c) => c.faction === mine && c.set === 'core')!
    expect(costFor(card, [], { variant: s.variant, buyer: 'p1' })).toBe(card.cost - 1)
    // And only for the player it was assigned to.
    if (s.variant!.faction!.p2 !== mine) {
      expect(costFor(card, [], { variant: s.variant, buyer: 'p2' })).toBe(card.cost)
    }
  })

  it('Commitment to the Cause pays the starters one more each', () => {
    const board = scenario({ me: { hand: ['scout', 'viper', 'explorer'] } })
    board.variant = { id: 'commitment-to-the-cause' }
    let st = board
    for (let i = 0; i < 3; i++) {
      st = run(st, { t: 'PLAY_CARD', card: st.players.p1.hand[0]!.iid }).state
    }
    // Scout 1+1, Explorer 2+1, Viper 1+1.
    expect(st.players.p1.trade).toBe(5)
    expect(st.players.p1.combat).toBe(2)
  })

  it("Buyer's Market marks the dearest card and discounts it", () => {
    const board = scenario({
      me: { hand: [], trade: 20 },
      // Command Ship costs 8, the dearest in the row by some way.
      tradeRow: ['command-ship', 'ram', 'scout', 'viper', 'explorer'],
    })
    board.variant = { id: 'buyers-market' }
    const dear = rowIid(board, 'command-ship')
    let st = run(board, { t: 'END_TURN' }).state
    expect(st.marketCounters[dear]).toBe(1)
    st = run(st, { t: 'END_TURN' }).state
    expect(st.marketCounters[dear]).toBe(2)

    // Trade is wiped at every turn boundary, so it is granted again here.
    st = { ...st, players: { ...st.players, p1: { ...st.players.p1, trade: 20 } } }
    const before = st.players.p1.trade
    st = run(st, { t: 'BUY_CARD', card: dear }).state
    // Printed 8, two counters, so 6.
    expect(before - st.players.p1.trade).toBe(6)
  })

  it('Rapid Construction tops the deck with the first acquisition only', () => {
    const board = scenario({
      me: { hand: [], trade: 20 },
      tradeRow: ['ram', 'cutter', 'scout', 'viper', 'explorer'],
    })
    board.variant = { id: 'rapid-construction' }
    let st = run(board, { t: 'BUY_CARD', card: rowIid(board, 'ram') }).state
    expect(st.players.p1.deck[0]?.def).toBe(D('ram'))
    expect(st.players.p1.discard).toHaveLength(0)

    // The second goes to the discard pile like any other purchase.
    st = run(st, { t: 'BUY_CARD', card: rowIid(st, 'cutter') }).state
    expect(st.players.p1.discard.map((c) => c.def)).toEqual([D('cutter')])
  })

  it('leaves a card in play alone when no scenario is in force', () => {
    const board = scenario({
      me: { hand: [], trade: 20 },
      tradeRow: ['barter-world', 'ram', 'scout', 'viper', 'explorer'],
    })
    const st = run(board, { t: 'BUY_CARD', card: rowIid(board, 'barter-world') }).state
    expect(st.players.p1.discard.map((c) => c.def)).toEqual([D('barter-world')])
    expect(st.players.p1.inPlay).toHaveLength(0)
  })
})
