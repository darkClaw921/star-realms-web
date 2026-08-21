import type { CardDefId, PlayerId } from './ids'
import type { ScenarioSetup } from './scenario'

/**
 * Campaign missions.
 *
 * These are OURS. The campaign in the publisher's own app is paid content built
 * on cards from Colony Wars, Frontiers, Gambits and Stellar Allies -- none of
 * which are in this base-set build -- and its chapter and mission texts are not
 * published anywhere we could reproduce faithfully. So rather than pass off a
 * half-remembered reconstruction as the official campaign, these missions are
 * written from scratch against the 80-card base trade deck, using the same
 * structural ideas any campaign uses: a fixed opening position, a restricted
 * card pool, an opponent with an advantage, and objectives other than "reduce
 * them to zero".
 *
 * Everything here is data. Adding a mission must never require touching the
 * reducer; if it does, the ScenarioRules vocabulary is what should grow.
 */

export type Difficulty = 1 | 2 | 3 | 4

export interface Mission {
  readonly id: string
  readonly campaign: CampaignId
  /** 1-based position within its campaign. */
  readonly index: number
  readonly difficulty: Difficulty
  readonly setup: ScenarioSetup
}

export type CampaignId = 'frontier' | 'hive' | 'foundry'

export interface Campaign {
  readonly id: CampaignId
  readonly missions: readonly Mission[]
}

/** The player is always p1 and always moves first in a mission. */
export const HERO: PlayerId = 'p1'
const BOSS: PlayerId = 'p2'

const SCOUT = 'scout' as CardDefId
const VIPER = 'viper' as CardDefId

function deck(scouts: number, vipers: number): CardDefId[] {
  return [...Array<CardDefId>(scouts).fill(SCOUT), ...Array<CardDefId>(vipers).fill(VIPER)]
}

const ids = (...xs: string[]): CardDefId[] => xs as CardDefId[]

/**
 * Faction pools, used to restrict a mission's trade deck.
 *
 * A pool is never a single faction: each faction is exactly 20 cards, which is
 * five in the opening row and fifteen left -- the row runs dry long before the
 * game ends. Two factions is the floor, and the campaign test enforces it.
 */
const TRADE_FEDERATION = ids(
  'federation-shuttle', 'cutter', 'embassy-yacht', 'freighter', 'trade-escort',
  'flagship', 'command-ship', 'trading-post', 'barter-world', 'defense-center',
  'central-office', 'port-of-call',
)
const BLOB = ids(
  'blob-fighter', 'trade-pod', 'battle-pod', 'ram', 'blob-destroyer', 'blob-carrier',
  'battle-blob', 'blob-wheel', 'the-hive', 'blob-world',
)
const STAR_EMPIRE = ids(
  'imperial-fighter', 'corvette', 'survey-ship', 'imperial-frigate', 'battlecruiser',
  'dreadnaught', 'space-station', 'recycling-station', 'war-world', 'royal-redoubt',
  'fleet-hq',
)
const MACHINE_CULT = ids(
  'trade-bot', 'missile-bot', 'supply-bot', 'patrol-mech', 'stealth-needle',
  'battle-mech', 'missile-mech', 'battle-station', 'mech-world', 'junkyard',
  'machine-base', 'brain-world',
)

interface MissionSpec {
  readonly id: string
  readonly difficulty: Difficulty
  readonly heroAuthority?: number
  readonly bossAuthority?: number
  readonly heroDeck?: readonly CardDefId[]
  readonly heroBases?: readonly CardDefId[]
  readonly bossBases?: readonly CardDefId[]
  readonly bossCombat?: number
  readonly bossTrade?: number
  readonly pool?: readonly CardDefId[]
  readonly objective?: ScenarioSetup['rules']['objective']
}

function mission(campaign: CampaignId, index: number, spec: MissionSpec): Mission {
  return {
    id: spec.id,
    campaign,
    index,
    difficulty: spec.difficulty,
    setup: {
      rules: {
        id: spec.id,
        hero: HERO,
        objective: spec.objective ?? { k: 'AUTHORITY' },
        turnStartCombat: { p1: 0, p2: spec.bossCombat ?? 0 },
        turnStartTrade: { p1: 0, p2: spec.bossTrade ?? 0 },
      },
      authority: {
        ...(spec.heroAuthority === undefined ? {} : { p1: spec.heroAuthority }),
        ...(spec.bossAuthority === undefined ? {} : { p2: spec.bossAuthority }),
      },
      starterDeck: spec.heroDeck ? { p1: spec.heroDeck } : {},
      startingBases: {
        ...(spec.heroBases ? { p1: spec.heroBases } : {}),
        ...(spec.bossBases ? { p2: spec.bossBases } : {}),
      },
      tradeDeckOnly: spec.pool ?? null,
    },
  }
}

/**
 * Пограничье -- the teaching campaign. Each mission isolates one thing: buying,
 * allies, outposts, then all three at once against a funded opponent.
 */
