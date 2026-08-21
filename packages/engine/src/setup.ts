import { EXPLORER, SCOUT, VIPER, tradeDeckComposition } from './cards/registry'
import type { CardDefId, CardIid, PlayerId } from './ids'
import { PLAYERS } from './ids'
import { nextHex, seedRng, shuffle, type RngState } from './rng'
import {
  ENGINE_VERSION, EXPLORER_PILE_SIZE, FIRST_TURN_HAND_SIZE, HAND_SIZE,
  STARTING_AUTHORITY, TRADE_ROW_SIZE,
  emptyFactionCounts, type CardInstance, type GameState, type PlayerState,
} from './state'

export interface MatchSetup {
  readonly matchId: string
  /** Hex string from a CSPRNG, generated OUTSIDE the engine. */
  readonly seed: string
  readonly firstPlayer: PlayerId
}

/** Card instance ids are drawn from the seeded stream, so setup is reproducible. */
function mint(rng: RngState, def: CardDefId): [CardInstance, RngState] {
  const [hex, next] = nextHex(rng, 12)
  return [{ iid: hex as CardIid, def }, next]
}

function mintAll(rng: RngState, defs: readonly CardDefId[]): [CardInstance[], RngState] {
  const out: CardInstance[] = []
  let s = rng
  for (const d of defs) {
    let c: CardInstance
    ;[c, s] = mint(s, d)
    out.push(c)
  }
  return [out, s]
}

function starterDeck(): CardDefId[] {
  return [...Array(8).fill(SCOUT), ...Array(2).fill(VIPER)] as CardDefId[]
}

function newPlayer(deck: CardInstance[]): PlayerState {
  return {
    authority: STARTING_AUTHORITY,
    deck,
    hand: [],
    discard: [],
    inPlay: [],
    shipsPlayedThisTurn: [],
    trade: 0,
    combat: 0,
    factionPlayedThisTurn: emptyFactionCounts(),
    allyUnlocked: [],
    pendingTopdeck: 0,
  }
}

/**
 * Build a fresh game.
 *
 * The one setup asymmetry: the first player draws 3 cards for their very first
 * turn, the second player draws 5. Every later hand is 5 for both.
 */
export function createGame(setup: MatchSetup): GameState {
  let rng = seedRng(setup.seed)

  const decks: Record<PlayerId, CardInstance[]> = { p1: [], p2: [] }
  for (const pid of PLAYERS) {
    let cards: CardInstance[]
    ;[cards, rng] = mintAll(rng, starterDeck())
    ;[cards, rng] = shuffle(rng, cards)
    decks[pid] = cards
  }

  let tradeDeck: CardInstance[]
  ;[tradeDeck, rng] = mintAll(rng, tradeDeckComposition())
  ;[tradeDeck, rng] = shuffle(rng, tradeDeck)

  const players: Record<PlayerId, PlayerState> = {
    p1: newPlayer(decks.p1),
    p2: newPlayer(decks.p2),
  }

  const tradeRow: (CardInstance | null)[] = []
  for (let i = 0; i < TRADE_ROW_SIZE; i++) tradeRow.push(tradeDeck.shift() ?? null)

  const second = setup.firstPlayer === 'p1' ? 'p2' : 'p1'
  for (let i = 0; i < FIRST_TURN_HAND_SIZE; i++) {
    const c = players[setup.firstPlayer].deck.shift()
    if (c) players[setup.firstPlayer].hand.push(c)
  }
  for (let i = 0; i < HAND_SIZE; i++) {
    const c = players[second].deck.shift()
    if (c) players[second].hand.push(c)
  }

  return {
    engineVersion: ENGINE_VERSION,
    matchId: setup.matchId,
    version: 0,
    turn: 1,
    activePlayer: setup.firstPlayer,
    phase: 'main',
    players,
    tradeRow,
    tradeDeck,
    explorerPile: EXPLORER_PILE_SIZE,
    scrapHeap: [],
    resolution: [],
    rng,
    winner: null,
  }
}

export { EXPLORER }
