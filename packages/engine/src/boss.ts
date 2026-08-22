import type { CardDefId, CardInstance, Faction, PlayerId } from './ids'
import { ALL_SEATS } from './ids'
import { sharedTurn, type TeamMode } from './coop'
import type { Objective, ScenarioSetup } from './scenario'
import type { SetId } from './cards/types'

/**
 * The eight solo/co-op Challenges from Star Realms: Frontiers, as a one-player
 * game against the Boss.
 *
 * All of it is the published rules. Setups, difficulty levels, Order of Play
 * and the Boss Attacks targeting algorithm come from the Frontiers rulebook
 * (pages 21-40). The per-faction ability tables and each boss's own rules text
 * come from the oversized Challenge Cards, read off the publisher's own scans
 * of the card faces and backs.
 *
 * Co-op is here too. Every "per player" number scales with the table, the three
 * team rules the rulebook prints (Hydra, Pirates' pooled turn, the Horror's
 * individual turns) live in coop.ts, and the per-challenge multipliers are
 * below, next to the challenge they belong to.
 *
 * One deviation remains:
 *
 * Frontiers-only cards do not exist in this base-set build, so the four
 * challenges that call for a specific Frontiers deck (Blob Assault's ten-card
 * Blob deck, and the Machine Cult / Star Empire / Trade Federation decks) get a
 * deck of base-set cards of the same faction instead. Their rules are
 * unchanged; only the card pool differs.
 */

export type BossId =
  | 'automatons'
  | 'blob-assault'
  | 'dimensional-horror'
  | 'madness-of-the-machine'
  | 'nemesis-beast'
  | 'pirates-of-the-dark-star'
  | 'defy-the-empire'
  | 'cost-of-freedom'

/**
 * Difficulty changes exactly one thing, per the rulebook: how many turns the
 * players take before the boss's first turn.
 */
/**
 * Which team rules each challenge is printed with, and how many players it
 * takes. Both are read off the challenge's own pages in the rulebook: seven
 * say "1-4 players solo/co-op challenge", Defy the Empire says "1-3".
 */
export const TEAM_MODE: Record<BossId, TeamMode> = {
  'automatons': 'hydra',
  'blob-assault': 'hydra',
  'dimensional-horror': 'individual',
  'madness-of-the-machine': 'hydra',
  'nemesis-beast': 'hydra',
  'pirates-of-the-dark-star': 'pooled',
  'defy-the-empire': 'hydra',
  'cost-of-freedom': 'hydra',
}

export const MAX_PLAYERS: Record<BossId, number> = {
  'automatons': 4,
  'blob-assault': 4,
  'dimensional-horror': 4,
  'madness-of-the-machine': 4,
  'nemesis-beast': 4,
  'pirates-of-the-dark-star': 4,
  'defy-the-empire': 3,
  'cost-of-freedom': 4,
}

export type ChallengeLevel = 'beginner' | 'intermediate' | 'veteran' | 'expert'

/**
 * Turns the player takes before the boss's first turn, per the rulebook. The
 * player always physically moves first here, so what the engine stores is how
 * many of its own turns the boss skips: one less than this.
 *
 * Expert is the documented deviation. The rulebook has the boss move first,
 * which this engine cannot express -- setup cannot run a turn without importing
 * the reducer. Instead the boss skips nothing and takes a double first turn,
 * which lands in the same place: it is a step ahead from the opening.
 */
export const GRACE_TURNS: Record<ChallengeLevel, number> = {
  beginner: 3,
  intermediate: 2,
  veteran: 1,
  expert: 0,
}

/**
 * Boss turns skipped, given the difficulty and the table.
 *
 * With a shared turn the team's three turns are three turns, so the boss simply
 * sits out two of its own. The Dimensional Horror is different and says so on
 * its own page: it "doesn't take a turn after each player's first and second
 * turns", and with N players that is N boss turns per round -- so the same two
 * rounds of grace cost it 2N turns.
 */
export function skipsFor(level: ChallengeLevel, players = 1, mode: TeamMode = 'hydra'): number {
  const rounds = Math.max(0, GRACE_TURNS[level] - 1)
  return sharedTurn(mode) ? rounds : rounds * players
}

export function headStartFor(level: ChallengeLevel): boolean {
  return level === 'expert'
}

/** Which bosses hold cards and play them, and which are driven by a script. */
export type BossKind = 'deck' | 'script'

