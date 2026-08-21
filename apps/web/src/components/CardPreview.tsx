'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cardDef, type CardDefId } from '@sr/engine'
import { UI } from '@/i18n/ui'
import { CardFrame } from './Card'
import { FACTION_VAR } from './Icons'

/** Maximum tilt in degrees at the edge of the viewport. */
const MAX_TILT = 13

/**
 * The held card, blown up and tilted away from the pointer.
 *
 * The tilt is written to CSS custom properties rather than to `style.transform`
 * so the transform itself stays declarative and one place owns the composition
 * of rotation, scale and the glare position. Pointer maths runs on every move,
 * so nothing here allocates or reads layout: the stage's rect is measured once
 * per open and reused.
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

  const tilt = useCallback((e: React.PointerEvent | React.MouseEvent): void => {
    const el = cardRef.current
    if (!el) return
    // Relative to the viewport, not to the card: the card is what moves, so
    // measuring against it would feed its own rotation back into the input.
    const dx = (e.clientX / window.innerWidth) * 2 - 1
    const dy = (e.clientY / window.innerHeight) * 2 - 1
    // Positive rotateY sends the right edge away, positive rotateX sends the top
    // away -- so this leans the surface off the pointer rather than toward it.
    el.style.setProperty('--rx', `${(-dy * MAX_TILT).toFixed(2)}deg`)
    el.style.setProperty('--ry', `${(dx * MAX_TILT).toFixed(2)}deg`)
    el.style.setProperty('--gx', `${(((dx + 1) / 2) * 100).toFixed(1)}%`)
    el.style.setProperty('--gy', `${(((dy + 1) / 2) * 100).toFixed(1)}%`)
  }, [])

  if (!mounted) return null

  return createPortal(
    <div
      className="preview"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onPointerMove={tilt}
      onClick={onClose}
    >
      <div className="preview__stage">
        <div className={`preview__slot${isBase ? ' preview__slot--base' : ''}`}>
          <div
            ref={cardRef}
            className={`card preview__card${isBase ? ' is-base' : ''}`}
            style={{
              '--fc': FACTION_VAR[c.faction],
              '--fc-line': `color-mix(in srgb, ${FACTION_VAR[c.faction]} 30%, var(--rule))`,
            } as React.CSSProperties}
          >
            <CardFrame def={def} />
            <span className="preview__glare" aria-hidden="true" />
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
