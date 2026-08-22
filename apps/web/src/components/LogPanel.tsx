'use client'

import { useEffect, useRef, useState } from 'react'
import { UI } from '@/i18n/ui'
import type { LogLine } from '@/match/types'

/**
 * Журнал партии в выдвижной панели.
 *
 * Раньше он занимал постоянную колонку рядом с зоной игры и отбирал у неё
 * четверть ширины — при том, что читают его редко, а карты на столе смотрят
 * постоянно. Теперь он закрыт по умолчанию и открывается корешком у правого
 * края.
 *
 * Высота панели фиксирована, и внутри прокрутка: длинный ход добавляет
 * десятки строк, и без этого панель растягивала бы стол. Новые записи стоят
 * сверху, поэтому прокручивать за ними не нужно — свежее всегда на виду.
 */
export function LogPanel({ log }: { log: readonly LogLine[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  // Сколько строк накопилось, пока панель была закрыта: корешок должен
  // говорить, что в партии что-то происходило, а не просто висеть.
  const seen = useRef(log.length)
  const fresh = open ? 0 : Math.max(0, log.length - seen.current)
  if (open) seen.current = log.length

  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open])

  if (!open) {
    return (
      <button
        type="button"
        className={`logtab${fresh > 0 ? ' has-new' : ''}`}
        onClick={() => setOpen(true)}
        title={UI.logHint}
      >
        {UI.log}
        {fresh > 0 && <span className="logtab__n">{fresh > 99 ? '99+' : fresh}</span>}
      </button>
    )
  }

  return (
    <aside className="logpanel" aria-label={UI.log}>
      <header className="logpanel__head">
        <span className="eyebrow">{UI.log}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>
          {UI.hide}
        </button>
      </header>
      <div className="log">
        {[...log].reverse().map((l) => (
          <div key={l.id} className="log__line">
            {l.emphasis ? <b>{l.text}</b> : l.text}
          </div>
        ))}
      </div>
    </aside>
  )
}
