import { asDefId, type CardDefId, type CardType, type Faction } from '../ids'
import type { Effect, Trigger } from '../effects'

/** How a card enters the game. Only `trade_deck` cards are shuffled into the trade deck. */
export type CardRole = 'trade_deck' | 'starter' | 'explorer'

/**
 * Which product a card comes from.
 *
 * The point of carrying this on the card rather than in a separate list is that
 * turning a set on or off is then a filter over the registry, and a card can
 * never end up in a deck whose set is disabled.
 */
export type SetId =
  | 'core'
  | 'frontiers'
  | 'colony-wars'
  | 'crisis-bases'
  | 'crisis-fleets'
  | 'crisis-heroes'
  | 'crisis-events'
  | 'united-assault'
  | 'united-command'
  | 'united-heroes'
  | 'high-alert-first-strike'
  | 'high-alert-tech'
  | 'high-alert-requisition'
  | 'high-alert-invasion'
  | 'high-alert-heroes'

/**
 * Printed card text, as tokens. `{trade:2}` / `{combat:4}` / `{authority:3}` are
 * replaced with icons by the renderer.
 *
 * Kept separate from `Effect[]`: effects are what the engine executes, this is what
 * the player reads. Text is NEVER parsed to drive game logic -- the arrow only ever
 * points effects -> text.
 */
export interface CardText {
  readonly primary: string
  readonly ally: string
  /** United: the second faction's ally ability on a dual-faction card. */
  readonly ally2?: string
  /** Frontiers: needs TWO other cards of the faction, not one. */
  readonly doubleAlly?: string
  readonly scrap: string
}

export interface CardDef {
  readonly id: CardDefId
  readonly set: SetId
  readonly name: string
  readonly faction: Faction
  /**
   * United: a card can belong to TWO factions at once. It counts as both for
   * every ally condition, and each faction may carry its own ally ability.
   */
  readonly faction2?: Faction
  readonly cost: number
  readonly type: CardType
  /** null for ships. */
  readonly defense: number | null
  /** Copies in the 80-card trade deck. 0 for starters and Explorer. */
  readonly copies: number
  /**
   * High Alert: "Pay 1 Trade less to acquire this card for each <faction> card
   * you have in play." A discount, never a surcharge, and it floors at zero.
   */
  readonly discount?: { readonly faction: Faction; readonly per: number }
  /**
   * High Alert's Tech: the trade you must pay to use the primary. A Tech is not
   * spent by using it, so this is the whole of what limits it -- that and once
   * per turn.
   */
  readonly primaryCost?: number
  readonly role: CardRole
  /** Ships: resolved immediately and mandatorily on play. Bases: activatable once per turn. */
  readonly primary: readonly Effect[]
  /** Needs another card of the same faction in play. Once per turn, optional. */
  readonly ally: readonly Effect[]
  /**
   * Which faction unlocks `ally`. Undefined means "any of this card's own
   * factions" -- which is both the ordinary single-faction case and United's
   * "Coalition Ally (Machine Cult or Trade Federation)", where either will do.
   */
  readonly allyFaction?: Faction
  /** United: the second faction's ally ability. Independent of `ally`. */
  readonly ally2: readonly Effect[]
  readonly ally2Faction?: Faction
  /**
   * Frontiers' Double Ally: needs TWO other cards of the faction, so three of
   * that faction in play counting this one. A separate slot rather than a flag
   * on `ally` because both can be used in the same turn.
   */
  readonly doubleAlly: readonly Effect[]
  /** Removes the card from play to the scrap heap. Once, optional. */
  readonly scrap: readonly Effect[]
  /** Fires on an event rather than being activated. Fleet HQ is the only base-set user. */
  readonly triggers: readonly Trigger[]
  /** Mech World: satisfies the ally condition of every faction at once. */
  readonly factionWildcard: boolean
  readonly text: CardText
}

export type CardRegistry = ReadonlyMap<CardDefId, CardDef>

/**
 * A card table entry with the boilerplate left out.
 *
 * Lives here rather than in registry.ts so that a set's card table can import
 * it without importing the registry that imports the set.
 */
export type Spec =
  Omit<CardDef,
    'id' | 'set' | 'ally' | 'ally2' | 'doubleAlly' | 'scrap' | 'triggers' | 'factionWildcard'> &
  Partial<Pick<CardDef,
    'set' | 'ally' | 'ally2' | 'doubleAlly' | 'scrap' | 'triggers' | 'factionWildcard'>>

/** Fills in everything a spec leaves out. Shared by every set's card table. */
export function buildDefs(defs: Record<string, Spec>, set: SetId): [CardDefId, CardDef][] {
  return Object.entries(defs).map(([id, s]) => [
    asDefId(id),
    {
      id: asDefId(id),
      set: s.set ?? set,
      ...s,
      ally: s.ally ?? [],
      ally2: s.ally2 ?? [],
      doubleAlly: s.doubleAlly ?? [],
      scrap: s.scrap ?? [],
      triggers: s.triggers ?? [],
      factionWildcard: s.factionWildcard ?? false,
    } satisfies CardDef,
  ])
}
