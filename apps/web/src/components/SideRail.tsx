'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Какая плашка закреплена открытой. Одна на всю полосу: две открытые
 * развёртки лежат друг на друге и обе становятся нечитаемыми.
 */
const RailContext = createContext<{
  open: string | null
  setOpen: (id: string | null) => void
}>({ open: null, setOpen: () => {} })

/**
 * Гамбиты и миссии, убранные к левому краю стола.
 *
 * Они лежат на столе всю партию и почти всю партию к ним не притрагиваются:
 * гамбит раскрывают один раз, миссию засчитывают один раз. Полоса карт во всю
 * ширину отнимала место у торгового ряда и у руки, то есть у того, на что
 * смотрят каждый ход. Здесь они свёрнуты в плашку и разворачиваются наведением.
 *
 * Наведение не единственный способ открыть. На касании ховера нет вовсе, а
 * спрятать за ним ЛЕГАЛЬНЫЙ ход — значит спрятать ход: плашка открывается
 * также щелчком и при фокусе с клавиатуры, а когда внутри есть что сделать,
 * на ней горит точка.
 */
export function SideRail({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const value = useMemo(() => ({ open, setOpen }), [open])
  return (
    <RailContext.Provider value={value}>
      <aside className="rail-side">{children}</aside>
    </RailContext.Provider>
  )
}

export function SidePlate({
  label, count, alert, children,
}: {
  label: string
  /** Сколько карт внутри. Ноль плашку не рисует — её просто не вызывают. */
  count: number
  /** Внутри есть легальный ход: раскрыть гамбит или засчитать миссию. */
  alert: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const { open, setOpen } = useContext(RailContext)
  const pinned = open === label
  const ref = useRef<HTMLDivElement | null>(null)

  // Закреплённая щелчком плашка должна закрываться щелчком мимо и по Escape,
  // иначе она перекрывает стол до конца партии.
  useEffect(() => {
    if (!pinned) return undefined
    const away = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    }
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [pinned, setOpen])

  return (
    <div className={`plate${pinned ? ' is-pinned' : ''}`} ref={ref}>
      <button
        type="button"
        className="plate__tab"
        aria-expanded={pinned}
        onClick={() => setOpen(pinned ? null : label)}
      >
        <span className="plate__label">{label}</span>
        <span className="plate__count">{count}</span>
        {alert && <span className="plate__dot" aria-hidden="true" />}
      </button>
      <div className="plate__flyout">
        <div className="plate__cards">{children}</div>
      </div>
    </div>
  )
}
