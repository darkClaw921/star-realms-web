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
  /** Frontiers: needs TWO other cards of the faction, not one. */
  readonly doubleAlly?: string
  readonly scrap: string
}

export interface CardDef {
  readonly id: CardDefId
  readonly set: SetId
  readonly name: string
  readonly faction: Faction
  readonly cost: number
  readonly type: CardType
  /** null for ships. */
  readonly defense: number | null
  /** Copies in the 80-card trade deck. 0 for starters and Explorer. */
  readonly copies: number
  readonly role: CardRole
  /** Ships: resolved immediately and mandatorily on play. Bases: activatable once per turn. */
  readonly primary: readonly Effect[]
  /** Needs another card of the same faction in play. Once per turn, optional. */
  readonly ally: readonly Effect[]
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
  Omit<CardDef, 'id' | 'set' | 'ally' | 'doubleAlly' | 'scrap' | 'triggers' | 'factionWildcard'> &
  Partial<Pick<CardDef, 'set' | 'ally' | 'doubleAlly' | 'scrap' | 'triggers' | 'factionWildcard'>>

/** Fills in everything a spec leaves out. Shared by every set's card table. */
export function buildDefs(defs: Record<string, Spec>, set: SetId): [CardDefId, CardDef][] {
  return Object.entries(defs).map(([id, s]) => [
    asDefId(id),
    {
      id: asDefId(id),
      set: s.set ?? set,
      ...s,
      ally: s.ally ?? [],
      doubleAlly: s.doubleAlly ?? [],
      scrap: s.scrap ?? [],
      triggers: s.triggers ?? [],
      factionWildcard: s.factionWildcard ?? false,
    } satisfies CardDef,
  ])
}
