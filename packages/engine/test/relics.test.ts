import { describe, expect, it } from 'vitest'
import { CARDS, cardDef, tradeDeckComposition } from '../src/cards/registry'
import { ALL_SETS } from '../src/cards/registry'
import type { CardDefId } from '../src/ids'
import { enumerateLegalActions } from '../src/legal'
import { reduce } from '../src/reduce'
import {
  RELIC, RELICS, RELIC_DEFS, RUN_LADDER, runNode, runSetup, runStartCarry,
  type RelicId, type RunCarry,
} from '../src/run'
import { createGame } from '../src/setup'
import { actorOf, type GameState } from '../src/state'
import { redact } from '../src/view'
import { handIid, run } from './scenario'

const carry = (relics: RelicId[], over: Partial<RunCarry> = {}): RunCarry => ({
  ...runStartCarry(), relics, ...over,
})

/** A fight on node 1 with these relics and this hand. */
function fight(relics: RelicId[], over: Partial<RunCarry> = {}, seed = 'relic'): GameState {
  const node = runNode(1)
  if (!node) throw new Error('no node 1')
  return createGame({
    matchId: 'r', seed, firstPlayer: 'p1', scenario: runSetup(node, carry(relics, over)),
  })
}

/** Put `defs` in p1's hand, discarding whatever was dealt. */
function withHand(s: GameState, defs: string[]): GameState {
  const next = structuredClone(s)
  next.players.p1.hand = defs.map((d, i) => ({
    iid: `h${i}` as never, def: d as CardDefId,
  }))
  return next
}

describe('relic data', () => {
  it('every relic is a real card, and every card is claimed by a relic', () => {
    for (const id of RELICS) {
      const def = cardDef(RELIC[id].card)
      expect(def.role).toBe('token')
      expect(def.copies).toBe(0)
      expect(def.faction).toBe('unaligned')
      expect(def.set).toBe('relics')
    }
    const cards = [...CARDS.values()].filter((c) => c.set === 'relics')
    expect(cards.length).toBe(RELICS.length)
    expect(RELIC_DEFS.size).toBe(RELICS.length)
  })

  it('never reaches the trade deck, whichever sets are on', () => {
    const deck = new Set<string>(tradeDeckComposition(undefined, ALL_SETS))
    for (const id of RELICS) expect(deck.has(RELIC[id].card)).toBe(false)
  })

  it('stands beside the board, not on it', () => {
    const s = fight(['viper-fangs', 'war-drums'])
    expect(s.players.p1.gambitsInPlay.map((c) => c.def as string).sort())
      .toEqual([RELIC['viper-fangs'].card, RELIC['war-drums'].card].sort())
    expect(s.players.p1.inPlay).toEqual([])
    // And the opponent gets none of them.
    expect(s.players.p2.gambitsInPlay).toEqual([])
    // Public, both ways: a rule that applies to the table is not a secret.
    expect(redact(s, 'p2').opponent.gambitsInPlay.length).toBe(2)
  })
})

