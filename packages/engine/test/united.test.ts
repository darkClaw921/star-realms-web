import { describe, expect, it } from 'vitest'
import { CARDS, tradeDeckComposition } from '../src/cards/registry'
import { asDefId } from '../src/ids'
import { byDef, choose, handIid, inPlay, legalFor, pending, playIid, run, scenario } from './scenario'

const D = asDefId

describe('United data integrity', () => {
  const packs = ['united-assault', 'united-command'] as const

  for (const set of packs) {
    const cards = [...CARDS.values()].filter((c) => c.set === set)

    it(`${set} is eight cards in twelve copies`, () => {
      expect(cards).toHaveLength(8)
      expect(tradeDeckComposition(undefined, [set])).toHaveLength(12)
    })

    it(`${set} is entirely dual-faction`, () => {
      for (const c of cards) {
        expect(c.faction2, c.name).toBeDefined()
        expect(c.faction2, c.name).not.toBe(c.faction)
      }
    })

    it(`${set} pins a second ally only where there is a second ability`, () => {
      for (const c of cards) {
        // A pinned slot must name one of the card's own factions.
        for (const f of [c.allyFaction, c.ally2Faction]) {
          if (f) expect([c.faction, c.faction2], c.name).toContain(f)
        }
        // ally2 without ally would be an unreachable second slot.
        if (c.ally2.length > 0) expect(c.ally.length, c.name).toBeGreaterThan(0)
        if (c.text.ally2) expect(c.ally2.length, c.name).toBeGreaterThan(0)
      }
    })
  }
})

describe('dual-faction cards count as both', () => {
  it('satisfies another faction ally on its own', () => {
    // Alliance Transport is Star Empire AND Trade Federation. With one Trade
    // Federation card beside it, the Cutter's ally is on.
    const s = scenario({ me: { hand: ['alliance-transport', 'cutter'] } })
    const st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'alliance-transport') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'cutter') },
    ).state
    expect(st.players.p1.allyUnlocked).toContain('trade_federation')
    expect(legalFor(st, 'p1').some(
      (a) => a.t === 'ACTIVATE' && a.card === playIid(st, 'p1', 'cutter') && a.slot === 'ally',
    )).toBe(true)
  })
})

describe('per-faction ally slots', () => {
  it('offers only the slot whose faction is unlocked, and both when both are', () => {
    // Star Empire beside it: only the Star Empire slot opens.
    const se = scenario({ me: { hand: ['alliance-transport', 'imperial-fighter'] } })
    let st = run(se,
      { t: 'PLAY_CARD', card: handIid(se, 'p1', 'alliance-transport') },
      { t: 'PLAY_CARD', card: handIid(se, 'p1', 'imperial-fighter') },
    ).state
    // Imperial Fighter's primary makes the opponent discard; clear the prompt.
    if (pending(st)) st = run(st, choose(st, () => true)).state
    const card = playIid(st, 'p1', 'alliance-transport')
    const slots = legalFor(st, 'p1')
      .filter((a) => a.t === 'ACTIVATE' && a.card === card)
      .map((a) => (a as { slot: string }).slot)
    expect(slots).toEqual(['ally'])

    st = run(st, { t: 'ACTIVATE', card, slot: 'ally' }).state
    expect(pending(st)?.actor).toBe('p2')       // the pinned Star Empire ability

    // Both factions present: both slots, and both usable in the same turn.
    const both = scenario({
      me: { hand: ['alliance-transport'], inPlay: [inPlay('imperial-fighter'), inPlay('cutter')] },
    })
    const st2 = run(both, { t: 'PLAY_CARD', card: handIid(both, 'p1', 'alliance-transport') }).state
    const c2 = playIid(st2, 'p1', 'alliance-transport')
    const slots2 = legalFor(st2, 'p1')
      .filter((a) => a.t === 'ACTIVATE' && a.card === c2)
      .map((a) => (a as { slot: string }).slot)
    expect(slots2.sort()).toEqual(['ally', 'ally2'])

    const st3 = run(st2, { t: 'ACTIVATE', card: c2, slot: 'ally2' }).state
    expect(st3.players.p1.authority).toBe(54)
  })

  it('opens an unpinned slot from either half of the pair', () => {
    // Assault Pod's "Union Ally (Blob or Star Empire)" is one ability that
    // either faction switches on.
    for (const partner of ['blob-fighter', 'imperial-fighter']) {
      const s = scenario({
        me: { hand: ['assault-pod'], inPlay: [inPlay(partner)], deck: ['scout'] },
      })
      const st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'assault-pod') }).state
      expect(legalFor(st, 'p1').some(
        (a) => a.t === 'ACTIVATE' && a.slot === 'ally',
      ), partner).toBe(true)
    }
  })
})

describe('Exchange Point', () => {
  it('scraps across hand, discard pile and the trade row in one choice', () => {
    const s = scenario({
      me: {
        hand: ['exchange-point', 'scout'],
        discard: ['viper'],
        inPlay: [inPlay('blob-fighter')],
      },
      tradeRow: ['cutter', 'ram', 'scout', 'viper', 'explorer'],
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'exchange-point') }).state
    st = run(st, {
      t: 'ACTIVATE', card: playIid(st, 'p1', 'exchange-point'), slot: 'ally',
    }).state
    // Own hand (1) + own discard (1) + the whole trade row (5).
    expect(pending(st)?.n).toBe(7)

    st = run(st, choose(st, byDef('cutter'))).state
    expect(st.scrapHeap.some((c) => c.def === D('cutter'))).toBe(true)
    // The row closes the gap: a scrapped slot is refilled, not left empty.
    expect(st.tradeRow.filter(Boolean)).toHaveLength(5)
    // Scrapping from the shared row has no owner, so it does not feed the
    // player's own "cards scrapped this turn" counter.
    expect(st.players.p1.scrappedThisTurn).toBe(0)
  })
})

describe('Coalition Messenger', () => {
  it('top-decks a cheap card from the discard pile, not an expensive one', () => {
    const s = scenario({
      me: {
        hand: ['coalition-messenger'],
        inPlay: [inPlay('cutter')],
        discard: ['command-ship', 'ram'],
      },
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'coalition-messenger') }).state
    st = run(st, {
      t: 'ACTIVATE', card: playIid(st, 'p1', 'coalition-messenger'), slot: 'ally',
    }).state
    // Command Ship costs 8, over the limit of five, so it is never offered --
    // leaving one option for a mandatory choice, which auto-resolves.
    expect(pending(st)).toBeNull()
    expect(st.players.p1.deck[0]?.def).toBe(D('ram'))
    expect(st.players.p1.discard.some((c) => c.def === D('command-ship'))).toBe(true)
  })
})
