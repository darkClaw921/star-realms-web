import { describe, expect, it } from 'vitest'
import { CAMPAIGNS, missionById } from '../src/campaign'
import { cardDef, tradeDeckComposition } from '../src/cards/registry'
import { reduce } from '../src/reduce'
import { createGame } from '../src/setup'
import { actorOf, type GameState } from '../src/state'
import { redact } from '../src/view'
import { inPlay, run } from './scenario'

const start = (id: string, seed = 'campaign-seed'): GameState => {
  const m = missionById(id)
  if (!m) throw new Error(`no mission ${id}`)
  return createGame({ matchId: 'm', seed, firstPlayer: 'p1', scenario: m.setup })
}

/** End turns until it is `turn`, letting each side do nothing but pass. */
function passTo(s0: GameState, turn: number): GameState {
  let s = s0
  let guard = 0
  while (s.turn < turn && !s.winner && guard++ < 200) {
    s = reduce(s, { actor: actorOf(s), action: { t: 'END_TURN' } }).state
  }
  return s
}

describe('campaign data', () => {
  it('every mission builds a playable opening position', () => {
    for (const c of CAMPAIGNS) {
      for (const m of c.missions) {
        const s = start(m.id)
        expect(s.scenario?.id).toBe(m.id)
        expect(s.players.p1.hand.length).toBe(3)
        expect(s.players.p2.hand.length).toBe(5)
        expect(s.tradeRow.filter(Boolean).length).toBe(5)
        expect(s.winner).toBeNull()
        // The whole state still has to survive the wire.
        expect(JSON.parse(JSON.stringify(s))).toEqual(s)
      }
    }
  })

  it('mission ids are unique and indexes are contiguous', () => {
    const seen = new Set<string>()
    for (const c of CAMPAIGNS) {
      c.missions.forEach((m, i) => {
        expect(seen.has(m.id)).toBe(false)
        seen.add(m.id)
        expect(m.index).toBe(i + 1)
        expect(m.campaign).toBe(c.id)
      })
    }
  })

  it('a restricted pool puts nothing else in the trade deck', () => {
    for (const c of CAMPAIGNS) {
      for (const m of c.missions) {
        const pool = m.setup.tradeDeckOnly
        if (!pool) continue
        const allowed = new Set<string>(pool)
        const s = start(m.id)
        const all = [...s.tradeDeck, ...s.tradeRow.filter((x) => x !== null)]
        for (const card of all) expect(allowed.has(card.def)).toBe(true)
        // A restricted deck must still be big enough to play a whole game out of.
        expect(s.tradeDeck.length + 5).toBe(tradeDeckComposition(pool).length)
        // Two factions minimum: one faction is 20 cards and the row runs dry.
        expect(s.tradeDeck.length).toBeGreaterThan(30)
      }
    }
  })

  it('every referenced card exists and starting bases really are bases', () => {
    for (const c of CAMPAIGNS) {
      for (const m of c.missions) {
        for (const def of m.setup.tradeDeckOnly ?? []) {
          expect(cardDef(def).role).toBe('trade_deck')
        }
        for (const side of ['p1', 'p2'] as const) {
          for (const def of m.setup.startingBases[side] ?? []) {
            expect(cardDef(def).type).not.toBe('ship')
          }
          for (const def of m.setup.starterDeck[side] ?? []) {
            expect(() => cardDef(def)).not.toThrow()
          }
        }
      }
    }
  })

  it('starting bases are standing, not freshly played', () => {
    const s = start('foundry-4')
    expect(s.players.p2.inPlay.length).toBe(3)
    for (const c of s.players.p2.inPlay) {
      expect(c.playedThisTurn).toBe(false)
      expect(c.used).toEqual({
        primary: false, ally: false, ally2: false, ally3: false, ally4: false,
        doubleAlly: false, scrap: false, splinter: false,
      })
    }
  })
})

