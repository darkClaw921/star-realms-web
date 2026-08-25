import { cardDef } from './cards/registry'
import type { CardDef, MissionObjective } from './cards/types'
import type { ScenarioRules } from './scenario'
import type { VariantState } from './variants'
import type { CardDefId, CardIid, Faction, PlayerId } from './ids'
import { FACTIONS } from './ids'
import { opponentOf } from './ids'
import { guardTeam, livePlayers } from './coop'
import type { EffectCtx, GameState, InPlayCard, PlayerState } from './state'

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
export function costFor(
  def: CardDef,
  inPlay: readonly Pick<InPlayCard, 'def'>[],
  /** The Arena scenario and who is buying, where one of them changes prices. */
  ctx?: {
    variant: VariantState | null
    buyer: PlayerId
    /** Buyer's Market: counters sitting on THIS copy of the card. */
    counters?: number
    /** A mission's or a relic's standing discount for this buyer. */
    scenario?: ScenarioRules | null
  },
): number {
  let cost = def.cost
  if (def.discount) {
    const { faction, per } = def.discount
    let n = 0
    for (const c of inPlay) {
      const d = cardDef(c.def)
      if (d.faction === faction || d.faction2 === faction) n++
    }
    cost -= n * per
  }
  const v = ctx?.variant
  if (v && ctx) {
    // Recruiting Drive: bases are a point cheaper for everyone.
    if (v.id === 'recruiting-drive' && (def.type === 'base' || def.type === 'outpost')) cost -= 1
    // Entrenched Loyalties: your assigned faction is a point cheaper for you.
    const mine = v.faction?.[ctx.buyer]
    if (v.id === 'entrenched-loyalties' && mine
        && (def.faction === mine || def.faction2 === mine)) cost -= 1
    // Buyer's Market: one point off per counter this copy has collected.
    if (v.id === 'buyers-market') cost -= ctx.counters ?? 0
  }
  if (ctx) cost -= ctx.scenario?.buyDiscount?.[ctx.buyer] ?? 0
  return Math.max(0, cost)
}

export function isOutpost(c: Pick<InPlayCard, 'def'>): boolean {
  return cardDef(c.def).type === 'outpost'
}

export function hasOutpost(p: Pick<PlayerState, 'inPlay'>): boolean {
  return p.inPlay.some(isOutpost)
}

/**
 * Who this seat is fighting.
 *
 * In a duel, the other player. In a co-op Challenge every player's only enemy
 * is the Boss, and the Boss's enemies are all the players at once -- which is
 * exactly what the printed abilities say ("Each player discards two cards").
 * Two challenges narrow the Boss down to one player, and both do it through
 * `ctx.target`: the Horror hits only the player whose turn just ended, and the
 * Pirates deal with the players one revealed card at a time.
 */
export function foesOf(
  s: Pick<GameState, 'coop' | 'bossSeat'>, seat: PlayerId, ctx?: Pick<EffectCtx, 'target'>,
): readonly PlayerId[] {
  const c = s.coop
  if (!c) return [opponentOf(seat)]
  if (seat !== c.boss) return [c.boss]
  // One player, not the table: see the note on guardTeam. `ctx.target` is the
  // Pirates dealing with the players one at a time, and EACH_FOE setting it in
  // turn for an ability that really does say "each player".
  if (ctx?.target) return [ctx.target]
  const live = livePlayers(c)
  if (c.bossTarget && live.includes(c.bossTarget)) return [c.bossTarget]
  return live.length > 0 ? [live[0] as PlayerId] : [c.players[0] as PlayerId]
}

/** Every living foe. What an ability that says "each player" reaches. */
export function allFoesOf(
  s: Pick<GameState, 'coop' | 'bossSeat'>, seat: PlayerId,
): readonly PlayerId[] {
  const c = s.coop
  if (!c) return [opponentOf(seat)]
  if (seat !== c.boss) return [c.boss]
  return livePlayers(c)
}

