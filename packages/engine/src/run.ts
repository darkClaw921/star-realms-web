import { cardDef, tradeDeckComposition } from './cards/registry'
import type { SetId } from './cards/types'
import { asDefId, type CardDefId, type PlayerId } from './ids'
import { seedRng, shuffle } from './rng'
import type { ScenarioSetup } from './scenario'
import type { FightTally, GameState } from './state'

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
  /**
   * What the fight asks of you beyond winning it. Doing it earns the right to
   * pick a relic, and it is known before the fight starts -- a task you can
   * play towards is a decision, a task you only learn about afterwards is a
   * lottery.
   */
  readonly feat: FeatSpec
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
    feat: { k: 'BUYS_TURN', n: 3 },
  },
  {
    index: 2, kind: 'battle',
    enemyAuthority: 45, enemyCombat: 1, enemyTrade: 1, enemyBases: [],
    offerCost: [1, 5],
    feat: { k: 'DAMAGE_TURN', n: 12 },
  },
  {
    index: 3, kind: 'battle',
    enemyAuthority: 50, enemyCombat: 2, enemyTrade: 1,
    enemyBases: ids('defense-center'),
    offerCost: [2, 6],
    feat: { k: 'BASES', n: 1 },
  },
  {
    index: 4, kind: 'elite',
    enemyAuthority: 55, enemyCombat: 2, enemyTrade: 2,
    enemyBases: ids('trading-post'),
    enemyDeck: ELITE_DECK,
    offerCost: [2, 6],
    feat: { k: 'SCRAP', n: 3 },
  },
  {
    index: 5, kind: 'battle',
    enemyAuthority: 60, enemyCombat: 3, enemyTrade: 2,
    enemyBases: ids('the-hive'),
    offerCost: [3, 7],
    feat: { k: 'DAMAGE_TURN', n: 20 },
  },
  {
    index: 6, kind: 'elite',
    enemyAuthority: 65, enemyCombat: 3, enemyTrade: 3,
    enemyBases: ids('blob-wheel', 'space-station'),
    enemyDeck: ELITE_DECK,
    offerCost: [3, 8],
    feat: { k: 'BY_TURN', n: 12 },
  },
  {
    index: 7, kind: 'elite',
    enemyAuthority: 70, enemyCombat: 4, enemyTrade: 3,
    enemyBases: ids('mech-world'),
    enemyDeck: ELITE_DECK,
    offerCost: [4, 8],
    feat: { k: 'AUTHORITY_END', n: 25 },
  },
  {
    index: 8, kind: 'boss',
    enemyAuthority: 90, enemyCombat: 5, enemyTrade: 4,
    enemyBases: ids('brain-world', 'fleet-hq'),
    enemyDeck: BOSS_DECK,
    offerCost: [4, 8],
    feat: { k: 'DAMAGE_TURN', n: 30 },
  },
]

/* ─────────────────────────── реликвии ─────────────────────────── */

/**
 * A relic: a rule that changes in your favour for the rest of the run.
 *
 * Ten of the fourteen are nothing but a card standing beside the board -- the
 * card vocabulary already expresses "whenever you play a Viper", "at the start
 * of your turn" and "once per turn, for a price", and the reducer has watched
 * that zone since long before relics existed. The other four still get a card,
 * so the board shows one list rather than two, but their rule is applied by the
 * opening position: hand size, price, a base already standing, authority.
 *
 * Which is why nothing here is a rules hook. `runSetup` folds a relic into the
 * ScenarioSetup it was already building, and the engine goes on knowing nothing
 * about runs.
 */
export type RelicId =
  | 'viper-fangs' | 'scout-scanners' | 'dock-crew' | 'swarm-doctrine'
  | 'war-drums' | 'trade-charter' | 'hull-plating' | 'shield-array'
  | 'salvage-rig' | 'overclock'
  | 'deep-reserves' | 'black-market-pass' | 'outpost-cache' | 'field-hospital'

