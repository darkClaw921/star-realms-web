import { CARDS, cardDef, EXPLORER, SCOUT, VIPER, tradeDeckComposition } from './cards/registry'
import { COMMAND_DECKS, type CommandDeckSpec } from './cards/commandDecks'
import type { CardDefId, CardIid, PlayerId } from './ids'
import type { BossState } from './boss'
import type { SetId } from './cards/types'
import type { ScenarioSetup } from './scenario'
import { asDefId, opponentOf, PLAYERS } from './ids'
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
  /** A campaign mission, or absent for the standard game. */
  readonly scenario?: ScenarioSetup | undefined
  /** A Frontiers Challenge boss, or absent. */
  readonly boss?: BossState | undefined
  /**
   * Which card sets are in the trade deck. Defaults to the base set alone, so
   * an existing caller keeps dealing exactly the game it dealt before.
   */
  readonly sets?: readonly SetId[] | undefined
  /**
   * Gambits dealt face down to each player, from the gambit sets that are
   * switched on. Zero -- the default -- means playing without gambits at all,
   * which is what the printed rule leaves you to choose.
   */
  readonly gambitsPerPlayer?: number | undefined
  /**
   * Missions dealt face down to each player. Three is the printed number, and
   * completing all of yours wins the game, so this doubles as switching the
   * alternate win condition on.
   */
  readonly missionsPerPlayer?: number | undefined
  /**
   * A Command Deck per seat. Replaces that player's starting deck, sets their
   * hand size and starting authority from the Legendary Commander, deals them
   * its two gambits, and shuffles its megaship into the trade deck.
   */
  readonly commandDeck?: Partial<Record<PlayerId, string>> | undefined
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

