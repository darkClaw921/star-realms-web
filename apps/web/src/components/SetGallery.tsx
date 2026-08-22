'use client'

import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CARDS, type CardDefId, type SetId } from '@sr/engine'
import { UI } from '@/i18n/ui'
import { Card } from './Card'

/** Печатный порядок: сначала то, что попадает в торговую колоду. */
const ROLE_ORDER = [
  'trade_deck', 'starter', 'explorer', 'gambit', 'mission', 'command', 'commander', 'token',
] as const

interface Row {
  role: string
  cards: readonly { id: CardDefId; copies: number }[]
}

/**
 * Что лежит в наборе, разложенное по ролям.
 *
 * Роль — не украшение заголовка: гамбит, миссия и командная колода приходят на
 * стол разными путями, и набор из тринадцати гамбитов рядом с набором из
 * восьмидесяти карт торговой колоды иначе выглядел бы одинаково.
 *
 * Внутри роли — по стоимости, как в правилах и в самой торговой колоде;
 * при равной стоимости по имени, чтобы порядок не зависел от порядка реестра.
 */
function rowsOf(set: SetId): readonly Row[] {
  const byRole = new Map<string, { id: CardDefId; copies: number; cost: number; name: string }[]>()
  for (const def of CARDS.values()) {
    if (def.set !== set) continue
    const list = byRole.get(def.role) ?? []
    list.push({ id: def.id, copies: def.copies, cost: def.cost, name: def.name })
    byRole.set(def.role, list)
  }
  const rows: Row[] = []
  for (const role of ROLE_ORDER) {
    const list = byRole.get(role)
    if (!list) continue
    list.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name))
    rows.push({ role, cards: list.map((c) => ({ id: c.id, copies: c.copies })) })
  }
  return rows
}

/**
 * Просмотр набора целиком.
 *
 * Открывается удержанием на плитке набора — тем же жестом, каким увеличивается
 * карта на столе, так что жест не приходится узнавать заново. Внутри лежат
 * настоящие `<Card>`, а значит удержание работает и здесь: набор → карта →
 * увеличенная карта.
 */
export function SetGallery({ set, onClose }: { set: SetId; onClose: () => void }): React.JSX.Element {
  const rows = useMemo(() => rowsOf(set), [set])
  const total = rows.reduce((n, r) => n + r.cards.length, 0)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Фокус уходит в окно и возвращается на плитку, которая его открыла.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => previous?.focus?.()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="overlay overlay--gallery" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--gallery"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={UI.setName[set] ?? set}
      >
        <div className="sheet__head">
          <span className="sheet__title">{UI.setName[set] ?? set}</span>
          <span className="sheet__hint">
            {UI.setGalleryCount(total)} · {UI.setGalleryHint}
          </span>
          <button ref={closeRef} type="button" className="btn btn--sm" onClick={onClose}>
            {UI.previewClose}
          </button>
        </div>

        <div className="gallery">
          {total === 0 ? <p className="group__note">{UI.setGalleryEmpty}</p> : null}
          {rows.map((row) => (
            <section className="group" key={row.role}>
              {rows.length > 1
                ? <h3 className="group__title">{UI.galleryRole[row.role] ?? row.role}</h3>
                : null}
              <div className="gallery__grid">
                {row.cards.map((c) => (
                  <div className="gallery__cell" key={c.id}>
                    <Card def={c.id} />
                    {c.copies > 1
                      ? <span className="gallery__copies">{UI.setGalleryCopies(c.copies)}</span>
                      : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
