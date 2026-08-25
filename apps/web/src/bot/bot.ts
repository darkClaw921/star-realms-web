import {
  cardDef, type Action, type CardDefId, type ChoiceOption, type PlayerView,
} from '@sr/engine'
import { contextFor, valueOf, type Ctx } from './valuation'

export type Difficulty = 'easy' | 'normal' | 'hard'

/** Softmax temperature over buy scores. Higher = more plausible-but-wrong picks. */
const TEMP: Record<Difficulty, number> = { easy: 4.0, normal: 1.2, hard: 0 }

export interface Rand { (): number }

/**
 * A 1-ply greedy policy. No search.
 *
 * The published reference bot wins ~63% against a field of six others using
 * nothing but a phase-conditioned score table, so search buys very little here.
 * It is a pure function of (view, legal) with an injected RNG, which keeps it
 * both testable and trivially movable into a Web Worker later -- that would be a
 * file move, not a rewrite.
 *
 * Difficulty degrades DECISION QUALITY, never rules knowledge: the bot always
 * plays legally, it just picks worse cards and worse orderings.
 */
export function chooseAction(
  v: PlayerView,
  legal: readonly Action[],
  difficulty: Difficulty,
  rand: Rand,
): Action {
  if (legal.length === 0) throw new Error('bot asked to move with no legal actions')
  const ctx = contextFor(v)

  if (v.pendingChoice) return resolveChoice(v, legal, ctx, difficulty, rand)

  // 1. Empty the hand. Bases first, so Embassy Yacht sees them; Stealth Needle
  //    last, so it has something worth copying.
  const play = legal.filter((a) => a.t === 'PLAY_CARD')
  if (play.length > 0) {
    const ranked = [...play].sort((a, b) => playOrder(v, a.card) - playOrder(v, b.card))
    // A weak bot mis-orders its plays: the most natural-looking mistake there is,
    // because it silently drops ally triggers and copy targets.
    if (difficulty === 'easy' && ranked.length > 1 && rand() < 0.45) {
      return ranked[Math.floor(rand() * ranked.length)] as Action
    }
    return ranked[0] as Action
  }

  // 2. Free value: base primaries and ally abilities, repeated to a fixpoint by
  //    virtue of being re-asked every step.
  //    Свойство с ценой бесплатным не является: четыре арена-сценария и
  //    технологии High Alert берут за него торговлю, и «бесплатная ценность»
  //    съедала её раньше покупки — бот каждый ход уходил в ряд на монету
  //    беднее, чем мог.
  const free = legal.filter((a) =>
    a.t === 'ACTIVATE' && (a.slot === 'primary' || a.slot === 'ally')
    && priceOf(v, a.card, a.slot) === 0)
  if (free.length > 0) return free[0] as Action

  // 3. Scrap for TRADE before buying -- otherwise the bot never reaches the card
  //    it was one trade short of.
  const trade = legal.filter((a) => a.t === 'ACTIVATE' && a.slot === 'scrap'
    && givesTrade(v, a.card) > 0)
  if (trade.length > 0) {
    const best = bestBuyScore(v, ctx, v.me.trade)
    for (const a of trade) {
      if (a.t !== 'ACTIVATE') continue
      const after = bestBuyScore(v, ctx, v.me.trade + givesTrade(v, a.card))
      if (after > best + 4) return a
    }
  }

  // 4. Buy.
  const buys = legal.filter((a) => a.t === 'BUY_CARD' || a.t === 'BUY_EXPLORER')
  if (buys.length > 0) {
    const scored = buys.map((a) => ({ a, s: buyScore(v, ctx, a) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s)
    if (scored.length > 0) {
      // Two cheap cards often beat one expensive one; ~10 lines, real strength.
      const pair = bestPair(v, ctx, buys)
      const single = scored[0] as { a: Action; s: number }
      if (pair && pair.total > single.s * 1.15) return pair.first
      return pickSoftmax(scored, TEMP[difficulty], rand)
    }
  }

  // 4a. Сдача. Покупать уже нечего — торговля, оставшаяся на руках, пропадёт
  //     в конце хода, и платное свойство обменивает её хоть на что-то.
  const paid = legal.filter((a) =>
    a.t === 'ACTIVATE' && a.slot === 'primary' && priceOf(v, a.card, a.slot) > 0)
  if (paid.length > 0 && v.me.trade > 0) return paid[0] as Action

  // 5. Combat last. Check lethal BEFORE spending combat on outposts.
  const attackFace = legal.filter((a) => a.t === 'ATTACK_PLAYER')
  const lethal = attackFace.find((a) => a.t === 'ATTACK_PLAYER' && a.amount >= v.opponent.authority)
  if (lethal) return lethal

  // Scrap for COMBAT only now, once buying is done and lethal is in reach.
  const scrapCombat = legal.filter((a) => a.t === 'ACTIVATE' && a.slot === 'scrap'
    && givesCombat(v, a.card) > 0)
  if (scrapCombat.length > 0 && v.opponent.inPlay.every((c) => cardDef(c.def).type === 'ship')) {
    const potential = v.me.combat + scrapCombat.reduce((n, a) =>
      n + (a.t === 'ACTIVATE' ? givesCombat(v, a.card) : 0), 0)
    if (potential >= v.opponent.authority && v.me.combat < v.opponent.authority) {
      return scrapCombat[0] as Action
    }
  }

  const attackBase = legal.filter((a) => a.t === 'ATTACK_BASE')
  if (attackBase.length > 0) {
    // Kill the cheapest wall first so the remaining combat can reach further.
    const ranked = [...attackBase].sort((a, b) =>
      defenseOf(v, a.base) - defenseOf(v, b.base))
    return ranked[0] as Action
  }
  if (attackFace.length > 0) {
    return attackFace.reduce((best, a) =>
      (a.t === 'ATTACK_PLAYER' && best.t === 'ATTACK_PLAYER' && a.amount > best.amount) ? a : best)
  }

  return legal.find((a) => a.t === 'END_TURN') ?? (legal[0] as Action)
}

// ── ordering and scoring ─────────────────────────────────────────────────────

function playOrder(v: PlayerView, iid: string): number {
  const c = v.me.hand.find((x) => x.iid === iid)
  if (!c) return 50
  const d = cardDef(c.def)
  if (d.type !== 'ship') return 0                      // bases first
  if (c.def === ('stealth-needle' as CardDefId)) return 90 // copy something good
  if (c.def === ('embassy-yacht' as CardDefId)) return 20  // after bases
  return 50
}

function defOfInPlay(v: PlayerView, iid: string): CardDefId | null {
  const mine = v.me.inPlay.find((c) => c.iid === iid)
  if (mine) return mine.copiedDef ?? mine.def
  // Карта сценария и раскрытый гамбит стоят в своей зоне, но свойства у них
  // такие же, и цену за них спрашивают там же.
  const side = v.me.gambitsInPlay.find((c) => c.iid === iid)
  if (side) return side.def
  const theirs = v.opponent.inPlay.find((c) => c.iid === iid)
  return theirs ? theirs.def : null
}

/** Сколько торговли просит свойство. Платят только за основное. */
function priceOf(v: PlayerView, iid: string, slot: string): number {
  if (slot !== 'primary') return 0
  const def = defOfInPlay(v, iid)
  return def ? (cardDef(def).primaryCost ?? 0) : 0
}

function defenseOf(v: PlayerView, iid: string): number {
  const def = defOfInPlay(v, iid)
  return def ? (cardDef(def).defense ?? 0) : 0
}

function givesTrade(v: PlayerView, iid: string): number {
  const def = defOfInPlay(v, iid)
  if (!def) return 0
  return cardDef(def).scrap.reduce((n, e) => n + (e.k === 'GAIN_TRADE' ? e.n : 0), 0)
}

function givesCombat(v: PlayerView, iid: string): number {
  const def = defOfInPlay(v, iid)
  if (!def) return 0
  return cardDef(def).scrap.reduce((n, e) => n + (e.k === 'GAIN_COMBAT' ? e.n : 0), 0)
}

function buyScore(v: PlayerView, ctx: Ctx, a: Action): number {
  if (a.t === 'BUY_EXPLORER') {
    // Only when there is genuinely nothing else and a scrapper can remove it later.
    return ctx.scrappers > 0 ? 8 : 3
  }
  if (a.t !== 'BUY_CARD') return 0
  const c = v.tradeRow.find((x) => x?.iid === a.card)
  return c ? valueOf(c.def, ctx) : 0
}

function bestBuyScore(v: PlayerView, ctx: Ctx, trade: number): number {
  let best = 0
  for (const c of v.tradeRow) {
    if (!c) continue
    if (cardDef(c.def).cost > trade) continue
    best = Math.max(best, valueOf(c.def, ctx))
  }
  return best
}

function bestPair(
  v: PlayerView, ctx: Ctx, buys: readonly Action[],
): { first: Action; total: number } | null {
  const cards = buys.flatMap((a) => {
    if (a.t !== 'BUY_CARD') return []
    const c = v.tradeRow.find((x) => x?.iid === a.card)
    return c ? [{ a, def: c.def, cost: cardDef(c.def).cost, s: valueOf(c.def, ctx) }] : []
  })
  let best: { first: Action; total: number } | null = null
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const x = cards[i]!, y = cards[j]!
      if (x.cost + y.cost > v.me.trade) continue
      const total = x.s + y.s
      if (!best || total > best.total) {
        best = { first: x.s >= y.s ? x.a : y.a, total }
      }
    }
  }
  return best
}

