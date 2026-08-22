'use client'

import { useCallback, useEffect, useState } from 'react'
import { ALL_SETS, COMMAND_DECKS, VARIANTS, type SetId } from '@sr/engine'
import { setVolume } from '@/fx/audio'

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
  /**
   * A Command Deck for the player, or '' for the ordinary starting deck. Only
   * the player's own seat: the opponent keeps the standard deck, because
   * choosing for them is not a setting, it is a different game mode.
   */
  commandDeck: string
  /** An Arena scenario, or '' for the ordinary game. Applies to both players. */
  variant: string
  /** Громкость стола, 0..1. Ноль выключает звук: контекст даже не создаётся. */
  volume: number
  /** Вспышки на столе: взрывы, осколки, свечение союза. */
  effects: boolean
}

export const DEFAULTS: Settings = {
  cardScale: 1, textScale: 1, sets: ['core'], gambits: 0, missions: 0, commandDeck: '', variant: '',
  volume: 0.5, effects: true,
}

export const LIMITS = {
  cardScale: { min: 0.7, max: 1.6, step: 0.05 },
  textScale: { min: 0.85, max: 1.4, step: 0.05 },
  gambits: { min: 0, max: 3, step: 1 },
  missions: { min: 0, max: 3, step: 1 },
  volume: { min: 0, max: 1, step: 0.05 },
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
    // An unknown id from an older or foreign record falls back to no deck, which
    // is always a legal setup.
    commandDeck: COMMAND_DECKS.some((c) => c.id === o.commandDeck) ? String(o.commandDeck) : '',
    variant: (VARIANTS as readonly string[]).includes(String(o.variant)) ? String(o.variant) : '',
    // Ноль — законное значение, поэтому `|| DEFAULT` здесь нельзя: он бы молча
    // включал звук каждому, кто его выключил.
    volume: clamp(Number.isFinite(Number(o.volume)) ? Number(o.volume) : DEFAULTS.volume,
      LIMITS.volume.min, LIMITS.volume.max),
    effects: o.effects === undefined ? DEFAULTS.effects : Boolean(o.effects),
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

/** Канал синхронизации: панель настроек и стол — разные инстансы одного хука. */
const CHANNEL = 'sr:settings-changed'

export function applySettings(s: Settings): void {
  const root = document.documentElement
  root.style.setProperty('--card-scale', String(s.cardScale))
  root.style.setProperty('--card-text-scale', String(s.textScale))
  setVolume(s.volume)
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
    // Стол и панель настроек держат по своему инстансу хука. Без этого
    // ползунок громкости менял бы только собственную копию состояния, и
    // выключить вспышки прямо во время партии было бы нельзя.
    const sync = (e: Event): void => setSettings((e as CustomEvent<Settings>).detail)
    window.addEventListener(CHANNEL, sync)
    return () => window.removeEventListener(CHANNEL, sync)
  }, [])

  const persist = useCallback((next: Settings) => {
    setSettings(next)
    applySettings(next)
    window.dispatchEvent(new CustomEvent(CHANNEL, { detail: next }))
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
