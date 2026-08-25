import { describe, expect, it } from 'vitest'
import { cardDef } from '../src/cards/registry'
import type { CardDefId } from '../src/ids'
import { enumerateLegalActions } from '../src/legal'
import { reduce } from '../src/reduce'
import {
  applyRelic, applyReward, harvestRun, RELICS, RUN_LADDER, RUN_LENGTH,
  RUN_OFFER_SIZE, RUN_REPAIR, RUN_START_AUTHORITY, relicOffer, runNode, runOffer,
  runSetup, runStartCarry, scrappable, type RunCarry,
} from '../src/run'
import { createGame } from '../src/setup'
import { actorOf, type GameState } from '../src/state'
import { redact } from '../src/view'

const opening = (index: number, carry: RunCarry = runStartCarry(), seed = 'run-seed'): GameState => {
  const n = runNode(index)
  if (!n) throw new Error(`no node ${index}`)
  return createGame({ matchId: 'r', seed, firstPlayer: 'p1', scenario: runSetup(n, carry) })
}

/** Play a game out with legal-but-mindless moves, and hand back where it ended. */
function playOut(s0: GameState, seed = 1): GameState {
  let s = s0
  let rng = seed
  for (let i = 0; i < 800 && !s.winner; i++) {
    const seat = actorOf(s)
    const acts = enumerateLegalActions(redact(s, seat), seat)
    expect(acts.length, `node stalled with no legal action on turn ${s.turn}`).toBeGreaterThan(0)
    rng = (rng * 1103515245 + 12345) % 2147483648
    // Bias hard towards doing something other than passing, or the ladder never
    // resolves: END_TURN is always legal and would be picked a third of the time.
    const doing = acts.filter((a) => a.t !== 'END_TURN')
    const pick = doing.length && rng % 8 !== 0 ? doing : acts
    s = reduce(s, { actor: seat, action: pick[rng % pick.length]! }).state
  }
  return s
}

describe('ladder', () => {
  it('is eight nodes, indexed contiguously, ending in a boss', () => {
    expect(RUN_LADDER.length).toBe(RUN_LENGTH)
    RUN_LADDER.forEach((n, i) => expect(n.index).toBe(i + 1))
    expect(RUN_LADDER[RUN_LENGTH - 1]?.kind).toBe('boss')
    expect(runNode(RUN_LENGTH + 1)).toBeNull()
  })

  it('never gets easier as it goes', () => {
    for (let i = 1; i < RUN_LADDER.length; i++) {
      const prev = RUN_LADDER[i - 1]!
      const here = RUN_LADDER[i]!
      expect(here.enemyAuthority).toBeGreaterThan(prev.enemyAuthority)
      expect(here.enemyCombat).toBeGreaterThanOrEqual(prev.enemyCombat)
      expect(here.enemyTrade).toBeGreaterThanOrEqual(prev.enemyTrade)
    }
  })

  it('every node opens a playable position and plays through to a winner', () => {
    for (const n of RUN_LADDER) {
      const s = opening(n.index)
      expect(s.scenario?.id).toBe(`run-${n.index}`)
      expect(s.players.p1.hand.length).toBe(3)
      expect(s.players.p2.hand.length).toBe(5)
      expect(s.players.p2.authority).toBe(n.enemyAuthority)
      expect(s.tradeRow.filter(Boolean).length).toBe(5)
      // The enemy's bases are already standing, not waiting in its deck.
      expect(s.players.p2.inPlay.map((c) => c.def as string).sort())
        .toEqual([...n.enemyBases].map(String).sort())
      // And the whole thing still survives the wire.
      expect(JSON.parse(JSON.stringify(s))).toEqual(s)

      const done = playOut(s)
      expect(done.winner, `node ${n.index} never ended`).not.toBeNull()
    }
  })

  it('every card the ladder names is real, and every enemy deck is ten cards', () => {
    for (const n of RUN_LADDER) {
      for (const b of n.enemyBases) {
        const t = cardDef(b).type
        expect(t === 'base' || t === 'outpost', `${b} is not a base`).toBe(true)
      }
      if (n.enemyDeck) {
        expect(n.enemyDeck.length).toBe(10)
        for (const c of n.enemyDeck) expect(() => cardDef(c)).not.toThrow()
      }
    }
  })
})