describe('relics that watch what you play', () => {
  it('Viper Fangs adds two combat to a Viper, and nothing to a Scout', () => {
    const s = withHand(fight(['viper-fangs']), ['viper', 'scout'])
    const after = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'viper') })
    expect(after.state.players.p1.combat).toBe(3)
    const then = run(after.state, { t: 'PLAY_CARD', card: handIid(after.state, 'p1', 'scout') })
    expect(then.state.players.p1.combat).toBe(3)
    expect(then.state.players.p1.trade).toBe(1)
  })

  it("does nothing for the opponent's Vipers", () => {
    const s = withHand(fight(['viper-fangs']), ['scout'])
    const next = structuredClone(s)
    next.players.p2.hand = [{ iid: 'x1' as never, def: 'viper' as CardDefId }]
    const after = run(next, { t: 'END_TURN' })
    const played = run(after.state, { t: 'PLAY_CARD', card: 'x1' as never })
    expect(played.state.players.p2.combat).toBe(1)
  })

  it('Dock Crew pays for a base PLAYED, not for one that was already standing', () => {
    // Already standing: it arrived with the opening position, so nothing fires.
    const standing = fight(['dock-crew', 'outpost-cache'])
    expect(standing.players.p1.authority).toBe(runStartCarry().authority)
    expect(standing.players.p1.inPlay.map((c) => c.def as string)).toEqual(['defense-center'])

    const s = withHand(fight(['dock-crew']), ['space-station'])
    const before = s.players.p1.authority
    const after = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'space-station') })
    expect(after.state.players.p1.authority).toBe(before + 3)
  })

  it('Swarm Doctrine fires on a Blob ship and a Blob base, not on anyone else', () => {
    const s = withHand(fight(['swarm-doctrine']), ['blob-fighter', 'blob-wheel', 'corvette'])
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-fighter') }).state
    expect(st.players.p1.combat).toBe(4)
    st = run(st, { t: 'PLAY_CARD', card: handIid(st, 'p1', 'blob-wheel') }).state
    expect(st.players.p1.combat).toBe(5)
    st = run(st, { t: 'PLAY_CARD', card: handIid(st, 'p1', 'corvette') }).state
    expect(st.players.p1.combat).toBe(6)
  })
})

describe('relics that pay by themselves', () => {
  it('War Drums pays at the start of each of your turns, and never the enemy its own', () => {
    const s = fight(['war-drums'])
    // The opening turn is not a turn start -- the game deals into it.
    const t2 = run(s, { t: 'END_TURN' }, { t: 'END_TURN' }).state
    expect(t2.activePlayer).toBe('p1')
    expect(t2.players.p1.combat).toBe(1)
    expect(t2.players.p2.combat).toBe(0)
  })

  it('Trade Charter pays trade the same way', () => {
    const s = fight(['trade-charter'])
    const t2 = run(s, { t: 'END_TURN' }, { t: 'END_TURN' }).state
    expect(t2.players.p1.trade).toBe(1)
  })
})

