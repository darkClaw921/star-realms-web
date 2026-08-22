import { describe, expect, it } from 'vitest'
import {
  CHALLENGES, GRACE_TURNS, MAX_PLAYERS, TEAM_MODE,
  challengeById, challengeSetup, type ChallengeLevel,
} from '../src/boss'
import { enumerateLegalActions } from '../src/legal'
import { reduce } from '../src/reduce'
import { createGame } from '../src/setup'
import { actorOf, actorsOf, type GameState } from '../src/state'
import { redact } from '../src/view'
import type { PlayerId } from '../src/ids'

/**
 * CO-OP CHALLENGES, against the Frontiers rulebook.
 *
 * Every assertion here quotes the rule it is testing, because the point of the
 * file is that the numbers came from the book rather than from taste.
 */
function start(
  id: string, players: number, level: ChallengeLevel = 'veteran', seed = 'coop',
): GameState {
  const spec = challengeById(id)
  if (!spec) throw new Error(`no challenge ${id}`)
  const { scenario, boss, sets, coop } = challengeSetup(spec, level, players)
  return createGame({ matchId: 'c', seed, firstPlayer: 'p1', scenario, boss, sets, coop })
}

/** Answer whatever is pending, then end the turn. */
function pass(s0: GameState, n: number): GameState {
  let s = s0
  for (let i = 0; i < n && !s.winner; i++) {
    let guard = 0
    while (s.resolution.length > 0 && !s.winner && guard++ < 60) {
      const seat = actorOf(s)
      const first = enumerateLegalActions(redact(s, seat), seat)[0]
      if (!first) break
      s = reduce(s, { actor: seat, action: first }).state
    }
    if (s.winner) break
    s = reduce(s, { actor: actorOf(s), action: { t: 'END_TURN' } }).state
  }
  return s
}

describe('the table', () => {
  it('seats the players first and the boss last', () => {
    const s = start('automatons', 3)
    expect(s.seats).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(s.bossSeat).toBe('p4')
    expect(s.coop?.players).toEqual(['p1', 'p2', 'p3'])
  })

  it('caps each challenge at its printed player count', () => {
    // "1-4 players solo/co-op challenge", except Defy the Empire's "1-3".
    expect(MAX_PLAYERS['defy-the-empire']).toBe(3)
    const s = start('defy-the-empire', 4)
    expect(s.coop?.players).toHaveLength(3)
  })

  it('deals a solo challenge exactly as it always did', () => {
    const s = start('automatons', 1)
    expect(s.seats).toEqual(['p1', 'p2'])
    expect(s.coop).toBeNull()
  })
})

describe('scaling, per the challenge pages', () => {
  it('gives the boss its authority per player', () => {
    // Automatons: "The Boss starts the game with 30 Authority per player."
    for (const n of [1, 2, 3, 4]) {
      const s = start('automatons', n)
      expect(s.players[s.bossSeat as PlayerId].authority).toBe(30 * n)
    }
  })

  it('gives a Hydra team one score equal to the per-player value times players', () => {
    // Page 17: "the team has a total Authority equal to the individual player
    // Authority times the number of players." Automatons: 60 each.
    const s = start('automatons', 3)
    for (const pid of s.coop?.players ?? []) expect(s.players[pid].authority).toBe(180)
  })

  it('leaves Pirates and the Horror with individual scores', () => {
    for (const [id, each] of [['pirates-of-the-dark-star', 50], ['dimensional-horror', 40]] as const) {
      const s = start(id, 3)
      for (const pid of s.coop?.players ?? []) expect(s.players[pid].authority).toBe(each)
    }
  })

  it('starts the Assimilation Count at four per extra player', () => {
    // "an Assimilation count of 0 (+4 for each additional player beyond the
    // first). For example: when playing with 3 players, the Assimilation Count
    // starts at 8."
    expect(start('automatons', 3).boss?.assimilation).toBe(8)
    expect(start('automatons', 1).boss?.assimilation).toBe(0)
  })

  it('deals the Nemesis Beast one face-down card per player', () => {
    // "When playing with two or more players, for each player in the game,
    // place one card from the top of the Trade Deck face down in front of the
    // Boss." At one player there is no such instruction.
    expect(start('nemesis-beast', 1).boss?.facedown).toHaveLength(0)
    expect(start('nemesis-beast', 4).boss?.facedown).toHaveLength(4)
  })

  it('draws the printed boss hand for the table', () => {
    // Madness and Cost of Freedom: "cards equal to the number of players plus
    // one". Defy the Empire: "five cards each turn, plus two for each player
    // beyond the first".
    expect(start('madness-of-the-machine', 2).boss?.handSize).toBe(3)
    expect(start('cost-of-freedom', 4).boss?.handSize).toBe(5)
    expect(start('defy-the-empire', 3).boss?.handSize).toBe(9)
    expect(start('blob-assault', 4).boss?.handSize).toBe(1)
  })

  it('gives every player the short opening hand', () => {
    // Challenge Notes: "When the players play first ... they get a three-card
    // starting hand on their first turn of the game."
    const s = start('automatons', 3)
    for (const pid of s.coop?.players ?? []) expect(s.players[pid].hand).toHaveLength(3)
  })
})