function newPlayer(deck: CardInstance[], authority: number): PlayerState {
  return {
    authority,
    deck,
    hand: [],
    discard: [],
    inPlay: [],
    shipsPlayedThisTurn: [],
    trade: 0,
    combat: 0,
    factionPlayedThisTurn: emptyFactionCounts(),
    allyUnlocked: [],
    doubleAllyUnlocked: [],
    pendingRedirects: [],
    phantomFactions: [],
    gambits: [],
    gambitsInPlay: [],
    missions: [],
    missionsDone: [],
    gainedThisTurn: { trade: 0, combat: 0, authority: 0 },
    gainedAuthorityThisTurn: false,
    pendingDiscounts: [],
    alliesUsedThisTurn: [],
    scrappedThisTurn: 0,
    returnAtEndOfTurn: [],
    handSize: HAND_SIZE,
    commander: null,
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
  const sc = setup.scenario

  // A Command Deck replaces the starting deck outright, so it is resolved before
  // anything is minted.
  const cmd: Partial<Record<PlayerId, CommandDeckSpec>> = {}
  for (const pid of PLAYERS) {
    const id = setup.commandDeck?.[pid]
    const spec = id ? COMMAND_DECKS.find((c) => c.id === id) : undefined
    if (spec) cmd[pid] = spec
  }

  const decks: Record<PlayerId, CardInstance[]> = { p1: [], p2: [] }
  for (const pid of PLAYERS) {
    let cards: CardInstance[]
    const personal = cmd[pid]?.deck.map((x) => asDefId(x))
    ;[cards, rng] = mintAll(rng, personal ?? sc?.starterDeck[pid] ?? starterDeck())
    // A stacked deck stays stacked: Blob Assault's ten cards are dealt in the
    // order the rulebook prints them, and shuffling would erase the challenge.
    if (!sc?.unshuffled?.includes(pid)) [cards, rng] = shuffle(rng, cards)
    decks[pid] = cards
  }

  let tradeDeck: CardInstance[]
  const sets = setup.sets ?? ['core']
  ;[tradeDeck, rng] = mintAll(rng, tradeDeckComposition(sc?.tradeDeckOnly ?? undefined, sets))
  // Each Command Deck contributes exactly one card to the shared trade deck:
  // its eight-cost megaship. Both players' megaships go in, which is what makes
  // a mirror match still contain two of them.
  for (const pid of PLAYERS) {
    const ship = cmd[pid]?.megaship
    if (!ship) continue
    let one: CardInstance[]
    ;[one, rng] = mintAll(rng, [asDefId(ship)])
    tradeDeck.push(...one)
  }
  ;[tradeDeck, rng] = shuffle(rng, tradeDeck)

  const startingAuthority = (pid: PlayerId): number => {
    const c = cmd[pid]
    if (c) return cardDef(asDefId(c.commander)).commander?.authority ?? STARTING_AUTHORITY
    return sc?.authority[pid] ?? STARTING_AUTHORITY
  }
  const players: Record<PlayerId, PlayerState> = {
    p1: newPlayer(decks.p1, startingAuthority('p1')),
    p2: newPlayer(decks.p2, startingAuthority('p2')),
  }

  // The commander sets the hand size, and its two gambits are dealt face up in
  // hand terms but face down like any other gambit: they start unrevealed.
  for (const pid of PLAYERS) {
    const c = cmd[pid]
    if (!c) continue
    const def = cardDef(asDefId(c.commander))
    players[pid].commander = def.id
    players[pid].handSize = def.commander?.handSize ?? HAND_SIZE
    let gs: CardInstance[]
    ;[gs, rng] = mintAll(rng, c.gambits.map((x) => asDefId(x)))
    players[pid].gambits.push(...gs)
  }

  // Cards that open in a discard pile (Blob Assault's face-up Spike Cluster).
  for (const pid of PLAYERS) {
    for (const def of sc?.startingDiscard?.[pid] ?? []) {
      let c: CardInstance
      ;[c, rng] = mint(rng, def)
      players[pid].discard.push(c)
    }
  }

  // Bases a mission starts you (or the boss) with. They are already standing,
  // so playedThisTurn is false and their abilities are available immediately --
  // exactly like a base held over from a previous turn.
  for (const pid of PLAYERS) {
    for (const def of sc?.startingBases[pid] ?? []) {
      let c: CardInstance
      ;[c, rng] = mint(rng, def)
      players[pid].inPlay.push({
        iid: c.iid, def: c.def, copiedDef: null, chosenFaction: null,
        used: {
      primary: false, ally: false, ally2: false, ally3: false, ally4: false,
      doubleAlly: false, scrap: false, splinter: false,
    },
        playedThisTurn: false,
      })
    }
  }

  // Gambits and missions are dealt from their own piles, never shuffled into
  // the trade deck. Both are secret, so both are dealt before anything public.
  let unclaimedGambits: CardInstance[] = []
  const enabled = new Set<SetId>(setup.sets ?? ['core'])
  const sideCards = (role: 'gambit' | 'mission'): CardDefId[] => {
    const out: CardDefId[] = []
    for (const def of CARDS.values()) {
      if (def.role !== role || !enabled.has(def.set)) continue
      for (let i = 0; i < def.copies; i++) out.push(def.id)
    }
    return out
  }

  const gambitCount = setup.gambitsPerPlayer ?? 0
  if (gambitCount > 0) {
    ;[unclaimedGambits, rng] = mintAll(rng, sideCards('gambit'))
    ;[unclaimedGambits, rng] = shuffle(rng, unclaimedGambits)
    for (const pid of PLAYERS) {
      for (let i = 0; i < gambitCount; i++) {
        const c = unclaimedGambits.shift()
        if (c) players[pid].gambits.push(c)
      }
    }
  }

  const missionCount = setup.missionsPerPlayer ?? 0
  if (missionCount > 0) {
    let pool: CardInstance[]
    ;[pool, rng] = mintAll(rng, sideCards('mission'))
    ;[pool, rng] = shuffle(rng, pool)
    for (const pid of PLAYERS) {
      for (let i = 0; i < missionCount; i++) {
        const c = pool.shift()
        if (c) players[pid].missions.push(c)
      }
    }
  }

  const tradeRow: (CardInstance | null)[] = []
  for (let i = 0; i < TRADE_ROW_SIZE; i++) tradeRow.push(tradeDeck.shift() ?? null)

  const second = setup.firstPlayer === 'p1' ? 'p2' : 'p1'
  // The first player's short opening hand is two fewer than their normal one,
  // which is what FIRST_TURN_HAND_SIZE is against the standard five -- so a
  // commander with a different hand size keeps the same handicap.
  const firstHand = Math.max(
    1, players[setup.firstPlayer].handSize - (HAND_SIZE - FIRST_TURN_HAND_SIZE),
  )
  for (let i = 0; i < firstHand; i++) {
    const c = players[setup.firstPlayer].deck.shift()
    if (c) players[setup.firstPlayer].hand.push(c)
  }
  // A deck boss opens with the hand its challenge card gives it, not five.
  const bossSeat = setup.boss ? opponentOf(setup.firstPlayer) : null
  const secondHand = setup.boss && setup.boss.kind === 'deck' && second === bossSeat
    ? setup.boss.handSize
    : players[second].handSize
  for (let i = 0; i < secondHand; i++) {
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
    setAside: [],
    unclaimedGambits,
    extraRowSlots: 0,
    blackMarketOwner: null,
    blackMarketUsedThisTurn: false,
    resolution: [],
    rng,
    winner: null,
    scenario: sc?.rules ?? null,
    basesDestroyed: { p1: 0, p2: 0 },
    boss: setup.boss ?? null,
  }
}

export { EXPLORER }
