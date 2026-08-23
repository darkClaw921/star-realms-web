import { cardDef, type GameEvent, type PlayerId } from '@sr/engine'
import { TENTACLE_RU } from '@/i18n/challenges.ru'
import { cardName } from '@/i18n/cards.ru'
import { UI } from '@/i18n/ui'
import type { LogLine } from './types'

/**
 * A table can seat up to five, so names are partial: an unnamed seat falls back
 * to its own id rather than making the map declare seats nobody is sitting in.
 */
export type SeatNames = Partial<Record<PlayerId, string>>

const DEFAULT_NAMES: SeatNames = { p1: UI.playerOne, p2: UI.playerTwo }

const RESOURCE: Record<'trade' | 'combat' | 'authority', string> = {
  trade: 'очк. торговли',
  combat: 'очк. боя',
  authority: 'очк. влияния',
}

const SLOT: Record<string, string> = {
  primary: 'первичное',
  ally: 'союзное',
  scrap: 'утилизационное',
}

const ZONE: Record<string, string> = {
  hand: 'руки',
  discard: 'стопки сброса',
  inPlay: 'игры',
  tradeRow: 'торгового ряда',
  deck: 'колоды',
  scrapHeap: 'утиля',
  explorerPile: 'стопки исследователей',
}

const FACTION_CASE: Record<string, string> = {
  trade_federation: 'Торговой Федерации',
  blob: 'Слизней',
  star_empire: 'Звёздной Империи',
  machine_cult: 'Техно-культа',
  unaligned: 'без фракции',
}

/** Склонение существительного при числительном: 1 карту, 2 карты, 5 карт. */
function cards(n: number): string {
  const t = n % 10
  const h = n % 100
  if (h >= 11 && h <= 14) return `${n} карт`
  if (t === 1) return `${n} карту`
  if (t >= 2 && t <= 4) return `${n} карты`
  return `${n} карт`
}

/** Превращает поток событий движка в читаемый комментарий к партии. */
export function describe(e: GameEvent, names: SeatNames = DEFAULT_NAMES): string | null {
  const who = (p: PlayerId): string => names[p] ?? p
  const card = (d: Parameters<typeof cardDef>[0]): string => `«${cardName(d, cardDef(d).name)}»`

  switch (e.e) {
    case 'TURN_START': return `— Ход ${e.turn}: ${who(e.player)} —`
    // Пропуск объявляется вслух: без строки в журнале уровень «новичок»
    // выглядит как сбой очереди — ходы игрока идут подряд, а номера прыгают.
    case 'TURN_SKIPPED': return `— Ход ${e.turn}: ${who(e.player)} пропускает —`
    case 'TURN_END': return null
    case 'TOPDECK':
      return `${who(e.player)} кладёт ${card(e.def)} на верх колоды`
    case 'RETURN_FROM_SCRAP':
      return `${card(e.def)} возвращается из утиля в стопку сброса`
    case 'RETURN_TO_HAND':
      return `${card(e.def)} возвращается в руку игрока ${who(e.owner)}`
    case 'EVENT':
      return `Событие: ${card(e.def)}`
    case 'DOCKED':
      return `${card(e.def)} стыкуется и остаётся в руке игрока ${who(e.player)}`
    case 'SET_ASIDE':
      return `${card(e.def)} отложена — её можно купить до конца партии`
    case 'GAMBIT_REVEALED':
      return `${who(e.player)} раскрывает гамбит ${card(e.def)}`
    case 'MISSION_COMPLETE':
      return `${who(e.player)} выполняет миссию ${card(e.def)}`
    case 'TENTACLE_FED':
      return `${TENTACLE_RU[e.faction] ?? e.faction} поглощает ${card(e.def)}`
    case 'TENTACLE_HIT':
      return `${card(e.def)} сбита с щупальца (${e.cost} очк. боя)`
    case 'PLAY_CARD': return `${who(e.player)} разыгрывает ${card(e.def)}`
    case 'ABILITY_USED':
      return e.slot === 'trigger'
        ? `Срабатывает ${card(e.def)}`
        : `${who(e.player)} применяет ${SLOT[e.slot] ?? e.slot} свойство ${card(e.def)}`
    case 'GAIN': return `${who(e.player)}: +${e.n} ${RESOURCE[e.what]}`
    case 'DRAW':
      // Никогда не называем добранные карты, даже свои. Журнал переживает смену
      // зрителя (передача устройства, прокрутка назад), поэтому единственное
      // безопасное правило — печатать только количество. Свою руку игрок и так
      // видит на столе.
      return `${who(e.player)} добирает ${cards(e.n)}`
    case 'DISCARD':
      return `${who(e.player)} сбрасывает ${e.def ? card(e.def) : 'карту'}`
    case 'SCRAP':
      return `${e.def ? card(e.def) : 'Карта'} уходит в утиль из ${ZONE[e.from] ?? e.from}`
    case 'ACQUIRE':
      return `${who(e.player)} покупает ${card(e.def)}` +
        (e.dest === 'deck_top' ? ' на верх колоды' : '')
    case 'TRADE_ROW_REFILL': return null
    case 'BASE_DESTROYED':
      return `${card(e.def)} уничтожена (база: ${who(e.owner)})`
    case 'ATTACK_PLAYER':
      return `${who(e.attacker)} атакует ${who(e.target)} на ${e.n}`
    case 'AUTHORITY_LOST': return null
    case 'COPY_SHIP': return `«Игла-невидимка» копирует ${card(e.copied)}`
    case 'ALLY_UNLOCKED':
      return `${who(e.player)}: открыты союзные свойства ${FACTION_CASE[e.faction] ?? e.faction}`
    case 'RESHUFFLE': return `${who(e.player)} замешивает сброс (${cards(e.n)})`
    case 'CHOICE_AUTO_RESOLVED': return `Выбор сделан автоматически — вариант был один`
    case 'FIZZLE': return `Без эффекта`
    case 'ELIMINATED': return `${who(e.player)} выбывает из игры`
    case 'TRANSFER':
      return `${who(e.from)} передаёт ${who(e.to)} ${e.n} ${RESOURCE[e.what]}`
    case 'GAME_OVER': return `${who(e.winner)} побеждает`
  }
}

let nextId = 1

export function toLines(
  events: readonly GameEvent[],
  seatNames?: SeatNames,
): LogLine[] {
  const out: LogLine[] = []
  for (const e of events) {
    const text = describe(e, seatNames)
    if (!text) continue
    out.push({
      id: nextId++,
      player: 'player' in e ? (e.player as PlayerId) : null,
      text,
      emphasis: e.e === 'TURN_START' || e.e === 'TURN_SKIPPED' || e.e === 'GAME_OVER'
        || e.e === 'BASE_DESTROYED' || e.e === 'ELIMINATED',
    })
  }
  return out
}
