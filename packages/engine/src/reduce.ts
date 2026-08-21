import { produce, type Draft } from 'immer'
import type { Action, Command } from './actions'
import { TENTACLE_FACTIONS } from './boss'
import { cardDef, EXPLORER } from './cards/registry'
import type { ChoiceOption, PendingChoice, PromptKind } from './choices'
import { sameOption } from './choices'
import type { Effect, EffectBranch } from './effects'
import type { GameEvent } from './events'
import {
  allyCountFor, canAttackFace, effectiveDefId, factionsOf, findInPlay, isBase,
  isOutpost, legalAttackTargets, legalDestroyTargets,
} from './helpers'
import type { CardDefId, CardIid, ChoiceId, Faction, PlayerId, Zone } from './ids'
import { FACTIONS, opponentOf, PLAYERS } from './ids'
import { nextHex, shuffle } from './rng'
import {
  EXPLORER_COST, HAND_SIZE, TRADE_ROW_SIZE, emptyFactionCounts,
  type CardInstance, type ChoiceCont, type EffectCtx, type GameState, type InPlayCard,
  type PlayerState, type ResolutionFrame,
} from './state'
import { actorOf } from './state'

export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalActionError'
  }
}

export interface ReduceResult {
  readonly state: GameState
  readonly events: readonly GameEvent[]
}

type D = Draft<GameState>
type DP = Draft<PlayerState>

/** Guards against a malformed card definition spinning settle() forever. */
const MAX_RESOLUTION_STEPS = 10_000

// ─────────────────────────────── small helpers ───────────────────────────────

function mintId(d: D, len = 10): string {
  const [hex, next] = nextHex(d.rng, len)
  d.rng = next as Draft<GameState>['rng']
  return hex
}

function pushEffects(d: D, effects: readonly Effect[], ctx: EffectCtx): void {
  const frames = effects.map((effect) => ({ f: 'effect' as const, effect, ctx }))
  d.resolution.unshift(...(frames as Draft<GameState>['resolution']))
}

function pushChoice(d: D, choice: PendingChoice, cont?: ChoiceCont): void {
  const frame: ResolutionFrame = cont ? { f: 'choice', choice, cont } : { f: 'choice', choice }
  d.resolution.unshift(frame as Draft<GameState>['resolution'][number])
}

function gain(d: D, pid: PlayerId, what: 'trade' | 'combat' | 'authority', n: number, ev: GameEvent[]): void {
  if (n === 0) return
  const p = d.players[pid]
  if (what === 'trade') p.trade += n
  else if (what === 'combat') p.combat += n
  else p.authority += n
  ev.push({ e: 'GAIN', player: pid, what, n })
}

function win(d: D, who: PlayerId, ev: GameEvent[]): void {
  d.winner = who
  d.phase = 'gameOver'
  d.resolution = []
  ev.push({ e: 'GAME_OVER', winner: who })
}

/**
 * Zero authority always ends the game, in every scenario -- a mission can add a
 * way to win, never take away the way to lose. Only when nobody is dead does an
 * objective get consulted, so a hero who completes their objective on the same
 * turn they are killed still loses.
 */
function checkWin(d: D, ev: GameEvent[]): void {
  if (d.winner) return
  for (const pid of PLAYERS) {
    if (d.players[pid].authority <= 0) {
      win(d, opponentOf(pid), ev)
      return
    }
  }

  const sc = d.scenario
  if (!sc) return
  const hero = sc.hero
  switch (sc.objective.k) {
    case 'AUTHORITY':
      return
    case 'SURVIVE':
      // The turn counter has already advanced past the last turn to survive.
      if (d.turn > sc.objective.turns) win(d, hero, ev)
      return
    case 'DESTROY_BASES':
      if (d.basesDestroyed[hero] >= sc.objective.n) win(d, hero, ev)
      return
    case 'REACH_AUTHORITY':
      if (d.players[hero].authority >= sc.objective.n) win(d, hero, ev)
      return
    case 'DESTROY_TENTACLES': {
      const b = d.boss
      if (b && TENTACLE_FACTIONS.every((f) => b.tentaclesDestroyed.includes(f))) win(d, hero, ev)
      return
    }
  }
}

/**
 * Draw with lazy reshuffle.
 *
 * Tolerant by design: if both deck and discard are empty we simply draw fewer
 * cards. That is not hypothetical -- Junkyard, Brain World, Machine Base and
 * Patrol Mech's ally permanently remove your own cards, so a deck really can run
 * dry. There is no deck-out loss condition.
 */
function drawCards(d: D, pid: PlayerId, n: number, ev: GameEvent[]): CardDefId[] {
  const p = d.players[pid]
  const drawn: CardDefId[] = []
  for (let i = 0; i < n; i++) {
    if (p.deck.length === 0) {
      if (p.discard.length === 0) break
      const [shuffled, next] = shuffle(d.rng, p.discard as CardInstance[])
      d.rng = next as Draft<GameState>['rng']
      p.deck = shuffled as DP['deck']
      ev.push({ e: 'RESHUFFLE', player: pid, n: p.discard.length })
      p.discard = []
    }
    const c = p.deck.shift()
    if (!c) break
    p.hand.push(c)
    drawn.push(c.def)
  }
  if (drawn.length > 0) ev.push({ e: 'DRAW', player: pid, n: drawn.length, defs: drawn })
  return drawn
}

function refillTradeRow(d: D, ev: GameEvent[]): void {
  for (let i = 0; i < TRADE_ROW_SIZE; i++) {
    if (d.tradeRow[i]) continue
    const c = d.tradeDeck.shift() ?? null
    d.tradeRow[i] = c
    ev.push({ e: 'TRADE_ROW_REFILL', def: c?.def ?? null, slot: i })
  }
}

/**
 * Send a card to the scrap heap -- removed from the game.
 *
 * One exception, and it is a printed rule: an Explorer that would go to the scrap
 * heap goes back to the Explorer pile instead. This applies to genuine Explorer
 * cards only, not to a Stealth Needle that copied one.
 */
function toScrapHeap(d: D, inst: CardInstance, from: Zone, owner: PlayerId | null, ev: GameEvent[]): void {
  if (inst.def === EXPLORER) {
    d.explorerPile += 1
  } else {
    d.scrapHeap.push(inst)
  }
  ev.push({ e: 'SCRAP', from, owner, iid: inst.iid, def: inst.def })
}

