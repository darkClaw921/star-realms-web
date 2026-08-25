import { CARDS, cardDef, EXPLORER, SCOUT, VIPER, tradeDeckComposition } from './cards/registry'
import { COMMAND_DECKS, type CommandDeckSpec } from './cards/commandDecks'
import type { CardDefId, CardIid, PlayerId } from './ids'
import type { BossState } from './boss'
import type { SetId } from './cards/types'
import type { ScenarioSetup } from './scenario'
import { asDefId, ALL_SEATS, FACTIONS, opponentOf } from './ids'
import { newCoopState, type CoopState, type TeamMode } from './coop'
import type { Faction } from './ids'
import { nextHex, nextInt, seedRng, shuffle, type RngState } from './rng'
import {
  VARIANT_AUTHORITY, VARIANT_CARD, VARIANT_RECRUIT_COST,
  type VariantId, type VariantState,
} from './variants'
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
  /** An Arena scenario: one rule changed for the whole game, for both players. */
  readonly variant?: VariantId | undefined
  /**
   * A co-operative Challenge: how many players sit against the Boss, and under
   * which of the rulebook's three team rules. Absent, or one player, deals the
   * ordinary two-seat game the rest of this file has always dealt.
   */
  readonly coop?: { readonly players: number; readonly mode: TeamMode } | undefined
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
    acquiredThisTurn: false,
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

  // Who is at the table. A co-op Challenge seats its players first and the Boss
  // last; everything else is the two seats it has always been.
  const coopPlayers = setup.coop && setup.coop.players > 1 ? setup.coop.players : 0
  const seats: PlayerId[] = coopPlayers
    ? ALL_SEATS.slice(0, coopPlayers + 1) as PlayerId[]
    : ['p1', 'p2']
  const bossSeatId: PlayerId | null = setup.boss ? seats[seats.length - 1] as PlayerId : null
  const coop: CoopState | null = coopPlayers && bossSeatId && setup.coop
    ? newCoopState(seats.slice(0, coopPlayers), bossSeatId, setup.coop.mode)
    : null
  /** Human seats: everything but the boss. */
  const humans: PlayerId[] = seats.filter((x) => x !== bossSeatId)

  // A Command Deck replaces the starting deck outright, so it is resolved before
  // anything is minted.
  const cmd: Partial<Record<PlayerId, CommandDeckSpec>> = {}
  for (const pid of seats) {
    const id = setup.commandDeck?.[pid]
    const spec = id ? COMMAND_DECKS.find((c) => c.id === id) : undefined
    if (spec) cmd[pid] = spec
  }

  const decks: Record<PlayerId, CardInstance[]> = { p1: [], p2: [], p3: [], p4: [], p5: [] }
  for (const pid of seats) {
    let cards: CardInstance[]
    const personal = cmd[pid]?.deck.map((x) => asDefId(x))
    // Two scenarios change the starting deck itself, and nothing else.
    const base: CardDefId[] = [...(personal ?? sc?.starterDeck[pid] ?? starterDeck())]
    if (setup.variant === 'frontier-expedition') {
      // Two Explorers in the place of two Scouts.
      for (let i = 0; i < 2; i++) {
        const at = base.indexOf(SCOUT)
        if (at >= 0) base[at] = EXPLORER
      }
    }
    if (setup.variant === 'frantic-preparations') {
      // One Viper and one Scout removed.
      for (const gone of [SCOUT, VIPER]) {
        const at = base.indexOf(gone)
        if (at >= 0) base.splice(at, 1)
      }
    }
    ;[cards, rng] = mintAll(rng, base)
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
  for (const pid of seats) {
    const ship = cmd[pid]?.megaship
    if (!ship) continue
    let one: CardInstance[]
    ;[one, rng] = mintAll(rng, [asDefId(ship)])
    tradeDeck.push(...one)
  }
  ;[tradeDeck, rng] = shuffle(rng, tradeDeck)

  const startingAuthority = (pid: PlayerId): number => {
    const c = cmd[pid]
    const base = c
      ? cardDef(asDefId(c.commander)).commander?.authority ?? STARTING_AUTHORITY
      : sc?.authority[pid] ?? STARTING_AUTHORITY
    // Border Skirmish and Prolonged Conflict move the starting authority, and
    // they move it relative to whatever it already was -- so a Command Deck's
    // own number is shifted rather than replaced.
    const shift = setup.variant ? VARIANT_AUTHORITY[setup.variant] ?? 0 : 0
    return Math.max(1, base + shift)
  }
  // Every seat gets a PlayerState; only the ones in `seats` are dealt anything.
  const players = Object.fromEntries(
    ALL_SEATS.map((pid) => [pid, newPlayer(decks[pid], startingAuthority(pid))]),
  ) as Record<PlayerId, PlayerState>

  // The commander sets the hand size, and its two gambits are dealt face up in
  // hand terms but face down like any other gambit: they start unrevealed.
  for (const pid of seats) {
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
  for (const pid of seats) {
    for (const def of sc?.startingDiscard?.[pid] ?? []) {
      let c: CardInstance
      ;[c, rng] = mint(rng, def)
      players[pid].discard.push(c)
    }
  }

  // Bases a mission starts you (or the boss) with. They are already standing,
  // so playedThisTurn is false and their abilities are available immediately --
  // exactly like a base held over from a previous turn.
  for (const pid of seats) {
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
    for (const pid of humans) {
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
    for (const pid of humans) {
      for (let i = 0; i < missionCount; i++) {
        const c = pool.shift()
        if (c) players[pid].missions.push(c)
      }
    }
  }

  // The scenario is rolled before anything else it touches: Entrenched
  // Loyalties assigns a faction per player at setup, and that assignment is
  // public from the first turn.
  let variant: VariantState | null = null
  let extraRowSlots = 0
  if (setup.variant) {
    if (setup.variant === 'entrenched-loyalties') {
      const pool = FACTIONS.filter((f) => f !== 'unaligned')
      const pick: Partial<Record<PlayerId, Faction>> = {}
      for (const pid of seats) {
        let i: number
        ;[i, rng] = nextInt(rng, pool.length)
        pick[pid] = pool[i] as Faction
      }
      variant = { id: setup.variant, faction: pick }
    } else {
      variant = { id: setup.variant }
    }
    // Warpgate Nexus: "play with two additional cards in the trade row".
    if (setup.variant === 'warpgate-nexus') extraRowSlots = 2

    // Early Recruitment and Picking Sides hand each player two cost-1 (or
    // cost-2) cards from the trade deck, one per faction. The printed card has
    // the players CHOOSE which faction each pick is; setup here is not
    // interactive, so the four factions are dealt out in a random order and the
    // picks follow the printed seat order -- first, second, second, first.
    const recruitCost = setup.variant ? VARIANT_RECRUIT_COST[setup.variant] : undefined
    if (recruitCost !== undefined) {
      let order = FACTIONS.filter((f) => f !== 'unaligned')
      ;[order, rng] = shuffle(rng, order)
      const seats: PlayerId[] = [
        setup.firstPlayer, opponentOf(setup.firstPlayer),
        opponentOf(setup.firstPlayer), setup.firstPlayer,
      ]
      order.forEach((faction, i) => {
        const seat = seats[i]
        if (!seat) return
        const at = tradeDeck.findIndex(
          (c) => cardDef(c.def).faction === faction && cardDef(c.def).cost === recruitCost,
        )
        if (at < 0) return
        const [card] = tradeDeck.splice(at, 1)
        if (card) players[seat].deck.push(card)
      })
      for (const pid of seats) {
        let d2: CardInstance[]
        ;[d2, rng] = shuffle(rng, players[pid].deck as CardInstance[])
        players[pid].deck = d2
      }
    }

    // A scenario with an activated ability gets a card in front of each player,
    // face up from the start.
    const face = VARIANT_CARD[setup.variant]
    if (face) {
      for (const pid of seats) {
        let c: CardInstance
        ;[c, rng] = mint(rng, face)
        players[pid].gambitsInPlay.push({
          iid: c.iid, def: c.def, copiedDef: null, chosenFaction: null,
          used: {
            primary: false, ally: false, ally2: false, ally3: false, ally4: false,
            doubleAlly: false, scrap: false, splinter: false,
          },
          playedThisTurn: false,
        })
      }
    }
  }

  // Nemesis Beast: "When playing with two or more players, for each player in
  // the game, place one card from the top of the Trade Deck face down in front
  // of the Boss." Its Combat each turn is how many cards are sitting there, so
  // a four-player table faces a beast that opens at four.
  // Copied rather than mutated: createGame must be a pure function of its
  // setup, or dealing the same match twice would deal two different games.
  const boss: BossState | null = setup.boss
    ? { ...setup.boss, facedown: [...setup.boss.facedown] }
    : null
  if (boss?.id === 'nemesis-beast' && coopPlayers >= 2) {
    for (let i = 0; i < coopPlayers; i++) {
      const c = tradeDeck.shift()
      if (c) boss.facedown.push({ iid: c.iid, def: c.def })
    }
  }

  /**
   * Начальный ряд.
   *
   * Событие в него не кладётся: карта этого типа не существует в ряду ни одного
   * мгновения — вскрылась, применилась, ушла в утиль. Разрешить его прямо
   * здесь тоже нельзя, и это не осторожность, а арифметика: партия ещё не
   * собрана — руки не розданы, активного игрока нет, — а «каждый игрок
   * сбрасывает карту» требует и того, и другого. Поэтому событие, попавшее под
   * раздачу, отправляется в утиль, а слот берёт следующую карту.
   *
   * Без этого ряд начинался с события примерно в каждой пятой раздаче на полном
   * наборе, и оно лежало там обычной покупаемой картой.
   */
  const setupScrapped: CardInstance[] = []
  const tradeRow: (CardInstance | null)[] = []
  for (let i = 0; i < TRADE_ROW_SIZE + extraRowSlots; i++) {
    let c = tradeDeck.shift() ?? null
    while (c && cardDef(c.def).type === 'event') {
      setupScrapped.push(c)
      c = tradeDeck.shift() ?? null
    }
    tradeRow.push(c)
  }

  /**
   * Два сценария начинают действовать раньше, чем кто-либо успевает походить.
   *
   * «At the start of each player's turn» — первый ход первого игрока тоже его
   * ход, а начало хода движок отсчитывает от КОНЦА предыдущего, которого здесь
   * ещё не было. Без этих двух строк оба правила пропускали ровно один ход —
   * и всегда один и тот же: первый игрок за всю партию добирал на карту меньше
   * соперника, а ряд успевал прожить лишний ход нетронутым.
   */
  if (variant?.id === 'fleeting-opportunities') {
    const far = tradeRow.reduce((at, c, i) => (c ? i : at), -1)
    if (far >= 0) {
      setupScrapped.push(tradeRow[far] as CardInstance)
      // Сдвиг на одну позицию: место освобождается у торговой колоды, и его
      // берёт следующая карта — так же, как это делает начало каждого хода.
      tradeRow.copyWithin(1, 0, far)
      let c = tradeDeck.shift() ?? null
      while (c && cardDef(c.def).type === 'event') {
        setupScrapped.push(c)
        c = tradeDeck.shift() ?? null
      }
      tradeRow[0] = c
    }
  }
  const warpDraw = variant?.id === 'maximum-warp' ? 1 : 0

  const second = coopPlayers ? (bossSeatId as PlayerId) : (setup.firstPlayer === 'p1' ? 'p2' : 'p1')
  // The first player's short opening hand is two fewer than their normal one,
  // which is what FIRST_TURN_HAND_SIZE is against the standard five -- so a
  // commander with a different hand size keeps the same handicap.
  const firstHand = Math.max(
    1, players[setup.firstPlayer].handSize - (HAND_SIZE - FIRST_TURN_HAND_SIZE),
  ) + warpDraw
  // Challenge Notes, page 23: "When the players play first ... they get a
  // three-card starting hand on their first turn of the game." All of them, not
  // just one -- there is no second player to hand the long hand to.
  const openers: PlayerId[] = coopPlayers ? humans : [setup.firstPlayer]
  for (const pid of openers) {
    const n = Math.max(1, players[pid].handSize - (HAND_SIZE - FIRST_TURN_HAND_SIZE)) + warpDraw
    for (let i = 0; i < (coopPlayers ? n : firstHand); i++) {
      const c = players[pid].deck.shift()
      if (c) players[pid].hand.push(c)
    }
  }
  // A deck boss opens with the hand its challenge card gives it, not five.
  const bossSeat = bossSeatId ?? (setup.boss ? opponentOf(setup.firstPlayer) : null)
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
    seats,
    bossSeat,
    coop,
    activePlayer: setup.firstPlayer,
    phase: 'main',
    players,
    tradeRow,
    tradeDeck,
    explorerPile: EXPLORER_PILE_SIZE,
    scrapHeap: setupScrapped,
    setAside: [],
    unclaimedGambits,
    extraRowSlots,
    blackMarketOwner: null,
    blackMarketUsedThisTurn: false,
    resolution: [],
    rng,
    winner: null,
    scenario: sc?.rules ?? null,
    basesDestroyed: Object.fromEntries(ALL_SEATS.map((p) => [p, 0])) as Record<PlayerId, number>,
    boss,
    variant,
    marketCounters: {},
  }
}

export { EXPLORER }
