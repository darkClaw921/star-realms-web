import { cardDef } from './cards/registry'
import type { CardDefId, CardIid, Faction, PlayerId } from './ids'
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
export function factionsOf(c: Pick<InPlayCard, 'def' | 'copiedDef'>): Faction[] {
  const own = cardDef(c.def).faction
  if (!c.copiedDef) return [own]
  const copied = cardDef(c.copiedDef).faction
  return copied === own ? [own] : [own, copied]
}

export function isWildcard(c: Pick<InPlayCard, 'def' | 'copiedDef'>): boolean {
  return cardDef(c.def).factionWildcard
}

/**
 * How many in-play cards satisfy faction F. Mech World satisfies every faction,
 * so it counts here for all of them. A card's own ally needs this to be >= 2,
 * i.e. at least one OTHER qualifying card.
 */
export function allyCountFor(p: Pick<PlayerState, 'inPlay'>, f: Faction): number {
  let n = 0
  for (const c of p.inPlay) {
    if (isWildcard(c) || factionsOf(c).includes(f)) n++
  }
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
