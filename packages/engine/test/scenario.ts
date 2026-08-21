import type { Action } from '../src/actions'
import type { CardDefId, CardIid, PlayerId } from '../src/ids'
import { asDefId } from '../src/ids'
import { reduce, type ReduceResult } from '../src/reduce'
import { createGame } from '../src/setup'
import type { CardInstance, GameState, InPlayCard } from '../src/state'
import { actorOf } from '../src/state'
import { redact } from '../src/view'
import { enumerateLegalActions } from '../src/legal'

let counter = 0
function iid(): CardIid { return `t${(counter++).toString(36).padStart(8, '0')}` as CardIid }

export function inst(def: string): CardInstance { return { iid: iid(), def: asDefId(def) } }

export function inPlay(def: string, opts: Partial<InPlayCard> = {}): InPlayCard {
  return {
    iid: iid(), def: asDefId(def), copiedDef: null,
    used: { primary: false, ally: false, scrap: false },
    playedThisTurn: false,
    ...opts,
  }
}

export interface Side {
  hand?: string[]
  deck?: string[]
  discard?: string[]
  inPlay?: InPlayCard[]
  authority?: number
  trade?: number
  combat?: number
}

/**
 * Build a precise board position.
 *
 * Constructing states by hand rather than by playing into them keeps the rules
 * tests readable and independent of card draw.
 */
export function scenario(opts: {
  me?: Side
  them?: Side
  tradeRow?: (string | null)[]
  explorerPile?: number
  seed?: string
}): GameState {
  const s = createGame({ matchId: 'scenario', seed: opts.seed ?? 'scenario-seed', firstPlayer: 'p1' })
  const apply = (pid: PlayerId, side: Side | undefined): void => {
    const p = s.players[pid]
    if (!side) return
    if (side.hand) p.hand = side.hand.map(inst)
    if (side.deck) p.deck = side.deck.map(inst)
    if (side.discard) p.discard = side.discard.map(inst)
    if (side.inPlay) p.inPlay = side.inPlay
    if (side.authority !== undefined) p.authority = side.authority
    if (side.trade !== undefined) p.trade = side.trade
    if (side.combat !== undefined) p.combat = side.combat
  }
  apply('p1', opts.me)
  apply('p2', opts.them)
  if (opts.tradeRow) {
    s.tradeRow = opts.tradeRow.map((d) => (d ? inst(d) : null))
  }
  if (opts.explorerPile !== undefined) s.explorerPile = opts.explorerPile
  return s
}

/** Apply a sequence of actions, always as whoever currently owns the input. */
export function run(s0: GameState, ...actions: Action[]): ReduceResult & { state: GameState } {
  let state = s0
  let events: ReduceResult['events'] = []
  for (const action of actions) {
    const r = reduce(state, { actor: actorOf(state), action })
    state = r.state
    events = [...events, ...r.events]
  }
  return { state, events }
}

export function handIid(s: GameState, pid: PlayerId, def: string): CardIid {
  const c = s.players[pid].hand.find((x) => x.def === asDefId(def))
  if (!c) throw new Error(`no ${def} in ${pid}'s hand`)
  return c.iid
}

export function playIid(s: GameState, pid: PlayerId, def: string): CardIid {
  const c = s.players[pid].inPlay.find((x) => x.def === asDefId(def))
  if (!c) throw new Error(`no ${def} in ${pid}'s play area`)
  return c.iid
}

export function rowIid(s: GameState, def: string): CardIid {
  const c = s.tradeRow.find((x) => x?.def === asDefId(def))
  if (!c) throw new Error(`no ${def} in the trade row`)
  return c.iid
}

/** Answer the pending choice by picking the option matching `pred`. */
export function choose(s: GameState, pred: (o: never) => boolean): Action {
  const c = s.resolution[0]
  if (!c || c.f !== 'choice') throw new Error('no pending choice')
  const opt = c.choice.options.find(pred as never)
  if (!opt) throw new Error(`no matching option among ${JSON.stringify(c.choice.options)}`)
  return { t: 'RESOLVE_CHOICE', choiceId: c.choice.id, selected: [opt] }
}

export function chooseMany(s: GameState, preds: ((o: never) => boolean)[]): Action {
  const c = s.resolution[0]
  if (!c || c.f !== 'choice') throw new Error('no pending choice')
  const selected = preds.map((p) => {
    const o = c.choice.options.find(p as never)
    if (!o) throw new Error('no matching option')
    return o
  })
  return { t: 'RESOLVE_CHOICE', choiceId: c.choice.id, selected }
}

export function decline(s: GameState): Action {
  const c = s.resolution[0]
  if (!c || c.f !== 'choice') throw new Error('no pending choice')
  return { t: 'RESOLVE_CHOICE', choiceId: c.choice.id, selected: [] }
}

export function pending(s: GameState): { prompt: string; min: number; max: number; actor: PlayerId; n: number } | null {
  const c = s.resolution[0]
  if (!c || c.f !== 'choice') return null
  return {
    prompt: c.choice.prompt, min: c.choice.min, max: c.choice.max,
    actor: c.choice.actor, n: c.choice.options.length,
  }
}

export function byDef(def: string) {
  return (o: { o: string; def?: CardDefId }): boolean => o.o === 'CARD' && o.def === asDefId(def)
}
export function byBranch(index: number) {
  return (o: { o: string; index?: number }): boolean => o.o === 'BRANCH' && o.index === index
}

export function legalFor(s: GameState, pid: PlayerId): Action[] {
  return enumerateLegalActions(redact(s, pid), pid)
}
