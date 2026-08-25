import type { PlayMode } from '@/profile/types'

/**
 * Строки профиля.
 *
 * Отдельный словарь, как у полигона и кампании: статистика — это свой домен со
 * своими терминами, и держать его в общем UI значило бы утопить меню игры в
 * названиях счётчиков.
 */
export const PROFILE_RU = {
  title: 'Профиль',
  eyebrow: 'Статистика этого браузера',
  guest: 'Капитан без имени',
  namePlaceholder: 'Ваше имя',
  rename: 'Сменить имя',
  save: 'Сохранить',
  cancel: 'Отмена',
  loading: 'Считаем…',
  offline: 'Статистика недоступна: сервер не отвечает',
  storageOff: 'Браузер не даёт сохранить профиль — статистика не ведётся',
  empty: 'Партий пока нет. Сыграйте — и здесь появится счёт.',
  emptyHint: 'Считаются все партии, кроме полигона.',
  full: 'Вся статистика',
  back: 'В меню',

  // счётчики
  games: 'Партий',
  wins: 'Побед',
  losses: 'Поражений',
  winRate: 'Процент побед',
  streak: 'Серия',
  bestStreak: 'Лучшая серия',
  worstStreak: 'Худшая серия',
  avgTurns: 'Ходов в среднем',
  fastestWin: 'Быстрейшая победа',
  longest: 'Самая долгая партия',
  avgDuration: 'Средняя длительность',
  totalTime: 'Всего за столом',

  // разделы
  byMode: 'По режимам',
  factions: 'Фракции',
  cards: 'Карты',
  recent: 'Последние партии',

  // таблицы
  colMode: 'Режим',
  colGames: 'Партий',
  colRecord: 'В–П',
  colRate: '% побед',
  colStreak: 'Серия',
  colAvgTurns: 'Ходов',
  colCards: 'Карт взято',
  colLeading: 'Основная',
  colCard: 'Карта',
  colTaken: 'Взята',
  colWinsWith: 'Побед с ней',
  colResult: 'Итог',
  colOpponent: 'Соперник',
  colTurns: 'Ходов',
  colScore: 'Счёт',
  colWhen: 'Когда',

  win: 'Победа',
  loss: 'Поражение',
  noData: '—',
  factionHint: 'Основная — фракция, которой в колоде оказалось больше всего к концу партии.',
  cardsHint: 'Считается каждая купленная копия карты.',

  turns: (n: number): string => `${n} ${plural(n, 'ход', 'хода', 'ходов')}`,
  gamesN: (n: number): string => `${n} ${plural(n, 'партия', 'партии', 'партий')}`,
  winStreak: (n: number): string => `${n} подряд`,
  lossStreak: (n: number): string => `${n} подряд`,
  percent: (v: number): string => `${Math.round(v * 100)}%`,
  score: (mine: number, theirs: number): string => `${mine} : ${theirs}`,
} as const

/**
 * Кем был соперник — для строки в истории партий.
 *
 * Бот записывается со сложностью: «победа над ботом» без неё значит слишком
 * разное, а история как раз для того, чтобы это различать.
 */
export const BOT_RU: Record<string, string> = {
  easy: 'Бот (лёгкий)',
  normal: 'Бот (обычный)',
  hard: 'Бот (сложный)',
}

export const MODE_RU: Record<PlayMode, string> = {
  bot: 'Против бота',
  online: 'По сети',
  hotseat: 'За одним экраном',
  campaign: 'Кампания',
  challenge: 'Испытания',
  run: 'Забег',
}

/** Русское число: «1 ход», «2 хода», «5 ходов». */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  const mod10 = mod100 % 10
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

/** Длительность человеческими словами: часы нужны, секунды — нет. */
export function humanDuration(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 1) return 'меньше минуты'
  if (min < 60) return `${min} мин`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest === 0 ? `${h} ч` : `${h} ч ${rest} мин`
}

/** Дата партии: сегодняшняя — часами, прочие — числом. */
export function humanDate(at: number, now = Date.now()): string {
  const d = new Date(at)
  const sameDay = new Date(now).toDateString() === d.toDateString()
  return sameDay
    ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