function removeFromZone(d: D, pid: PlayerId, zone: Zone, iid: CardIid): CardInstance | null {
  const p = d.players[pid]
  const list = zone === 'hand' ? p.hand : zone === 'discard' ? p.discard : null
  if (!list) return null
  const idx = list.findIndex((c) => c.iid === iid)
  if (idx < 0) return null
  return list.splice(idx, 1)[0] as CardInstance
}

/** Recompute which factions have had their ally condition met. Never un-unlocks. */
function recomputeAlly(d: D, pid: PlayerId, ev: GameEvent[]): void {
  const p = d.players[pid]
  for (const f of FACTIONS) {
    if (f === 'unaligned') continue
    if (p.allyUnlocked.includes(f)) continue
    if (allyCountFor(p, f) >= 2) {
      p.allyUnlocked.push(f)
      ev.push({ e: 'ALLY_UNLOCKED', player: pid, faction: f })
    }
  }
}

function acquire(
  d: D, pid: PlayerId, inst: CardInstance, cost: number,
  dest: 'discard' | 'deck_top', ev: GameEvent[],
): void {
  const p = d.players[pid]
  ev.push({ e: 'ACQUIRE', player: pid, def: inst.def, dest, cost })
  if (dest === 'deck_top') {
    p.deck.unshift(inst)
    return
  }
  p.discard.push(inst)
  // Freighter / Central Office: offer to redirect this acquisition to the deck top.
  if (p.pendingTopdeck > 0 && cardDef(inst.def).type === 'ship') {
    pushChoice(d, {
      id: mintId(d) as ChoiceId,
      actor: pid,
      prompt: 'TOPDECK_ACQUIRED',
      source: null,
      label: `Put ${cardDef(inst.def).name} on top of your deck?`,
      min: 0,
      max: 1,
      options: [{ o: 'CARD', iid: inst.iid, def: inst.def, zone: 'discard', owner: pid }],
    })
  }
}

function destroyBase(
  d: D, owner: PlayerId, card: InPlayCard, by: 'combat' | 'effect', ev: GameEvent[],
  destroyer: PlayerId = opponentOf(owner),
): void {
  const p = d.players[owner]
  const idx = p.inPlay.findIndex((c) => c.iid === card.iid)
  if (idx < 0) return
  // Only enemy bases count. "Destroy target base" may legally target your own,
  // and a mission asking you to break a blockade must not be satisfiable by
  // demolishing your own outpost.
  if (destroyer !== owner) d.basesDestroyed[destroyer] += 1
  p.inPlay.splice(idx, 1)
  // Destroyed bases go to their OWNER'S discard pile, not the scrap heap --
  // they cycle back into that player's deck.
  p.discard.push({ iid: card.iid, def: card.def })
  ev.push({ e: 'BASE_DESTROYED', owner, iid: card.iid, def: card.def, by })
}

// ────────────────────────────── choice building ──────────────────────────────

function cardOpts(cards: readonly CardInstance[], zone: Zone, owner: PlayerId): ChoiceOption[] {
  return cards.map((c) => ({ o: 'CARD' as const, iid: c.iid, def: c.def, zone, owner }))
}

function makeChoice(
  d: D, actor: PlayerId, prompt: PromptKind, label: string,
  min: number, max: number, options: ChoiceOption[], source: CardIid | null,
): PendingChoice {
  return { id: mintId(d) as ChoiceId, actor, prompt, source, label, min, max, options }
}

// ──────────────────────────────── effect engine ──────────────────────────────

