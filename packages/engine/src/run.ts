import { cardDef, tradeDeckComposition } from './cards/registry'
import type { SetId } from './cards/types'
import type { CardDefId, PlayerId } from './ids'
import { seedRng, shuffle } from './rng'
import type { ScenarioSetup } from './scenario'
import type { GameState } from './state'

/**
 * Забег -- a run: one deck carried through a ladder of fights.
 *
 * Everything else in this build hands you a fresh eight Scouts and two Vipers
 * every game. A run does not: the deck you finish a fight with is the deck you
 * start the next one with, your authority is not restored between fights, and
 * a loss ends the whole thing. That single change is what turns the deck from
 * something you rebuild each game into something you carry -- and it is why
 * scrapping, which is normally a tempo cost, becomes the main way you shape a
 * deck over eight fights.
 *
 * Ours, not the publisher's: Star Realms has no run mode. It is built out of
 * the ScenarioSetup vocabulary the campaign already speaks, so the reducer
 * learns nothing about runs -- an encounter is a mission whose opening position
 * happens to be computed from the last one instead of written down.
 *
 * Progress is NOT here. Where a run has got to is the player's, not the rules':
 * the same node with the same carried deck has to deal the same game whether it
 * is the first attempt or the tenth. The web layer persists it.
 */

export const RUN_LENGTH = 8

/** Authority you open a run with. Not restored between fights -- it IS the run. */
export const RUN_START_AUTHORITY = 50

/** What Ремонт puts back. */
export const RUN_REPAIR = 8

export type RunNodeKind = 'battle' | 'elite' | 'boss'

export interface RunNode {
  /** 1-based position in the ladder. */
  readonly index: number
  readonly kind: RunNodeKind
  readonly enemyAuthority: number
  /** Combat and trade the enemy is handed at the start of each of its turns. */
  readonly enemyCombat: number
  readonly enemyTrade: number
  readonly enemyBases: readonly CardDefId[]
  /** Replaces the enemy's starting deck. Absent means the printed 8/2. */
  readonly enemyDeck?: readonly CardDefId[]
  /**
   * Cost band the reward cards are drawn from, inclusive.
   *
   * A band rather than a cap: by the back half of a run a 1-cost Scout upgrade
   * is not a reward, it is a card you would scrap. The floor is what keeps the
   * offer meaningful once the deck is good.
   */
  readonly offerCost: readonly [number, number]
}

const ids = (...xs: string[]): CardDefId[] => xs as CardDefId[]

const SCOUT = 'scout' as CardDefId
const VIPER = 'viper' as CardDefId

/**
 * The enemy's own deck on the hardest nodes.
 *
 * Ten cards, like any starting deck, so the draw stays honest -- the enemy is
 * dangerous because its deck is better, not because it holds more cards.
 */
const ELITE_DECK = ids(
  'scout', 'scout', 'scout', 'scout',
  'viper', 'viper',
  'imperial-fighter', 'imperial-frigate', 'battle-pod', 'trade-bot',
)
const BOSS_DECK = ids(
  'scout', 'scout', 'viper', 'viper',
  'battlecruiser', 'blob-destroyer', 'battle-mech', 'ram',
  'trade-escort', 'freighter',
)

/**
 * The ladder.
 *
 * Escalation has to outrun a deck that only ever improves, so every node moves
 * more than one dial: authority, income, and something standing on the table.
 * The bases are the part that actually forces a rebuild -- an outpost means the
 * combat you were pointing at their face stops landing until you deal with it.
 */
export const RUN_LADDER: readonly RunNode[] = [
  {
    index: 1, kind: 'battle',
    enemyAuthority: 40, enemyCombat: 0, enemyTrade: 0, enemyBases: [],
    offerCost: [1, 4],
  },
  {
    index: 2, kind: 'battle',
    enemyAuthority: 45, enemyCombat: 1, enemyTrade: 1, enemyBases: [],
    offerCost: [1, 5],
  },
  {
    index: 3, kind: 'battle',
    enemyAuthority: 50, enemyCombat: 2, enemyTrade: 1,
    enemyBases: ids('defense-center'),
    offerCost: [2, 6],
  },
  {
    index: 4, kind: 'elite',
    enemyAuthority: 55, enemyCombat: 2, enemyTrade: 2,
    enemyBases: ids('trading-post'),
    enemyDeck: ELITE_DECK,
    offerCost: [2, 6],
  },
  {
    index: 5, kind: 'battle',
    enemyAuthority: 60, enemyCombat: 3, enemyTrade: 2,
    enemyBases: ids('the-hive'),
    offerCost: [3, 7],
  },
  {
    index: 6, kind: 'elite',
    enemyAuthority: 65, enemyCombat: 3, enemyTrade: 3,
    enemyBases: ids('blob-wheel', 'space-station'),
    enemyDeck: ELITE_DECK,
    offerCost: [3, 8],
  },
  {
    index: 7, kind: 'elite',
    enemyAuthority: 70, enemyCombat: 4, enemyTrade: 3,
    enemyBases: ids('mech-world'),
    enemyDeck: ELITE_DECK,
    offerCost: [4, 8],
  },
  {
    index: 8, kind: 'boss',
    enemyAuthority: 90, enemyCombat: 5, enemyTrade: 4,
    enemyBases: ids('brain-world', 'fleet-hq'),
    enemyDeck: BOSS_DECK,
    offerCost: [4, 8],
  },
]