export interface Relic {
  readonly id: RelicId
  /** The card that stands beside the board. Every relic has one. */
  readonly card: CardDefId
  /** Replaces the five-card hand. */
  readonly handSize?: number
  /** Trade off every price `costFor` decides. */
  readonly buyDiscount?: number
  /** A base already standing when each fight opens. */
  readonly startingBase?: CardDefId
  /** Authority on top of what the run carries, every fight. */
  readonly authority?: number
}

const rel = (id: RelicId, extra: Omit<Relic, 'id' | 'card'> = {}): Relic =>
  ({ id, card: asDefId(`rl-${id}`), ...extra })

export const RELIC: Record<RelicId, Relic> = {
  'viper-fangs': rel('viper-fangs'),
  'scout-scanners': rel('scout-scanners'),
  'dock-crew': rel('dock-crew'),
  'swarm-doctrine': rel('swarm-doctrine'),
  'war-drums': rel('war-drums'),
  'trade-charter': rel('trade-charter'),
  'hull-plating': rel('hull-plating'),
  'shield-array': rel('shield-array'),
  'salvage-rig': rel('salvage-rig'),
  'overclock': rel('overclock'),
  'deep-reserves': rel('deep-reserves', { handSize: 6 }),
  'black-market-pass': rel('black-market-pass', { buyDiscount: 1 }),
  'outpost-cache': rel('outpost-cache', { startingBase: asDefId('defense-center') }),
  'field-hospital': rel('field-hospital', { authority: 8 }),
}

export const RELICS: readonly RelicId[] = Object.keys(RELIC) as RelicId[]

/** The relic cards, for a board that wants to tell them from revealed gambits. */
export const RELIC_DEFS: ReadonlySet<CardDefId> =
  new Set(RELICS.map((id) => RELIC[id].card))

/* ─────────────────────────── достижения ─────────────────────────── */

/**
 * A feat: what this fight asks of you beyond winning it.
 *
 * Data, like a mission's objective, and for the same reason -- it has to
 * survive JSON and stay reviewable. Deliberately NOT part of ScenarioRules:
 * the reducer never enforces a feat, it only counts, and ScenarioRules is the
 * part of a scenario the engine is obliged to keep applying.
 */
export type FeatSpec =
  /** Combat damage put into the opponent's face in a single turn. */
  | { readonly k: 'DAMAGE_TURN'; readonly n: number }
  /** Cards paid for in a single turn. */
  | { readonly k: 'BUYS_TURN'; readonly n: number }
  | { readonly k: 'BASES'; readonly n: number }
  /** Cards scrapped over the whole fight. */
  | { readonly k: 'SCRAP'; readonly n: number }
  /** Win on or before this turn. */
  | { readonly k: 'BY_TURN'; readonly n: number }
  /** Finish the fight with at least this much authority. */
  | { readonly k: 'AUTHORITY_END'; readonly n: number }

/** Everything a feat can read. Available from a PlayerView and from a state. */
export interface FeatSource {
  readonly tally: FightTally
  readonly turn: number
  readonly basesDestroyed: number
  readonly authority: number
}

export function featSource(state: GameState, hero: PlayerId = RUN_HERO): FeatSource {
  return {
    tally: state.tally[hero],
    turn: state.turn,
    basesDestroyed: state.basesDestroyed[hero],
    authority: state.players[hero].authority,
  }
}

export function featProgress(
  f: FeatSpec, s: FeatSource,
): { have: number; need: number; met: boolean } {
  // The turn in progress counts: its numbers have not been rolled into the
  // best-turn figure yet, and a feat completed on the winning turn is still
  // completed.
  const best = (now: number, top: number): number => Math.max(now, top)
  const have = f.k === 'DAMAGE_TURN' ? best(s.tally.dmg, s.tally.dmgBest)
    : f.k === 'BUYS_TURN' ? best(s.tally.buys, s.tally.buysBest)
      : f.k === 'BASES' ? s.basesDestroyed
        : f.k === 'SCRAP' ? s.tally.scrapped
          : f.k === 'BY_TURN' ? s.turn
            : s.authority
  // Two of them are the wrong way round: finishing EARLY and finishing HIGH.
  const met = f.k === 'BY_TURN' ? have <= f.n : have >= f.n
  return { have, need: f.n, met }
}

