import type { CardDefId, CardInstance, Faction, PlayerId } from './ids'
import type { Objective, ScenarioSetup } from './scenario'

/**
 * The eight solo/co-op Challenges from Star Realms: Frontiers, as a one-player
 * game against the Boss.
 *
 * WHAT IS OFFICIAL HERE, AND WHAT IS NOT -- this distinction matters, so it is
 * written down rather than left to be guessed at:
 *
 * Official, taken from the Frontiers rulebook (pages 21-40): the eight
 * challenges and their names; every setup (boss authority per player, player
 * authority, personal decks); the four difficulty levels and exactly what they
 * change; the Boss Order of Play for each challenge; the Boss Attacks targeting
 * algorithm; and the once-per-challenge trade row mulligan.
 *
 * NOT official, and reconstructed here: the per-faction ability tables. Those
 * are printed on the oversized Challenge Cards themselves and are not published
 * in the rulebook or anywhere else public, so they could not be reproduced
 * faithfully. Ours are written to match the published descriptions of what each
 * boss does, and are marked as ours in the UI. They are the one part of a
 * challenge that is not the real thing.
 *
 * Four challenges also call for cards that only exist in the Frontiers box
 * (Spike Cluster, Hive Queen, Hammerhead, Transit Nexus and so on). This is a
 * base-set build, so those decks are rebuilt from the base cards of the same
 * faction. The boss's rules are unchanged; only the card pool differs.
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
  /** Automatons: the growing armada. Also the boss's combat each turn. */
  assimilation: number
  /** Nemesis Beast: cards scrapped face down. Combat equals how many there are. */
  facedown: CardInstance[]
  /** Dimensional Horror: one pile per faction; destroy them all to win. */
  tentacles: Record<Faction, CardInstance[]>
  tentaclesDestroyed: Faction[]
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
  id: BossId, kind: BossKind, level: ChallengeLevel,
): BossState {
  return {
    id,
    kind,
    assimilation: 0,
    facedown: [],
    tentacles: { trade_federation: [], blob: [], star_empire: [], machine_cult: [], unaligned: [] },
    tentaclesDestroyed: [],
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
}

const ids = (...xs: string[]): CardDefId[] => xs as CardDefId[]

const TF = ids(
  'federation-shuttle', 'cutter', 'embassy-yacht', 'freighter', 'trade-escort',
  'flagship', 'command-ship', 'trading-post', 'barter-world', 'defense-center',
  'central-office', 'port-of-call',
)
const BLOB = ids(
  'blob-fighter', 'trade-pod', 'battle-pod', 'ram', 'blob-destroyer', 'blob-carrier',
  'battle-blob', 'blob-wheel', 'the-hive', 'blob-world',
)
const EMPIRE = ids(
  'imperial-fighter', 'corvette', 'survey-ship', 'imperial-frigate', 'battlecruiser',
  'dreadnaught', 'space-station', 'recycling-station', 'war-world', 'royal-redoubt',
  'fleet-hq',
)
const CULT = ids(
  'trade-bot', 'missile-bot', 'supply-bot', 'patrol-mech', 'stealth-needle',
  'battle-mech', 'missile-mech', 'battle-station', 'mech-world', 'junkyard',
  'machine-base', 'brain-world',
)

const SCOUT = 'scout' as CardDefId
const VIPER = 'viper' as CardDefId
const std = (): CardDefId[] =>
  [...Array<CardDefId>(8).fill(SCOUT), ...Array<CardDefId>(2).fill(VIPER)]

/**
 * A deck boss's personal deck: the faction's cards plus the starter chaff the
 * challenge calls for. Two copies of each faction card keeps the deck near the
 * ~20 cards the Frontiers version uses.
 */
const factionDeck = (faction: readonly CardDefId[], scouts: number, vipers: number): CardDefId[] => [
  ...faction, ...faction,
  ...Array<CardDefId>(scouts).fill(SCOUT),
  ...Array<CardDefId>(vipers).fill(VIPER),
]

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
    id: 'blob-assault', kind: 'deck',
    bossAuthority: 40, playerAuthority: 40,
    // The challenge removes every Blob card from the trade deck and gives them
    // to the boss.
    bossDeck: factionDeck(BLOB, 0, 0),
    tradeDeckOnly: [...TF, ...EMPIRE, ...CULT],
  },
  {
    id: 'madness-of-the-machine', kind: 'deck',
    bossAuthority: 40, playerAuthority: 60,
    // Rulebook: the player's deck is 7 Scouts and 1 Viper, and the boss's deck
    // is the Machine Cult cards plus 4 Scouts and 4 Vipers.
    playerDeck: [...Array<CardDefId>(7).fill(SCOUT), VIPER],
    bossDeck: factionDeck(CULT, 4, 4),
    tradeDeckOnly: [...TF, ...BLOB, ...EMPIRE],
  },
  {
    id: 'defy-the-empire', kind: 'deck',
    bossAuthority: 40, playerAuthority: 50,
    // "The Boss and each player start with a standard Personal Deck", and the
    // boss additionally acquires from its own Star Empire decks. Here the two
    // are merged into one personal deck, since a private trade deck for the
    // boss would need a second acquisition economy for no gain in solo play.
    bossDeck: [...std(), ...EMPIRE],
    tradeDeckOnly: [...TF, ...BLOB, ...CULT],
  },
  {
    id: 'cost-of-freedom', kind: 'deck',
    bossAuthority: 40, playerAuthority: 30,
    bossDeck: [...std(), ...TF],
    tradeDeckOnly: [...BLOB, ...EMPIRE, ...CULT],
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
    },
    boss: newBossState(spec.id, spec.kind, level),
  }
}