function pickSoftmax(
  scored: readonly { a: Action; s: number }[], temp: number, rand: Rand,
): Action {
  if (temp <= 0 || scored.length === 1) return scored[0]!.a
  const max = scored[0]!.s
  const weights = scored.map((x) => Math.exp((x.s - max) / (temp * 10)))
  const sum = weights.reduce((a, b) => a + b, 0)
  let r = rand() * sum
  for (let i = 0; i < scored.length; i++) {
    r -= weights[i] as number
    if (r <= 0) return scored[i]!.a
  }
  return scored[0]!.a
}

// ── choices ──────────────────────────────────────────────────────────────────

function resolveChoice(
  v: PlayerView, legal: readonly Action[], ctx: Ctx, difficulty: Difficulty, rand: Rand,
): Action {
  const c = v.pendingChoice!
  const opts = legal.filter((a) => a.t === 'RESOLVE_CHOICE')
  if (opts.length === 0) throw new Error('bot: pending choice with no legal resolution')

  const score = (a: Action): number => {
    if (a.t !== 'RESOLVE_CHOICE') return 0
    return a.selected.reduce((n, o) => n + optionScore(v, ctx, c.prompt, o), 0)
      + emptyBonus(c.prompt, a.selected.length)
  }
  const ranked = [...opts].sort((a, b) => score(b) - score(a))
  if (difficulty === 'easy' && ranked.length > 2 && rand() < 0.4) {
    return ranked[Math.floor(rand() * Math.min(3, ranked.length))] as Action
  }
  return ranked[0] as Action
}

