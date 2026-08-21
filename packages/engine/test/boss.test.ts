import { describe, expect, it } from 'vitest'
import {
  CHALLENGES, GRACE_TURNS, TENTACLE_FACTIONS, challengeById, challengeSetup,
  type ChallengeLevel,
} from '../src/boss'
import { cardDef } from '../src/cards/registry'
import { asDefId } from '../src/ids'
import { reduce } from '../src/reduce'
import { createGame } from '../src/setup'
import { actorOf, type GameState } from '../src/state'
import { enumerateLegalActions } from '../src/legal'
import { redact } from '../src/view'

function start(id: string, level: ChallengeLevel = 'veteran', seed = 'boss-seed'): GameState {
  const spec = challengeById(id)
  if (!spec) throw new Error(`no challenge ${id}`)
  const { scenario, boss } = challengeSetup(spec, level)
  return createGame({ matchId: 'c', seed, firstPlayer: 'p1', scenario, boss })
}

/** Pass turns; the boss's own turn resolves inside END_TURN. */
function pass(s0: GameState, n: number): GameState {
  let s = s0
  for (let i = 0; i < n && !s.winner; i++) {
    // A boss step can stop on a choice the player owns (a forced discard).
    let guard = 0
    while (s.resolution.length > 0 && !s.winner && guard++ < 20) {
      const legal = enumerateLegalActions(redact(s, actorOf(s)), actorOf(s))
      const first = legal[0]
      if (!first) break
      s = reduce(s, { actor: actorOf(s), action: first }).state
    }
    if (s.winner) break
    s = reduce(s, { actor: actorOf(s), action: { t: 'END_TURN' } }).state
  }
  return s
}

describe('challenge setup', () => {
  it('builds all eight challenges', () => {
    expect(CHALLENGES).toHaveLength(8)
    for (const spec of CHALLENGES) {
      const s = start(spec.id)
      expect(s.boss?.id).toBe(spec.id)
      expect(s.players.p1.authority).toBe(spec.playerAuthority)
      expect(JSON.parse(JSON.stringify(s))).toEqual(s)
    }
  })

  it('gives script bosses no deck, no hand and no discard pile', () => {
    for (const spec of CHALLENGES.filter((c) => c.kind === 'script')) {
      const s = start(spec.id)
      expect(s.players.p2.deck).toHaveLength(0)
      expect(s.players.p2.hand).toHaveLength(0)
      expect(s.players.p2.discard).toHaveLength(0)
      // And it never acquires one: ten turns in, all three are still empty.
      const later = pass(s, 10)
      expect(later.players.p2.deck).toHaveLength(0)
      expect(later.players.p2.hand).toHaveLength(0)
      expect(later.players.p2.discard).toHaveLength(0)
    }
  })

  it('gives deck bosses a personal deck and removes their faction from the trade deck', () => {
    for (const spec of CHALLENGES.filter((c) => c.kind === 'deck')) {
      const s = start(spec.id)
      expect(s.players.p2.deck.length + s.players.p2.hand.length).toBeGreaterThan(10)
      const allowed = new Set<string>(spec.tradeDeckOnly ?? [])
      for (const c of [...s.tradeDeck, ...s.tradeRow.filter((x) => x !== null)]) {
        expect(allowed.has(c.def)).toBe(true)
      }
    }
  })

  it('every card a challenge names exists', () => {
    for (const spec of CHALLENGES) {
      for (const def of [...(spec.bossDeck ?? []), ...(spec.playerDeck ?? []), ...(spec.tradeDeckOnly ?? [])]) {
        expect(() => cardDef(def)).not.toThrow()
      }
    }
  })
})

