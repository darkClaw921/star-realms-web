import { describe, expect, it } from 'vitest'
import { CARDS, tradeDeckComposition } from '../src/cards/registry'
import { asDefId } from '../src/ids'
import { decline, handIid, inPlay, legalFor, pending, playIid, run, scenario } from './scenario'

const D = asDefId

describe('Stellar Allies and promo data integrity', () => {
  const packs = [
    { set: 'stellar-allies' as const, distinct: 8, copies: 12 },
    { set: 'promo-1' as const, distinct: 10, copies: 15 },
    { set: 'promo-year-2' as const, distinct: 6, copies: 9 },
  ]

  for (const pack of packs) {
    const cards = [...CARDS.values()].filter((c) => c.set === pack.set)

    it(`${pack.set} is ${pack.distinct} cards in ${pack.copies} copies`, () => {
      expect(cards).toHaveLength(pack.distinct)
      expect(tradeDeckComposition(undefined, [pack.set])).toHaveLength(pack.copies)
    })

    it(`${pack.set} collides with no other set`, () => {
      const others = new Set(
        [...CARDS.values()].filter((c) => c.set !== pack.set).map((c) => c.id),
      )
      for (const c of cards) expect(others.has(c.id), c.name).toBe(false)
    })
  }

  it('completes United\'s faction pairs with Alignment and Pact', () => {
    const pairs = [...CARDS.values()]
      .filter((c) => c.set === 'stellar-allies')
      .map((c) => [c.faction, c.faction2].sort().join('+'))
    expect(new Set(pairs)).toEqual(new Set([
      'machine_cult+star_empire',
      'blob+trade_federation',
    ]))
  })

  it('pins all four of Mercenary Garrison\'s allies, one per faction', () => {
    const g = CARDS.get('mercenary-garrison' as never)!
    expect(g.faction).toBe('unaligned')
    expect([g.allyFaction, g.ally2Faction, g.ally3Faction, g.ally4Faction].sort())
      .toEqual(['blob', 'machine_cult', 'star_empire', 'trade_federation'])
  })
})

describe('Mercenary Garrison', () => {
  it('offers exactly the slots whose factions are unlocked', () => {
    const s = scenario({
      me: {
        hand: ['cutter', 'federation-shuttle'],
        inPlay: [inPlay('mercenary-garrison')],
      },
    })
    // Nothing unlocked: an ally-only card with no primary has no move at all.
    expect(legalFor(s, 'p1').some((a) => a.t === 'ACTIVATE')).toBe(false)

    const st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'cutter') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'federation-shuttle') },
    ).state
    const garrison = playIid(st, 'p1', 'mercenary-garrison')
    const slots = legalFor(st, 'p1')
      .filter((a) => a.t === 'ACTIVATE' && a.card === garrison)
      .map((a) => (a as { slot: string }).slot)
    // Trade Federation only, which is the third slot.
    expect(slots).toEqual(['ally3'])

    const before = st.players.p1.authority
    const after = run(st, { t: 'ACTIVATE', card: garrison, slot: 'ally3' }).state
    expect(after.players.p1.authority).toBe(before + 3)
  })
})

describe('Needle Lancer', () => {
  it('copies an ally ability used earlier this turn without re-using the card', () => {
    // Needle Lancer is Machine Cult AND Star Empire, so playing it beside two
    // Machine Cult cards switches on both its own ally and Battle Mech's.
    const s = scenario({
      me: {
        hand: ['needle-lancer'],
        inPlay: [inPlay('missile-bot'), inPlay('battle-mech')],
        deck: ['scout', 'scout', 'scout'],
      },
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'needle-lancer') }).state
    expect(st.players.p1.combat).toBe(5)

    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'battle-mech'), slot: 'ally' }).state
    expect(st.players.p1.hand).toHaveLength(1)
    expect(st.players.p1.alliesUsedThisTurn).toHaveLength(1)

    st = run(st, {
      t: 'ACTIVATE', card: playIid(st, 'p1', 'needle-lancer'), slot: 'ally',
    }).state
    // One ability on the list, so the mandatory choice auto-resolves.
    expect(pending(st)).toBeNull()
    expect(st.players.p1.hand).toHaveLength(2)
    // The original card's own once-per-turn flag is untouched by the copy.
    expect(st.players.p1.inPlay.find((c) => c.def === D('battle-mech'))!.used.ally).toBe(true)
  })

  it('fizzles when no ally ability has been used yet', () => {
    const s = scenario({
      me: { hand: ['needle-lancer'], inPlay: [inPlay('missile-bot')] },
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'needle-lancer') }).state
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'needle-lancer'), slot: 'ally' }).state
    // A copy ability is not itself copyable, so it never joins the list.
    expect(st.players.p1.alliesUsedThisTurn).toEqual([])
    expect(pending(st)).toBeNull()
  })
})

describe('"if you played a base this turn"', () => {
  it('counts the base asking the question, and not one from a previous turn', () => {
    // Played this turn, including itself.
    const fresh = scenario({ me: { hand: ['breeding-site'] } })
    let st = run(fresh, { t: 'PLAY_CARD', card: handIid(fresh, 'p1', 'breeding-site') }).state
    st = run(st, {
      t: 'ACTIVATE', card: playIid(st, 'p1', 'breeding-site'), slot: 'primary',
    }).state
    expect(st.players.p1.combat).toBe(5)

    // Standing from an earlier turn, with no base played since: nothing.
    const standing = scenario({ me: { hand: [], inPlay: [inPlay('breeding-site')] } })
    const st2 = run(standing, {
      t: 'ACTIVATE', card: playIid(standing, 'p1', 'breeding-site'), slot: 'primary',
    }).state
    expect(st2.players.p1.combat).toBe(0)
  })
})

describe('Battle Barge', () => {
  it('adds its bonus only at two bases, and the return is optional', () => {
    const lean = scenario({ me: { hand: ['battle-barge'] }, them: { hand: [] } })
    let st = run(lean, { t: 'PLAY_CARD', card: handIid(lean, 'p1', 'battle-barge') }).state
    while (pending(st)) st = run(st, decline(st)).state
    expect(st.players.p1.combat).toBe(5)

    const heavy = scenario({
      me: { hand: ['battle-barge'], inPlay: [inPlay('barter-world'), inPlay('storage-silo')] },
      them: { hand: [] },
    })
    st = run(heavy, { t: 'PLAY_CARD', card: handIid(heavy, 'p1', 'battle-barge') }).state
    expect(st.players.p1.combat).toBe(8)
    expect(pending(st)?.prompt).toBe('RETURN_BASE_TO_HAND')
    expect(pending(st)?.min).toBe(0)
  })
})
