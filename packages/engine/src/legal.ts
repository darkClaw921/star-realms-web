import type { Action } from './actions'
import { TENTACLE_FACTIONS } from './boss'
import { cardDef } from './cards/registry'
import { costFor, defenseAgainst, objectiveMet } from './helpers'
import { splinterSet } from './reduce'
import type { ChoiceOption } from './choices'
import { EXPLORER_COST } from './state'
import { wagerFor, wagerProgress, wagerSourceOf } from './wagers'
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
  // A Hydra team shares its turn, so several seats may be legal actors at once.
  if (!v.actors.includes(seat)) return []

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

  // Revealed gambits offer their abilities exactly as cards in play do.
  for (const card of me.gambitsInPlay) {
    const eff = cardDef(card.def)
    // Цена — часть законности, а не пожелание: четыре арена-сценария живут в
    // этой зоне и все четыре стоят торговли. Без проверки ход предлагался при
    // нулевой торговле, и нажатие упиралось в отказ движка.
    if (!card.used.primary && eff.activated && eff.primary.length > 0
        && me.trade >= (eff.primaryCost ?? 0)) {
      out.push({ t: 'ACTIVATE', card: card.iid, slot: 'primary' })
    }
    for (const [slot, effects, pinned] of [
      ['ally', eff.ally, eff.allyFaction],
      ['ally2', eff.ally2, eff.ally2Faction],
    ] as const) {
      if (!card.used[slot] && effects.length > 0
          && (pinned ? me.allyUnlocked.includes(pinned) : false)) {
        out.push({ t: 'ACTIVATE', card: card.iid, slot })
      }
    }
  }

  for (const card of me.inPlay) {
    const printed = cardDef(card.def)
    const eff = cardDef(card.copiedDef ?? card.def)

    // A ship's primary resolved on play and a Hero's on acquisition; only a
    // base's or a Tech's primary is something the player spends a click on --
    // and a Tech's also costs trade, which has to be affordable before the
    // action is offered at all.
    if (!card.used.primary && printed.type !== 'ship' && printed.type !== 'hero'
        && eff.primary.length > 0 && me.trade >= (eff.primaryCost ?? 0)) {
      out.push({ t: 'ACTIVATE', card: card.iid, slot: 'primary' })
    }
    if (!card.used.ally && eff.ally.length > 0
        && allyReady(card, me.allyUnlocked, eff.allyFaction)) {
      out.push({ t: 'ACTIVATE', card: card.iid, slot: 'ally' })
    }
    if (!card.used.ally2 && eff.ally2.length > 0
        && allyReady(card, me.allyUnlocked, eff.ally2Faction)) {
      out.push({ t: 'ACTIVATE', card: card.iid, slot: 'ally2' })
    }
    if (!card.used.ally3 && eff.ally3.length > 0
        && allyReady(card, me.allyUnlocked, eff.ally3Faction)) {
      out.push({ t: 'ACTIVATE', card: card.iid, slot: 'ally3' })
    }
    if (!card.used.ally4 && eff.ally4.length > 0
        && allyReady(card, me.allyUnlocked, eff.ally4Faction)) {
      out.push({ t: 'ACTIVATE', card: card.iid, slot: 'ally4' })
    }
    if (!card.used.doubleAlly && eff.doubleAlly.length > 0
        && allyReady(card, me.doubleAllyUnlocked)) {
      out.push({ t: 'ACTIVATE', card: card.iid, slot: 'doubleAlly' })
    }
    if (!card.used.scrap && eff.scrap.length > 0) {
      out.push({ t: 'ACTIVATE', card: card.iid, slot: 'scrap' })
    }
    // Lost Fleet's Splinter: legal only while three matching Shards played this
    // turn are still in play, because those three are the cost.
    if (!card.used.splinter && eff.splinter.length > 0
        && splinterSet(me, card).length === 3) {
      out.push({ t: 'ACTIVATE', card: card.iid, slot: 'splinter' })
    }
  }

  for (const c of v.tradeRow) {
    // High Alert prices some cards against your board, so the affordability
    // test has to go through the same function the purchase does.
    const price = c ? costFor(cardDef(c.def), me.inPlay, {
      variant: v.variant, buyer: seat, counters: v.marketCounters[c.iid] ?? 0,
      scenario: v.scenario,
    }) : 0
    if (c && price <= me.trade) {
      out.push({ t: 'BUY_CARD', card: c.iid })
    }
  }
  // "You may reveal any Gambits ... during your Main Phase."
  for (const g of me.gambits) out.push({ t: 'REVEAL_GAMBIT', card: g.iid })
  // A mission is claimable only while its objective actually holds, so the
  // legality check IS the objective check -- there is no second rule to drift.
  for (const m of me.missions) {
    const obj = cardDef(m.def).objective
    if (obj && objectiveMet(me, obj)) {
      out.push({ t: 'CLAIM_MISSION', card: m.iid })
    }
  }

  for (const c of v.setAside) {
    // Bought exactly as a row card is, so it goes through the same price.
    if (costFor(cardDef(c.def), me.inPlay, {
      variant: v.variant, buyer: seat, scenario: v.scenario,
    }) <= me.trade) {
      out.push({ t: 'BUY_CARD', card: c.iid })
    }
  }
  if (v.explorerPile > 0 && me.trade >= EXPLORER_COST) out.push({ t: 'BUY_EXPLORER' })

  // Outposts must fall before anything behind them can be touched.
  const shielded = v.opponent.inPlay.some((c) => cardDef(c.def).type === 'outpost')
  for (const c of v.opponent.inPlay) {
    const def = cardDef(c.def)
    // Only bases are attackable. A Hero sits in the play area and cannot be
    // attacked at all, which a "not a ship" test would get wrong.
    if (def.type !== 'base' && def.type !== 'outpost') continue
    if (shielded && def.type !== 'outpost') continue
    // Unity Warcraft shifts what a base actually costs to break, so the
    // affordability test goes through the same function the attack does.
    const need = defenseAgainst(v.opponent.gambitsInPlay, me.gambitsInPlay, def.defense ?? 0)
    if (me.combat >= need) out.push({ t: 'ATTACK_BASE', base: c.iid })
  }
  if (!shielded) {
    // Every amount, not just "all of it": a partial hit is legal, and the fuzz
    // property asserts that anything omitted here is rejected by reduce().
    for (let n = 1; n <= me.combat; n++) out.push({ t: 'ATTACK_PLAYER', amount: n })
  }

  // ── Frontiers Challenge actions ─────────────────────────────────────────
  if (v.boss) {
    if (!v.boss.mulliganUsed) out.push({ t: 'MULLIGAN_ROW' })
    if (v.boss.id === 'dimensional-horror') {
      // One entry per affordable CARD, not per tentacle: each card is shot off
      // for its own cost, and any number of them per turn.
      for (const f of TENTACLE_FACTIONS) {
        for (const c of v.boss.tentacles[f]) {
          if (me.combat >= cardDef(c.def).cost) {
            out.push({ t: 'ATTACK_TENTACLE', faction: f, card: c.iid })
          }
        }
      }
    }
  }

  // Teammates pool their Trade and Combat: "Players may, as many times as they
  // like each turn, transfer any amount of their Trade and/or Combat to a
  // teammate's pool."
  const c = v.coop
  if (c && c.mode !== 'individual') {
    for (const mate of c.players) {
      if (mate === seat || c.eliminated.includes(mate)) continue
      for (const what of ['trade', 'combat'] as const) {
        for (let n = 1; n <= me[what]; n++) out.push({ t: 'TRANSFER', to: mate, what, n })
      }
    }
  }

  // Забег: ставка на собственный ход. Только на своём ходу, раз за ход, и
  // только пока она ещё не выиграна сама собой — обещать уже сделанное нельзя.
  if (v.scenario?.wagers && v.activePlayer === seat && me.wager === null) {
    const w = wagerFor(v.matchId, v.turn, seat)
    if (!wagerProgress(w, wagerSourceOf(v.tally[seat], me)).met) out.push({ t: 'TAKE_WAGER' })
  }

  out.push({ t: 'END_TURN' })
  return out
}

/**
 * Is this ally slot switched on?
 *
 * `pinned` is United's per-faction slot: that faction and no other. Unpinned
 * means any faction the card counts as -- its printed one or two, plus a Stealth
 * Needle's copied faction -- which is also United's "Coalition Ally (Machine
 * Cult or Trade Federation)", where either half will do.
 */
function allyReady(
  card: InPlayCardView, unlocked: readonly string[], pinned?: string,
): boolean {
  if (pinned) return unlocked.includes(pinned)
  const printed = cardDef(card.def)
  if (unlocked.includes(printed.faction)) return true
  if (printed.faction2 && unlocked.includes(printed.faction2)) return true
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