function applyEffect(d: D, effect: Effect, ctx: EffectCtx, ev: GameEvent[]): void {
  const me = ctx.controller
  const p = d.players[me]

  switch (effect.k) {
    case 'GAIN_TRADE': return gain(d, me, 'trade', effect.n, ev)
    case 'GAIN_COMBAT': return gain(d, me, 'combat', effect.n, ev)
    case 'GAIN_AUTHORITY': return gain(d, me, 'authority', effect.n, ev)
    case 'DRAW': { drawCards(d, me, effect.n, ev); return }

    case 'SEQ': return pushEffects(d, effect.effects, ctx)

    // ── Frontiers Challenges ────────────────────────────────────────────────
    case 'BOSS_TURN': return pushEffects(d, bossOrderOfPlay(d), ctx)
    case 'BOSS_END_TURN': {
      if (d.boss) d.boss.acting = false
      endTurn(d, ev)
      return
    }
    case 'BOSS_ATTACK': { bossAttacks(d, ev); return }
    case 'BOSS_ASSIMILATE': { automatonsStep(d, ev); return }
    case 'BOSS_NEMESIS_STEP': { nemesisStep(d, ev, ctx); return }
    case 'BOSS_HORROR_STEP': { horrorStep(d, ev, ctx); return }
    case 'BOSS_PIRATE_STEP': { pirateStep(d, ev, ctx); return }

    case 'IF': {
      if (evalCondition(d, me, effect.cond)) pushEffects(d, effect.then, ctx)
      return
    }

    case 'PER': {
      const n = p.factionPlayedThisTurn[effect.ref.faction]
      if (n <= 0) { ev.push({ e: 'FIZZLE', label: 'nothing to count' }); return }
      const repeated: Effect[] = []
      for (let i = 0; i < n; i++) repeated.push(...effect.then)
      return pushEffects(d, repeated, ctx)
    }

    case 'MAY': {
      pushChoice(
        d,
        makeChoice(d, me, 'MAY', effect.label, 0, 1, [{ o: 'CONFIRM' }], ctx.source),
        { c: 'MAY', then: effect.then },
      )
      return
    }

    case 'CHOOSE_ONE': {
      const opts: ChoiceOption[] = effect.branches.map((b: EffectBranch, i: number) =>
        ({ o: 'BRANCH', index: i, label: b.label }))
      pushChoice(
        d,
        makeChoice(d, me, 'CHOOSE_BRANCH', 'Choose one', 1, 1, opts, ctx.source),
        { c: 'BRANCHES', branches: effect.branches },
      )
      return
    }

    case 'OPPONENT_DISCARD': {
      const target = opponentOf(me)
      const hand = d.players[target].hand as CardInstance[]
      if (hand.length === 0) { ev.push({ e: 'FIZZLE', label: 'opponent has no cards to discard' }); return }
      const n = Math.min(effect.n, hand.length)
      const label = n === 1 ? 'Discard a card' : `Discard ${n} cards`
      pushChoice(d, makeChoice(d, target, 'DISCARD', label, n, n,
        cardOpts(hand, 'hand', target), ctx.source))
      return
    }

    case 'DESTROY_BASE': {
      const targets = legalDestroyTargets(d as unknown as GameState, me)
      if (targets.length === 0) { ev.push({ e: 'FIZZLE', label: 'no base to destroy' }); return }
      const opts: ChoiceOption[] = targets.map((c) => ({
        o: 'CARD', iid: c.iid, def: c.def, zone: 'inPlay',
        owner: d.players[me].inPlay.some((x) => x.iid === c.iid) ? me : opponentOf(me),
      }))
      pushChoice(d, makeChoice(d, me, 'DESTROY_BASE', 'Destroy target base', effect.min, effect.max, opts, ctx.source))
      return
    }

    case 'SCRAP_TRADE_ROW': {
      const opts: ChoiceOption[] = []
      for (const c of d.tradeRow) {
        if (c) opts.push({ o: 'CARD', iid: c.iid, def: c.def, zone: 'tradeRow', owner: null })
      }
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'trade row is empty' }); return }
      pushChoice(d, makeChoice(d, me, 'SCRAP_TRADE_ROW', 'Scrap a card in the trade row',
        effect.min, effect.max, opts, ctx.source))
      return
    }

    case 'SCRAP_FROM_ZONES': {
      const opts: ChoiceOption[] = []
      if (effect.zones.includes('hand')) opts.push(...cardOpts(p.hand as CardInstance[], 'hand', me))
      if (effect.zones.includes('discard')) opts.push(...cardOpts(p.discard as CardInstance[], 'discard', me))
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'nothing to scrap' }); return }
      const max = Math.min(effect.max, opts.length)
      const min = Math.min(effect.min, opts.length)
      const label = min === 0 ? 'You may scrap a card' : 'Scrap a card'
      pushChoice(d, makeChoice(d, me, 'SCRAP_ZONES', label, min, max, opts, ctx.source))
      return
    }

    case 'SCRAP_THEN_DRAW': {
      const opts: ChoiceOption[] = []
      if (effect.zones.includes('hand')) opts.push(...cardOpts(p.hand as CardInstance[], 'hand', me))
      if (effect.zones.includes('discard')) opts.push(...cardOpts(p.discard as CardInstance[], 'discard', me))
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'nothing to scrap' }); return }
      pushChoice(d, makeChoice(d, me, 'SCRAP_THEN_DRAW',
        `Scrap up to ${effect.max} cards, then draw one for each`, 0,
        Math.min(effect.max, opts.length), opts, ctx.source))
      return
    }

    case 'DISCARD_THEN_DRAW': {
      const opts = cardOpts(p.hand as CardInstance[], 'hand', me)
      pushChoice(d, makeChoice(d, me, 'DISCARD_THEN_DRAW',
        `Discard up to ${effect.max} cards, then draw that many`, 0,
        Math.min(effect.max, opts.length), opts, ctx.source))
      return
    }

    case 'ACQUIRE_FREE': {
      const opts: ChoiceOption[] = []
      d.tradeRow.forEach((c) => {
        if (!c) return
        const def = cardDef(c.def)
        if (effect.filter === 'ship' && def.type !== 'ship') return
        if (effect.maxCost !== null && def.cost > effect.maxCost) return
        opts.push({ o: 'CARD', iid: c.iid, def: c.def, zone: 'tradeRow', owner: null })
      })
      if (d.explorerPile > 0 && (effect.maxCost === null || EXPLORER_COST <= effect.maxCost)) {
        opts.push({ o: 'EXPLORER' })
      }
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'nothing to acquire' }); return }
      pushChoice(
        d,
        makeChoice(d, me, 'ACQUIRE_FREE', 'Acquire a ship for free', 1, 1, opts, ctx.source),
        { c: 'ACQUIRE', dest: effect.dest },
      )
      return
    }

    case 'TOPDECK_NEXT_ACQUIRED': {
      p.pendingTopdeck += 1
      return
    }

    case 'COPY_SHIP': {
      const src = ctx.source
      const opts: ChoiceOption[] = p.shipsPlayedThisTurn
        .filter((c) => c.iid !== src)
        .map((c) => ({ o: 'CARD' as const, iid: c.iid, def: c.def, zone: 'inPlay' as Zone, owner: me }))
      if (opts.length === 0) {
        // No legal target: the Needle still enters play, as a plain Machine Cult
        // ship with no abilities. Never block the play, never softlock the prompt.
        ev.push({ e: 'FIZZLE', label: 'no ship to copy' })
        return
      }
      pushChoice(d, makeChoice(d, me, 'COPY_SHIP', 'Copy a ship you played this turn', 1, 1, opts, src))
      return
    }
  }
}

function evalCondition(d: D, me: PlayerId, cond: { c: 'BASES_IN_PLAY_AT_LEAST'; n: number }): boolean {
  switch (cond.c) {
    case 'BASES_IN_PLAY_AT_LEAST':
      return d.players[me].inPlay.filter(isBase).length >= cond.n
  }
}

// ─────────────────────────────── choice resolution ───────────────────────────

type ChoiceFrame = Extract<ResolutionFrame, { f: 'choice' }>

