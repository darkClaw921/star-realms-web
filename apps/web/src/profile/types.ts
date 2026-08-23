import type { CardDefId, Faction } from '@sr/engine'

/**
 * Профиль игрока и его статистика.
 *
 * Аккаунтов в игре нет, и заводить их ради счётчика побед незачем: игрок
 * опознаётся случайным идентификатором, который заводит себе браузер, а имя
 * — просто подпись, которую он может сменить. Отсюда прямое следствие, о
 * котором честнее сказать вслух: статистика привязана к устройству, а не к
 * человеку, и очистка данных сайта её обнуляет.
 *
 * Считается всё раздельно по режимам. Партия с ботом и партия против живого
 * соперника — разные вещи, и общий процент побед по ним не значит ничего.
 */

/** Полигон в список не входит: там состояние правят руками. */
export type PlayMode = 'bot' | 'online' | 'hotseat' | 'campaign' | 'challenge'

export const PLAY_MODES: readonly PlayMode[] = [
  'bot', 'online', 'campaign', 'challenge', 'hotseat',
]

/** Итог одной партии — то, что игрок мог бы записать в тетрадку сам. */
export interface MatchResult {
  readonly mode: PlayMode
  readonly won: boolean
  /** Ход, на котором партия кончилась. */
  readonly turns: number
  /** Авторитет на финише: свой и чужой. Разница — это «насколько уверенно». */
  readonly authority: number
  readonly foeAuthority: number
  /** Сколько партия шла по часам. */
  readonly durationMs: number
  /** Кем был соперник: сложность бота, имя босса, имя игрока. */
  readonly opponent: string
  /**
   * Состав колоды на финише, без стартовых карт: чем игрок в итоге играл.
   * Именно из него считаются любимые фракции и карты — событий приобретения к
   * концу партии уже нет, а колода есть.
   */
  readonly cards: readonly CardDefId[]
  /** Момент завершения, в миллисекундах эпохи. */
  readonly at: number
}

/** Счёт по одному режиму. */
export interface Tally {
  games: number
  wins: number
  losses: number
  /** Сумма ходов всех партий: среднее считается из неё, а не хранится. */
  turns: number
  /** Сумма длительностей, та же арифметика. */
  durationMs: number
  /** Самая быстрая победа в ходах, null — если побед ещё не было. */
  fastestWin: number | null
  /** Самая долгая партия в ходах. */
  longest: number
  /** Текущая серия: положительная — победы подряд, отрицательная — поражения. */
  streak: number
  bestStreak: number
  worstStreak: number
}

export interface FactionTally {
  /** Сколько карт этой фракции игрок набрал за все партии. */
  cards: number
  /** В скольких партиях она была у него самой многочисленной. */
  leading: number
  /** И сколько из них выиграно. */
  leadingWins: number
}

export interface CardTally {
  taken: number
  wins: number
}

export interface Profile {
  readonly id: string
  name: string
  readonly createdAt: number
  updatedAt: number
  modes: Record<PlayMode, Tally>
  factions: Record<Faction, FactionTally>
  /** Карты, которые игрок брал: ключ — определение карты. */
  cards: Record<string, CardTally>
  /** Последние партии, новые впереди. Длина ограничена RECENT_LIMIT. */
  recent: MatchResult[]
}

/** Дальше история интересна уже как статистика, а не как список. */
export const RECENT_LIMIT = 25
