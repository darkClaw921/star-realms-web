'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Maximum tilt in degrees at the very edge of the card. */
const MAX_TILT = 14

export interface TiltOptions {
  /** The element that rotates. Defaults to the one carrying the handlers. */
  target?: React.RefObject<HTMLElement | null>
  /**
   * The element the pointer is measured against. Must NOT be the rotating one:
   * `getBoundingClientRect` of a transformed element reports the bounds of its
   * rotated, scaled box, so measuring the card against itself feeds its own
   * rotation back into the input and the tilt goes non-linear near the edges.
   * Defaults to the element carrying the handlers.
   */
  frame?: React.RefObject<HTMLElement | null>
}

export interface Tilt {
  /** True while the pointer is on the card -- switches CSS to the direct, snappy transition. */
  active: boolean
  handlers: {
    onPointerEnter: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerLeave: () => void
  }
}

/**
 * Hover tilt for a card: the surface leans away from wherever the pointer sits
 * on it.
 *
 * Ported from the holographic card in cash_flow_online (HoloCard/holo.css),
 * whose approach fixes the three things that make a hand-rolled tilt feel rough:
 *
 *  - Pointer samples are coalesced through requestAnimationFrame. A pointermove
 *    can fire several times per painted frame, and writing a custom property on
 *    each one makes the card chase sub-frame positions instead of moving once,
 *    smoothly, per frame.
 *  - The rotating element and the measured element are different nodes, so the
 *    rotation never feeds back into the pointer maths (see `frame` above).
 *  - Following and returning are two different gestures. Following the pointer
 *    wants to be near-immediate, returning to rest wants a long eased curve;
 *    one duration for both reads either as lag or as a snap.
 *
 * The angles go into CSS custom properties rather than into `style.transform`,
 * so CSS keeps sole ownership of how perspective, lift, scale and rotation
 * compose, and React never re-renders on pointer movement.
 */
export function useTilt({ target, frame: frameRef }: TiltOptions = {}): Tilt {
  const [active, setActive] = useState(false)
  const raf = useRef<number | null>(null)
  const pending = useRef<{ el: HTMLElement, x: number, y: number } | null>(null)

  const write = useCallback((el: HTMLElement, x: number, y: number): void => {
    // -0.5 at the left/top edge, +0.5 at the right/bottom.
    const cx = x - 0.5
    const cy = y - 0.5
    // Positive rotateY sends the right edge away, positive rotateX the top --
    // so the surface leans off the pointer rather than toward it.
    el.style.setProperty('--rx', `${(-cy * 2 * MAX_TILT).toFixed(2)}deg`)
    el.style.setProperty('--ry', `${(cx * 2 * MAX_TILT).toFixed(2)}deg`)
  }, [])

  const schedule = useCallback((e: React.PointerEvent): void => {
    const host = e.currentTarget as HTMLElement
    const el = target?.current ?? host
    const box = frameRef?.current ?? host
    const r = box.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    // Clamped: the entering event can sit a fraction outside the box, and for
    // the enlarged card the pointer roams the whole backdrop -- past the edge
    // the card simply holds its steepest lean rather than winding up further.
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    pending.current = { el, x, y }
    if (raf.current !== null) return
    raf.current = requestAnimationFrame(() => {
      raf.current = null
      const p = pending.current
      if (p) write(p.el, p.x, p.y)
    })
  }, [write, target, frameRef])

  const enter = useCallback((e: React.PointerEvent): void => {
    // Touch has no hover, so a tap would tilt the card and leave it tilted.
    if (e.pointerType === 'touch') return
    setActive(true)
    // A pointer that comes to rest sends no further pointermove, so the entering
    // event has to be a sample like any other -- otherwise the card stays flat
    // until the player happens to jog the mouse, which reads as the effect
    // needing to be held for.
    schedule(e)
  }, [schedule])

  const move = useCallback((e: React.PointerEvent): void => {
    if (e.pointerType === 'touch') return
    schedule(e)
  }, [schedule])

  const leave = useCallback((): void => {
    setActive(false)
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    raf.current = null
    const p = pending.current
    pending.current = null
    if (!p) return
    // Clearing the properties -- rather than setting them to zero -- hands the
    // rest position back to the stylesheet, so one place still owns it.
    p.el.style.removeProperty('--rx')
    p.el.style.removeProperty('--ry')
  }, [])

  // A queued frame must never fire into a node this component no longer owns.
  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current)
  }, [])

  return { active, handlers: { onPointerEnter: enter, onPointerMove: move, onPointerLeave: leave } }
}
