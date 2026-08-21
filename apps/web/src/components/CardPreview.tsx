'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cardDef, type CardDefId } from '@sr/engine'
import { UI } from '@/i18n/ui'
import { CardFrame } from './Card'
import { FACTION_VAR } from './Icons'
import { useTilt } from './useTilt'

/**
 * The held card, blown up and tilted away from the pointer.
 *
 * Shares the tilt with the cards on the table, so the enlarged face behaves as
 * the same physical object rather than as a second, similar-looking effect.
 * The whole overlay listens, which lets the pointer keep steering the card out
 * on the backdrop; angles are measured against the slot, which -- unlike the
 * card -- never rotates.
 */
export function CardPreview({
  def, label, onClose,
}: {
  def: CardDefId
  label: string
  onClose: () => void
}): React.JSX.Element | null {
  const [mounted, setMounted] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const tilt = useTilt({ target: cardRef, frame: slotRef })
  const c = cardDef(def)
  const isBase = c.type !== 'ship'

  useEffect(() => setMounted(true), [])

  // Focus moves into the overlay and returns to whatever opened it.
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

  if (!mounted) return null

  return createPortal(
    <div
      className="preview"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
      {...tilt.handlers}
    >
      <div className="preview__stage">
        <div ref={slotRef} className={`preview__slot${isBase ? ' preview__slot--base' : ''}`}>
          <div
            ref={cardRef}
            className={`card preview__card${isBase ? ' is-base' : ''}${tilt.active ? ' is-tilting' : ''}`}
            style={{
              '--fc': FACTION_VAR[c.faction],
              '--fc-line': `color-mix(in srgb, ${FACTION_VAR[c.faction]} 30%, var(--rule))`,
            } as React.CSSProperties}
          >
            <CardFrame def={def} />
          </div>
        </div>
      </div>

      <div className="preview__bar">
        <span className="preview__hint">{UI.previewHint}</span>
        <button ref={closeRef} type="button" className="btn btn--sm" onClick={onClose}>
          {UI.previewClose}
        </button>
      </div>
    </div>,
    document.body,
  )
}