function resolveChoice(d: D, frame: ChoiceFrame, selected: readonly ChoiceOption[], ev: GameEvent[]): void {
  const c = frame.choice
  const cont = frame.cont
  const me = c.actor
  const p = d.players[me]
  const ctx: EffectCtx = { controller: me, source: c.source, slot: 'primary' }

  switch (c.prompt) {
    case 'DISCARD': {
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, 'hand', o.iid)
        if (inst) {
          p.discard.push(inst)
          ev.push({ e: 'DISCARD', player: me, iid: inst.iid, def: inst.def })
        }
      }
      return
    }

    case 'SCRAP_ZONES': {
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, o.zone, o.iid)
        // Scrapping a card FROM hand or discard never triggers that card's own
        // scrap ability -- only a card using its own scrap ability from play does.
        if (inst) toScrapHeap(d, inst, o.zone, me, ev)
      }
      return
    }

    case 'SCRAP_THEN_DRAW': {
      let n = 0
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, o.zone, o.iid)
        if (inst) { toScrapHeap(d, inst, o.zone, me, ev); n++ }
      }
      if (n > 0) pushEffects(d, [{ k: 'DRAW', n }], ctx)
      return
    }

    case 'DISCARD_THEN_DRAW': {
      // All discards land BEFORE any draw: if the deck empties during the draws,
      // the reshuffled discard pile already contains what was just discarded.
      let n = 0
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, 'hand', o.iid)
        if (inst) {
          p.discard.push(inst)
          ev.push({ e: 'DISCARD', player: me, iid: inst.iid, def: inst.def })
          n++
        }
      }
      if (n > 0) pushEffects(d, [{ k: 'DRAW', n }], ctx)
      return
    }

    case 'SCRAP_TRADE_ROW': {
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const idx = d.tradeRow.findIndex((x) => x?.iid === o.iid)
        if (idx < 0) continue
        const inst = d.tradeRow[idx] as CardInstance
        d.tradeRow[idx] = null
        toScrapHeap(d, inst, 'tradeRow', null, ev)
      }
      refillTradeRow(d, ev)
      return
    }

    case 'DESTROY_BASE': {
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const found = findInPlay(d as unknown as GameState, o.iid)
        // `me` resolves the choice, so `me` is the destroyer -- which matters
        // because the target may legally be one of their own bases.
        if (found) destroyBase(d, found.owner, found.card, 'effect', ev, me)
      }
      return
    }

    case 'CHOOSE_BRANCH': {
      const o = selected[0]
      if (!o || o.o !== 'BRANCH') return
      const branch = cont?.c === 'BRANCHES' ? cont.branches[o.index] : undefined
      if (branch) pushEffects(d, branch.then, ctx)
      return
    }

    case 'MAY': {
      // Declining is simply selecting nothing; the body never gets pushed.
      if (selected.length > 0 && cont?.c === 'MAY') pushEffects(d, cont.then, ctx)
      return
    }

    case 'ACQUIRE_FREE': {
      const o = selected[0]
      if (!o) return
      const dest = cont?.c === 'ACQUIRE' ? cont.dest : 'discard'
      if (o.o === 'EXPLORER') {
        if (d.explorerPile <= 0) return
        d.explorerPile -= 1
        acquire(d, me, { iid: mintId(d, 12) as CardIid, def: EXPLORER }, 0, dest, ev)
        return
      }
      if (o.o !== 'CARD') return
      const idx = d.tradeRow.findIndex((x) => x?.iid === o.iid)
      if (idx < 0) return
      const inst = d.tradeRow[idx] as CardInstance
      d.tradeRow[idx] = null
      acquire(d, me, inst, 0, dest, ev)
      refillTradeRow(d, ev)
      return
    }

    case 'TOPDECK_ACQUIRED': {
      const o = selected[0]
      if (!o || o.o !== 'CARD') return
      const idx = p.discard.findIndex((x) => x.iid === o.iid)
      if (idx < 0) return
      const inst = p.discard.splice(idx, 1)[0] as CardInstance
      p.deck.unshift(inst)
      p.pendingTopdeck = Math.max(0, p.pendingTopdeck - 1)
      ev.push({ e: 'ACQUIRE', player: me, def: inst.def, dest: 'deck_top', cost: 0 })
      return
    }

    case 'COPY_SHIP': {
      const o = selected[0]
      if (!o || o.o !== 'CARD') return
      const needle = c.source ? p.inPlay.find((x) => x.iid === c.source) : undefined
      if (!needle) return
      needle.copiedDef = o.def
      ev.push({ e: 'COPY_SHIP', player: me, iid: needle.iid, copied: o.def })
      // The Needle becomes a full copy: resolve the copied ship's primary now, and
      // it gains that ship's ally/scrap for the rest of the turn. Its faction set
      // grows too -- but the copy does NOT count as a card played, so the
      // faction-played counters (Blob World) are deliberately untouched.
      pushEffects(d, cardDef(o.def).primary, { controller: me, source: needle.iid, slot: 'primary' })
      return
    }
  }
}

// ─────────────────────────────────── settle ──────────────────────────────────

/**
 * Run the resolution stack until it is empty or blocked on a real choice.
 *
 * Implements the rulebook's general partial-resolution rule -- "if you cannot
 * resolve part of an ability, just do as much as you can in the order written" --
 * as ONE rule here rather than ad hoc per card: a mandatory choice with no legal
 * options fizzles instead of deadlocking.
 */
export function settle(d: D, ev: GameEvent[]): void {
  let steps = 0
  for (;;) {
    if (++steps > MAX_RESOLUTION_STEPS) throw new Error('settle: resolution did not converge')
    for (const pid of PLAYERS) recomputeAlly(d, pid, ev)
    checkWin(d, ev)
    if (d.phase === 'gameOver') return

    const top = d.resolution[0]
    if (!top) return

    if (top.f === 'effect') {
      d.resolution.shift()
      applyEffect(d, top.effect as Effect, top.ctx as EffectCtx, ev)
      continue
    }

    const choice = top.choice as PendingChoice
    if (choice.options.length === 0) {
      d.resolution.shift()
      if (choice.min > 0) ev.push({ e: 'FIZZLE', label: choice.label })
      continue
    }
    if (choice.options.length <= choice.min) {
      // No meaningful decision: resolve it silently but still narrate it.
      const frame = d.resolution.shift() as unknown as ChoiceFrame
      ev.push({ e: 'CHOICE_AUTO_RESOLVED', player: choice.actor, label: choice.label })
      resolveChoice(d, frame, choice.options, ev)
      continue
    }
    return // blocked on real input
  }
}

// ────────────────────────────────── actions ──────────────────────────────────