export function runNode(index: number): RunNode | null {
  return RUN_LADDER.find((n) => n.index === index) ?? null
}

/** The player is always p1 in a run, and always moves first. */
export const RUN_HERO: PlayerId = 'p1'

/**
 * What survives a fight and goes into the next one.
 *
 * Bases are kept apart from the deck because they carry differently: a base
 * still standing when the fight ends is still standing when the next one opens,
 * while a destroyed one went to the discard pile and is simply a card again.
 */
export interface RunCarry {
  /** The whole personal deck, flattened -- draw pile, hand and discard alike. */
  readonly deck: readonly CardDefId[]
  /** Bases and outposts left standing. */
  readonly bases: readonly CardDefId[]
  readonly authority: number
}

export function runStartCarry(): RunCarry {
  return {
    deck: [...Array<CardDefId>(8).fill(SCOUT), ...Array<CardDefId>(2).fill(VIPER)],
    bases: [],
    authority: RUN_START_AUTHORITY,
  }
}

/**
 * Reads the deck out of a finished game.
 *
 * Note what this does NOT collect: the scrap heap. A card you scrapped during a
 * fight is gone from the run, which is the whole reason scrapping is worth
 * doing here -- in an ordinary game thinning pays off for twenty minutes, in a
 * run it pays off for the rest of the ladder.
 */
export function harvestRun(state: GameState, hero: PlayerId = RUN_HERO): RunCarry {
  const p = state.players[hero]
  const deck: CardDefId[] = []
  const bases: CardDefId[] = []
  for (const c of p.deck) deck.push(c.def)
  for (const c of p.hand) deck.push(c.def)
  for (const c of p.discard) deck.push(c.def)
  for (const c of p.inPlay) {
    const t = cardDef(c.def).type
    if (t === 'base' || t === 'outpost') bases.push(c.def)
    else deck.push(c.def)
  }
  return { deck, bases, authority: Math.max(0, p.authority) }
}

/** The opening position for one node, built from what the last one left you. */
export function runSetup(node: RunNode, carry: RunCarry): ScenarioSetup {
  return {
    rules: {
      id: `run-${node.index}`,
      hero: RUN_HERO,
      objective: { k: 'AUTHORITY' },
      turnStartCombat: { p1: 0, p2: node.enemyCombat },
      turnStartTrade: { p1: 0, p2: node.enemyTrade },
    },
    authority: { p1: carry.authority, p2: node.enemyAuthority },
    starterDeck: {
      p1: [...carry.deck],
      ...(node.enemyDeck ? { p2: [...node.enemyDeck] } : {}),
    },
    startingBases: {
      ...(carry.bases.length ? { p1: [...carry.bases] } : {}),
      ...(node.enemyBases.length ? { p2: [...node.enemyBases] } : {}),
    },
    tradeDeckOnly: null,
  }
}

/** What a win pays. Exactly one of the three is taken. */
export type RunReward =
  /** Add this card to the deck. */
  | { readonly k: 'CARD'; readonly def: CardDefId }
  /** Remove one copy of this card from the deck, for good. */
  | { readonly k: 'SCRAP'; readonly def: CardDefId }
  | { readonly k: 'REPAIR'; readonly n: number }

/** How many cards a win offers to choose between. */
export const RUN_OFFER_SIZE = 3

/**
 * The three cards offered after a win.
 *
 * Derived from the run's seed and the node, so the offer is fixed the moment
 * the run is rolled: a player who reloads the page must not get to re-roll a
 * reward they did not like.
 */
export function runOffer(
  seed: string,
  node: RunNode,
  sets: readonly SetId[] = ['core'],
): CardDefId[] {
  const [lo, hi] = node.offerCost
  const seen = new Set<string>()
  const pool: CardDefId[] = []
  // The composition, deduped: the offer is a choice between cards, and the same
  // card twice in a row of three is not a choice.
  for (const id of tradeDeckComposition(undefined, sets)) {
    if (seen.has(id)) continue
    const def = cardDef(id)
    if (def.cost < lo || def.cost > hi) continue
    seen.add(id)
    pool.push(id)
  }
  const [shuffled] = shuffle(seedRng(`${seed}:offer:${node.index}`), pool)
  return shuffled.slice(0, RUN_OFFER_SIZE)
}

export function applyReward(carry: RunCarry, r: RunReward): RunCarry {
  if (r.k === 'REPAIR') return { ...carry, authority: carry.authority + r.n }
  if (r.k === 'CARD') return { ...carry, deck: [...carry.deck, r.def] }
  const at = carry.deck.indexOf(r.def)
  if (at < 0) return carry
  return { ...carry, deck: [...carry.deck.slice(0, at), ...carry.deck.slice(at + 1)] }
}

/**
 * Which cards the deck can afford to lose.
 *
 * Anything at all, including the good ones -- a player who wants a two-card
 * deck has earned the right to find out how that goes. The one rule is that the
 * deck may not be emptied: a deck of nothing draws nothing and the fight would
 * never end.
 */
export function scrappable(carry: RunCarry): CardDefId[] {
  if (carry.deck.length <= 1) return []
  const seen = new Set<string>()
  return carry.deck.filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
}