describe('relics that change the maths', () => {
  it('Hull Plating puts your bases out of reach, for the table and the reducer alike', () => {
    const s = fight(['hull-plating', 'outpost-cache'])
    // Defense Center is a 5-defense outpost; with the relic it is 6.
    const done = run(s, { t: 'END_TURN' })
    const armed = structuredClone(done.state)
    armed.players.p2.combat = 5
    const target = armed.players.p1.inPlay[0]
    if (!target) throw new Error('no base')
    const legal = enumerateLegalActions(redact(armed, 'p2'), 'p2')
    expect(legal.some((a) => a.t === 'ATTACK_BASE' && a.card === target.iid)).toBe(false)
    expect(() => reduce(armed, {
      actor: 'p2', action: { t: 'ATTACK_BASE', card: target.iid },
    })).toThrow()
  })

  it('Shield Array soaks a point off every attack on you', () => {
    const s = fight(['shield-array'])
    // Combat is granted AFTER the turn passes: an unspent pool is lost at the
    // end of a turn, so arming p2 before that would arm nothing.
    const done = run(s, { t: 'END_TURN' })
    const armed = structuredClone(done.state)
    armed.players.p2.combat = 5
    const before = armed.players.p1.authority
    const hit = run(armed, { t: 'ATTACK_PLAYER', amount: 5 })
    expect(hit.state.players.p1.authority).toBe(before - 4)
    // And the tally records what LANDED, not what was spent.
    expect(hit.state.tally.p2.dmg).toBe(4)
  })

  it('Black Market Pass takes a point off every price, and floors at zero', () => {
    const s = fight(['black-market-pass'])
    const next = structuredClone(s)
    next.tradeRow = [
      { iid: 'r1' as never, def: 'federation-shuttle' as CardDefId },
      { iid: 'r2' as never, def: 'battle-mech' as CardDefId },
      null, null, null,
    ]
    next.players.p1.trade = 4
    const legal = enumerateLegalActions(redact(next, 'p1'), 'p1')
    expect(legal.some((a) => a.t === 'BUY_CARD' && a.card === 'r2')).toBe(true)
    const bought = run(next, { t: 'BUY_CARD', card: 'r2' as never })
    // Battle Mech is 5; the relic makes it 4.
    expect(bought.state.players.p1.trade).toBe(0)
    // A 1-cost card floors at 0 rather than paying the player.
    const free = run(next, { t: 'BUY_CARD', card: 'r1' as never })
    expect(free.state.players.p1.trade).toBe(4)
  })

  it('discounts the set-aside pile too -- the table and the reducer agreed here', () => {
    const s = fight(['black-market-pass'])
    const next = structuredClone(s)
    next.setAside = [{ iid: 'a1' as never, def: 'battle-mech' as CardDefId }]
    next.players.p1.trade = 4
    const legal = enumerateLegalActions(redact(next, 'p1'), 'p1')
    expect(legal.some((a) => a.t === 'BUY_CARD' && a.card === 'a1')).toBe(true)
    // Before the fix this threw: legal.ts priced it with context, the buy did not.
    const bought = run(next, { t: 'BUY_CARD', card: 'a1' as never })
    expect(bought.state.players.p1.trade).toBe(0)
    expect(bought.state.players.p1.discard.map((c) => c.def as string)).toContain('battle-mech')
  })

  it('leaves the Explorer alone, where table and reducer read one constant', () => {
    const s = fight(['black-market-pass'])
    const next = structuredClone(s)
    next.players.p1.trade = 1
    expect(enumerateLegalActions(redact(next, 'p1'), 'p1')
      .some((a) => a.t === 'BUY_EXPLORER')).toBe(false)
  })

  it('Deep Reserves deals a bigger hand, opening turn included', () => {
    const s = fight(['deep-reserves'])
    // The first turn of the game is short by two, as it is for everyone.
    expect(s.players.p1.hand.length).toBe(4)
    expect(s.players.p1.handSize).toBe(6)
    expect(s.players.p2.handSize).toBe(5)
    const t2 = run(s, { t: 'END_TURN' }, { t: 'END_TURN' }).state
    expect(t2.players.p1.hand.length).toBe(6)
  })

  it('Field Hospital adds authority to every fight, on top of what was carried', () => {
    const s = fight(['field-hospital'], { authority: 30 })
    expect(s.players.p1.authority).toBe(38)
  })
})

describe('the activated relic', () => {
  it('Overclock is offered only when it can be paid, and only once a turn', () => {
    const s = fight(['overclock'])
    const relic = s.players.p1.gambitsInPlay[0]
    if (!relic) throw new Error('no relic')
    const offered = (st: GameState): boolean => enumerateLegalActions(redact(st, 'p1'), 'p1')
      .some((a) => a.t === 'ACTIVATE' && a.card === relic.iid && a.slot === 'primary')

    expect(offered(s)).toBe(false)
    const rich = structuredClone(s)
    rich.players.p1.trade = 1
    expect(offered(rich)).toBe(true)

    const used = run(rich, { t: 'ACTIVATE', card: relic.iid, slot: 'primary' })
    expect(used.state.players.p1.trade).toBe(0)
    expect(used.state.players.p1.hand.length).toBe(rich.players.p1.hand.length + 1)
    expect(offered(used.state)).toBe(false)
  })
})

describe('a whole ladder with every relic', () => {
  it('opens a playable position on every node and survives the wire', () => {
    for (const node of RUN_LADDER) {
      const s = createGame({
        matchId: 'r', seed: `all-${node.index}`, firstPlayer: 'p1',
        scenario: runSetup(node, carry([...RELICS])),
      })
      expect(s.players.p1.gambitsInPlay.length).toBe(RELICS.length)
      expect(enumerateLegalActions(redact(s, actorOf(s)), actorOf(s)).length)
        .toBeGreaterThan(0)
      expect(JSON.parse(JSON.stringify(s))).toEqual(s)
    }
  })
})
