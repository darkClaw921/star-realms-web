'use client'

import { useCallback, useEffect, useState } from 'react'
import { ALL_SETS, type SetId } from '@sr/engine'

/**
 * Пользовательские настройки отображения.
 *
 * Хранятся МНОЖИТЕЛИ, а не абсолютные размеры. Абсолютная ширина карты,
 * выставленная на десктопе, приехала бы на телефон как есть и разнесла бы
 * вёрстку; множитель же накладывается поверх адаптивной базы, и медиазапросы
 * продолжают работать.
 */
export interface Settings {
  /** Множитель ширины карты. Внутренности карты заданы в cqi, поэтому масштабируется всё сразу. */
  cardScale: number
  /** Дополнительный множитель только для текста на карте. */
  textScale: number
  /**
   * Наборы карт в торговой колоде.
   *
   * Настройка читается ТОЛЬКО при раздаче новой партии: менять состав колоды
   * посреди игры значило бы менять правила на ходу, а сохранённая партия
   * перестала бы воспроизводиться.
   */
  sets: readonly SetId[]
  /**
   * Gambits dealt face down to each player, and missions dealt to each. Both are
   * separate from `sets` because owning the cards and playing with them are
   * different decisions: the printed gambit rule says "choose a number of them
   * to be dealt", and zero is a legitimate choice.
   */
  gambits: number
  missions: number
}

export const DEFAULTS: Settings = {
  cardScale: 1, textScale: 1, sets: ['core'], gambits: 0, missions: 0,
}

export const LIMITS = {
  cardScale: { min: 0.7, max: 1.6, step: 0.05 },
  textScale: { min: 0.85, max: 1.4, step: 0.05 },
  gambits: { min: 0, max: 3, step: 1 },
  missions: { min: 0, max: 3, step: 1 },
} as const

const KEY = 'sr:settings'

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function sanitize(raw: unknown): Settings {
  const o = (raw ?? {}) as Partial<Settings>
  return {
    cardScale: clamp(Number(o.cardScale) || DEFAULTS.cardScale,
      LIMITS.cardScale.min, LIMITS.cardScale.max),
    textScale: clamp(Number(o.textScale) || DEFAULTS.textScale,
      LIMITS.textScale.min, LIMITS.textScale.max),
    sets: sanitizeSets(o.sets),
    gambits: clamp(Math.round(Number(o.gambits) || 0), LIMITS.gambits.min, LIMITS.gambits.max),
    missions: clamp(Math.round(Number(o.missions) || 0), LIMITS.missions.min, LIMITS.missions.max),
  }
}

/**
 * Неизвестный набор из старой или чужой записи отбрасывается, а пустой список
 * возвращается к базовому: раздать партию вообще без карт нельзя.
 */
function sanitizeSets(raw: unknown): readonly SetId[] {
  if (!Array.isArray(raw)) return DEFAULTS.sets
  const known = new Set<string>(ALL_SETS)
  const out = ALL_SETS.filter((s) => raw.includes(s) && known.has(s))
  return out.length > 0 ? out : DEFAULTS.sets
}

export function readSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? sanitize(JSON.parse(raw)) : DEFAULTS
  } catch {
    // Приватный режим или заблокированное хранилище — работаем со значениями по умолчанию.
    return DEFAULTS
  }
}

export function applySettings(s: Settings): void {
  const root = document.documentElement
  root.style.setProperty('--card-scale', String(s.cardScale))
  root.style.setProperty('--card-text-scale', String(s.textScale))
}

export function useSettings(): {
  settings: Settings
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  reset: () => void
} {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)

  useEffect(() => {
    const stored = readSettings()
    setSettings(stored)
    applySettings(stored)
  }, [])

  const persist = useCallback((next: Settings) => {
    setSettings(next)
    applySettings(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // Не сохранилось — настройка всё равно действует до конца сессии.
    }
  }, [])

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    persist({ ...readSettings(), [key]: value })
  }, [persist])

  const reset = useCallback(() => { persist(DEFAULTS) }, [persist])

  return { settings, set, reset }
}
