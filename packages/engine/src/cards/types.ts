import type { CardDefId, CardType, Faction } from '../ids'
import type { Effect, Trigger } from '../effects'

/** How a card enters the game. Only `trade_deck` cards are shuffled into the trade deck. */
export type CardRole = 'trade_deck' | 'starter' | 'explorer'

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
  readonly scrap: string
}

export interface CardDef {
  readonly id: CardDefId
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
  /** Removes the card from play to the scrap heap. Once, optional. */
  readonly scrap: readonly Effect[]
  /** Fires on an event rather than being activated. Fleet HQ is the only base-set user. */
  readonly triggers: readonly Trigger[]
  /** Mech World: satisfies the ally condition of every faction at once. */
  readonly factionWildcard: boolean
  readonly text: CardText
}

export type CardRegistry = ReadonlyMap<CardDefId, CardDef>