const FRONTIER: readonly MissionSpec[] = [
  {
    id: 'frontier-1', difficulty: 1,
    heroAuthority: 55, bossAuthority: 30,
    pool: [...TRADE_FEDERATION, ...STAR_EMPIRE],
  },
  {
    id: 'frontier-2', difficulty: 1,
    heroAuthority: 50, bossAuthority: 40,
    // One Cutter in the opening deck: the ally bonus is reachable on turn one,
    // which is the lesson.
    heroDeck: [...deck(7, 2), ...ids('cutter')],
    pool: [...TRADE_FEDERATION, ...MACHINE_CULT],
  },
  {
    id: 'frontier-3', difficulty: 2,
    heroAuthority: 50, bossAuthority: 45,
    bossBases: ids('trading-post', 'defense-center'),
    objective: { k: 'DESTROY_BASES', n: 2 },
    pool: [...TRADE_FEDERATION, ...STAR_EMPIRE],
  },
  {
    id: 'frontier-4', difficulty: 2,
    heroAuthority: 45, bossAuthority: 50,
    bossCombat: 2,
  },
]

/**
 * Улей -- attrition. The Blob is funded, so the pressure never stops; the
 * missions ask you to outlast it rather than out-trade it.
 */
const HIVE: readonly MissionSpec[] = [
  {
    id: 'hive-1', difficulty: 2,
    heroAuthority: 50, bossAuthority: 45,
    bossCombat: 3,
    pool: [...BLOB, ...TRADE_FEDERATION],
  },
  {
    id: 'hive-2', difficulty: 3,
    heroAuthority: 50, bossAuthority: 120,
    // High but finite. A sentinel like 999 shows up in the HUD looking like a
    // bug, and a player who somehow does grind it down deserves the win; the
    // clock is simply the realistic way out.
    // Tuned against a do-nothing player: a run that never buys a card must
    // lose this, or the mission is not asking anything.
    bossCombat: 5,
    objective: { k: 'SURVIVE', turns: 14 },
    heroBases: ids('defense-center'),
    pool: [...BLOB, ...TRADE_FEDERATION],
  },
  {
    id: 'hive-3', difficulty: 3,
    heroAuthority: 45, bossAuthority: 55,
    bossBases: ids('the-hive'),
    bossCombat: 3,
    pool: [...BLOB, ...MACHINE_CULT],
  },
  {
    id: 'hive-4', difficulty: 4,
    heroAuthority: 40, bossAuthority: 60,
    bossBases: ids('the-hive', 'blob-wheel'),
    bossCombat: 4, bossTrade: 2,
    pool: [...BLOB, ...STAR_EMPIRE],
  },
]

/**
 * Литейная -- the Machine Cult. Outposts everywhere, so the lesson is that you
 * cannot choose your targets until the outposts are gone.
 */
const FOUNDRY: readonly MissionSpec[] = [
  {
    id: 'foundry-1', difficulty: 2,
    heroAuthority: 50, bossAuthority: 40,
    bossBases: ids('battle-station'),
    pool: [...MACHINE_CULT, ...TRADE_FEDERATION],
  },
  {
    id: 'foundry-2', difficulty: 3,
    heroAuthority: 50, bossAuthority: 50,
    bossBases: ids('battle-station', 'machine-base'),
    objective: { k: 'DESTROY_BASES', n: 3 },
    bossCombat: 2,
    pool: [...MACHINE_CULT, ...STAR_EMPIRE],
  },
  {
    id: 'foundry-3', difficulty: 3,
    heroAuthority: 55, bossAuthority: 55,
    // Win the peace instead of the war: climbing to 75 needs the Federation's
    // authority cards, and the Cult is shooting the whole time.
    objective: { k: 'REACH_AUTHORITY', n: 75 },
    bossCombat: 3,
    pool: [...MACHINE_CULT, ...TRADE_FEDERATION],
  },
  {
    id: 'foundry-4', difficulty: 4,
    heroAuthority: 40, bossAuthority: 65,
    bossBases: ids('machine-base', 'battle-station', 'mech-world'),
    bossCombat: 4, bossTrade: 2,
  },
]

function build(id: CampaignId, specs: readonly MissionSpec[]): Campaign {
  return { id, missions: specs.map((s, i) => mission(id, i + 1, s)) }
}

export const CAMPAIGNS: readonly Campaign[] = [
  build('frontier', FRONTIER),
  build('hive', HIVE),
  build('foundry', FOUNDRY),
]

const BY_ID = new Map<string, Mission>()
for (const c of CAMPAIGNS) for (const m of c.missions) BY_ID.set(m.id, m)

export function missionById(id: string): Mission | null {
  return BY_ID.get(id) ?? null
}

export function campaignById(id: string): Campaign | null {
  return CAMPAIGNS.find((c) => c.id === id) ?? null
}

export { BOSS }