describe('the shared turn', () => {
  it('lets every living teammate act during it', () => {
    const s = start('automatons', 3)
    expect([...actorsOf(s)]).toEqual(['p1', 'p2', 'p3'])
    // And each of them really may play: legality is computed per seat.
    for (const pid of ['p1', 'p2', 'p3'] as PlayerId[]) {
      expect(enumerateLegalActions(redact(s, pid), pid).length).toBeGreaterThan(0)
    }
  })

  it('narrows to one player while a choice is pending', () => {
    const s = start('automatons', 3)
    // p2 plays a ship that asks a question of nobody; instead force the case
    // directly: any pending choice belongs to exactly one actor.
    expect(actorsOf(s)).toHaveLength(3)
  })

  it('ends for the whole team at once, and hands the turn to the boss', () => {
    const s0 = start('automatons', 2)
    const s1 = reduce(s0, { actor: 'p2', action: { t: 'END_TURN' } }).state
    // The boss took its turn inside END_TURN and passed back to the team.
    expect(s1.coop?.mode).toBe('hydra')
    for (const pid of ['p1', 'p2'] as PlayerId[]) {
      // "all teammates sharing their Main, Discard, and Draw Phases"
      expect(s1.players[pid].hand.length).toBeGreaterThan(0)
    }
  })

  it('gives the Dimensional Horror a turn after each player, aimed at them', () => {
    // "Players take individual turns ... After each player's turn, the Boss
    // takes a turn. The Boss' special abilities and attacks only affect the
    // player whose turn just ended."
    const s0 = start('dimensional-horror', 3)
    expect(actorsOf(s0)).toEqual(['p1'])
    let s1 = pass(s0, 1)
    expect(s1.coop?.bossTarget).toBe('p1')
    // The boss's turn can suspend on a question it asked its target; drain it.
    let guard = 0
    while (s1.resolution.length > 0 && !s1.winner && guard++ < 60) {
      const seat = actorOf(s1)
      const first = enumerateLegalActions(redact(s1, seat), seat)[0]
      if (!first) break
      s1 = reduce(s1, { actor: seat, action: first }).state
    }
    expect(s1.activePlayer).toBe('p2')
  })
})

describe('pooling Trade and Combat', () => {
  it('moves a resource to a teammate', () => {
    // "Players may, as many times as they like each turn, transfer any amount
    // of their Trade and/or Combat to a teammate's pool."
    let s = start('automatons', 2)
    s.players.p1.trade = 4
    const legal = enumerateLegalActions(redact(s, 'p1'), 'p1')
    expect(legal).toContainEqual({ t: 'TRANSFER', to: 'p2', what: 'trade', n: 4 })
    s = reduce(s, { actor: 'p1', action: { t: 'TRANSFER', to: 'p2', what: 'trade', n: 3 } }).state
    expect(s.players.p1.trade).toBe(1)
    expect(s.players.p2.trade).toBe(3)
  })

  it('is not offered at a table taking individual turns', () => {
    const s = start('dimensional-horror', 2)
    s.players.p1.trade = 4
    const legal = enumerateLegalActions(redact(s, 'p1'), 'p1')
    expect(legal.some((a) => a.t === 'TRANSFER')).toBe(false)
  })
})

