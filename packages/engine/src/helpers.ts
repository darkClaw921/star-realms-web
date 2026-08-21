import { cardDef } from './cards/registry'
import type { CardDef, MissionObjective } from './cards/types'
import type { CardDefId, CardIid, Faction, PlayerId } from './ids'
import { FACTIONS } from './ids'
import { opponentOf } from './ids'
import type { GameState, InPlayCard, PlayerState } from './state'

/** The definition whose ally/scrap/triggers this card currently uses. */
export function effectiveDefId(c: Pick<InPlayCard, 'def' | 'copiedDef'>): CardDefId {
  return c.copiedDef ?? c.def
}

/**
 * A card's factions. Normally one; Stealth Needle after copying has two --
 * Machine Cult plus the copied ship's faction -- and counts as both for ally
 * purposes.
 */
export function factionsOf(
  c: Pick<InPlayCard, 'def' | 'copiedDef'> & Partial<Pick<InPlayCard, 'chosenFaction'>>,
): Faction[] {
  const printed = cardDef(c.def)
  // United's dual-faction cards are printed with two, and count as both for
  // every ally condition -- including the other card's.
  const out = printed.faction2 ? [printed.faction, printed.faction2] : [printed.faction]
  // The Colossus picks its faction on play; the Needle copies one.
  for (const extra of [c.chosenFaction, c.copiedDef ? cardDef(c.copiedDef).faction : null]) {
    if (extra && !out.includes(extra)) out.push(extra)
  }
  return out
}

export function isWildcard(c: Pick<InPlayCard, 'def' | 'copiedDef'>): boolean {
  return cardDef(c.def).factionWildcard
}

/**
 * How many in-play cards satisfy faction F. Mech World satisfies every faction,
 * so it counts here for all of them. A card's own ally needs this to be >= 2,
 * i.e. at least one OTHER qualifying card.
 */
export function allyCountFor(
  p: Pick<PlayerState, 'inPlay'> & Partial<Pick<PlayerState, 'phantomFactions'>>,
  f: Faction,
): number {
  let n = 0
  for (const c of p.inPlay) {
    if (isWildcard(c) || factionsOf(c).includes(f)) n++
  }
  // Stealth's phantom card counts here and nowhere else: it satisfies ally
  // conditions without being a card in play.
  for (const pf of p.phantomFactions ?? []) if (pf === f) n++
  return n
}

/**
 * Whitelist, not "anything that is not a ship".
 *
 * Crisis' Heroes sit in the play area beside your bases without being bases:
 * they cannot be attacked or destroyed, and they must not count for Embassy
 * Yacht or Central Station. Written as a negation, every one of those would
 * silently include them.
 */
export function isBase(c: Pick<InPlayCard, 'def'>): boolean {
  const t = cardDef(c.def).type
  return t === 'base' || t === 'outpost'
}

/** Crisis' Heroes: in play, but not a base and not a ship. */
export function isHero(c: Pick<InPlayCard, 'def'>): boolean {
  return cardDef(c.def).type === 'hero'
}

/** High Alert's Tech: in play permanently, and never spent by being used. */
export function isTech(c: Pick<InPlayCard, 'def'>): boolean {
  return cardDef(c.def).type === 'tech'
}

/**
 * What this card costs THIS player right now.
 *
 * High Alert prices some cards against your board: "pay 1 Trade less for each
 * Machine Cult card you have in play". Every place that reads a price has to go
 * through here -- the trade row, the buy, and the UI -- or the three will
 * disagree and a card will look affordable and then be refused.
 */
export function costFor(def: CardDef, inPlay: readonly Pick<InPlayCard, 'def'>[]): number {
  if (!def.discount) return def.cost
  const { faction, per } = def.discount
  let n = 0
  for (const c of inPlay) {
    const d = cardDef(c.def)
    if (d.faction === faction || d.faction2 === faction) n++
  }
  return Math.max(0, def.cost - n * per)
}

export function isOutpost(c: Pick<InPlayCard, 'def'>): boolean {
  return cardDef(c.def).type === 'outpost'
}

export function hasOutpost(p: Pick<PlayerState, 'inPlay'>): boolean {
  return p.inPlay.some(isOutpost)
}

/**
 * Bases `chooser` may target with a free "destroy target base" effect.
 *
 * The outpost shield protects a player's non-outpost bases from being attacked
 * OR TARGETED *by an opponent* -- so it constrains what you may pick among the
 * opponent's bases, but never among your own. Per the physical rules (the digital
 * app differs here) your own bases are legal targets.
 */
export function legalDestroyTargets(s: GameState, chooser: PlayerId): InPlayCard[] {
  const out: InPlayCard[] = []
  const opp = s.players[opponentOf(chooser)]
  const oppShielded = hasOutpost(opp)
  for (const c of opp.inPlay) {
    if (!isBase(c)) continue
    if (oppShielded && !isOutpost(c)) continue
    out.push(c)
  }
  for (const c of s.players[chooser].inPlay) {
    if (isBase(c)) out.push(c)
  }
  return out
}

/** Bases the attacker may spend combat on. Never their own. */
export function legalAttackTargets(s: GameState, attacker: PlayerId): InPlayCard[] {
  const def = s.players[opponentOf(attacker)]
  const shielded = hasOutpost(def)
  return def.inPlay.filter((c) => isBase(c) && (!shielded || isOutpost(c)))
}