export interface BossState {
  readonly id: BossId
  readonly kind: BossKind
  /** Automatons: the growing armada. It plays cards until it matches this. */
  assimilation: number
  /** Deck bosses: cards drawn per turn, from the challenge card. */
  handSize: number
  /** Nemesis Beast: cards scrapped face down. Combat equals how many there are. */
  facedown: CardInstance[]
  /**
   * Dimensional Horror: one pile per faction. Cards are destroyed individually
   * by spending combat equal to THAT CARD's cost, and the players win when all
   * four piles are empty at once. An empty tentacle regrows as soon as a card
   * of its colour is added again, so there is no permanent "destroyed" state.
   */
  tentacles: Record<Faction, CardInstance[]>
  /**
   * True once anything has ever been fed to a tentacle. Without it, "every
   * tentacle is empty" would be true on turn one, before the Horror has grown
   * any, and the players would win instantly.
   */
  tentaclesEverFed: boolean
  /** Boss turns still to be skipped, from the difficulty level. */
  graceTurns: number
  /** Expert only: the boss's first turn counts double. */
  headStart: boolean
  /** The trade row may be mulliganed once per challenge. */
  mulliganUsed: boolean
  /** Set while the boss's turn is resolving, so END_TURN cannot be spoofed. */
  acting: boolean
}

export function newBossState(
  id: BossId, kind: BossKind, level: ChallengeLevel, handSize = 0,
  players = 1, mode: TeamMode = 'hydra',
): BossState {
  return {
    id,
    kind,
    // Automatons: "an Assimilation count of 0 (+4 for each additional player
    // beyond the first). For example: when playing with 3 players, the
    // Assimilation Count starts at 8."
    assimilation: id === 'automatons' ? (players - 1) * 4 : 0,
    handSize,
    facedown: [],
    tentacles: { trade_federation: [], blob: [], star_empire: [], machine_cult: [], unaligned: [] },
    tentaclesEverFed: false,
    graceTurns: skipsFor(level, players, mode),
    headStart: headStartFor(level),
    mulliganUsed: false,
    acting: false,
  }
}

/** The four factions that can be a tentacle. Unaligned cards join the longest. */
export const TENTACLE_FACTIONS: readonly Faction[] =
  ['trade_federation', 'blob', 'star_empire', 'machine_cult']

export interface ChallengeSpec {
  readonly id: BossId
  readonly kind: BossKind
  /**
   * Deck bosses only: cards drawn at the start of each of the boss's turns, as
   * a function of how many players are at the table. Printed on each challenge
   * card:
   *   Blob Assault      -- plays the top card of its deck (so: one, always)
   *   Madness / Freedom -- players plus one
   *   Defy the Empire   -- five, plus two per extra player
   */
  readonly handSize?: (players: number) => number
  /** Boss authority for a solo game. Rulebook values, "per player" x1. */
  readonly bossAuthority: number
  readonly playerAuthority: number
  /** Non-standard personal deck for the player, if the challenge sets one. */
  readonly playerDeck?: readonly CardDefId[]
  /**
   * For deck bosses: the cards its personal deck is built from. Frontiers cards
   * are unavailable here, so these are the base-set cards of the same faction.
   */
  readonly bossDeck?: readonly CardDefId[]
  /** Trade deck restriction, where the challenge removes a faction from it. */
  readonly tradeDeckOnly?: readonly CardDefId[]
  /**
   * Blob Assault's deck is STACKED, not shuffled: the rulebook gives its ten
   * cards in order, and the difficulty curve of the challenge is that order.
   */
  readonly bossDeckOrdered?: boolean
  /** Cards already in the boss's discard pile at setup. */
  readonly bossDiscard?: readonly CardDefId[]
}

const ids = (...xs: string[]): CardDefId[] => xs as CardDefId[]

/**
 * The Frontiers cards each challenge actually calls for.
 *
 * These are the real decks now. Until the Frontiers set was in the registry
 * these four challenges had to make do with base-set cards of the right colour;
 * that substitution is gone and the challenge cards are followed as printed.
 */

/** Blob Assault's Blob deck, in the exact order the rulebook stacks it. */
const BLOB_ASSAULT_DECK = ids(
  'stinger', 'spike-cluster', 'burrower', 'crusher', 'nesting-ground',
  'pulverizer', 'blob-alpha', 'swarm-cluster', 'infested-moon', 'hive-queen',
)

/** All twenty Blob cards from Frontiers, by copy count. */
const BLOB_FRONTIERS = ids(
  'blob-alpha', 'blob-miner', 'blob-miner', 'blob-miner', 'burrower', 'burrower',
  'crusher', 'crusher', 'hive-queen', 'infested-moon', 'moonwurm-hatchling',
  'moonwurm-hatchling', 'nesting-ground', 'pulverizer', 'spike-cluster',
  'spike-cluster', 'stinger', 'stinger', 'stinger', 'swarm-cluster',
)