/** The single foe, for the many effects that name one. */
export function foeOf(
  s: Pick<GameState, 'coop' | 'bossSeat'>, seat: PlayerId, ctx?: Pick<EffectCtx, 'target'>,
): PlayerId {
  return foesOf(s, seat, ctx)[0] as PlayerId
}

/**
 * The defending groups an attacker faces, each group sharing one Authority
 * score and one Outpost shield.
 *
 * A Hydra team is one group of several seats; everyone else is a group of one.
 * Grouping rather than listing seats is what makes the shield rule fall out
 * instead of being special-cased: a group is protected if ANY of its seats has
 * an Outpost standing.
 */
export function foeGroups(s: GameState, attacker: PlayerId): readonly (readonly PlayerId[])[] {
  // Every foe, not just the turn's named target: the Boss Attacks algorithm
  // scans the whole table before it picks.
  const foes = allFoesOf(s, attacker)
  const seen: PlayerId[] = []
  const out: (readonly PlayerId[])[] = []
  for (const f of foes) {
    if (seen.includes(f)) continue
    const team = guardTeam(s.coop, f).filter((p) => foes.includes(p))
    seen.push(...team)
    out.push(team.length > 0 ? team : [f])
  }
  return out
}

function teamHasOutpost(s: GameState, team: readonly PlayerId[]): boolean {
  return team.some((p) => hasOutpost(s.players[p]))
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
  for (const team of foeGroups(s, chooser)) {
    const shielded = teamHasOutpost(s, team)
    for (const seat of team) {
      for (const c of s.players[seat].inPlay) {
        if (!isBase(c)) continue
        if (shielded && !isOutpost(c)) continue
        out.push(c)
      }
    }
  }
  // Your own bases are always legal targets -- never a teammate's, which the
  // shield above would not protect either way.
  for (const c of s.players[chooser].inPlay) {
    if (isBase(c)) out.push(c)
  }
  return out
}

/** Bases the attacker may spend combat on. Never their own, never a teammate's. */
export function legalAttackTargets(s: GameState, attacker: PlayerId): InPlayCard[] {
  const out: InPlayCard[] = []
  for (const team of foeGroups(s, attacker)) {
    const shielded = teamHasOutpost(s, team)
    for (const seat of team) {
      for (const c of s.players[seat].inPlay) {
        if (isBase(c) && (!shielded || isOutpost(c))) out.push(c)
      }
    }
  }
  return out
}

/** A side may only be hit directly once every outpost shielding it is gone. */
export function canAttackFace(s: GameState, attacker: PlayerId, victim?: PlayerId): boolean {
  const groups = foeGroups(s, attacker)
  const team = victim
    ? groups.find((g) => g.includes(victim)) ?? [victim]
    : groups[0]
  if (!team) return false
  return !teamHasOutpost(s, team)
}

export function findInPlay(s: GameState, iid: CardIid): { owner: PlayerId; card: InPlayCard } | null {
  for (const pid of s.seats) {
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
  s: Pick<GameState, 'players' | 'coop' | 'bossSeat'>,
  owner: PlayerId,
  def: number,
): number {
  const bonus = (pid: PlayerId): number => defenseBonus(s.players[pid].gambitsInPlay)
  let against = 0
  for (const f of foesOf(s as GameState, owner)) against = Math.max(against, bonus(f))
  return Math.max(1, def + bonus(owner) - against)
}

export function defenseBonus(gambitsInPlay: readonly { def: CardDefId }[]): number {
  let n = 0
  for (const g of gambitsInPlay) n += cardDef(g.def).baseDefenseBonus ?? 0
  return n
}

/**
 * The same sum, computed from a VIEW rather than from state.
 *
 * Legality has to be decidable from the view alone, and "can I break this
 * base" is a legality question -- so the number the UI offers and the number
 * the reducer charges come from one place.
 */
export function defenseAgainst(
  defenderGambits: readonly { def: CardDefId }[],
  attackerGambits: readonly { def: CardDefId }[],
  def: number,
): number {
  return Math.max(1, def + defenseBonus(defenderGambits) - defenseBonus(attackerGambits))
}