describe('difficulty levels', () => {
  it('changes only how many boss turns are skipped', () => {
    const skips: Record<ChallengeLevel, number> = {
      beginner: 2, intermediate: 1, veteran: 0, expert: 0,
    }
    for (const level of Object.keys(skips) as ChallengeLevel[]) {
      expect(start('nemesis-beast', level).boss?.graceTurns).toBe(skips[level])
    }
    expect(GRACE_TURNS.beginner).toBe(3)
    expect(start('nemesis-beast', 'expert').boss?.headStart).toBe(true)
    expect(start('nemesis-beast', 'veteran').boss?.headStart).toBe(false)
  })

  it('a skipped boss turn really does nothing', () => {
    // Beginner: two boss turns are skipped, so nothing is scrapped face down.
    const s = pass(start('nemesis-beast', 'beginner'), 2)
    expect(s.boss?.facedown).toHaveLength(0)
    const s3 = pass(s, 1)
    expect(s3.boss?.facedown.length).toBeGreaterThan(0)
  })

  it('expert takes a double first turn', () => {
    const veteran = pass(start('nemesis-beast', 'veteran'), 1)
    const expert = pass(start('nemesis-beast', 'expert'), 1)
    expect(veteran.boss?.facedown).toHaveLength(1)
    expect(expert.boss?.facedown).toHaveLength(2)
  })
})

describe('Nemesis Beast', () => {
  it('scraps the far trade row card face down and grows with the pile', () => {
    let s = start('nemesis-beast')
    const rowBefore = s.tradeRow.filter(Boolean).length
    s = pass(s, 1)
    expect(s.boss?.facedown).toHaveLength(1)
    // The row is refilled, so it stays full.
    expect(s.tradeRow.filter(Boolean).length).toBe(rowBefore)
    s = pass(s, 1)
    expect(s.boss?.facedown).toHaveLength(2)
  })

  it('spends its combat rather than banking it', () => {
    const s = pass(start('nemesis-beast'), 3)
    expect(s.players.p2.combat).toBe(0)
    // Three boss turns of a growing pile have to have landed somewhere.
    expect(s.players.p1.authority).toBeLessThan(50)
  })
})

describe('Automatons', () => {
  it('assimilates a card into play and grows its count every turn', () => {
    let s = start('automatons')
    const rowBefore = s.tradeRow.filter(Boolean).length
    s = pass(s, 1)
    expect(s.boss?.assimilation).toBe(1)
    // The salvaged card joins the armada and stays on the table: a script boss
    // has no discard pile to send it to.
    expect(s.players.p2.inPlay.length).toBe(1)
    expect(s.players.p2.discard).toHaveLength(0)
    expect(s.tradeRow.filter(Boolean).length).toBe(rowBefore)

    s = pass(s, 1)
    expect(s.boss?.assimilation).toBe(2)
    expect(s.players.p2.inPlay.length).toBe(2)
  })

  it('grows the combat it opens with, turn over turn', () => {
    // Assimilation IS the combat, so turn three has to hit harder than turn one.
    const one = pass(start('automatons'), 1)
    const three = pass(start('automatons'), 3)
    expect(60 - three.players.p1.authority).toBeGreaterThan(60 - one.players.p1.authority)
  })
})

describe('Dimensional Horror', () => {
  it('feeds tentacles and is beaten by destroying all four', () => {
    let s = pass(start('dimensional-horror'), 3)
    const piles = TENTACLE_FACTIONS.map((f) => s.boss?.tentacles[f].length ?? 0)
    expect(piles.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)

    // Hand the player enough combat to shear off every tentacle at once.
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, combat: 500 } } }
    for (const f of TENTACLE_FACTIONS) {
      if ((s.boss?.tentacles[f].length ?? 0) === 0) continue
      s = reduce(s, { actor: 'p1', action: { t: 'ATTACK_TENTACLE', faction: f } }).state
    }
    const left = TENTACLE_FACTIONS.filter((f) => !s.boss?.tentaclesDestroyed.includes(f))
    // Any tentacle that never got fed cannot be attacked, so only claim the win
    // when all four actually existed.
    if (left.length === 0) expect(s.winner).toBe('p1')
    else expect(s.winner).toBeNull()
  })

  it('a tentacle costs its swallowed cards to destroy', () => {
    const s0 = pass(start('dimensional-horror'), 2)
    const fed = TENTACLE_FACTIONS.find((f) => (s0.boss?.tentacles[f].length ?? 0) > 0)
    expect(fed).toBeDefined()
    const pile = s0.boss!.tentacles[fed!]
    const cost = pile.reduce((n, c) => n + cardDef(c.def).cost, 0)

    const poor = { ...s0, players: { ...s0.players, p1: { ...s0.players.p1, combat: cost - 1 } } }
    expect(() => reduce(poor, { actor: 'p1', action: { t: 'ATTACK_TENTACLE', faction: fed! } }))
      .toThrow()

    const rich = { ...s0, players: { ...s0.players, p1: { ...s0.players.p1, combat: cost } } }
    const after = reduce(rich, { actor: 'p1', action: { t: 'ATTACK_TENTACLE', faction: fed! } }).state
    expect(after.players.p1.combat).toBe(0)
    expect(after.boss?.tentaclesDestroyed).toContain(fed)
  })
})

