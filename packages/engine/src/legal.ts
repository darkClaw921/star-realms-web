import type { Action } from './actions'
import { cardDef } from './cards/registry'
import type { ChoiceOption } from './choices'
import { EXPLORER_COST } from './state'
import type { InPlayCardView, PlayerView } from './view'

/**
 * Every action `seat` may legally take right now.
 *
 * Defined over the VIEW, not over GameState, and the server calls it as
 * `enumerateLegalActions(redact(state, seat), seat)`. That enforces a real
 * invariant: no legal move may depend on hidden information -- which is also true
 * of the physical game, where you cannot choose a play based on cards you are not
 * allowed to see.
 *
 * One generator serves four consumers: the UI (to grey out illegal actions), the
 * server (to validate), the bot (to pick), and the fuzz tests (to drive random
 * play). Two hand-rolled copies would drift, producing either rejected clicks or
 * phantom rules bugs.
 */
export function enumerateLegalActions(v: PlayerView, seat: PlayerView['viewer']): Action[] {
  if (v.phase === 'gameOver') return []
  if (v.actor !== seat) return []

  const out: Action[] = []

  // A pending choice blocks everything else.
  if (v.pendingChoice) {
    const c = v.pendingChoice
    if (!c.options) return [] // not this seat's options to see, and actor !== seat anyway
    for (const sel of combinations(c.options, c.min, c.max)) {
      out.push({ t: 'RESOLVE_CHOICE', choiceId: c.id, selected: sel })
    }
    return out
  }

  const me = v.me

  for (const card of me.hand) {
    out.push({ t: 'PLAY_CARD', card: card.iid })
  }
  if (me.hand.some((c) => cardDef(c.def).type === 'ship')) {
    out.push({ t: 'PLAY_ALL' })
  }

  for (const card of me.inPlay) {
    const printed = cardDef(card.def)
    const eff = cardDef(card.copiedDef ?? card.def)

    // A ship's primary resolved on play; only bases can be activated.
    if (!card.used.primary && printed.type !== 'ship' && eff.primary.length > 0) {
      out.push({ t: 'ACTIVATE', card: card.iid, slot: 'primary' })
    }
    if (!card.used.ally && eff.ally.length > 0 && allyReady(card, me.allyUnlocked)) {
      out.push({ t: 'ACTIVATE', card: card.iid, slot: 'ally' })
    }
    if (!card.used.scrap && eff.scrap.length > 0) {
      out.push({ t: 'ACTIVATE', card: card.iid, slot: 'scrap' })
    }
  }

  for (const c of v.tradeRow) {
    if (c && cardDef(c.def).cost <= me.trade) out.push({ t: 'BUY_CARD', card: c.iid })
  }
  if (v.explorerPile > 0 && me.trade >= EXPLORER_COST) out.push({ t: 'BUY_EXPLORER' })

  // Outposts must fall before anything behind them can be touched.
  const shielded = v.opponent.inPlay.some((c) => cardDef(c.def).type === 'outpost')
  for (const c of v.opponent.inPlay) {
    const def = cardDef(c.def)
    if (def.type === 'ship') continue
    if (shielded && def.type !== 'outpost') continue
    if (me.combat >= (def.defense ?? 0)) out.push({ t: 'ATTACK_BASE', base: c.iid })
  }
  if (!shielded) {
    // Every amount, not just "all of it": a partial hit is legal, and the fuzz
    // property asserts that anything omitted here is rejected by reduce().
    for (let n = 1; n <= me.combat; n++) out.push({ t: 'ATTACK_PLAYER', amount: n })
  }

  out.push({ t: 'END_TURN' })
  return out
}

function allyReady(card: InPlayCardView, unlocked: readonly string[]): boolean {
  const own = cardDef(card.def).faction
  if (unlocked.includes(own)) return true
  if (card.copiedDef && unlocked.includes(cardDef(card.copiedDef).faction)) return true
  return false
}

/**
 * All subsets of `opts` with size in [min, max].
 *
 * No base-set card lets you pick more than two, so the worst case is
 * `C(n, 2) + n + 1` over a late-game discard pile -- a few hundred entries.
 */
function combinations(opts: readonly ChoiceOption[], min: number, max: number): ChoiceOption[][] {
  const out: ChoiceOption[][] = []
  const hi = Math.min(max, opts.length)
  const lo = Math.min(min, hi)
  const cur: ChoiceOption[] = []
  const rec = (start: number, size: number): void => {
    if (size >= lo) out.push([...cur])
    if (size === hi) return
    for (let i = start; i < opts.length; i++) {
      cur.push(opts[i] as ChoiceOption)
      rec(i + 1, size + 1)
      cur.pop()
    }
  }
  rec(0, 0)
  return out
}

export { combinations as choiceCombinations }