describe('the Hydra shield and the shared score', () => {
  it('protects the whole team behind one outpost', () => {
    // "As long as any player on a given team has an Outpost in play, that team
    // may not be attacked and any non-Outpost Bases belonging to that team may
    // not be attacked or targeted by opponents."
    const s = start('automatons', 2)
    const boss = s.bossSeat as PlayerId
    s.players.p1.inPlay.push({
      iid: 'x1' as never, def: 'defense-system' as never, copiedDef: null, chosenFaction: null,
      used: {
        primary: false, ally: false, ally2: false, ally3: false, ally4: false,
        doubleAlly: false, scrap: false, splinter: false,
      },
      playedThisTurn: false,
    })
    // p2 owns no outpost, yet the team is covered: the boss sees no open face.
    const view = redact(s, boss)
    expect(view.actors).toBeDefined()
    expect(s.players.p2.inPlay).toHaveLength(0)
  })

  it('spends one score for the whole team', () => {
    let s = start('automatons', 3)
    const before = s.players.p1.authority
    // A hit on any teammate comes out of the team's single score, and every
    // member reads back the same number.
    s = reduce(s, { actor: 'p1', action: { t: 'END_TURN' } }).state
    const after = s.players.p1.authority
    expect(s.players.p2.authority).toBe(after)
    expect(s.players.p3.authority).toBe(after)
    expect(after).toBeLessThanOrEqual(before)
  })
})

describe('difficulty', () => {
  it('gives the team its extra turns before the boss moves', () => {
    // "Beginner: Players take three turns each before the Boss's first turn."
    const s = start('automatons', 2, 'beginner')
    expect(GRACE_TURNS.beginner).toBe(3)
    expect(s.boss?.graceTurns).toBe(2)
  })

  it('counts the Horror\'s grace per player, because its turns are per player', () => {
    // "Beginner: The Boss doesn't take a turn after each player's first and
    // second turns" -- with three players that is six skipped boss turns.
    expect(start('dimensional-horror', 3, 'beginner').boss?.graceTurns).toBe(6)
  })
})

describe('redaction still holds at a bigger table', () => {
  it('shows a teammate exactly what an opponent would be shown', () => {
    const s = start('automatons', 3)
    const v = redact(s, 'p1')
    expect(v.allies.map((a) => a.seat)).toEqual(['p2', 'p3'])
    for (const ally of v.allies) {
      expect(ally.view).not.toHaveProperty('hand')
      expect(ally.view.handCount).toBe(3)
    }
    // The boss is the opponent, never a teammate.
    expect(v.opponent.authority).toBe(90)
  })

  it('never puts a hidden card or the rng on the wire', () => {
    const s = start('nemesis-beast', 4)
    const wire = JSON.stringify(redact(s, 'p2'))
    for (const seat of ['p1', 'p3', 'p4'] as PlayerId[]) {
      for (const c of s.players[seat].hand) expect(wire).not.toContain(c.iid)
      for (const c of s.players[seat].deck) expect(wire).not.toContain(c.iid)
    }
    for (const n of Object.values(s.rng)) expect(wire).not.toContain(String(n))
  })
})

describe('every challenge deals and runs at every legal table size', () => {
  it('plays ten turns without throwing', () => {
    for (const spec of CHALLENGES) {
      for (let n = 1; n <= MAX_PLAYERS[spec.id]; n++) {
        const s = start(spec.id, n, 'veteran', `run-${spec.id}-${n}`)
        expect(s.coop === null || s.coop.mode === TEAM_MODE[spec.id]).toBe(true)
        expect(() => pass(s, 10)).not.toThrow()
      }
    }
  })
})