describe('boss attack targeting', () => {
  it('takes the outpost before the base, and the player only when open', () => {
    const s0 = start('nemesis-beast')
    // Outpost (Trading Post, defense 4) and a plain base (The Hive, defense 5).
    const staged: GameState = {
      ...s0,
      players: {
        ...s0.players,
        p1: {
          ...s0.players.p1,
          inPlay: [
            { iid: 'aaa' as never, def: asDefId('trading-post'), copiedDef: null, used: { primary: false, ally: false, scrap: false }, playedThisTurn: false },
            { iid: 'bbb' as never, def: asDefId('the-hive'), copiedDef: null, used: { primary: false, ally: false, scrap: false }, playedThisTurn: false },
          ],
        },
        p2: { ...s0.players.p2, combat: 0 },
      },
    }
    const after = pass(staged, 1)
    const outpostGone = !after.players.p1.inPlay.some((c) => c.def === asDefId('trading-post'))
    const baseGone = !after.players.p1.inPlay.some((c) => c.def === asDefId('the-hive'))

    // The rule under test is ORDER, not damage: the plain base can only fall
    // once the outpost has. (Once the outpost is gone the leftover combat does
    // carry on to what is behind it -- that is what the rulebook says.)
    if (baseGone) expect(outpostGone).toBe(true)
    if (!outpostGone) {
      expect(baseGone).toBe(false)
      expect(after.players.p1.authority).toBe(staged.players.p1.authority)
    }
  })
})

describe('trade row mulligan', () => {
  it('is offered once per challenge and replaces the whole row', () => {
    const s0 = start('nemesis-beast')
    const before = s0.tradeRow.map((c) => c?.iid)
    expect(enumerateLegalActions(redact(s0, 'p1'), 'p1')).toContainEqual({ t: 'MULLIGAN_ROW' })

    const s1 = reduce(s0, { actor: 'p1', action: { t: 'MULLIGAN_ROW' } }).state
    expect(s1.boss?.mulliganUsed).toBe(true)
    expect(s1.tradeRow.filter(Boolean)).toHaveLength(5)
    for (const iid of s1.tradeRow.map((c) => c?.iid)) expect(before).not.toContain(iid)

    expect(enumerateLegalActions(redact(s1, 'p1'), 'p1')).not.toContainEqual({ t: 'MULLIGAN_ROW' })
    expect(() => reduce(s1, { actor: 'p1', action: { t: 'MULLIGAN_ROW' } })).toThrow()
  })

  it('is not available outside a challenge', () => {
    const s = createGame({ matchId: 'm', seed: 'plain', firstPlayer: 'p1' })
    expect(enumerateLegalActions(redact(s, 'p1'), 'p1')).not.toContainEqual({ t: 'MULLIGAN_ROW' })
    expect(() => reduce(s, { actor: 'p1', action: { t: 'MULLIGAN_ROW' } })).toThrow()
  })
})

describe('challenges stay playable', () => {
  it('every challenge survives twenty turns without stalling or leaking', () => {
    for (const spec of CHALLENGES) {
      const s = pass(start(spec.id, 'veteran'), 20)
      // Either somebody won or the game is still legally playable.
      if (!s.winner) {
        expect(enumerateLegalActions(redact(s, actorOf(s)), actorOf(s)).length).toBeGreaterThan(0)
      }
      const wire = JSON.stringify(redact(s, 'p1'))
      expect(wire).not.toContain('"rng"')
      for (const c of s.players.p2.hand) expect(wire).not.toContain(c.iid)
    }
  })
})