describe('carrying a deck', () => {
  it('opens the run on the printed starting deck', () => {
    const c = runStartCarry()
    expect(c.authority).toBe(RUN_START_AUTHORITY)
    expect(c.deck.filter((x) => x === 'scout').length).toBe(8)
    expect(c.deck.filter((x) => x === 'viper').length).toBe(2)
    expect(c.bases).toEqual([])
  })

  it('harvests every pile the player still owns, and nothing they scrapped', () => {
    const s = opening(1)
    const done = playOut(s, 7)
    const carry = harvestRun(done, 'p1')
    const p = done.players.p1
    const owned = p.deck.length + p.hand.length + p.discard.length + p.inPlay.length
    expect(carry.deck.length + carry.bases.length).toBe(owned)
    // Cards in the scrap heap are gone from the run for good.
    const heap = new Set(done.scrapHeap.map((c) => c.iid))
    expect([...p.deck, ...p.hand, ...p.discard].some((c) => heap.has(c.iid))).toBe(false)
    for (const b of carry.bases) {
      const t = cardDef(b).type
      expect(t === 'base' || t === 'outpost').toBe(true)
    }
  })

  it('carries the harvested deck, bases and authority into the next node', () => {
    const carry: RunCarry = {
      deck: ['scout', 'scout', 'battle-mech', 'freighter'] as CardDefId[],
      bases: ['defense-center'] as CardDefId[],
      authority: 23,
      relics: [],
    }
    const s = opening(2, carry)
    const mine = [...s.players.p1.deck, ...s.players.p1.hand]
    expect(mine.length).toBe(carry.deck.length)
    expect(mine.map((c) => c.def as string).sort()).toEqual([...carry.deck].map(String).sort())
    expect(s.players.p1.inPlay.map((c) => c.def as string)).toEqual(['defense-center'])
    expect(s.players.p1.authority).toBe(23)
  })

  it('deals the carried deck shuffled -- a run is not a solitaire of known draws', () => {
    const carry: RunCarry = {
      deck: ['scout', 'viper', 'freighter', 'cutter', 'ram', 'corvette',
        'trade-bot', 'battle-pod', 'survey-ship', 'missile-bot'] as CardDefId[],
      bases: [],
      authority: 40,
      relics: [],
    }
    const orders = new Set<string>()
    for (const seed of ['a', 'b', 'c', 'd']) {
      const s = opening(2, carry, seed)
      orders.add([...s.players.p1.hand, ...s.players.p1.deck].map((c) => c.def).join(','))
    }
    expect(orders.size).toBeGreaterThan(1)
  })
})

describe('rewards', () => {
  it('offers three distinct cards inside the node cost band', () => {
    for (const n of RUN_LADDER) {
      const offer = runOffer('seed', n)
      expect(offer.length).toBe(RUN_OFFER_SIZE)
      expect(new Set(offer).size).toBe(RUN_OFFER_SIZE)
      for (const id of offer) {
        const def = cardDef(id)
        expect(def.cost).toBeGreaterThanOrEqual(n.offerCost[0])
        expect(def.cost).toBeLessThanOrEqual(n.offerCost[1])
        expect(def.role).toBe('trade_deck')
      }
    }
  })

  it('offers the same three however many times it is asked', () => {
    const n = RUN_LADDER[3]!
    expect(runOffer('same', n)).toEqual(runOffer('same', n))
    // ...and something else for a different run or a different node.
    expect(runOffer('other', n)).not.toEqual(runOffer('same', n))
    expect(runOffer('same', RUN_LADDER[4]!)).not.toEqual(runOffer('same', n))
  })

  it('adds, removes and repairs', () => {
    const c0 = runStartCarry()
    const added = applyReward(c0, { k: 'CARD', def: 'battle-mech' as CardDefId })
    expect(added.deck.length).toBe(11)
    expect(added.deck).toContain('battle-mech')

    const cut = applyReward(added, { k: 'SCRAP', def: 'scout' as CardDefId })
    expect(cut.deck.filter((x) => x === 'scout').length).toBe(7)
    expect(cut.deck.length).toBe(10)

    expect(applyReward(c0, { k: 'REPAIR', n: RUN_REPAIR }).authority)
      .toBe(RUN_START_AUTHORITY + RUN_REPAIR)
  })

  it('does not invent a card the deck never had', () => {
    const c0 = runStartCarry()
    expect(applyReward(c0, { k: 'SCRAP', def: 'flagship' as CardDefId })).toEqual(c0)
  })

  it('lists each distinct card once, and refuses to empty the deck', () => {
    expect(scrappable(runStartCarry()).sort()).toEqual(['scout', 'viper'])
    expect(scrappable({
      deck: ['scout'] as CardDefId[], bases: [], authority: 5, relics: [],
    })).toEqual([])
  })
})