/** Did the hero earn a relic in the fight they just won? */
export function featEarned(
  state: GameState, feat: FeatSpec, hero: PlayerId = RUN_HERO,
): boolean {
  return featProgress(feat, featSource(state, hero)).met
}

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
/**
 * Карта забега: сама карта и то, сколько раз её улучшали.
 *
 * Улучшение принадлежит КОПИИ, а не названию: выигранное пари улучшает одну
 * гадюку, а не все гадюки в колоде, и перенос между боями обязан помнить
 * именно копию.
 */
export interface RunCard {
  readonly def: CardDefId
  readonly up: number
}

export interface RunCarry {
  /** The whole personal deck, flattened -- draw pile, hand and discard alike. */
  readonly deck: readonly RunCard[]
  /** Bases and outposts left standing, upgrades and all. */
  readonly bases: readonly RunCard[]
  readonly authority: number
  /**
   * Relics earned so far. Unlike the deck they are not read back out of the
   * finished fight -- they are never lost, destroyed or scrapped, so the list
   * the run keeps IS the truth about them.
   */
  readonly relics: readonly RelicId[]
}

export function runStartCarry(): RunCarry {
  return {
    deck: [
      ...Array.from({ length: 8 }, () => ({ def: SCOUT, up: 0 })),
      ...Array.from({ length: 2 }, () => ({ def: VIPER, up: 0 })),
    ],
    bases: [],
    authority: RUN_START_AUTHORITY,
    relics: [],
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
export function harvestRun(
  state: GameState, hero: PlayerId = RUN_HERO, prev?: RunCarry,
): RunCarry {
  const p = state.players[hero]
  const deck: RunCard[] = []
  const bases: RunCard[] = []
  const take = (c: { def: CardDefId; up?: number }): RunCard => ({ def: c.def, up: c.up ?? 0 })
  for (const c of p.deck) deck.push(take(c))
  for (const c of p.hand) deck.push(take(c))
  for (const c of p.discard) deck.push(take(c))
  for (const c of p.inPlay) {
    const t = cardDef(c.def).type
    if (t === 'base' || t === 'outpost') bases.push(take(c))
    else deck.push(take(c))
  }
  // Relic cards stand in the gambit zone, never in play, so the loop above
  // cannot mistake one for a base -- and they come from the run's own list
  // rather than from the board.
  return { deck, bases, authority: Math.max(0, p.authority), relics: prev?.relics ?? [] }
}

/**
 * The opening position for one node, built from what the last one left you.
 *
 * The only place a relic turns into engine vocabulary. Four of them do it here
 * -- as a hand size, a discount, a standing base and an authority bonus -- and
 * the other ten simply come along as cards.
 */
export function runSetup(node: RunNode, carry: RunCarry): ScenarioSetup {
  const relics = carry.relics.map((id) => RELIC[id])
  const sum = (f: (r: Relic) => number | undefined): number =>
    relics.reduce((n, r) => n + (f(r) ?? 0), 0)
  const extraBases: RunCard[] = relics
    .map((r) => r.startingBase)
    .filter((b): b is CardDefId => b !== undefined)
    .map((def) => ({ def, up: 0 }))
  const bases = [...carry.bases, ...extraBases]
  const discount = sum((r) => r.buyDiscount)
  // The largest wins rather than the sum: two hand-size relics would otherwise
  // stack into a hand nobody designed.
  const hand = relics.reduce<number | undefined>(
    (n, r) => (r.handSize === undefined ? n : Math.max(n ?? 0, r.handSize)), undefined,
  )
  return {
    rules: {
      id: `run-${node.index}`,
      hero: RUN_HERO,
      objective: { k: 'AUTHORITY' },
      turnStartCombat: { p1: 0, p2: node.enemyCombat },
      turnStartTrade: { p1: 0, p2: node.enemyTrade },
      ...(discount > 0 ? { buyDiscount: { p1: discount } } : {}),
      wagers: true,
    },
    authority: {
      p1: carry.authority + sum((r) => r.authority),
      p2: node.enemyAuthority,
    },
    starterDeck: {
      // Улучшения едут в позицию как есть: улучшенная копия — это карта, а не
      // отдельное правило.
      p1: carry.deck.map((c) => (c.up > 0 ? { def: c.def, up: c.up } : c.def)),
      ...(node.enemyDeck ? { p2: [...node.enemyDeck] } : {}),
    },
    startingBases: {
      // Стоящие базы улучшений не несут: startingBases говорит определениями,
      // а улучшенная база, пережившая бой, вернётся улучшенной только если её
      // уничтожат и она уедет в сброс. Цена простоты, и она озвучена в тексте.
      ...(bases.length ? { p1: bases.map((b) => b.def) } : {}),
      ...(node.enemyBases.length ? { p2: [...node.enemyBases] } : {}),
    },
    ...(relics.length ? { startingSideCards: { p1: relics.map((r) => r.card) } } : {}),
    // Ставки — часть забега, и только его: в обычной партии кнопки нет.
    
    ...(hand === undefined ? {} : { handSize: { p1: hand } }),
    tradeDeckOnly: null,
  }
}

/** What a win pays. Exactly one of the three is taken. */
export type RunReward =
  /** Add this card to the deck. */
  | { readonly k: 'CARD'; readonly def: CardDefId }
  /** Remove one copy of this card from the deck, for good. */
  | { readonly k: 'SCRAP'; readonly def: CardDefId; readonly up: number }
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

/**
 * The three relics offered for a completed feat.
 *
 * Fewer than three near the end of a run, and none at all once every relic is
 * taken -- the screen has to survive both. Fixed by the run's seed and the
 * node, like the card offer: a reload must not re-roll a choice you did not
 * like.
 */
export function relicOffer(
  seed: string, node: RunNode, owned: readonly RelicId[],
): RelicId[] {
  const have = new Set<string>(owned)
  const left = RELICS.filter((id) => !have.has(id))
  const [shuffled] = shuffle(seedRng(`${seed}:relic:${node.index}`), left)
  return shuffled.slice(0, RUN_OFFER_SIZE)
}

/**
 * Улучшения, выигранные в бою, но не потраченные в нём.
 *
 * Бывает ровно одно: пари взято ударом, который бой и закончил. Забег
 * доспрашивает между боями — см. `applyUpgrade`.
 */
export function owedUpgrades(state: GameState, hero: PlayerId = RUN_HERO): number {
  return state.players[hero].upgradesOwed
}

/** Улучшить одну копию в перенесённой колоде. */
export function applyUpgrade(carry: RunCarry, def: CardDefId, up: number): RunCarry {
  const at = carry.deck.findIndex((c) => c.def === def && c.up === up)
  if (at < 0) return carry
  return {
    ...carry,
    deck: [
      ...carry.deck.slice(0, at),
      { def, up: up + 1 },
      ...carry.deck.slice(at + 1),
    ],
  }
}

export function applyRelic(carry: RunCarry, id: RelicId): RunCarry {
  if (carry.relics.includes(id)) return carry
  return { ...carry, relics: [...carry.relics, id] }
}

export function applyReward(carry: RunCarry, r: RunReward): RunCarry {
  if (r.k === 'REPAIR') return { ...carry, authority: carry.authority + r.n }
  if (r.k === 'CARD') return { ...carry, deck: [...carry.deck, { def: r.def, up: 0 }] }
  const at = carry.deck.findIndex((c) => c.def === r.def && c.up === r.up)
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
export function scrappable(carry: RunCarry): RunCard[] {
  if (carry.deck.length <= 1) return []
  const seen = new Set<string>()
  // Улучшенная копия — отдельная строка выбора: расставаться с гадюкой и с
  // дважды улучшенной гадюкой это разные решения.
  return carry.deck.filter((c) => {
    const key = `${c.def}:${c.up}`
    return seen.has(key) ? false : (seen.add(key), true)
  })
}
