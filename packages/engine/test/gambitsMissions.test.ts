import { describe, expect, it } from 'vitest'
import { CARDS } from '../src/cards/registry'
import { createGame } from '../src/setup'
import { redact } from '../src/view'
import { asDefId } from '../src/ids'
import { inPlay, legalFor, playIid, run, scenario } from './scenario'

const D = asDefId

const withSides = (gambits: number, missions: number) => createGame({
  matchId: 'sides', seed: 'sides-seed', firstPlayer: 'p1',
  sets: ['core', 'gambits', 'cosmic-gambits', 'missions'],
  gambitsPerPlayer: gambits,
  missionsPerPlayer: missions,
})

describe('gambit and mission data integrity', () => {
  it('keeps gambits and missions out of the trade deck entirely', () => {
    const s = withSides(2, 3)
    const sideRoles = new Set(['gambit', 'mission', 'token'])
    for (const c of s.tradeDeck) {
      expect(sideRoles.has(CARDS.get(c.def)!.role), CARDS.get(c.def)!.name).toBe(false)
    }
    for (const c of s.tradeRow) {
      if (c) expect(sideRoles.has(CARDS.get(c.def)!.role)).toBe(false)
    }
  })

  it('deals the asked-for number to each player, from one shared pile', () => {
    const s = withSides(2, 3)
    expect(s.players.p1.gambits).toHaveLength(2)
    expect(s.players.p2.gambits).toHaveLength(2)
    expect(s.players.p1.missions).toHaveLength(3)
    expect(s.players.p2.missions).toHaveLength(3)
    const all = [...s.players.p1.gambits, ...s.players.p2.gambits, ...s.unclaimedGambits]
    expect(new Set(all.map((c) => c.iid)).size).toBe(all.length)
  })

  it('deals none by default, so an existing game is unchanged', () => {
    const s = createGame({ matchId: 'x', seed: 'y', firstPlayer: 'p1' })
    expect(s.players.p1.gambits).toHaveLength(0)
    expect(s.players.p1.missions).toHaveLength(0)
    expect(s.unclaimedGambits).toHaveLength(0)
  })

  it('never shows one player the other\'s face-down cards', () => {
    const s = withSides(2, 3)
    const wire = JSON.stringify(redact(s, 'p1'))
    for (const c of s.players.p2.gambits) expect(wire).not.toContain(c.iid)
    for (const c of s.players.p2.missions) expect(wire).not.toContain(c.iid)
  })
})

describe('revealing a gambit', () => {
  it('spends a one-shot and keeps an ongoing one', () => {
    const s = scenario({ me: { hand: [], deck: ['scout'] } })
    s.players.p1.gambits = [
      { iid: 'g1' as never, def: D('surprise-assault') },
      { iid: 'g2' as never, def: D('frontier-fleet') },
    ]
    let st = run(s, { t: 'REVEAL_GAMBIT', card: 'g1' as never }).state
    expect(st.players.p1.combat).toBe(8)
    // One-shot: out of the game, not sitting face up.
    expect(st.players.p1.gambitsInPlay).toHaveLength(0)
    expect(st.scrapHeap.some((c) => c.iid === 'g1')).toBe(true)

    st = run(st, { t: 'REVEAL_GAMBIT', card: 'g2' as never }).state
    expect(st.players.p1.gambitsInPlay.map((c) => c.def)).toEqual([D('frontier-fleet')])
    expect(st.players.p1.gambits).toHaveLength(0)
  })

  it('pays an ongoing gambit at the start of every one of your turns', () => {
    const s = scenario({ me: { hand: [], deck: ['scout', 'scout', 'scout', 'scout', 'scout'] } })
    s.players.p1.gambits = [{ iid: 'g1' as never, def: D('frontier-fleet') }]
    let st = run(s, { t: 'REVEAL_GAMBIT', card: 'g1' as never }).state
    expect(st.players.p1.combat).toBe(0)   // nothing on reveal
    st = run(st, { t: 'END_TURN' }).state  // p2's turn
    expect(st.players.p1.combat).toBe(0)
    st = run(st, { t: 'END_TURN' }).state  // back to p1
    expect(st.players.p1.combat).toBe(1)
  })

  it('lets Energy Shield soak damage to the player but not to a base', () => {
    const s = scenario({
      me: { hand: [], combat: 5 },
      them: { inPlay: [inPlay('barter-world')] },
    })
    // Already revealed: revealing it costs a turn, and the turn boundary would
    // wipe the combat this test needs.
    s.players.p2.gambitsInPlay = [{ iid: 'g1' as never, def: D('energy-shield') }]

    // The base still takes its printed defence, unreduced.
    let st = run(s, { t: 'ATTACK_BASE', base: playIid(s, 'p2', 'barter-world') }).state
    expect(st.players.p2.inPlay).toHaveLength(0)
    expect(st.players.p1.combat).toBe(1)
    // The player takes one less, so a single point of combat bounces off.
    st = run(st, { t: 'ATTACK_PLAYER', amount: 1 }).state
    expect(st.players.p2.authority).toBe(50)
  })

  it('gives Veteran Pilots its bonus on a Viper and on nothing else', () => {
    const s = scenario({ me: { hand: ['viper', 'scout'] } })
    s.players.p1.gambits = [{ iid: 'g1' as never, def: D('veteran-pilots') }]
    let st = run(s, { t: 'REVEAL_GAMBIT', card: 'g1' as never }).state
    st = run(st, { t: 'PLAY_CARD', card: st.players.p1.hand.find((c) => c.def === D('scout'))!.iid }).state
    expect(st.players.p1.combat).toBe(0)
    st = run(st, { t: 'PLAY_CARD', card: st.players.p1.hand.find((c) => c.def === D('viper'))!.iid }).state
    // The Viper's own 1, plus the gambit's 2.
    expect(st.players.p1.combat).toBe(3)
  })
})