function playCard(d: D, me: PlayerId, iid: CardIid, ev: GameEvent[]): void {
  const p = d.players[me]
  const idx = p.hand.findIndex((c) => c.iid === iid)
  if (idx < 0) throw new IllegalActionError(`card ${iid} is not in hand`)
  const inst = p.hand.splice(idx, 1)[0] as CardInstance
  const def = cardDef(inst.def)

  const card: InPlayCard = {
    iid: inst.iid,
    def: inst.def,
    copiedDef: null,
    used: { primary: false, ally: false, scrap: false },
    playedThisTurn: true,
  }
  p.inPlay.push(card as Draft<InPlayCard>)
  p.factionPlayedThisTurn[def.faction] += 1
  if (def.type === 'ship') p.shipsPlayedThisTurn.push(inst)
  ev.push({ e: 'PLAY_CARD', player: me, iid: inst.iid, def: inst.def })

  const ctx: EffectCtx = { controller: me, source: inst.iid, slot: 'primary' }
  const queued: Effect[] = []
  if (def.type === 'ship') {
    // A ship's primary ability is mandatory and immediate. A base's is not: the
    // player chooses when to activate it during their main phase.
    queued.push(...def.primary)
    card.used.primary = true
  }
  // Triggered abilities of cards ALREADY in play (Fleet HQ).
  const on = def.type === 'ship' ? 'PLAY_SHIP' : 'PLAY_BASE'
  for (const other of p.inPlay) {
    if (other.iid === inst.iid) continue
    for (const t of cardDef(effectiveDefId(other)).triggers) {
      if (t.on !== on) continue
      queued.push(...t.effects)
      ev.push({ e: 'ABILITY_USED', player: me, iid: other.iid, def: other.def, slot: 'trigger' })
    }
  }
  if (queued.length > 0) pushEffects(d, queued, ctx)
}

function activate(d: D, me: PlayerId, iid: CardIid, slot: 'primary' | 'ally' | 'scrap', ev: GameEvent[]): void {
  const p = d.players[me]
  const card = p.inPlay.find((c) => c.iid === iid)
  if (!card) throw new IllegalActionError(`card ${iid} is not in play`)
  if (card.used[slot]) throw new IllegalActionError(`${slot} already used this turn`)

  const def = cardDef(effectiveDefId(card))
  const effects = def[slot]
  if (effects.length === 0) throw new IllegalActionError(`card has no ${slot} ability`)

  if (slot === 'ally') {
    const factions = factionsOf(card)
    const ok = factions.some((f) => p.allyUnlocked.includes(f))
    if (!ok) throw new IllegalActionError('ally condition not met')
  }
  if (slot === 'primary' && cardDef(card.def).type === 'ship') {
    throw new IllegalActionError('a ship primary resolves on play')
  }

  card.used[slot] = true
  ev.push({ e: 'ABILITY_USED', player: me, iid: card.iid, def: card.def, slot })

  if (slot === 'scrap') {
    // Using a card's own scrap ability removes it from play permanently. Its
    // other abilities may have been used first, which is the standard line.
    const idx = p.inPlay.findIndex((c) => c.iid === iid)
    p.inPlay.splice(idx, 1)
    toScrapHeap(d, { iid: card.iid, def: card.def }, 'inPlay', me, ev)
  }
  pushEffects(d, effects, { controller: me, source: iid, slot })
}

function buyFromRow(d: D, me: PlayerId, iid: CardIid, ev: GameEvent[]): void {
  const p = d.players[me]
  const idx = d.tradeRow.findIndex((c) => c?.iid === iid)
  if (idx < 0) throw new IllegalActionError('card is not in the trade row')
  const inst = d.tradeRow[idx] as CardInstance
  const cost = cardDef(inst.def).cost
  if (p.trade < cost) throw new IllegalActionError('not enough trade')
  p.trade -= cost
  d.tradeRow[idx] = null
  acquire(d, me, inst, cost, 'discard', ev)
  refillTradeRow(d, ev)
}

function buyExplorer(d: D, me: PlayerId, ev: GameEvent[]): void {
  const p = d.players[me]
  if (d.explorerPile <= 0) throw new IllegalActionError('explorer pile is empty')
  if (p.trade < EXPLORER_COST) throw new IllegalActionError('not enough trade')
  p.trade -= EXPLORER_COST
  d.explorerPile -= 1
  // The Explorer pile is never refilled from the trade deck and never enters the row.
  acquire(d, me, { iid: mintId(d, 12) as CardIid, def: EXPLORER }, EXPLORER_COST, 'discard', ev)
}

function endTurn(d: D, ev: GameEvent[]): void {
  const me = d.activePlayer
  const p = d.players[me]
  ev.push({ e: 'TURN_END', player: me })

  // A script boss has, per its challenge, "no hand, deck or Discard Pile". So it
  // skips the discard-and-draw phase entirely: what it has taken stays on the
  // table as its armada. Running the normal phase would quietly hand it a deck
  // -- the discarded ships get shuffled back on the next empty draw -- which is
  // exactly the thing the challenge says it does not have.
  const scriptBoss = d.boss?.kind === 'script' && me === bossSeat(d)

  // Discard phase. Unspent trade and combat are LOST.
  p.trade = 0
  p.combat = 0
  if (!scriptBoss) {
    const staying: Draft<InPlayCard>[] = []
    for (const c of p.inPlay) {
      if (isBase(c)) { staying.push(c); continue }
      p.discard.push({ iid: c.iid, def: c.def })
    }
    p.inPlay = staying
    for (const c of p.hand) p.discard.push(c)
    p.hand = []
  }

  // Per-turn bookkeeping that is easy to forget and silently wrong if missed.
  p.factionPlayedThisTurn = emptyFactionCounts()
  p.shipsPlayedThisTurn = []
  p.allyUnlocked = []
  p.pendingTopdeck = 0

  if (!scriptBoss) drawCards(d, me, HAND_SIZE, ev)

  d.activePlayer = opponentOf(me)
  d.turn += 1
  const next = d.players[d.activePlayer]
  next.trade = 0
  next.combat = 0
  next.factionPlayedThisTurn = emptyFactionCounts()
  next.shipsPlayedThisTurn = []
  next.allyUnlocked = []
  next.pendingTopdeck = 0
  for (const c of next.inPlay) {
    c.used = { primary: false, ally: false, scrap: false }
    c.playedThisTurn = false
    // A Stealth Needle never survives a turn (it is a ship), so no copy state
    // can leak across turns; bases have none.
  }
  // A scenario's per-turn funding is granted like any other gain: at the start
  // of the turn, spendable by the normal rules, and lost at end of turn if
  // unspent. This is the whole of what makes a boss a boss -- no second card
  // type, no special-cased combat.
  const sc = d.scenario
  if (sc) {
    const to = d.activePlayer
    if (sc.turnStartCombat[to] > 0) gain(d, to, 'combat', sc.turnStartCombat[to], ev)
    if (sc.turnStartTrade[to] > 0) gain(d, to, 'trade', sc.turnStartTrade[to], ev)
  }

  ev.push({ e: 'TURN_START', player: d.activePlayer, turn: d.turn })

  // A SURVIVE objective is decided by the clock, so the clock has to be read
  // where it advances.
  checkWin(d, ev)
  if (d.winner) return

  // A script boss has no hand to play, so its whole turn is pushed onto the
  // resolution stack here. Anything in it that asks the player something simply
  // suspends until they answer -- the boss does not need a driver loop.
  const b = d.boss
  if (b && b.kind === 'script' && d.activePlayer === bossSeat(d)) {
    if (b.graceTurns > 0) {
      // Difficulty: the boss sits out its first turns entirely.
      b.graceTurns -= 1
      endTurn(d, ev)
      return
    }
    const turns: Effect[] = b.headStart
      ? [{ k: 'BOSS_TURN' }, { k: 'BOSS_TURN' }]
      : [{ k: 'BOSS_TURN' }]
    b.headStart = false
    b.acting = true
    pushEffects(d, [...turns, { k: 'BOSS_END_TURN' }], BOSS_CTX(d))
  }
}


