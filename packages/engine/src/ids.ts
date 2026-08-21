/** Branded ids. The brand is erased at runtime -- these are all plain strings. */
type Brand<T, B> = T & { readonly __brand: B }

export type PlayerId = 'p1' | 'p2'
export const PLAYERS: readonly PlayerId[] = ['p1', 'p2']
export function opponentOf(p: PlayerId): PlayerId {
  return p === 'p1' ? 'p2' : 'p1'
}

/** Identifies a card *definition* (e.g. 'blob-fighter'). Public information. */
export type CardDefId = Brand<string, 'CardDefId'>
/**
 * Identifies a physical card *instance*. Deliberately random rather than
 * sequential: a sequential id in a hidden zone would let a client track a known
 * discard through a shuffle and reconstruct deck order.
 */
export type CardIid = Brand<string, 'CardIid'>
export type ChoiceId = Brand<string, 'ChoiceId'>

export type Faction =
  | 'trade_federation'
  | 'blob'
  | 'star_empire'
  | 'machine_cult'
  | 'unaligned'

export const FACTIONS: readonly Faction[] = [
  'trade_federation',
  'blob',
  'star_empire',
  'machine_cult',
  'unaligned',
]

export const FACTION_LABEL: Record<Faction, string> = {
  trade_federation: 'Trade Federation',
  blob: 'Blob',
  star_empire: 'Star Empire',
  machine_cult: 'Machine Cult',
  unaligned: 'Unaligned',
}

/**
 * Crisis adds two card types that are neither ships nor bases.
 *
 * A HERO goes straight into play when acquired, cannot be attacked or
 * destroyed, and waits there until you scrap it for its ability. An EVENT never
 * sits in the trade row at all: it resolves the instant it is turned up and is
 * replaced immediately.
 */
export type CardType = 'ship' | 'base' | 'outpost' | 'hero' | 'event'

/** Zones a card can occupy. `deck` and (an opponent's) `hand` are the hidden ones. */
export type Zone = 'deck' | 'hand' | 'discard' | 'inPlay' | 'tradeRow' | 'scrapHeap' | 'explorerPile'

export function asDefId(s: string): CardDefId {
  return s as CardDefId
}

/**
 * A physical card in a zone.
 *
 * Lives here, next to the ids, rather than in state.ts because the boss data
 * needs it and state.ts needs the boss type -- putting it in either one makes
 * the two import each other.
 */
export interface CardInstance {
  readonly iid: CardIid
  readonly def: CardDefId
}
