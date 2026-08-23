import { cardDef, type CardDefId, type GameState, type PlayerId } from '@sr/engine'
import type { MatchResult, PlayMode } from './types'

/**
 * Итог партии — из состояния, которым она кончилась.
 *
 * Считается он по СОСТОЯНИЮ, а не по виду игрока, и это важнее, чем кажется.
 * За одним экраном вид принадлежит тому, чей сейчас ход, то есть в конце — как
 * правило победителю; статистика, собранная с него, показывала бы сплошные
 * победы. Место, за которое считаем, называется явно.
 *
 * «Чем игрок играл» берётся из колоды на финише, а не из событий покупки:
 * события живут одну команду, а колода лежит до конца партии. Стартовые карты
 * и командные колоды отброшены — они у всех одинаковые и ни о чём не говорят.
 */

/** Карты, которые игрок добыл сам: торговый ряд и исследователи. */
function acquired(defs: readonly CardDefId[]): CardDefId[] {
  return defs.filter((def) => {
    try {
      const role = cardDef(def).role
      return role === 'trade_deck' || role === 'explorer'
    } catch {
      // Карта из набора, которого эта сборка не знает, не должна лишить игрока
      // всей записи о партии.
      return false
    }
  })
}

export function summarise(
  state: GameState, seat: PlayerId,
  meta: { mode: PlayMode; opponent: string; durationMs: number; at: number },
): MatchResult | null {
  if (state.phase !== 'gameOver') return null
  const me = state.players[seat]
  // Соперник — первое чужое место в партии. Для дуэли это ровно один игрок, а
  // в командной игре счёт всё равно ведётся по чужой стороне стола.
  const foeSeat = state.seats.find((s) => s !== seat) ?? seat
  const mine = [
    ...me.deck.map((c) => c.def),
    ...me.hand.map((c) => c.def),
    ...me.discard.map((c) => c.def),
    ...me.inPlay.map((c) => c.def),
  ]
  return {
    mode: meta.mode,
    won: state.winner === seat,
    turns: state.turn,
    authority: me.authority,
    foeAuthority: state.players[foeSeat].authority,
    durationMs: meta.durationMs,
    opponent: meta.opponent,
    cards: acquired(mine),
    at: meta.at,
  }
}
