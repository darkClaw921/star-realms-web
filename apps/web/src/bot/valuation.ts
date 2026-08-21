import { cardDef, type CardDefId, type Faction, type PlayerView } from '@sr/engine'

/**
 * Card valuation for the heuristic bot.
 *
 * Two layers, as the research recommends: an intrinsic per-card score, then
 * contextual multipliers for game phase, faction synergy, deck thinning and how
 * badly authority is needed. The numbers below encode published base-set
 * strategy consensus rather than invented weights -- notably that Trade Bot and
 * Supply Bot outperform their raw stats because they thin the deck, and that
 * Explorer is the most-bought and worst-performing opening purchase.
 */
interface Val { early: number; late: number }

const V: Record<string, Val> = {
  // The bombs. Flat-scored at the top regardless of phase or colour.
  'brain-world': { early: 95, late: 95 },
  'command-ship': { early: 95, late: 95 },
  'machine-base': { early: 92, late: 92 },
  'dreadnaught': { early: 90, late: 92 },
  'mothership': { early: 90, late: 90 },
  'battlecruiser': { early: 88, late: 90 },

  'blob-world': { early: 78, late: 82 },
  'battle-blob': { early: 70, late: 76 },
  'missile-mech': { early: 70, late: 74 },
  'fleet-hq': { early: 72, late: 66 },
  'blob-carrier': { early: 68, late: 62 },
  'central-office': { early: 66, late: 54 },
  'war-world': { early: 64, late: 68 },
  'royal-redoubt': { early: 62, late: 64 },
  'flagship': { early: 62, late: 62 },
  'blob-destroyer': { early: 60, late: 66 },
  'the-hive': { early: 60, late: 58 },
  'battle-mech': { early: 60, late: 56 },
  'port-of-call': { early: 58, late: 48 },
  'patrol-mech': { early: 58, late: 58 },
  'stealth-needle': { early: 55, late: 60 },
  'space-station': { early: 56, late: 58 },
  'junkyard': { early: 56, late: 32 },
  'cutter': { early: 62, late: 54 },
  'imperial-frigate': { early: 52, late: 56 },
  'trade-escort': { early: 52, late: 50 },
  'recycling-station': { early: 52, late: 38 },
  'mech-world': { early: 52, late: 48 },
  'defense-center': { early: 50, late: 48 },
  'freighter': { early: 50, late: 28 },
  'blob-wheel': { early: 48, late: 32 },
  'missile-bot': { early: 48, late: 46 },
  'battle-station': { early: 46, late: 44 },
  'barter-world': { early: 46, late: 38 },
  'survey-ship': { early: 46, late: 32 },
  'ram': { early: 46, late: 54 },
  'blob-fighter': { early: 45, late: 40 },
  'battle-pod': { early: 44, late: 48 },
  'corvette': { early: 44, late: 40 },
  'embassy-yacht': { early: 44, late: 38 },
  'imperial-fighter': { early: 42, late: 44 },
  'trading-post': { early: 40, late: 28 },
  'trade-pod': { early: 55, late: 30 },
  'supply-bot': { early: 60, late: 34 },
  'trade-bot': { early: 58, late: 20 },
  'federation-shuttle': { early: 30, late: 24 },
  // Demoted hard: 49% of top-level opening buys and the worst net result.
  'explorer': { early: 12, late: 6 },
}

/** Cards whose ability removes a card from your deck permanently. */
const SCRAPPERS = new Set([
  'trade-bot', 'missile-bot', 'supply-bot', 'battle-mech', 'patrol-mech',
  'junkyard', 'machine-base', 'brain-world',
])

export interface Ctx {
  readonly late: boolean
  /** How many cards of each faction the bot already owns. */
  readonly owned: Readonly<Record<Faction, number>>
  readonly ownedTotal: number
  readonly myAuthority: number
  readonly oppAuthority: number
  readonly scrappers: number
}

export function contextFor(v: PlayerView): Ctx {
  const owned: Record<Faction, number> = {
    trade_federation: 0, blob: 0, star_empire: 0, machine_cult: 0, unaligned: 0,
  }
  let total = 0
  let scrappers = 0
  const all: CardDefId[] = [
    ...v.me.deckComposition,
    ...v.me.hand.map((c) => c.def),
    ...v.me.discard.map((c) => c.def),
    ...v.me.inPlay.map((c) => c.def),
  ]
  for (const def of all) {
    const d = cardDef(def)
    owned[d.faction] += 1
    total += 1
    if (SCRAPPERS.has(def as string)) scrappers += 1
  }
  return {
    // Phase is set by deck size AND authority, never deck size alone -- otherwise
    // the bot keeps buying economy into an aggro rush.
    late: v.turn >= 9 || v.me.authority < 30 || v.opponent.authority < 26,
    owned,
    ownedTotal: total,
    myAuthority: v.me.authority,
    oppAuthority: v.opponent.authority,
    scrappers,
  }
}

export function valueOf(def: CardDefId, ctx: Ctx): number {
  const d = cardDef(def)
  const base = V[def as string] ?? { early: 40, late: 40 }
  let score = ctx.late ? base.late : base.early

  // Faction synergy, capped at ~35% of intrinsic value. The community consensus
  // ("faction fallacy") is that a bot chasing colour loses to one that does not.
  if (d.faction !== 'unaligned') {
    const n = ctx.owned[d.faction]
    const synergy = Math.min(0.35 * score, score * 0.06 * Math.min(n, 6))
    score += synergy
  }

  // Deck thinning. This single term reproduces the empirical result that the
  // cheap scrap bots are the best opening buys despite unremarkable statlines.
  if (SCRAPPERS.has(def as string)) {
    const remainingCycles = Math.max(0, 5 - Math.floor(ctx.ownedTotal / 10))
    if (ctx.scrappers >= 4 || remainingCycles < 1) score -= 14
    else score += 6 * remainingCycles
  }

  // When the bot is being raced, authority is worth real points.
  if (ctx.myAuthority < 26) {
    for (const e of d.primary) {
      if (e.k === 'GAIN_AUTHORITY') score += e.n * 2.2
    }
  }
  // ...and when it is winning the race, it is worth almost nothing.
  if (ctx.oppAuthority < 18) {
    for (const e of d.primary) {
      if (e.k === 'GAIN_COMBAT') score += e.n * 1.6
      if (e.k === 'GAIN_AUTHORITY') score -= e.n * 0.8
    }
  }
  return score
}
