import { describe, expect, it } from 'vitest'
import { createGame } from '../src/setup'
import { VARIANTS, VARIANT_CARD, type VariantId } from '../src/variants'
import { enumerateLegalActions } from '../src/legal'
import { actorOf } from '../src/state'
import { redact } from '../src/view'
import { reduce } from '../src/reduce'
import { CARDS, cardDef, EXPLORER, SCOUT, VIPER } from '../src/cards/registry'
import { costFor } from '../src/helpers'
import { asDefId } from '../src/ids'
import { byDef, choose, legalFor, playIid, rowIid, run, scenario } from './scenario'

const D = asDefId

const game = (variant: VariantId) => createGame({
  matchId: 'v', seed: 'v-seed', firstPlayer: 'p1', variant,
})

describe('Arena scenarios', () => {
  it('carries all twenty', () => {
    expect(VARIANTS).toHaveLength(20)
    // No duplicates, which a hand-maintained list of twenty invites.
    expect(new Set(VARIANTS).size).toBe(20)
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

  it('Maximum Warp counts the first turn of the game as a turn', () => {
    // The opening three plus the card the scenario draws. The engine measures
    // the start of a turn from the end of the previous one, and the first
    // player has no previous turn -- so this is the one that is easy to lose.
    expect(game('maximum-warp').players.p1.hand).toHaveLength(4)
  })

  it('Emergency Repairs buys back the discard pile, once a turn', () => {
    const board = scenario({ me: { hand: [], discard: ['ram', 'cutter'], deck: ['scout'], trade: 3 } })
    board.variant = { id: 'emergency-repairs' }
    board.players.p1.gambitsInPlay = game('emergency-repairs').players.p1.gambitsInPlay
    const card = board.players.p1.gambitsInPlay[0]!.iid
    const st = run(board, { t: 'ACTIVATE', card, slot: 'primary' }).state
    expect(st.players.p1.trade).toBe(2)
    expect(st.players.p1.discard).toHaveLength(0)
    expect(st.players.p1.deck).toHaveLength(3)
    expect(legalFor(st, 'p1').some((a) => a.t === 'ACTIVATE' && a.card === card)).toBe(false)
  })

  it('Ruthless Efficiency scraps a card out of hand for a trade', () => {
    const board = scenario({ me: { hand: ['scout', 'viper'], trade: 3 } })
    board.variant = { id: 'ruthless-efficiency' }
    board.players.p1.gambitsInPlay = game('ruthless-efficiency').players.p1.gambitsInPlay
    const card = board.players.p1.gambitsInPlay[0]!.iid
    let st = run(board, { t: 'ACTIVATE', card, slot: 'primary' }).state
    expect(st.players.p1.trade).toBe(2)
    st = run(st, choose(st, byDef('scout'))).state
    expect(st.players.p1.hand.map((c) => c.def)).toEqual([D('viper')])
    expect(st.scrapHeap.some((c) => c.def === D('scout'))).toBe(true)
  })

  it('Flare Mining draws then discards for a trade', () => {
    const board = scenario({ me: { hand: ['scout'], deck: ['ram', 'cutter'], trade: 3 } })
    board.variant = { id: 'flare-mining' }
    board.players.p1.gambitsInPlay = game('flare-mining').players.p1.gambitsInPlay
    const card = board.players.p1.gambitsInPlay[0]!.iid
    let st = run(board, { t: 'ACTIVATE', card, slot: 'primary' }).state
    expect(st.players.p1.trade).toBe(2)
    // Drawn first, so the drawn card is one of the two that may be discarded.
    expect(st.players.p1.hand.map((c) => c.def)).toEqual([D('scout'), D('ram')])
    st = run(st, choose(st, byDef('scout'))).state
    expect(st.players.p1.hand.map((c) => c.def)).toEqual([D('ram')])
    expect(st.players.p1.discard.map((c) => c.def)).toEqual([D('scout')])
  })

  it('hands the scenario card to both players, whichever scenario it is', () => {
    for (const [v, def] of Object.entries(VARIANT_CARD)) {
      const s = game(v as VariantId)
      for (const pid of ['p1', 'p2'] as const) {
        expect(s.players[pid].gambitsInPlay.map((c) => c.def), v).toEqual([def])
      }
    }
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

  it('Border Skirmish and Prolonged Conflict move the starting authority', () => {
    expect(game('border-skirmish').players.p1.authority).toBe(30)
    expect(game('prolonged-conflict').players.p1.authority).toBe(80)
  })

  it('Warpgate Nexus plays with two more cards in the row', () => {
    const s = game('warpgate-nexus')
    expect(s.tradeRow).toHaveLength(7)
    expect(s.tradeRow.filter(Boolean)).toHaveLength(7)
  })

  it('Early Recruitment deals one card of each faction, two per player', () => {
    const s = game('early-recruitment')
    const own = (pid: 'p1' | 'p2') =>
      [...s.players[pid].deck, ...s.players[pid].hand]
        .map((c) => cardDef(c.def))
        .filter((d) => d.role === 'trade_deck')
    expect(own('p1')).toHaveLength(2)
    expect(own('p2')).toHaveLength(2)
    // Cost 1 for Early Recruitment, and all four factions between them.
    const all = [...own('p1'), ...own('p2')]
    expect(all.every((d) => d.cost === 1)).toBe(true)
    expect(new Set(all.map((d) => d.faction)).size).toBe(4)
    // Picking Sides is the same deal at cost two.
    const two = game('picking-sides')
    const theirs = [...two.players.p1.deck, ...two.players.p1.hand]
      .map((c) => cardDef(c.def)).filter((d) => d.role === 'trade_deck')
    expect(theirs.every((d) => d.cost === 2)).toBe(true)
  })

  it('Fleeting Opportunities eats the far card at every turn start', () => {
    const board = scenario({
      me: { hand: [] },
      // Deliberately not an Explorer in the far slot: an Explorer that would be
      // scrapped goes back to the Explorer pile instead, which would make this
      // test pass or fail for the wrong reason.
      tradeRow: ['cutter', 'scout', 'viper', 'explorer', 'ram'],
    })
    board.variant = { id: 'fleeting-opportunities' }
    const far = board.tradeRow[4]!
    const st = run(board, { t: 'END_TURN' }).state
    expect(st.scrapHeap.some((c) => c.iid === far.iid)).toBe(true)
    // The row slides down and refills, so it is never short.
    expect(st.tradeRow.filter(Boolean)).toHaveLength(5)
  })

  it('Fleeting Opportunities slides the row instead of eating one slot', () => {
    const board = scenario({
      me: { hand: [] },
      tradeRow: ['cutter', 'ram', 'imperial-fighter', 'battle-pod', 'trade-bot'],
    })
    board.variant = { id: 'fleeting-opportunities' }
    // По iid, а не по названию: в колоде лежат другие копии тех же карт, и
    // сравнение по имени прошло бы на пришедшем из колоды двойнике.
    const opening = board.tradeRow.map((c) => c!.iid)
    let st = board
    for (let i = 0; i < 5; i++) st = run(st, { t: 'END_TURN' }).state
    // Five turn boundaries, five cards gone: every card the row opened with has
    // walked to the far end and left. Without the slide the refill would land
    // back in the slot just vacated and the other four would stand there for
    // the rest of the game.
    for (const iid of opening) {
      expect(st.tradeRow.some((c) => c?.iid === iid), iid).toBe(false)
      expect(st.scrapHeap.some((c) => c.iid === iid), iid).toBe(true)
    }
    expect(st.tradeRow.filter(Boolean)).toHaveLength(5)
  })

  it('Fleeting Opportunities counts the first turn of the game as a turn', () => {
    const s = game('fleeting-opportunities')
    expect(s.tradeRow.filter(Boolean)).toHaveLength(5)
    // One card was already eaten before anyone played: the far slot of the deal.
    expect(s.scrapHeap.filter((c) => cardDef(c.def).type !== 'event')).toHaveLength(1)
  })

  it('Ready Reserves keeps the hand and charges a draw for each card kept', () => {
    const board = scenario({
      me: {
        hand: ['scout', 'viper'],
        deck: ['ram', 'ram', 'ram', 'ram', 'ram', 'ram'],
      },
    })
    board.variant = { id: 'ready-reserves' }
    const st = run(board, { t: 'END_TURN' }).state
    // Nothing discarded, and the hand ends at five: the two kept plus three drawn.
    expect(st.players.p1.discard).toHaveLength(0)
    expect(st.players.p1.hand).toHaveLength(5)
    expect(st.players.p1.hand.filter((c) => c.def === D('ram'))).toHaveLength(3)
  })

  it('plays every one of the twenty through to a finished game', () => {
    // Не про конкретное правило, а про то, что ни одно из двадцати не заводит
    // партию в тупик: у сценария нет своего экрана, и сломанный ход
    // обнаруживался бы уже в живой игре — зависшим столом без единого хода.
    for (const v of VARIANTS) {
      let st = createGame({ matchId: 'sweep', seed: `sweep-${v}`, firstPlayer: 'p1', variant: v })
      let rng = 1
      for (let i = 0; i < 600 && !st.winner; i++) {
        const seat = actorOf(st)
        const acts = enumerateLegalActions(redact(st, seat), seat)
        expect(acts.length, `${v}: no legal action on turn ${st.turn}`).toBeGreaterThan(0)
        rng = (rng * 1103515245 + 12345) % 2147483648
        const busy = acts.filter((a) => a.t !== 'END_TURN' && a.t !== 'CONCEDE')
        const pick = busy.length > 0 && rng % 4 !== 0
          ? busy[rng % busy.length]!
          : (acts.find((a) => a.t === 'END_TURN') ?? busy[0]!)
        st = reduce(st, { actor: seat, action: pick }).state
      }
      expect(st.turn, `${v}: never got anywhere`).toBeGreaterThan(5)
    }
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