// ═══════════════════════════ Frontiers Challenges ═══════════════════════════
//
// Everything below implements the rulebook's Challenge rules for a solo game.
// The boss's turn is a list of effects rather than a loop, so a step that asks
// the player something suspends the boss and resumes when they answer.

const BOSS_CTX = (d: D): EffectCtx =>
  ({ controller: bossSeat(d), source: null, slot: 'primary' })

function bossSeat(d: D): PlayerId {
  // Solo: the player is p1 and the boss p2. The scenario's hero is the player.
  return d.scenario ? opponentOf(d.scenario.hero) : 'p2'
}

/** The card furthest from the trade deck: rulebook language for the last slot. */
function farthestRowIndex(d: D): number {
  for (let i = d.tradeRow.length - 1; i >= 0; i--) if (d.tradeRow[i]) return i
  return -1
}

/** Take the far card and slide the row down, as the challenges describe. */
function takeFarthest(d: D): CardInstance | null {
  const i = farthestRowIndex(d)
  if (i < 0) return null
  const card = d.tradeRow[i] as CardInstance
  d.tradeRow[i] = null
  return card
}

/**
 * Boss Attacks, verbatim from the rulebook: for each attack, make the first
 * possible attack from the list, spending the minimum combat needed, and repeat
 * until no combat remains.
 *
 *   1. defeat the player outright if possible
 *   2. the highest-defense outpost it can destroy (ties: highest cost)
 *   3. the highest-defense non-outpost base it can destroy (ties: highest cost)
 *   4. attack the player
 *
 * Ties are broken by cost and then by position rather than at random: a boss
 * that consults the RNG would make the same replay diverge, and the engine's
 * whole persistence story rests on it not doing that.
 */
function bossAttacks(d: D, ev: GameEvent[]): void {
  const me = bossSeat(d)
  const foe = opponentOf(me)
  const boss = d.players[me]
  let guard = 0

  while (boss.combat > 0 && guard++ < 64) {
    const state = d as unknown as GameState
    const open = canAttackFace(state, me)

    // 1. A killing blow beats everything else.
    if (open && d.players[foe].authority > 0 && boss.combat >= d.players[foe].authority) {
      const n = d.players[foe].authority
      boss.combat -= n
      d.players[foe].authority -= n
      ev.push({ e: 'ATTACK_PLAYER', attacker: me, target: foe, n })
      ev.push({ e: 'AUTHORITY_LOST', player: foe, n })
      return
    }

    const targets = legalAttackTargets(state, me)
      .map((c) => ({ c, def: cardDef(c.def).defense ?? 0, cost: cardDef(c.def).cost, out: isOutpost(c) }))
      .filter((t) => t.def <= boss.combat)

    const pick = (outposts: boolean): typeof targets[number] | undefined =>
      targets.filter((t) => t.out === outposts)
        .sort((a, b) => (b.def - a.def) || (b.cost - a.cost))[0]

    // 2 and 3: outposts first, then plain bases.
    const target = pick(true) ?? pick(false)
    if (target) {
      boss.combat -= target.def
      destroyBase(d, foe, target.c, 'combat', ev, me)
      continue
    }

    // 4. Whatever is left goes to the face, if the face is reachable.
    if (open) {
      const n = boss.combat
      boss.combat = 0
      d.players[foe].authority -= n
      ev.push({ e: 'ATTACK_PLAYER', attacker: me, target: foe, n })
      ev.push({ e: 'AUTHORITY_LOST', player: foe, n })
      return
    }

    // Outposts stand and nothing is affordable: the combat is simply wasted.
    return
  }
}

/** Automatons: it assimilates captured technology and grows every turn. */
function automatonsStep(d: D, ev: GameEvent[]): void {
  const b = d.boss
  if (!b) return
  const me = bossSeat(d)
  // Take the far card into play: the armada incorporates salvaged hardware.
  const card = takeFarthest(d)
  if (card) {
    d.players[me].inPlay.push({
      iid: card.iid, def: card.def, copiedDef: null,
      used: { primary: false, ally: false, scrap: false }, playedThisTurn: false,
    })
    ev.push({ e: 'PLAY_CARD', player: me, iid: card.iid, def: card.def })
  }
  b.assimilation += 1
  gain(d, me, 'combat', b.assimilation, ev)
  refillTradeRow(d, ev)
}

/**
 * Nemesis Beast: scrap the far card face down, gain combat equal to the pile,
 * then gain an ability decided by the faction of the card that replaces it.
 *
 * The scrap-and-count half is the rulebook's. The faction table is ours: the
 * printed one exists only on the Challenge Card. It follows the published
 * description of what the beast does -- wreck your hand, blow up your bases,
 * spoil your draws, or simply grow.
 */