/** Choosing nothing is right for some prompts and wrong for others. */
function emptyBonus(prompt: string, n: number): number {
  if (n > 0) return 0
  switch (prompt) {
    case 'SCRAP_ZONES': return 1        // scrapping a good card is worse than nothing
    case 'DISCARD_THEN_DRAW': return 2
    case 'SCRAP_THEN_DRAW': return 0
    case 'MAY': return 0
    default: return -50                 // never decline a free destroy or acquire
  }
}

function optionScore(v: PlayerView, ctx: Ctx, prompt: string, o: ChoiceOption): number {
  switch (o.o) {
    case 'BRANCH': return branchScore(v, ctx, o.index)
    case 'CONFIRM': return 10
    case 'EXPLORER': return 6
    case 'CARD': {
      const val = valueOf(o.def, ctx)
      switch (prompt) {
        // Discarding: dump the least useful card.
        case 'DISCARD': return 100 - val
        case 'DISCARD_THEN_DRAW': return 60 - val
        // Scrapping your own deck: get rid of the worst cards, never a bomb.
        case 'SCRAP_ZONES':
        case 'SCRAP_THEN_DRAW': return isJunk(o.def) ? 60 : 100 - val * 2
        // Removing from the trade row: deny the opponent the best card there.
        case 'SCRAP_TRADE_ROW': return val
        // Destroying: prefer the opponent's biggest wall, never your own base.
        case 'DESTROY_BASE': return o.owner === v.viewer ? -100 : val + (cardDef(o.def).defense ?? 0)
        case 'ACQUIRE_FREE': return val
        case 'COPY_SHIP': return val
        case 'TOPDECK_ACQUIRED': return val
        default: return val
      }
    }
  }
}

const JUNK = new Set<string>(['scout', 'viper', 'explorer'])
function isJunk(def: CardDefId): boolean { return JUNK.has(def as string) }

function branchScore(v: PlayerView, ctx: Ctx, index: number): number {
  // Branch labels are card-specific; a simple rule covers every base-set OR:
  // take combat when it can matter this turn, economy otherwise.
  const wantsCombat = ctx.oppAuthority < 30 || v.opponent.inPlay.some((c) => cardDef(c.def).type !== 'ship')
  return index === 0 ? (wantsCombat ? 12 : 10) : (wantsCombat ? 10 : 12)
}