describe('missions', () => {
  it('is claimable exactly while its objective holds', () => {
    const s = scenario({
      me: { hand: [], inPlay: [inPlay('barter-world')], deck: ['scout', 'scout'] },
    })
    s.players.p1.missions = [{ iid: 'm1' as never, def: D('colonize') }]
    // One base: the objective is not met, so the action is not offered.
    expect(legalFor(s, 'p1').some((a) => a.t === 'CLAIM_MISSION')).toBe(false)
    expect(() => run(s, { t: 'CLAIM_MISSION', card: 'm1' as never })).toThrow()

    const two = scenario({
      me: {
        hand: [],
        // Two Trade Federation bases.
        inPlay: [inPlay('barter-world'), inPlay('trading-post')],
        deck: ['scout', 'scout'],
      },
    })
    two.players.p1.missions = [
      { iid: 'm1' as never, def: D('colonize') },
      // A second mission, so completing the first does not end the game.
      { iid: 'm2' as never, def: D('armada') },
    ]
    expect(legalFor(two, 'p1').some((a) => a.t === 'CLAIM_MISSION')).toBe(true)
    const st = run(two, { t: 'CLAIM_MISSION', card: 'm1' as never }).state
    expect(st.players.p1.missionsDone).toEqual([D('colonize')])
    expect(st.players.p1.hand).toHaveLength(2)      // the reward
  })

  it('wins the game when the last one is completed', () => {
    const s = scenario({
      me: { hand: [], inPlay: [inPlay('barter-world'), inPlay('trading-post')], deck: ['scout', 'scout'] },
    })
    s.players.p1.missions = [{ iid: 'm1' as never, def: D('colonize') }]
    const st = run(s, { t: 'CLAIM_MISSION', card: 'm1' as never }).state
    expect(st.winner).toBe('p1')
    expect(st.phase).toBe('gameOver')
  })

  it('counts what Diversify asks about: gains, not what is left', () => {
    const s = scenario({ me: { hand: [], trade: 0 } })
    s.players.p1.missions = [{ iid: 'm1' as never, def: D('diversify') }]
    s.players.p1.gainedThisTurn = { trade: 4, combat: 5, authority: 3 }
    // Spent down to nothing, but the gains still count.
    expect(legalFor(s, 'p1').some((a) => a.t === 'CLAIM_MISSION')).toBe(true)
  })
})

describe('Black Market', () => {
  it('widens the trade row and discounts once per turn for its owner', () => {
    const s = scenario({
      me: { hand: [], trade: 20 },
      tradeRow: ['cutter', 'ram', 'scout', 'viper', 'explorer'],
    })
    s.players.p1.gambits = [{ iid: 'g1' as never, def: D('black-market') }]
    let st = run(s, { t: 'REVEAL_GAMBIT', card: 'g1' as never }).state
    expect(st.tradeRow).toHaveLength(6)
    expect(st.blackMarketOwner).toBe('p1')

    const extra = st.tradeRow[5]!
    const printed = CARDS.get(extra.def)!.cost
    const before = st.players.p1.trade
    st = run(st, { t: 'BUY_CARD', card: extra.iid }).state
    expect(before - st.players.p1.trade).toBe(Math.max(0, printed - 1))
    // Once per turn: the next purchase from the same slot is full price.
    expect(st.blackMarketUsedThisTurn).toBe(true)
  })
})