/** The opponent may only be hit directly once every outpost is gone. */
export function canAttackFace(s: GameState, attacker: PlayerId): boolean {
  return !hasOutpost(s.players[opponentOf(attacker)])
}

export function findInPlay(s: GameState, iid: CardIid): { owner: PlayerId; card: InPlayCard } | null {
  for (const pid of ['p1', 'p2'] as const) {
    const card = s.players[pid].inPlay.find((c) => c.iid === iid)
    if (card) return { owner: pid, card }
  }
  return null
}

/** Which faction a given ally slot is pinned to, if any. */
export function allySlotFaction(
  def: CardDef, slot: 'ally' | 'ally2' | 'ally3' | 'ally4',
): Faction | undefined {
  switch (slot) {
    case 'ally': return def.allyFaction
    case 'ally2': return def.ally2Faction
    case 'ally3': return def.ally3Faction
    case 'ally4': return def.ally4Faction
  }
}

/**
 * Is this mission's objective currently satisfied?
 *
 * Read off state the engine already keeps, which is the reason two of these
 * added per-turn counters rather than being approximated: a mission that is
 * "nearly" checkable is a mission that fires at the wrong moment.
 */
export interface ObjectiveContext {
  readonly inPlay: readonly (Pick<InPlayCard, 'def' | 'copiedDef'>
    & Partial<Pick<InPlayCard, 'chosenFaction'>>)[]
  readonly shipsPlayedThisTurn: readonly { readonly def: CardDefId }[]
  readonly alliesUsedThisTurn: readonly {
    readonly def: CardDefId
    readonly slot: 'ally' | 'ally2' | 'ally3' | 'ally4' | 'doubleAlly'
  }[]
  readonly gainedThisTurn: { readonly trade: number; readonly combat: number; readonly authority: number }
}

export function objectiveMet(p: ObjectiveContext, o: MissionObjective): boolean {
  const inPlayFactions = (pred: (c: Pick<InPlayCard, 'def' | 'copiedDef'>) => boolean): Faction[] => {
    const out: Faction[] = []
    for (const c of p.inPlay) {
      if (!pred(c)) continue
      for (const f of factionsOf(c)) if (f !== 'unaligned' && !out.includes(f)) out.push(f)
    }
    return out
  }
  const countOf = (f: Faction, pred: (c: Pick<InPlayCard, 'def'>) => boolean): number =>
    p.inPlay.filter((c) => pred(c) && factionsOf(c).includes(f)).length

  switch (o.o) {
    case 'ALLY_FACTIONS_THIS_TURN': {
      const seen = new Set<Faction>()
      for (const u of p.alliesUsedThisTurn) {
        const def = cardDef(u.def)
        const pinned = allySlotFaction(def, u.slot === 'doubleAlly' ? 'ally' : u.slot)
        for (const f of pinned ? [pinned] : [def.faction, def.faction2]) {
          if (f && f !== 'unaligned') seen.add(f)
        }
      }
      return seen.size >= o.n
    }
    case 'SHIPS_PLAYED_THIS_TURN':
      return p.shipsPlayedThisTurn.length >= o.n
    case 'SHIP_FACTIONS_PLAYED_THIS_TURN': {
      const seen = new Set<Faction>()
      for (const c of p.shipsPlayedThisTurn) {
        const def = cardDef(c.def)
        for (const f of [def.faction, def.faction2]) {
          if (f && f !== 'unaligned') seen.add(f)
        }
      }
      return seen.size >= o.n
    }
    case 'BASES_SAME_FACTION':
      return FACTIONS.some((f) => f !== 'unaligned' && countOf(f, isBase) >= o.n)
    case 'BASE_FACTIONS':
      return inPlayFactions(isBase).length >= o.n
    case 'CARDS_SAME_FACTION_IN_PLAY':
      return FACTIONS.some((f) => f !== 'unaligned' && countOf(f, () => true) >= o.n)
    case 'OUTPOSTS_IN_PLAY':
      return p.inPlay.filter(isOutpost).length >= o.n
    case 'SHIP_PLAYED_WITH_BASE':
      return p.shipsPlayedThisTurn.some((c) => factionsOf({ ...c, copiedDef: null }).includes(o.faction))
        && p.inPlay.some((c) => isBase(c) && factionsOf(c).includes(o.faction))
    case 'GAINED_THIS_TURN':
      return p.gainedThisTurn.trade >= o.trade
        && p.gainedThisTurn.combat >= o.combat
        && p.gainedThisTurn.authority >= o.authority
  }
}

/**
 * What a base actually has to survive.
 *
 * Unity Warcraft reads "your bases get +1 defense, your opponent's get -1", so
 * the modifier is the owner's bonus minus the other side's. Every place that
 * compares combat against a base has to go through here, or a base will be
 * destroyable by an amount the UI said was not enough.
 */
export function defenseOf(
  players: Record<PlayerId, { gambitsInPlay: readonly { def: CardDefId }[] }>,
  owner: PlayerId,
  def: number,
): number {
  const bonus = (pid: PlayerId): number => {
    let n = 0
    for (const g of players[pid].gambitsInPlay) n += cardDef(g.def).baseDefenseBonus ?? 0
    return n
  }
  return Math.max(1, def + bonus(owner) - bonus(opponentOf(owner)))
}
