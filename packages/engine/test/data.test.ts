import { describe, expect, it } from 'vitest'
import { CARDS, tradeDeckComposition } from '../src/cards/registry'
import { FACTIONS, type Faction } from '../src/ids'

describe('base-set data integrity', () => {
  const tradeDeck = [...CARDS.values()].filter((c) => c.role === 'trade_deck')

  it('has exactly 46 distinct trade-deck cards', () => {
    expect(tradeDeck).toHaveLength(46)
  })

  it('has exactly 80 cards in the trade deck', () => {
    expect(tradeDeckComposition()).toHaveLength(80)
  })

  it('has exactly 20 cards per faction', () => {
    const byFaction: Partial<Record<Faction, number>> = {}
    for (const c of tradeDeck) byFaction[c.faction] = (byFaction[c.faction] ?? 0) + c.copies
    expect(byFaction).toEqual({
      trade_federation: 20,
      blob: 20,
      star_empire: 20,
      machine_cult: 20,
    })
  })

  it('never puts a trade-deck card in the unaligned faction', () => {
    expect(tradeDeck.every((c) => c.faction !== 'unaligned')).toBe(true)
  })

  it('gives every base a defense and every ship none', () => {
    for (const c of CARDS.values()) {
      if (c.type === 'ship') expect(c.defense, c.name).toBeNull()
      else expect(c.defense, c.name).toBeGreaterThan(0)
    }
  })

  it('gives every card something to do', () => {
    for (const c of CARDS.values()) {
      const hasSomething =
        c.primary.length > 0 || c.ally.length > 0 || c.scrap.length > 0 ||
        c.triggers.length > 0 || c.factionWildcard
      expect(hasSomething, `${c.name} does nothing`).toBe(true)
    }
  })

  it('uses only known factions', () => {
    for (const c of CARDS.values()) expect(FACTIONS).toContain(c.faction)
  })

  it('applies the four verified corrections', () => {
    // Command Ship's ally destroys a base MANDATORILY (min 1, no "you may").
    const cmd = CARDS.get('command-ship' as never)!
    expect(cmd.ally[0]).toEqual({ k: 'DESTROY_BASE', min: 1, max: 1 })

    // Fleet HQ is a TRIGGERED ability post-errata, with no activatable primary.
    const hq = CARDS.get('fleet-hq' as never)!
    expect(hq.primary).toHaveLength(0)
    expect(hq.triggers).toEqual([{ on: 'PLAY_SHIP', effects: [{ k: 'GAIN_COMBAT', n: 1 }] }])

    // Blob Wheel has 3 copies, not the 2 the wiki claims.
    expect(CARDS.get('blob-wheel' as never)!.copies).toBe(3)

    // Battle Pod's trade-row scrap is optional.
    expect(CARDS.get('battle-pod' as never)!.primary).toContainEqual(
      { k: 'SCRAP_TRADE_ROW', min: 0, max: 1 },
    )
  })
})
