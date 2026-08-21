import type { CardDefId, CardInstance, Faction, PlayerId } from './ids'
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
 * Two deviations remain, both forced and both small:
 *
 * Solo only. Every "per player" number is taken at one player, and the
 * multi-player clauses ("for each player beyond the first", Hydra teams) are
 * not implemented because there is no second player to implement them for.
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

export function skipsFor(level: ChallengeLevel): number {
  return Math.max(0, GRACE_TURNS[level] - 1)
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
): BossState {
  return {
    id,
    kind,
    assimilation: 0,
    handSize,
    facedown: [],
    tentacles: { trade_federation: [], blob: [], star_empire: [], machine_cult: [], unaligned: [] },
    tentaclesEverFed: false,
    graceTurns: skipsFor(level),
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
   * Deck bosses only: cards drawn at the start of each of the boss's turns, at
   * one player. Printed on each challenge card:
   *   Blob Assault      -- plays the top card of its deck (so: one)
   *   Madness / Freedom -- players plus one (so: two)
   *   Defy the Empire   -- five, plus two per extra player (so: five)
   */
  readonly handSize?: number
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
    id: 'blob-assault', kind: 'deck', handSize: 1,
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
    id: 'madness-of-the-machine', kind: 'deck', handSize: 2,
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
    id: 'defy-the-empire', kind: 'deck', handSize: 5,
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
    id: 'cost-of-freedom', kind: 'deck', handSize: 2,
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
export function challengeSetup(spec: ChallengeSpec, level: ChallengeLevel): {
  scenario: ScenarioSetup
  boss: BossState
  /** Challenges are played on the Frontiers trade deck, as the set intends. */
  sets: readonly SetId[]
} {
  const objective: Objective = spec.id === 'dimensional-horror'
    ? { k: 'DESTROY_TENTACLES' }
    : { k: 'AUTHORITY' }

  return {
    scenario: {
      rules: {
        id: spec.id,
        hero: CHALLENGER,
        objective,
        turnStartCombat: { p1: 0, p2: 0 },
        turnStartTrade: { p1: 0, p2: 0 },
      },
      authority: {
        p1: spec.playerAuthority,
        // The Horror has no authority at all; it is killed tentacle by tentacle.
        // A nominal pool keeps it from dying to a stray hit before then.
        p2: spec.id === 'dimensional-horror' ? 999 : spec.bossAuthority,
      },
      starterDeck: {
        p1: playerDeckFor(spec),
        // A script boss has no deck. Giving it an empty one is what makes "no
        // hand, no deck, no discard pile" true rather than approximated.
        ...(spec.kind === 'script' ? { p2: [] } : {}),
        ...(spec.bossDeck ? { p2: spec.bossDeck } : {}),
      },
      startingBases: {},
      tradeDeckOnly: spec.tradeDeckOnly ?? null,
      ...(spec.bossDeckOrdered ? { unshuffled: [BOSS_SEAT] as const } : {}),
      ...(spec.bossDiscard ? { startingDiscard: { p2: spec.bossDiscard } } : {}),
    },
    boss: newBossState(spec.id, spec.kind, level, spec.handSize ?? 0),
    sets: ['frontiers'],
  }
}
