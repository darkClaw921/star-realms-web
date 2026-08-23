import { FACTIONS, type Faction } from '@sr/engine'
import { PLAY_MODES, type Profile, type PlayMode, type Tally } from './types'

/**
 * Показатели, которые не хранятся.
 *
 * В файле лежат только суммы; всё, что игрок видит на экране, считается отсюда.
 * Так профиль нельзя рассинхронизировать — процент побед не может разойтись со
 * счётом партий, потому что это одно и то же число, посчитанное в момент показа.
 */

export function emptyTally(): Tally {
  return {
    games: 0, wins: 0, losses: 0, turns: 0, durationMs: 0,
    fastestWin: null, longest: 0, streak: 0, bestStreak: 0, worstStreak: 0,
  }
}

/** Сложить счётчики нескольких режимов в один. */
export function merge(tallies: readonly Tally[]): Tally {
  return tallies.reduce<Tally>((a, t) => ({
    games: a.games + t.games,
    wins: a.wins + t.wins,
    losses: a.losses + t.losses,
    turns: a.turns + t.turns,
    durationMs: a.durationMs + t.durationMs,
    fastestWin: a.fastestWin === null ? t.fastestWin
      : t.fastestWin === null ? a.fastestWin
        : Math.min(a.fastestWin, t.fastestWin),
    longest: Math.max(a.longest, t.longest),
    // Серия принадлежит режиму: победы над ботом не продолжают серию в онлайне,
    // поэтому в своде показывается лучшая из них, а не сумма.
    streak: Math.max(a.streak, t.streak),
    bestStreak: Math.max(a.bestStreak, t.bestStreak),
    worstStreak: Math.min(a.worstStreak, t.worstStreak),
  }), emptyTally())
}

export function total(p: Profile): Tally {
  return merge(PLAY_MODES.map((m) => p.modes[m] ?? emptyTally()))
}

/** Доля побед, 0..1. Без партий — null: ноль процентов означал бы поражения. */
export function winRate(t: Tally): number | null {
  return t.games > 0 ? t.wins / t.games : null
}

export function avgTurns(t: Tally): number | null {
  return t.games > 0 ? t.turns / t.games : null
}

export function avgDuration(t: Tally): number | null {
  return t.games > 0 ? t.durationMs / t.games : null
}

/** Режимы, в которые действительно играли: пустые строки в таблице не нужны. */
export function playedModes(p: Profile): PlayMode[] {
  return PLAY_MODES.filter((m) => (p.modes[m]?.games ?? 0) > 0)
}

export interface FactionRow {
  readonly faction: Faction
  readonly cards: number
  readonly leading: number
  readonly leadingWins: number
  readonly rate: number | null
}

/**
 * Фракции по тому, сколько карт игрок в них вложил.
 *
 * Нейтральные карты не показываются: их берут все и всегда, и в списке
 * «любимых» они стояли бы первыми, ничего не объясняя.
 */
export function factionRows(p: Profile): FactionRow[] {
  return FACTIONS
    .filter((f) => f !== 'unaligned')
    .map((faction) => {
      const t = p.factions[faction] ?? { cards: 0, leading: 0, leadingWins: 0 }
      return {
        faction,
        cards: t.cards,
        leading: t.leading,
        leadingWins: t.leadingWins,
        rate: t.leading > 0 ? t.leadingWins / t.leading : null,
      }
    })
    .filter((r) => r.cards > 0)
    .sort((a, b) => b.cards - a.cards)
}

export interface CardRow {
  readonly def: string
  readonly taken: number
  readonly wins: number
  readonly rate: number | null
}

export function topCards(p: Profile, limit = 12): CardRow[] {
  return Object.entries(p.cards)
    .map(([def, t]) => ({
      def, taken: t.taken, wins: t.wins, rate: t.taken > 0 ? t.wins / t.taken : null,
    }))
    // При равном числе покупок вперёд идёт та, с которой чаще выигрывали:
    // алфавит на этом месте выглядел бы как случайный порядок.
    .sort((a, b) => b.taken - a.taken || b.wins - a.wins)
    .slice(0, limit)
}
