/** Branded ids. The brand is erased at runtime -- these are all plain strings. */
type Brand<T, B> = T & { readonly __brand: B }

/**
 * A seat at the table.
 *
 * Five, because the widest thing this engine deals is a four-player co-op
 * Challenge plus the Boss, and the Boss occupies an ordinary seat -- it holds
 * authority, bases and (for the deck bosses) a hand and a deck, so giving it
 * anything other than a PlayerState would mean writing every rule twice.
 *
 * A seat existing is not a seat being IN the game: `GameState.seats` is the
 * authority on who is playing. Iterating seats rather than this list is what
 * keeps a two-player game exactly two players.
 */
export type PlayerId = 'p1' | 'p2' | 'p3' | 'p4' | 'p5'
export const ALL_SEATS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4', 'p5']

/**
 * The two seats of an ordinary duel.
 *
 * Kept because a duel is still the common case and reads better as a constant;
 * anything that has to work for a co-op table must iterate `state.seats`.
 */
export const PLAYERS: readonly PlayerId[] = ['p1', 'p2']

/**
 * The other seat OF A DUEL. Not defined for a table with more than two seats --
 * there, who your foe is depends on the game (in co-op it is always the Boss),
 * which is a question about state, so `foeOf(state, seat)` answers it instead.
 */
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
 * Three card types that are neither ships nor bases.
 *
 * A HERO (Crisis, United) goes straight into play when acquired, cannot be
 * attacked or destroyed, and waits there until you scrap it for its ability. An
 * EVENT (Crisis) never sits in the trade row at all: it resolves the instant it
 * is turned up and is replaced immediately. A TECH (High Alert) also goes
 * straight into play, but unlike a Hero it is never spent: you pay trade to use
 * its ability, once per turn, for the rest of the game.
 */
export type CardType = 'ship' | 'base' | 'outpost' | 'hero' | 'event' | 'tech'

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
  /**
   * Забег: сколько раз ЭТУ копию улучшали.
   *
   * На экземпляре, а не на определении: улучшают одну карту, а не все копии
   * сразу, и две гадюки в одной колоде — разные предметы. Необязательное поле,
   * потому что вне забега улучшений не бывает вовсе, и обычная партия не должна
   * таскать по проводу ноль на каждой карте.
   */
  readonly up?: number
}