/** All twenty Machine Cult cards from Frontiers, by copy count. */
const CULT_FRONTIERS = ids(
  'builder-bot', 'builder-bot', 'builder-bot', 'conversion-yard',
  'defense-system', 'defense-system', 'destroyer-bot', 'destroyer-bot',
  'destroyer-bot', 'enforcer-mech', 'integration-port', 'integration-port',
  'nanobot-swarm', 'neural-nexus', 'plasma-bot', 'plasma-bot', 'plasma-bot',
  'reclamation-station', 'repair-mech', 'repair-mech',
)

/** All twenty Star Empire cards from Frontiers. */
const EMPIRE_FRONTIERS = ids(
  'captured-outpost', 'captured-outpost', 'cargo-craft', 'cargo-craft',
  'cargo-craft', 'farm-ship', 'farm-ship', 'frontier-hawk', 'frontier-hawk',
  'frontier-hawk', 'hammerhead', 'imperial-flagship', 'jamming-terminal',
  'light-cruiser', 'light-cruiser', 'light-cruiser', 'orbital-gun-platform',
  'orbital-gun-platform', 'siege-fortress', 'warpgate-cruiser',
)

/** All twenty Trade Federation cards from Frontiers. */
const TF_FRONTIERS = ids(
  'federation-battleship', 'federation-cruiser', 'frontier-runner',
  'frontier-runner', 'frontier-runner', 'gateship', 'ion-station',
  'long-hauler', 'long-hauler', 'mobile-market', 'mobile-market',
  'orbital-shuttle', 'orbital-shuttle', 'orbital-shuttle', 'outland-station',
  'outland-station', 'outland-station', 'patrol-boat', 'patrol-boat',
  'transit-nexus',
)

const SCOUT = 'scout' as CardDefId
const VIPER = 'viper' as CardDefId
const std = (): CardDefId[] =>
  [...Array<CardDefId>(8).fill(SCOUT), ...Array<CardDefId>(2).fill(VIPER)]

export const CHALLENGES: readonly ChallengeSpec[] = [
  // ── script bosses: no hand, no deck, no discard pile ────────────────────
  {
    id: 'automatons', kind: 'script',
    bossAuthority: 30, playerAuthority: 60,
  },
  {
    id: 'dimensional-horror', kind: 'script',
    // "The Boss has no ... Authority." Destroying every tentacle is the win.
    bossAuthority: 0, playerAuthority: 40,
  },
  {
    id: 'nemesis-beast', kind: 'script',
    bossAuthority: 50, playerAuthority: 50,
  },
  {
    id: 'pirates-of-the-dark-star', kind: 'script',
    bossAuthority: 25, playerAuthority: 50,
  },

  // ── deck bosses: they hold a hand and play it ───────────────────────────
  {
    id: 'blob-assault', kind: 'deck', handSize: () => 1,
    bossAuthority: 40, playerAuthority: 40,
    // "Remove all Blob cards from the Trade Deck. Put one Spike Cluster face up
    // in the Blob's Discard Pile. Then create a Blob deck with the following
    // cards in order..." -- and the remaining Blob cards are set aside unused.
    bossDeck: BLOB_ASSAULT_DECK,
    bossDeckOrdered: true,
    bossDiscard: ids('spike-cluster'),
    tradeDeckOnly: [...TF_FRONTIERS, ...EMPIRE_FRONTIERS, ...CULT_FRONTIERS],
  },
  {
    id: 'madness-of-the-machine', kind: 'deck', handSize: (n) => n + 1,
    bossAuthority: 40, playerAuthority: 60,
    // "Remove all Machine Cult cards from the Trade Deck. Shuffle those cards,
    // 4 Scouts, and 4 Vipers together to make the Machine Cult deck." The
    // player's own deck is cut to 7 Scouts and 1 Viper.
    playerDeck: [...Array<CardDefId>(7).fill(SCOUT), VIPER],
    bossDeck: [
      ...CULT_FRONTIERS,
      ...Array<CardDefId>(4).fill(SCOUT), ...Array<CardDefId>(4).fill(VIPER),
    ],
    tradeDeckOnly: [...TF_FRONTIERS, ...BLOB_FRONTIERS, ...EMPIRE_FRONTIERS],
  },
  {
    id: 'defy-the-empire', kind: 'deck', handSize: (n) => 5 + 2 * (n - 1),
    bossAuthority: 40, playerAuthority: 50,
    // "Remove all Star Empire cards from the Trade Deck." The boss starts with
    // a standard personal deck and acquires from its own two Star Empire decks
    // during play; those two decks are merged into its personal deck here,
    // because a private acquisition economy has nothing to interact with in a
    // solo game. The cards are the real twenty.
    bossDeck: [...std(), ...EMPIRE_FRONTIERS],
    tradeDeckOnly: [...TF_FRONTIERS, ...BLOB_FRONTIERS, ...CULT_FRONTIERS],
  },
  {
    id: 'cost-of-freedom', kind: 'deck', handSize: (n) => n + 1,
    bossAuthority: 40, playerAuthority: 30,
    // "Remove all Trade Federation cards from the Trade Deck." Same treatment
    // as Defy the Empire: the Acquisition Deck and the Assets Ledger fold into
    // the boss's personal deck, built from the real twenty.
    bossDeck: [...std(), ...TF_FRONTIERS],
    tradeDeckOnly: [...BLOB_FRONTIERS, ...EMPIRE_FRONTIERS, ...CULT_FRONTIERS],
  },
]

