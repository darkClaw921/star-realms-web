import type { Faction } from '@sr/engine'

/**
 * One inline SVG <symbol> sprite, injected once into the shell and referenced
 * with <use>. Not an icon font (screen readers announce private-use-area
 * garbage) and not emoji (OS-dependent rendering).
 *
 * Every mark is a distinct SHAPE, not a tinted dot. Machine Cult red and Blob
 * green collapse into the same grey under deuteranopia, so shape has to be the
 * thing that actually distinguishes them.
 */
export function IconSprite(): React.JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        {/* resources */}
        <symbol id="i-trade" viewBox="0 0 24 24">
          <path fill="currentColor" d="M12 1.6 22 7v10l-10 5.4L2 17V7z" />
        </symbol>
        <symbol id="i-combat" viewBox="0 0 24 24">
          <path fill="currentColor" d="m12 1 3.1 6.2L22 8.4l-5 4.9 1.2 6.9L12 17l-6.2 3.2L7 13.3l-5-4.9 6.9-1.2z" />
        </symbol>
        <symbol id="i-authority" viewBox="0 0 24 24">
          <path fill="currentColor" d="M12 1.8 21 5v7.4c0 5-3.8 8.6-9 9.8-5.2-1.2-9-4.8-9-9.8V5z" />
        </symbol>
        <symbol id="i-draw" viewBox="0 0 24 24">
          <rect x="4.4" y="2.6" width="15.2" height="18.8" rx="2.2" fill="currentColor" />
          <path d="M8 7.4h8M8 11.4h8M8 15.4h5" stroke="#0a0d13" strokeWidth="1.7" strokeLinecap="round" />
        </symbol>
        <symbol id="i-settings" viewBox="0 0 24 24">
          <path fill="currentColor" d="M10.3 1.8h3.4l.4 2.5 2 .9 2.1-1.4 2.4 2.4-1.4 2.1.9 2 2.5.4v3.4l-2.5.4-.9 2 1.4 2.1-2.4 2.4-2.1-1.4-2 .9-.4 2.5h-3.4l-.4-2.5-2-.9-2.1 1.4-2.4-2.4 1.4-2.1-.9-2-2.5-.4v-3.4l2.5-.4.9-2L3.4 6.2l2.4-2.4 2.1 1.4 2-.9z" />
          <circle cx="12" cy="12" r="3.6" fill="#0d1016" />
        </symbol>
        <symbol id="i-outpost" viewBox="0 0 24 24">
          <path fill="none" stroke="currentColor" strokeWidth="2.4"
            d="M12 2.4 20.6 7v10L12 21.6 3.4 17V7z" />
          <path fill="currentColor" d="M12 7.2 16.6 9.8v5.2L12 17.6 7.4 15V9.8z" />
        </symbol>

        {/* factions */}
        <symbol id="f-trade_federation" viewBox="0 0 24 24">
          <path fill="currentColor" d="M12 2 22 12l-4 0-6-6-6 6-4 0z M12 10l7 7-3.4 5H8.4L5 17z" />
        </symbol>
        <symbol id="f-blob" viewBox="0 0 24 24">
          <path fill="currentColor" d="M12 2c4 0 5 3.4 7.4 5.2C21.6 8.8 22 11 21 13.6c-1 2.6-2.2 3-4.4 5.2-2 2-5.4 2-7.8.4C6 17.4 2 15.6 2 11.6 2 7.6 5.4 2 12 2z" />
        </symbol>
        <symbol id="f-star_empire" viewBox="0 0 24 24">
          <path fill="currentColor" d="M12 1.2 14 9l7.8-2.6L16.4 12l5.4 5.6L14 15l-2 7.8L10 15l-7.8 2.6L7.6 12 2.2 6.4 10 9z" />
        </symbol>
        <symbol id="f-machine_cult" viewBox="0 0 24 24">
          <path fill="currentColor" d="M10.4 1.6h3.2l.5 2.6 2.3 1 2.3-1.4 2.2 2.2-1.4 2.3 1 2.3 2.6.5v3.2l-2.6.5-1 2.3 1.4 2.3-2.2 2.2-2.3-1.4-2.3 1-.5 2.6h-3.2l-.5-2.6-2.3-1-2.3 1.4-2.2-2.2 1.4-2.3-1-2.3L1.6 14v-3.2l2.6-.5 1-2.3-1.4-2.3 2.2-2.2 2.3 1.4 2.3-1z" />
          <circle cx="12" cy="12" r="3.4" fill="#0a0d13" />
        </symbol>
        <symbol id="f-unaligned" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="2.6" />
        </symbol>
      </defs>
    </svg>
  )
}

export type IconName = 'trade' | 'combat' | 'authority' | 'outpost' | 'draw' | 'settings'

export function Icon({ name, className }: { name: IconName; className?: string }): React.JSX.Element {
  // The `icon` class is not optional: an <svg> with no intrinsic size and no CSS
  // dimensions falls back to 300x150 and blows the layout apart.
  return (
    <svg className={className ? `icon ${className}` : 'icon'} aria-hidden="true" focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  )
}

export function FactionMark(
  { faction, className }: { faction: Faction; className?: string },
): React.JSX.Element {
  return (
    <svg className={className ? `icon ${className}` : 'icon'} aria-hidden="true" focusable="false">
      <use href={`#f-${faction}`} />
    </svg>
  )
}

export const FACTION_VAR: Record<Faction, string> = {
  trade_federation: 'var(--tf)',
  blob: 'var(--blob)',
  star_empire: 'var(--empire)',
  machine_cult: 'var(--cult)',
  unaligned: 'var(--unaligned)',
}
