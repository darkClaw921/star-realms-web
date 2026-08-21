'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** How long the card has to be held before it opens. Mirrored in CSS as the
 *  duration of the fill indicator, so the two must stay in step. */
export const HOLD_MS = 600

/** Movement past this many pixels means the player is scrolling, not holding. */
const SLOP_PX = 10

export interface HoldHandlers {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: () => void
  onPointerLeave: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onKeyUp: () => void
  onClickCapture: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}

export interface Hold {
  /** True while the timer is running -- drives the fill indicator. */
  holding: boolean
  handlers: HoldHandlers
}

/**
 * Press-and-hold, kept separate from the click it shares a target with.
 *
 * The subtle part is not the timer, it is the click that arrives afterwards:
 * a pointerup following a completed hold still fires a click, which on a card
 * would buy or play it. So a completed hold arms a one-shot suppression that
 * the capture-phase handler consumes before the card's own onClick ever sees it.
 *
 * Keyboard gets the same gesture rather than a different one: holding Enter or
 * Space repeats keydown, so the first one starts the timer and keyup cancels it.
 */
export function useHold(onHold: () => void): Hold {
  const [holding, setHolding] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    origin.current = null
    setHolding(false)
  }, [])

  // A component can unmount mid-hold (the trade row refills under the pointer).
  useEffect(() => cancel, [cancel])

  const start = useCallback((at: { x: number; y: number } | null) => {
    if (timer.current !== null) return
    origin.current = at
    setHolding(true)
    timer.current = setTimeout(() => {
      timer.current = null
      origin.current = null
      setHolding(false)
      suppressClick.current = true
      onHold()
    }, HOLD_MS)
  }, [onHold])

  return {
    holding,
    handlers: {
      onPointerDown: (e) => {
        // Secondary buttons are not a hold, and they must not arm the timer.
        if (e.button !== 0) return
        start({ x: e.clientX, y: e.clientY })
      },
      onPointerMove: (e) => {
        const o = origin.current
        if (!o) return
        if (Math.abs(e.clientX - o.x) > SLOP_PX || Math.abs(e.clientY - o.y) > SLOP_PX) cancel()
      },
      onPointerUp: () => cancel(),
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onKeyDown: (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        // Auto-repeat would restart the timer on every tick.
        if (e.repeat) return
        start(null)
      },
      onKeyUp: cancel,
      onClickCapture: (e) => {
        if (!suppressClick.current) return
        suppressClick.current = false
        e.preventDefault()
        e.stopPropagation()
      },
      // A long press on a touch screen raises the native context menu on top of
      // our own overlay; on desktop the right-click menu over a card is noise.
      onContextMenu: (e) => e.preventDefault(),
    },
  }
}