const BY_ID = new Map<BossId, ChallengeSpec>(CHALLENGES.map((c) => [c.id, c]))

export function challengeById(id: string): ChallengeSpec | null {
  return BY_ID.get(id as BossId) ?? null
}

export function playerDeckFor(spec: ChallengeSpec): readonly CardDefId[] {
  return spec.playerDeck ?? std()
}

/** Solo: the player is always p1, the boss p2. */
export const CHALLENGER: PlayerId = 'p1'
export const BOSS_SEAT: PlayerId = 'p2'

/**
 * Turn a challenge into a scenario setup plus its boss state.
 *
 * Kept here rather than in setup.ts so that the rulebook's numbers live next to
 * the challenge they belong to and nothing else has to know how a challenge is
 * assembled.
 */
export function challengeSetup(spec: ChallengeSpec, level: ChallengeLevel, players = 1): {
  scenario: ScenarioSetup
  boss: BossState
  /** Challenges are played on the Frontiers trade deck, as the set intends. */
  sets: readonly SetId[]
  /** Co-op only: the table, for createGame. Absent at one player. */
  coop?: { players: number; mode: TeamMode }
} {
  const n = Math.max(1, Math.min(players, MAX_PLAYERS[spec.id]))
  const mode = TEAM_MODE[spec.id]
  const objective: Objective = spec.id === 'dimensional-horror'
    ? { k: 'DESTROY_TENTACLES' }
    : { k: 'AUTHORITY' }

  // Seats: the players first, the boss last. At one player this is p1 and p2,
  // which is exactly the solo layout this file started with.
  const seats = ALL_SEATS.slice(0, n + 1) as PlayerId[]
  const humans = seats.slice(0, n)
  const boss = seats[n] as PlayerId

  // "The Boss starts the game with X Authority per player."
  const bossAuthority = spec.id === 'dimensional-horror'
    // The Horror has no authority at all; it is killed tentacle by tentacle.
    // A nominal pool keeps it from dying to a stray hit before then.
    ? 999
    : spec.bossAuthority * n
  // A Hydra team has ONE score: "the team has a total Authority equal to the
  // individual player Authority times the number of players." The other two
  // modes give each player their own.
  const authority: Partial<Record<PlayerId, number>> = { [boss]: bossAuthority }
  for (const pid of humans) {
    authority[pid] = mode === 'hydra' ? spec.playerAuthority * n : spec.playerAuthority
  }

  const starterDeck: Partial<Record<PlayerId, readonly CardDefId[]>> = {}
  for (const pid of humans) starterDeck[pid] = playerDeckFor(spec)
  // A script boss has no deck. Giving it an empty one is what makes "no hand,
  // no deck, no discard pile" true rather than approximated.
  if (spec.kind === 'script') starterDeck[boss] = []
  if (spec.bossDeck) starterDeck[boss] = spec.bossDeck

  return {
    scenario: {
      rules: {
        id: spec.id,
        hero: CHALLENGER,
        objective,
        turnStartCombat: {},
        turnStartTrade: {},
      },
      authority,
      starterDeck,
      startingBases: {},
      tradeDeckOnly: spec.tradeDeckOnly ?? null,
      ...(spec.bossDeckOrdered ? { unshuffled: [boss] } : {}),
      ...(spec.bossDiscard ? { startingDiscard: { [boss]: spec.bossDiscard } } : {}),
    },
    boss: newBossState(spec.id, spec.kind, level, spec.handSize?.(n) ?? 0, n, mode),
    sets: ['frontiers'],
    ...(n > 1 ? { coop: { players: n, mode } } : {}),
  }
}