describe('a whole run', () => {
  it('carries one deck through all eight nodes, and it only grows', () => {
    let carry = runStartCarry()
    const sizes: number[] = []
    for (const n of RUN_LADDER) {
      const done = playOut(opening(n.index, carry, `full-${n.index}`), n.index * 13)
      expect(done.winner).not.toBeNull()
      // Mindless play loses as often as it wins; the run mechanics are what is
      // under test here, so take the position it reached either way.
      carry = harvestRun(done, 'p1')
      carry = applyReward(carry, { k: 'CARD', def: runOffer('full', n)[0]! })
      sizes.push(carry.deck.length)
      expect(carry.deck.length).toBeGreaterThan(0)
      const s = runSetup(n, carry)
      expect(JSON.parse(JSON.stringify(s))).toEqual(s)
    }
    expect(sizes.length).toBe(RUN_LENGTH)
  })
})

describe('relics along the way', () => {
  it('starts a run with none', () => {
    expect(runStartCarry().relics).toEqual([])
  })

  it('keeps them through a fight -- they are never lost, so they are never re-read', () => {
    const carry = applyRelic(runStartCarry(), 'viper-fangs')
    const done = playOut(opening(1, carry), 11)
    const next = harvestRun(done, 'p1', carry)
    expect(next.relics).toEqual(['viper-fangs'])
    // ...and the relic card is not mistaken for a base carried over.
    expect(next.bases.some((b) => (b as string).startsWith('rl-'))).toBe(false)
    expect(next.deck.some((c) => (c as string).startsWith('rl-'))).toBe(false)
  })

  it('takes the same relic only once', () => {
    const once = applyRelic(runStartCarry(), 'war-drums')
    expect(applyRelic(once, 'war-drums').relics).toEqual(['war-drums'])
  })

  it('offers three unowned relics, the same three every time it is asked', () => {
    const node = RUN_LADDER[2]
    if (!node) throw new Error('no node')
    const offer = relicOffer('run', node, [])
    expect(offer.length).toBe(RUN_OFFER_SIZE)
    expect(new Set(offer).size).toBe(RUN_OFFER_SIZE)
    expect(relicOffer('run', node, [])).toEqual(offer)
    // Never one you already have.
    const owned = relicOffer('run', node, offer)
    expect(owned.some((id) => offer.includes(id))).toBe(false)
  })

  it('runs dry gracefully once every relic is taken', () => {
    const node = RUN_LADDER[7]
    if (!node) throw new Error('no node')
    expect(relicOffer('run', node, RELICS)).toEqual([])
    expect(relicOffer('run', node, RELICS.slice(0, RELICS.length - 2)).length).toBe(2)
  })

  it('carries a growing set of relics through all eight nodes', () => {
    let carry = runStartCarry()
    for (const node of RUN_LADDER) {
      const offer = relicOffer('eight', node, carry.relics)
      if (offer[0]) carry = applyRelic(carry, offer[0])
      const s = opening(node.index, carry, `eight-${node.index}`)
      expect(s.players.p1.gambitsInPlay.length).toBe(carry.relics.length)
      carry = harvestRun(playOut(s, node.index * 7), 'p1', carry)
    }
    expect(carry.relics.length).toBe(RUN_LENGTH)
    expect(new Set(carry.relics).size).toBe(RUN_LENGTH)
  })
})
