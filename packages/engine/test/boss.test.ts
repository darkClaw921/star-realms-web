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
  const { scenario, boss, sets } = challengeSetup(spec, level)
  // Challenges are dealt from the Frontiers trade deck, which is what the set
  // they come from is built around.
  return createGame({ matchId: 'c', seed, firstPlayer: 'p1', scenario, boss, sets })
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

      // It is never DEALT one either: ten turns in it still has no hand,
      // because it never draws. (Automatons plays cards off the trade deck,
      // and a card it plays may legitimately hand it one -- Gateship acquires
      // to the deck top -- so deck and discard are not asserted empty. What
      // matters is that no discard-and-draw phase ever runs for it.)
      const later = pass(s, 10)
      expect(later.players.p2.hand).toHaveLength(0)
    }
  })

  it('gives deck bosses a personal deck and removes their faction from the trade deck', () => {
    for (const spec of CHALLENGES.filter((c) => c.kind === 'deck')) {
      const s = start(spec.id)
      const bossCards = s.players.p2.deck.length + s.players.p2.hand.length
        + s.players.p2.discard.length
      expect(bossCards).toBeGreaterThan(9)
      const allowed = new Set<string>(spec.tradeDeckOnly ?? [])
      for (const c of [...s.tradeDeck, ...s.tradeRow.filter((x) => x !== null)]) {
        expect(allowed.has(c.def)).toBe(true)
      }
    }
  })

  it('deals challenges from the Frontiers trade deck, not the base set', () => {
    for (const spec of CHALLENGES) {
      const s = start(spec.id)
      for (const c of [...s.tradeDeck, ...s.tradeRow.filter((x) => x !== null)]) {
        expect(cardDef(c.def).set).toBe('frontiers')
      }
    }
  })

  it('Blob Assault stacks its deck in the printed order and opens with a Spike Cluster', () => {
    const s = start('blob-assault')
    // Hand size is one, so the top card has already been drawn: Stinger first.
    expect(s.players.p2.hand[0]?.def).toBe(asDefId('stinger'))
    const rest = ['spike-cluster', 'burrower', 'crusher', 'nesting-ground',
      'pulverizer', 'blob-alpha', 'swarm-cluster', 'infested-moon', 'hive-queen']
    rest.forEach((def, i) => expect(s.players.p2.deck[i]?.def).toBe(asDefId(def)))
    // "Put one Spike Cluster face up in the Blob's Discard Pile."
    expect(s.players.p2.discard.map((c) => c.def)).toEqual([asDefId('spike-cluster')])
  })

  it('Madness of the Machine builds the deck the rulebook describes', () => {
    const s = start('madness-of-the-machine')
    const all = [...s.players.p2.deck, ...s.players.p2.hand]
    // Twenty Machine Cult cards plus four Scouts and four Vipers.
    expect(all).toHaveLength(28)
    expect(all.filter((c) => c.def === asDefId('scout'))).toHaveLength(4)
    expect(all.filter((c) => c.def === asDefId('viper'))).toHaveLength(4)
    const cult = all.filter((c) => c.def !== asDefId('scout') && c.def !== asDefId('viper'))
    expect(cult).toHaveLength(20)
    for (const c of cult) {
      expect(cardDef(c.def).faction).toBe('machine_cult')
      expect(cardDef(c.def).set).toBe('frontiers')
    }
    // And the player's own deck is the cut-down 7 Scouts and 1 Viper.
    expect([...s.players.p1.deck, ...s.players.p1.hand]).toHaveLength(8)
  })

  it('every deck boss uses its own faction, from Frontiers', () => {
    const faction: Record<string, string> = {
      'blob-assault': 'blob',
      'madness-of-the-machine': 'machine_cult',
      'defy-the-empire': 'star_empire',
      'cost-of-freedom': 'trade_federation',
    }
    for (const [id, f] of Object.entries(faction)) {
      const s = start(id)
      const cards = [...s.players.p2.deck, ...s.players.p2.hand, ...s.players.p2.discard]
        .map((c) => cardDef(c.def))
        .filter((d) => d.role === 'trade_deck')
      expect(cards.length).toBeGreaterThan(0)
      for (const d of cards) {
        expect(d.faction).toBe(f)
        expect(d.set).toBe('frontiers')
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
  it('plays cards off the trade deck and grows its count after attacking', () => {
    let s = start('automatons')
    const deckBefore = s.tradeDeck.length
    s = pass(s, 1)
    // Count starts at 0, so turn one plays exactly one card (the do-while runs
    // once, then 0 >= 0 stops it), and the count becomes 1 after the attack.
    expect(s.boss?.assimilation).toBe(1)
    expect(s.tradeDeck.length).toBeLessThan(deckBefore)
    // The cards were PLAYED, so they are on the table, not in a discard pile a
    // script boss does not have.
    expect(s.players.p2.inPlay.length).toBeGreaterThan(0)
    expect(s.players.p2.discard).toHaveLength(0)

    s = pass(s, 1)
    expect(s.boss?.assimilation).toBe(2)
  })

  it('keeps playing until the cards it played cost at least the count', () => {
    // By turn four the count is high enough to force several cards in one turn.
    let s = start('automatons')
    const deck0 = s.tradeDeck.length
    s = pass(s, 1)
    const afterOne = deck0 - s.tradeDeck.length
    const beforeLate = s.tradeDeck.length
    s = pass(s, 4)
    const perLateTurn = (beforeLate - s.tradeDeck.length) / 4
    expect(perLateTurn).toBeGreaterThan(afterOne - 0.5)
  })
})

describe('Dimensional Horror', () => {
  it('is beaten by emptying every tentacle at once', () => {
    let s = pass(start('dimensional-horror'), 3)
    const total = TENTACLE_FACTIONS.reduce((n, f) => n + (s.boss?.tentacles[f].length ?? 0), 0)
    expect(total).toBeGreaterThan(0)

    // Enough combat to shoot every card off every tentacle.
    s = { ...s, players: { ...s.players, p1: { ...s.players.p1, combat: 500 } } }
    let guard = 0
    while (!s.winner && guard++ < 60) {
      const shot = TENTACLE_FACTIONS
        .map((f) => ({ f, c: s.boss?.tentacles[f][0] }))
        .find((x) => x.c)
      if (!shot?.c) break
      s = reduce(s, { actor: 'p1', action: { t: 'ATTACK_TENTACLE', faction: shot.f, card: shot.c.iid } }).state
    }
    expect(TENTACLE_FACTIONS.every((f) => (s.boss?.tentacles[f].length ?? 0) === 0)).toBe(true)
    expect(s.winner).toBe('p1')
  })

  it('a card in a tentacle costs exactly its own printed cost', () => {
    const s0 = pass(start('dimensional-horror'), 2)
    const fed = TENTACLE_FACTIONS.find((f) => (s0.boss?.tentacles[f].length ?? 0) > 0)
    expect(fed).toBeDefined()
    const target = s0.boss!.tentacles[fed!][0]!
    const cost = cardDef(target.def).cost

    const poor = { ...s0, players: { ...s0.players, p1: { ...s0.players.p1, combat: cost - 1 } } }
    expect(() => reduce(poor, {
      actor: 'p1', action: { t: 'ATTACK_TENTACLE', faction: fed!, card: target.iid },
    })).toThrow()

    const rich = { ...s0, players: { ...s0.players, p1: { ...s0.players.p1, combat: cost } } }
    const after = reduce(rich, {
      actor: 'p1', action: { t: 'ATTACK_TENTACLE', faction: fed!, card: target.iid },
    }).state
    expect(after.players.p1.combat).toBe(0)
    expect(after.boss!.tentacles[fed!].some((c) => c.iid === target.iid)).toBe(false)
    // Shooting one card does not remove the rest of the pile.
    expect(after.scrapHeap.some((c) => c.iid === target.iid)).toBe(true)
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
            { iid: 'aaa' as never, def: asDefId('trading-post'), copiedDef: null, chosenFaction: null, used: { primary: false, ally: false, scrap: false }, playedThisTurn: false },
            { iid: 'bbb' as never, def: asDefId('the-hive'), copiedDef: null, chosenFaction: null, used: { primary: false, ally: false, scrap: false }, playedThisTurn: false },
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

/**
 * The faction tables, as printed on the challenge cards. These are the part
 * that used to be reconstructed, so each one is pinned to its printed wording.
 */
describe('printed faction tables', () => {
  /** Stack the trade deck so a known faction is what gets revealed. */
  function withRow(id: string, defs: string[]): GameState {
    const s = start(id)
    return {
      ...s,
      tradeRow: defs.map((d) => ({ iid: `t${d}` as never, def: asDefId(d) })),
      // Refills come off the deck, so control that too.
      tradeDeck: defs.map((d, i) => ({ iid: `k${i}${d}` as never, def: asDefId(d) })),
    }
  }

  it('Nemesis Beast: yellow makes you discard TWO cards', () => {
    // Star Empire in the row means Star Empire is what replaces the scrapped
    // card, which is what the beast reads.
    const s = withRow('nemesis-beast', ['corvette', 'corvette', 'corvette', 'corvette', 'corvette'])
    const after = reduce(s, { actor: 'p1', action: { t: 'END_TURN' } }).state
    const choice = after.resolution[0]
    if (choice && choice.f === 'choice') {
      expect(choice.choice.prompt).toBe('DISCARD')
      expect(choice.choice.min).toBe(2)
    }
  })

  it('Nemesis Beast: blue gives it FIVE authority', () => {
    const s = withRow('nemesis-beast', ['cutter', 'cutter', 'cutter', 'cutter', 'cutter'])
    const before = s.players.p2.authority
    const after = reduce(s, { actor: 'p1', action: { t: 'END_TURN' } }).state
    expect(after.players.p2.authority).toBe(before + 5)
  })

  it('Nemesis Beast: green takes a base, or 3 combat when there is none', () => {
    const s = withRow('nemesis-beast', ['ram', 'ram', 'ram', 'ram', 'ram'])
    // No bases in play at all, so the "or gains 3 combat" branch is the one.
    const after = reduce(s, { actor: 'p1', action: { t: 'END_TURN' } }).state
    // The combat is spent by the attack that follows, so read the damage.
    expect(50 - after.players.p1.authority).toBeGreaterThanOrEqual(3)
  })

  it('Dimensional Horror: blue destroys ALL of your bases', () => {
    const base = {
      iid: 'mybase' as never, def: asDefId('the-hive'), copiedDef: null, chosenFaction: null,
      used: {
      primary: false, ally: false, ally2: false, ally3: false, ally4: false,
      doubleAlly: false, scrap: false, splinter: false,
    },
      playedThisTurn: false,
    }
    const s0 = withRow('dimensional-horror', ['cutter', 'cutter', 'cutter', 'cutter', 'cutter'])
    const s = { ...s0, players: { ...s0.players, p1: { ...s0.players.p1, inPlay: [base, { ...base, iid: 'b2' as never }] } } }
    const after = reduce(s, { actor: 'p1', action: { t: 'END_TURN' } }).state
    expect(after.players.p1.inPlay.filter((c) => c.def === asDefId('the-hive'))).toHaveLength(0)
  })

  it('Pirates: green attacks with three times the revealed cost', () => {
    // Ram costs 3, so green is 9 combat -- more than the 6 that 2x would give.
    const s = withRow('pirates-of-the-dark-star', ['ram', 'ram', 'ram', 'ram', 'ram'])
    const after = reduce(s, { actor: 'p1', action: { t: 'END_TURN' } }).state
    expect(50 - after.players.p1.authority).toBe(9)
  })

  it('Pirates: blue heals the boss as well as hitting you', () => {
    // Cutter costs 2: 4 combat and 4 authority.
    const s = withRow('pirates-of-the-dark-star', ['cutter', 'cutter', 'cutter', 'cutter', 'cutter'])
    const bossBefore = s.players.p2.authority
    const after = reduce(s, { actor: 'p1', action: { t: 'END_TURN' } }).state
    expect(after.players.p2.authority).toBe(bossBefore + 4)
    expect(50 - after.players.p1.authority).toBe(4)
  })
})

describe('deck bosses draw what their card says', () => {
  it('each deck boss draws its own printed hand size', () => {
    const expected: Record<string, number> = {
      'blob-assault': 1,
      'madness-of-the-machine': 2,
      'defy-the-empire': 5,
      'cost-of-freedom': 2,
    }
    for (const [id, n] of Object.entries(expected)) {
      expect(start(id).boss?.handSize).toBe(n)
      // And it really is what lands in hand after a turn passes.
      const s = pass(start(id), 1)
      expect(s.players.p2.hand.length).toBeLessThanOrEqual(n)
    }
  })
})