function nemesisStep(d: D, ev: GameEvent[], ctx: EffectCtx): void {
  const b = d.boss
  if (!b) return
  const me = bossSeat(d)
  const card = takeFarthest(d)
  if (card) {
    b.facedown.push({ iid: card.iid, def: card.def })
    ev.push({ e: 'SCRAP', owner: null, iid: card.iid, def: card.def, from: 'tradeRow' })
  }
  gain(d, me, 'combat', b.facedown.length, ev)

  refillTradeRow(d, ev)
  const revealed = d.tradeRow[farthestRowIndex(d)] ?? d.tradeRow.find((c) => c !== null)
  const faction = revealed ? cardDef(revealed.def).faction : 'unaligned'
  pushEffects(d, nemesisAbility(faction), ctx)
}

function nemesisAbility(faction: Faction): Effect[] {
  switch (faction) {
    // Star Empire wrecks your hand.
    case 'star_empire': return [{ k: 'OPPONENT_DISCARD', n: 1 }]
    // Machine Cult blows up your bases.
    case 'machine_cult': return [{ k: 'DESTROY_BASE', min: 1, max: 1 }]
    // Trade Federation heals it.
    case 'trade_federation': return [{ k: 'GAIN_AUTHORITY', n: 4 }]
    // Blob just grows.
    case 'blob': return [{ k: 'GAIN_COMBAT', n: 4 }]
    default: return []
  }
}

/**
 * Dimensional Horror: the far card joins a tentacle pile of its own faction,
 * cards of that faction keep joining as they are revealed, the boss gains an
 * ability for the colour it fed, and its combat equals the longest tentacle.
 */
function horrorStep(d: D, ev: GameEvent[], ctx: EffectCtx): void {
  const b = d.boss
  if (!b) return
  const me = bossSeat(d)
  const card = takeFarthest(d)
  let fed: Faction | null = null
  if (card) {
    fed = tentacleFor(d, cardDef(card.def).faction)
    b.tentacles[fed as Faction].push({ iid: card.iid, def: card.def })
    ev.push({ e: 'SCRAP', owner: null, iid: card.iid, def: card.def, from: 'tradeRow' })
  }

  // Refill; a replacement of the same faction is swallowed too.
  let guard = 0
  while (d.tradeRow.some((c) => c === null) && d.tradeDeck.length > 0 && guard++ < 20) {
    const next = d.tradeDeck.shift()
    if (!next) break
    if (fed && cardDef(next.def).faction === fed && !b.tentaclesDestroyed.includes(fed)) {
      b.tentacles[fed as Faction].push({ iid: next.iid, def: next.def })
      ev.push({ e: 'SCRAP', owner: null, iid: next.iid, def: next.def, from: 'tradeRow' })
      continue
    }
    const slot = d.tradeRow.findIndex((c) => c === null)
    if (slot < 0) break
    d.tradeRow[slot] = next
    ev.push({ e: 'TRADE_ROW_REFILL', slot, def: next.def })
  }

  gain(d, me, 'combat', longestTentacle(d), ev)
  if (fed) pushEffects(d, nemesisAbility(fed), ctx)
}

/** Unaligned cards have no tentacle of their own; they feed the longest one. */
function tentacleFor(d: D, faction: Faction): Faction {
  const b = d.boss
  if (!b) return faction
  const alive = TENTACLE_FACTIONS.filter((f) => !b.tentaclesDestroyed.includes(f))
  if (faction !== 'unaligned' && !b.tentaclesDestroyed.includes(faction)) return faction
  return [...alive].sort((x, y) => b.tentacles[y].length - b.tentacles[x].length)[0] ?? 'unaligned'
}

function longestTentacle(d: D): number {
  const b = d.boss
  if (!b) return 0
  return Math.max(0, ...TENTACLE_FACTIONS
    .filter((f) => !b.tentaclesDestroyed.includes(f))
    .map((f) => b.tentacles[f].length))
}

/**
 * Pirates of the Dark Star: the revealed card's faction and cost decide what is
 * done to you. Rulebook gives the procedure; the table itself is on the card,
 * so this one is ours, built around cost as severity.
 */
function pirateStep(d: D, ev: GameEvent[], ctx: EffectCtx): void {
  const card = takeFarthest(d)
  if (card) {
    d.scrapHeap.push({ iid: card.iid, def: card.def })
    ev.push({ e: 'SCRAP', owner: null, iid: card.iid, def: card.def, from: 'tradeRow' })
  }
  refillTradeRow(d, ev)

  const revealed = d.tradeRow[farthestRowIndex(d)] ?? d.tradeRow.find((c) => c !== null)
  if (!revealed) return
  const def = cardDef(revealed.def)
  const severity = Math.max(1, def.cost)
  const raid: Effect[] = def.faction === 'star_empire'
    ? [{ k: 'OPPONENT_DISCARD', n: 1 }, { k: 'GAIN_COMBAT', n: severity }]
    : def.faction === 'machine_cult'
      ? [{ k: 'DESTROY_BASE', min: 1, max: 1 }, { k: 'GAIN_COMBAT', n: severity }]
      : def.faction === 'trade_federation'
        ? [{ k: 'GAIN_AUTHORITY', n: severity }, { k: 'GAIN_COMBAT', n: severity }]
        : [{ k: 'GAIN_COMBAT', n: severity + 2 }]
  pushEffects(d, raid, ctx)
}

/** The Order of Play for whichever boss is in the game. */
function bossOrderOfPlay(d: D): Effect[] {
  const b = d.boss
  if (!b) return []
  switch (b.id) {
    case 'automatons':
      return [{ k: 'BOSS_ASSIMILATE' }, { k: 'BOSS_ATTACK' }]
    case 'nemesis-beast':
      return [{ k: 'BOSS_NEMESIS_STEP' }, { k: 'BOSS_ATTACK' }]
    case 'dimensional-horror':
      return [{ k: 'BOSS_HORROR_STEP' }, { k: 'BOSS_ATTACK' }]
    case 'pirates-of-the-dark-star':
      // The pirates' raid IS their attack: steps 1-5 with no separate attack.
      return [{ k: 'BOSS_PIRATE_STEP' }, { k: 'BOSS_ATTACK' }]
    default:
      // Deck bosses take an ordinary turn; nothing to script.
      return []
  }
}

