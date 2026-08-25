'use client'

import {
  applyRelic, applyReward, RUN_LENGTH, relicOffer, runNode, runStartCarry,
  type CardDefId, type RelicId, type RunCard, type RunCarry, type RunReward,
} from '@sr/engine'

/**
 * Где забег и что в колоде.
 *
 * Живёт в браузере, а не в движке, по той же причине, что и прогресс кампании:
 * это не правило партии. Узел с той же перенесённой колодой обязан раздать одну
 * и ту же игру и в первый заход, и в десятый — а если бы движок знал, сколько
 * боёв уже позади, он мог бы этим воспользоваться.
 *
 * Забег ровно один. Второй «слот сохранения» означал бы, что проигрыш можно
 * отменить, загрузившись, — а забег без цены проигрыша это уже кампания.
 */
const KEY = 'sr:run'
const RECORD_KEY = 'sr:run:best'

/** Чего экран ждёт от игрока прямо сейчас. */
export type RunStage =
  /** Следующий бой не сыгран. */
  | 'fight'
  /** Бой выигран, награда не взята. */
  | 'reward'
  /** Награда взята, а задача боя выполнена — остался артефакт. */
  | 'relic'
  | 'won'
  | 'lost'

export interface RunSave {
  /** Из него выводятся награды: перезагрузка страницы не должна их перекатывать. */
  readonly seed: string
  /** Узел, который предстоит (или только что) сыграть, 1..RUN_LENGTH. */
  readonly index: number
  readonly carry: RunCarry
  readonly stage: RunStage
  /** Сколько боёв забега уже выиграно. */
  readonly cleared: number
  /** Выполнена ли задача в последнем выигранном бою. */
  readonly featDone: boolean
}

function fresh(): RunSave {
  return {
    seed: Math.floor(Math.random() * 2 ** 52).toString(16).padStart(16, '0'),
    index: 1,
    carry: runStartCarry(),
    stage: 'fight',
    cleared: 0,
    featDone: false,
  }
}

/**
 * Прочитать сохранение, отбросив всё, чему нельзя верить.
 *
 * Проверка не формальная: в сохранении лежат идентификаторы карт, и битое
 * значение отсюда доедет до createGame и уронит партию. Дешевле считать
 * непонятное отсутствием забега.
 */
export function loadRun(): RunSave | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const p: unknown = JSON.parse(raw)
    if (!p || typeof p !== 'object') return null
    const s = p as Partial<RunSave>
    const c = s.carry
    if (typeof s.seed !== 'string' || typeof s.index !== 'number') return null
    if (!c || !Array.isArray(c.deck) || !Array.isArray(c.bases)) return null
    if (typeof c.authority !== 'number') return null
    const cards = (xs: unknown[]): RunCard[] | null => {
      const out: RunCard[] = []
      for (const x of xs) {
        // Сохранение до улучшений хранило одни идентификаторы. Такой забег —
        // забег без улучшений, а не испорченный: строка читается как карта с
        // нулём, а не выбрасывает всё сохранение.
        if (typeof x === 'string') { out.push({ def: x as CardDefId, up: 0 }); continue }
        if (!x || typeof x !== 'object') return null
        const c2 = x as { def?: unknown; up?: unknown }
        if (typeof c2.def !== 'string') return null
        out.push({ def: c2.def as CardDefId, up: typeof c2.up === 'number' ? c2.up : 0 })
      }
      return out
    }
    const deck = cards(c.deck as unknown[])
    const bases = cards(c.bases as unknown[])
    if (!deck || !bases) return null
    if (s.index < 1 || s.index > RUN_LENGTH + 1) return null
    const stage: RunStage =
      s.stage === 'reward' || s.stage === 'relic' || s.stage === 'won' || s.stage === 'lost'
        ? s.stage : 'fight'
    return {
      seed: s.seed,
      index: s.index,
      // Идентификаторы карт брендированы: строка из хранилища становится
      // CardDefId только здесь, после проверки, что это вообще строки.
      carry: {
        deck,
        bases,
        authority: c.authority,
        // Сохранение, сделанное до артефактов, — это забег без артефактов, а
        // не испорченный забег: пустой список, а не выброшенное сохранение.
        relics: Array.isArray(c.relics) && c.relics.every((x) => typeof x === 'string')
          ? c.relics as RelicId[]
          : [],
      },
      stage,
      cleared: typeof s.cleared === 'number' ? s.cleared : 0,
      featDone: s.featDone === true,
    }
  } catch {
    return null
  }
}

function write(save: RunSave): RunSave {
  try { localStorage.setItem(KEY, JSON.stringify(save)) } catch { /* не критично */ }
  return save
}

export function startRun(): RunSave {
  return write(fresh())
}

export function abandonRun(): void {
  try { localStorage.removeItem(KEY) } catch { /* не критично */ }
}

/** Бой выигран: колода, с которой из него вышли, и есть колода следующего боя. */
export function clearedNode(save: RunSave, carry: RunCarry, featDone: boolean): RunSave {
  return write({
    ...save,
    carry,
    cleared: save.index,
    featDone,
    stage: save.index >= RUN_LENGTH ? 'won' : 'reward',
  })
}

export function lostRun(save: RunSave): RunSave {
  return write({ ...save, stage: 'lost' })
}

/**
 * Награда взята. Если задача боя выполнена — следом выбор артефакта.
 *
 * Артефакт именно СЛЕДОМ, а не четвёртым вариантом награды: иначе он стал бы
 * альтернативой карте, а задача — способом отказаться от обычной награды.
 */
export function takeReward(save: RunSave, r: RunReward): RunSave {
  const carry = applyReward(save.carry, r)
  const node = runNode(save.index)
  const owed = save.featDone && node !== null
    && relicOffer(save.seed, node, carry.relics).length > 0
  return write(owed
    ? { ...save, carry, stage: 'relic' }
    : { ...save, carry, index: save.index + 1, stage: 'fight', featDone: false })
}

/** Артефакт выбран — дальше по лестнице. */
export function takeRelic(save: RunSave, id: RelicId): RunSave {
  return write({
    ...save,
    carry: applyRelic(save.carry, id),
    index: save.index + 1,
    stage: 'fight',
    featDone: false,
  })
}

/**
 * Самый глубокий пройденный узел за всё время.
 *
 * Отдельный ключ: забег стирается проигрышем, а рекорд — то немногое, что
 * проигрыш обязан пережить, иначе стирается и смысл лезть дальше.
 */
export function runRecord(): number {
  try {
    const n = Number(localStorage.getItem(RECORD_KEY))
    return Number.isFinite(n) && n > 0 ? Math.min(n, RUN_LENGTH) : 0
  } catch {
    return 0
  }
}

export function noteRecord(cleared: number): void {
  if (cleared <= runRecord()) return
  try { localStorage.setItem(RECORD_KEY, String(cleared)) } catch { /* не критично */ }
}

/**
 * Сколько каких карт в колоде — колоду показывают стопками, а не списком.
 *
 * Улучшенные копии считаются отдельной стопкой: две гадюки и одна улучшенная —
 * это два разных предмета, и складывать их в одну кучу значило бы спрятать
 * лучшую карту колоды.
 */
export function deckTally(carry: RunCarry): { def: CardDefId; up: number; n: number }[] {
  const by = new Map<string, { def: CardDefId; up: number; n: number }>()
  for (const c of carry.deck) {
    const key = `${c.def}:${c.up}`
    const at = by.get(key)
    if (at) at.n += 1
    else by.set(key, { def: c.def, up: c.up, n: 1 })
  }
  return [...by.values()]
}
