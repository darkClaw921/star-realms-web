import { describe, expect, it } from 'vitest'
import { CARDS, tradeDeckComposition } from '../src/cards/registry'
import { FACTIONS, type Faction } from '../src/ids'

describe('base-set data integrity', () => {
  // The registry now holds every set, so this suite has to say which one it is
  // checking. A card that lost its `set` would show up here as a count error.
  const tradeDeck = [...CARDS.values()]
    .filter((c) => c.role === 'trade_deck' && c.set === 'core')

  it('has exactly 46 distinct trade-deck cards', () => {
    expect(tradeDeck).toHaveLength(46)
  })

  it('has exactly 80 cards in the trade deck', () => {
    expect(tradeDeckComposition()).toHaveLength(80)
  })

  it('deals only base-set cards unless another set is switched on', () => {
    const core = new Set(tradeDeck.map((c) => c.id))
    for (const id of tradeDeckComposition()) expect(core.has(id)).toBe(true)
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


/**
 * Star Realms: Frontiers.
 *
 * The same three checks the base set gets, against the same source: the
 * publisher's Card Gallery spreadsheet, cross-checked with the contents list on
 * page 2 of the Frontiers rulebook.
 */
describe('Frontiers data integrity', () => {
  const frontiers = [...CARDS.values()]
    .filter((c) => c.role === 'trade_deck' && c.set === 'frontiers')

  it('has exactly 45 distinct trade-deck cards', () => {
    expect(frontiers).toHaveLength(45)
  })

  it('has exactly 80 copies, 20 per faction', () => {
    expect(tradeDeckComposition(undefined, ['frontiers'])).toHaveLength(80)
    const byFaction: Partial<Record<Faction, number>> = {}
    for (const c of frontiers) byFaction[c.faction] = (byFaction[c.faction] ?? 0) + c.copies
    expect(byFaction).toEqual({
      trade_federation: 20,
      blob: 20,
      star_empire: 20,
      machine_cult: 20,
    })
  })

  it('combines with the base set into a 160-card deck', () => {
    expect(tradeDeckComposition(undefined, ['core', 'frontiers'])).toHaveLength(160)
  })

  it('gives every card an ability and printed text', () => {
    for (const c of frontiers) {
      expect(c.primary.length + c.ally.length + c.doubleAlly.length + c.scrap.length)
        .toBeGreaterThan(0)
      expect(c.text.primary.length).toBeGreaterThan(0)
      // A double ally without an ally would be unreachable: you cannot have
      // three of a faction without first having two.
      if (c.doubleAlly.length > 0) expect(c.ally.length).toBeGreaterThan(0)
      // And every printed slot has to have effects behind it, or the card lies.
      if (c.text.doubleAlly) expect(c.doubleAlly.length).toBeGreaterThan(0)
      if (c.text.ally) expect(c.ally.length).toBeGreaterThan(0)
      if (c.text.scrap) expect(c.scrap.length).toBeGreaterThan(0)
    }
  })

  it('gives bases a defense and ships none', () => {
    for (const c of frontiers) {
      if (c.type === 'ship') expect(c.defense).toBeNull()
      else expect(c.defense).toBeGreaterThan(0)
    }
  })

  it('has no id colliding with the base set', () => {
    const core = new Set([...CARDS.values()].filter((c) => c.set === 'core').map((c) => c.id))
    for (const c of frontiers) expect(core.has(c.id)).toBe(false)
  })
})


/**
 * Star Realms: Colony Wars.
 *
 * A standalone base set rather than an add-on, so the same 80/20-per-faction
 * shape as the core set -- but it ships its own Scouts, Vipers and Explorers,
 * which we deliberately do NOT duplicate. Enabling it therefore adds exactly the
 * trade deck, which is what the combined-count check pins down.
 */
describe('Colony Wars data integrity', () => {
  const cw = [...CARDS.values()]
    .filter((c) => c.role === 'trade_deck' && c.set === 'colony-wars')

  it('has exactly 43 distinct trade-deck cards', () => {
    expect(cw).toHaveLength(43)
  })

  it('has exactly 80 copies, 20 per faction', () => {
    expect(tradeDeckComposition(undefined, ['colony-wars'])).toHaveLength(80)
    const byFaction: Partial<Record<Faction, number>> = {}
    for (const c of cw) byFaction[c.faction] = (byFaction[c.faction] ?? 0) + c.copies
    expect(byFaction).toEqual({
      trade_federation: 20,
      blob: 20,
      star_empire: 20,
      machine_cult: 20,
    })
  })

  it('adds only its trade deck, never a second set of starters', () => {
    expect(tradeDeckComposition(undefined, ['core', 'colony-wars'])).toHaveLength(160)
    expect(cw.some((c) => c.role !== 'trade_deck')).toBe(false)
  })

  it('gives every card an ability and printed text', () => {
    for (const c of cw) {
      expect(c.primary.length + c.ally.length + c.scrap.length + c.triggers.length,
        `${c.name} does nothing`).toBeGreaterThan(0)
      expect(c.text.primary.length, c.name).toBeGreaterThan(0)
      if (c.text.ally) expect(c.ally.length, c.name).toBeGreaterThan(0)
      if (c.text.scrap) expect(c.scrap.length, c.name).toBeGreaterThan(0)
    }
  })

  it('gives bases a defense and ships none', () => {
    for (const c of cw) {
      if (c.type === 'ship') expect(c.defense, c.name).toBeNull()
      else expect(c.defense, c.name).toBeGreaterThan(0)
    }
  })

  it('has no id colliding with any other set', () => {
    const others = new Set(
      [...CARDS.values()].filter((c) => c.set !== 'colony-wars').map((c) => c.id),
    )
    for (const c of cw) expect(others.has(c.id), c.name).toBe(false)
  })

  it('carries the four acquire-to-hand triggers, one per faction', () => {
    const withTrigger = cw.filter((c) => c.triggers.some((t) => t.on === 'ACQUIRE_SELF'))
    expect(withTrigger.map((c) => c.faction).sort()).toEqual(
      ['blob', 'machine_cult', 'star_empire', 'trade_federation'],
    )
  })
})