function applyAction(d: D, cmd: Command, ev: GameEvent[]): void {
  const { actor, action } = cmd
  const me = actor

  switch (action.t) {
    case 'PLAY_CARD': return playCard(d, me, action.card, ev)

    case 'PLAY_ALL': {
      // Play ships until one of them needs a decision; the player finishes the
      // rest manually after resolving it.
      for (;;) {
        if (d.resolution.length > 0) return
        const next = d.players[me].hand.find((c) => cardDef(c.def).type === 'ship')
        if (!next) return
        playCard(d, me, next.iid, ev)
        settle(d, ev)
        if (d.phase === 'gameOver') return
      }
    }

    case 'ACTIVATE': return activate(d, me, action.card, action.slot, ev)
    case 'BUY_CARD': return buyFromRow(d, me, action.card, ev)
    case 'BUY_EXPLORER': return buyExplorer(d, me, ev)

    case 'ATTACK_PLAYER': {
      const p = d.players[me]
      const target = opponentOf(me)
      if (!canAttackFace(d as unknown as GameState, me)) {
        throw new IllegalActionError('opponent has an outpost in play')
      }
      if (action.amount < 1 || action.amount > p.combat) throw new IllegalActionError('invalid combat amount')
      p.combat -= action.amount
      d.players[target].authority -= action.amount
      ev.push({ e: 'ATTACK_PLAYER', attacker: me, target, n: action.amount })
      ev.push({ e: 'AUTHORITY_LOST', player: target, n: action.amount })
      return
    }

    case 'ATTACK_BASE': {
      const p = d.players[me]
      const targets = legalAttackTargets(d as unknown as GameState, me)
      const target = targets.find((c) => c.iid === action.base)
      if (!target) throw new IllegalActionError('not a legal base target')
      const defense = cardDef(target.def).defense ?? 0
      if (p.combat < defense) throw new IllegalActionError('not enough combat')
      // Spend EXACTLY the defense value; the remainder stays in the pool.
      p.combat -= defense
      destroyBase(d, opponentOf(me), target, 'combat', ev)
      return
    }

    case 'RESOLVE_CHOICE': {
      const top = d.resolution[0]
      if (!top || top.f !== 'choice') throw new IllegalActionError('no choice is pending')
      const choice = top.choice as PendingChoice
      if (choice.id !== action.choiceId) throw new IllegalActionError('stale choice id')
      if (choice.actor !== me) throw new IllegalActionError('not your choice to make')
      const sel = action.selected
      if (sel.length < choice.min || sel.length > choice.max) {
        throw new IllegalActionError(`select between ${choice.min} and ${choice.max}`)
      }
      for (const o of sel) {
        if (!choice.options.some((x) => sameOption(x, o))) throw new IllegalActionError('illegal option')
      }
      for (let i = 0; i < sel.length; i++) {
        for (let j = i + 1; j < sel.length; j++) {
          if (sameOption(sel[i] as ChoiceOption, sel[j] as ChoiceOption)) {
            throw new IllegalActionError('duplicate selection')
          }
        }
      }
      const frame = d.resolution.shift() as unknown as ChoiceFrame
      resolveChoice(d, frame, sel, ev)
      return
    }

    case 'MULLIGAN_ROW': {
      // Rulebook: once per challenge, a player may scrap the entire trade row.
      const b = d.boss
      if (!b) throw new IllegalActionError('the mulligan is a challenge rule')
      if (b.mulliganUsed) throw new IllegalActionError('the trade row has already been mulliganed')
      b.mulliganUsed = true
      for (let i = 0; i < d.tradeRow.length; i++) {
        const c = d.tradeRow[i]
        if (!c) continue
        d.tradeRow[i] = null
        d.scrapHeap.push({ iid: c.iid, def: c.def })
        ev.push({ e: 'SCRAP', owner: null, iid: c.iid, def: c.def, from: 'tradeRow' })
      }
      refillTradeRow(d, ev)
      return
    }

    case 'ATTACK_TENTACLE': {
      const b = d.boss
      if (!b || b.id !== 'dimensional-horror') throw new IllegalActionError('no tentacles to attack')
      if (b.tentaclesDestroyed.includes(action.faction)) throw new IllegalActionError('already destroyed')
      const pile = b.tentacles[action.faction]
      // A tentacle's defense is the printed cost of what it has swallowed --
      // the piles are laid out cost-visible precisely so this can be read off.
      const defense = pile.reduce((n, c) => n + cardDef(c.def).cost, 0)
      if (pile.length === 0) throw new IllegalActionError('that tentacle is not in play')
      const attacker = d.players[me]
      if (attacker.combat < defense) throw new IllegalActionError('not enough combat')
      attacker.combat -= defense
      b.tentaclesDestroyed.push(action.faction)
      for (const c of pile) d.scrapHeap.push({ iid: c.iid, def: c.def })
      b.tentacles[action.faction] = []
      ev.push({ e: 'TENTACLE_DESTROYED', faction: action.faction, defense })
      return
    }

    case 'END_TURN': {
      if (d.resolution.length > 0) throw new IllegalActionError('resolve the pending choice first')
      if (d.boss?.acting) throw new IllegalActionError('the boss is still acting')
      return endTurn(d, ev)
    }
  }
}

/**
 * Apply one command. The ONLY way state changes.
 *
 * Throws IllegalActionError rather than returning a result type so that an
 * illegal command can never be mistaken for a legal no-op by a caller that
 * forgot to check.
 */
export function reduce(state: GameState, cmd: Command): ReduceResult {
  const events: GameEvent[] = []
  const next = produce(state, (d: D) => {
    if (d.phase === 'gameOver') throw new IllegalActionError('the game is over')
    // Input ownership, not turn ownership: a forced discard is answered by the
    // non-active player.
    const expected = actorOf(d as unknown as GameState)
    if (cmd.actor !== expected) throw new IllegalActionError(`it is ${expected}'s turn to act`)
    applyAction(d, cmd, events)
    settle(d, events)
    d.version += 1
  })
  return { state: next, events }
}

export type { Action }