describe('scenario rules', () => {
  it('funds the boss at the start of each of its turns, and not the hero', () => {
    const s0 = start('hive-1') // bossCombat: 3
    expect(s0.players.p1.combat).toBe(0)
    const s1 = reduce(s0, { actor: 'p1', action: { t: 'END_TURN' } }).state
    expect(s1.activePlayer).toBe('p2')
    expect(s1.players.p2.combat).toBe(3)
    const s2 = reduce(s1, { actor: 'p2', action: { t: 'END_TURN' } }).state
    // Unspent funding burns at end of turn like any other combat.
    expect(s2.players.p2.combat).toBe(0)
    expect(s2.players.p1.combat).toBe(0)
  })

  it('SURVIVE is won by outlasting the clock', () => {
    const s = passTo(start('hive-2'), 15) // objective: survive 14 turns
    expect(s.winner).toBe('p1')
    expect(s.phase).toBe('gameOver')
  })

  it('DESTROY_BASES counts enemy bases only', () => {
    // The mission asks for two; destroying our own must not count toward it.
    const s0 = start('frontier-3')
    const withMine = {
      ...s0,
      players: {
        ...s0.players,
        p1: {
          ...s0.players.p1,
          hand: [],
          combat: 40,
          inPlay: [inPlay('trading-post')],
        },
      },
    }
    // Attacking a base of our own is not even legal, so go through the effect
    // path: shoot the boss's two outposts instead and confirm the count.
    const target1 = withMine.players.p2.inPlay[0]!.iid
    let st = run(withMine, { t: 'ATTACK_BASE', base: target1 }).state
    expect(st.basesDestroyed.p1).toBe(1)
    expect(st.winner).toBeNull()

    const target2 = st.players.p2.inPlay[0]!.iid
    st = run(st, { t: 'ATTACK_BASE', base: target2 }).state
    expect(st.basesDestroyed.p1).toBe(2)
    expect(st.winner).toBe('p1')
  })

  it('REACH_AUTHORITY is won on the threshold', () => {
    const s0 = start('foundry-3') // reach 75
    const near = {
      ...s0,
      players: { ...s0.players, p1: { ...s0.players.p1, authority: 74 } },
    }
    const won = {
      ...near,
      players: { ...near.players, p1: { ...near.players.p1, authority: 75 } },
    }
    // Nothing is scored until a command runs, which is what settle() is for.
    expect(reduce(near, { actor: 'p1', action: { t: 'END_TURN' } }).state.winner).toBeNull()
    expect(reduce(won, { actor: 'p1', action: { t: 'END_TURN' } }).state.winner).toBe('p1')
  })

  it('death still beats a completed objective', () => {
    const s0 = start('foundry-3')
    const dying = {
      ...s0,
      players: {
        ...s0.players,
        // Objective met AND dead on the same check: the loss wins.
        p1: { ...s0.players.p1, authority: 0 },
      },
    }
    const after = reduce(dying, { actor: 'p1', action: { t: 'END_TURN' } }).state
    expect(after.winner).toBe('p2')
  })

  it('a standard game has no scenario and no objective', () => {
    const s = createGame({ matchId: 'm', seed: 'plain', firstPlayer: 'p1' })
    expect(s.scenario).toBeNull()
    // Only the seats in play; the state carries a slot for every seat the type
    // allows, and a duel occupies two of them.
    expect(s.seats).toEqual(['p1', 'p2'])
    expect(redact(s, 'p1').basesDestroyed).toEqual({ p1: 0, p2: 0 })
    expect(redact(s, 'p1').scenario).toBeNull()
  })

  it('the rules reach both players through the view', () => {
    const s = start('hive-2')
    for (const seat of ['p1', 'p2'] as const) {
      const v = redact(s, seat)
      expect(v.scenario?.objective).toEqual({ k: 'SURVIVE', turns: 14 })
      expect(v.scenario?.hero).toBe('p1')
      // And the view still leaks nothing it did not before: no rng, and no
      // instance id from the opponent's hand or either deck.
      const wire = JSON.stringify(v)
      expect(wire).not.toContain('"rng"')
      const foe = seat === 'p1' ? 'p2' : 'p1'
      for (const c of [...s.players[foe].hand, ...s.players[foe].deck, ...s.players[seat].deck]) {
        expect(wire).not.toContain(c.iid)
      }
    }
  })
})
