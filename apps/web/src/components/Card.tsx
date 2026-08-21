'use client'

import { memo, useState } from 'react'
import { cardDef, type CardDefId, type Effect } from '@sr/engine'
import { ART_MANIFEST } from '@/cards/artManifest.gen'
import { cardRu, FACTION_RU } from '@/i18n/cards.ru'
import { CardText, speak } from './cardText'
import { FACTION_VAR, Icon, type IconName } from './Icons'

/**
 * Condense an effect tree into icon chips, for card sizes where prose is
 * physically unreadable.
 *
 * Only possible because effects are structured data. Note CHOOSE_ONE: the
 * printed "OR" means the branches are alternatives, so we show the best value
 * each icon can reach rather than their sum.
 */
function chipsFor(
  effects: readonly Effect[],
  acc: Map<IconName, number> = new Map(),
  mode: 'add' | 'max' = 'add',
): Map<IconName, number> {
  const put = (k: IconName, n: number): void => {
    const cur = acc.get(k) ?? 0
    acc.set(k, mode === 'max' ? Math.max(cur, n) : cur + n)
  }
  for (const e of effects) {
    switch (e.k) {
      case 'GAIN_TRADE': put('trade', e.n); break
      case 'GAIN_COMBAT': put('combat', e.n); break
      case 'GAIN_AUTHORITY': put('authority', e.n); break
      case 'DRAW': put('draw', e.n); break
      case 'SEQ': chipsFor(e.effects, acc, mode); break
      case 'IF': chipsFor(e.then, acc, mode); break
      case 'MAY': chipsFor(e.then, acc, mode); break
      case 'PER': chipsFor(e.then, acc, mode); break
      case 'CHOOSE_ONE':
        for (const b of e.branches) chipsFor(b.then, acc, 'max')
        break
      default: break
    }
  }
  return acc
}

export interface CardFrameProps {
  def: CardDefId
  /** Suppresses the ability text; used for face-down-ish contexts like the scrap heap. */
  quiet?: boolean | undefined
}

/**
 * The pure card. Knows only which card it is -- no game state -- so it is cheap
 * to re-render with 30+ on screen and reusable in the gallery and rules screens.
 */
export const CardFrame = memo(function CardFrame({ def, quiet }: CardFrameProps): React.JSX.Element {
  const c = cardDef(def)
  // Russian is the only locale shipped; the engine's English text is the fallback
  // so a card can never render nameless if a translation is missing.
  const ru = cardRu(def)
  const name = ru?.name ?? c.name
  const text = ru ?? c.text
  const [loaded, setLoaded] = useState(false)
  const entry = ART_MANIFEST[def]
  const art = entry ? `/cards/art/${def}-320.webp` : null
  const chips = [...chipsFor(c.primary).entries()].filter(([, n]) => n !== 0)

  return (
    <span className="card__body">
      <span className="card__top">
        {c.role !== 'starter' && <span className="card__cost">{c.cost}</span>}
        <span className="card__name">{name}</span>
        {c.defense !== null && (
          <span className={`card__defense ${c.type === 'outpost' ? 'is-outpost' : 'is-base'}`}>
            {c.defense}
          </span>
        )}
      </span>

      <span className="card__window">
        {art && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={`card__art${loaded ? ' is-loaded' : ''}`}
            src={art}
            alt=""
            loading="lazy"
            decoding="async"
            width={entry?.w}
            height={entry?.h}
            onLoad={() => setLoaded(true)}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        )}
      </span>

      {!quiet && (
        <span className="card__text">
          <span className="card__chips">
            {chips.map(([icon, n]) => (
              <span key={icon} className={`chip glyph--${icon}`}>
                <Icon name={icon} /> {n}
              </span>
            ))}
          </span>
          <span className="card__prose">
            {text.primary && <CardText src={text.primary} />}
            {text.ally && (
              <>
                <span className="card__rule" />
                <span className="card__slot-label">Союз</span>{' '}
                <CardText src={text.ally} />
              </>
            )}
            {text.scrap && (
              <>
                <span className="card__rule" />
                <span className="card__slot-label is-scrap">Утиль</span>{' '}
                <CardText src={text.scrap} />
              </>
            )}
          </span>
        </span>
      )}
    </span>
  )
})

export interface CardProps {
  def: CardDefId
  /** Absent means the card is inert: not clickable, and not focusable. */
  onClick?: (() => void) | undefined
  playable?: boolean | undefined
  selected?: boolean | undefined
  dimmed?: boolean | undefined
  /** Overrides the printed orientation, e.g. to show a base upright in hand. */
  asShip?: boolean | undefined
  title?: string | undefined
  quiet?: boolean | undefined
}

export function Card({
  def, onClick, playable, selected, dimmed, asShip, title, quiet,
}: CardProps): React.JSX.Element {
  const c = cardDef(def)
  const isBase = !asShip && c.type !== 'ship'
  const cls = [
    'card',
    isBase ? 'is-base' : '',
    playable ? 'is-playable' : '',
    selected ? 'is-selected' : '',
    dimmed ? 'is-dimmed' : '',
  ].filter(Boolean).join(' ')

  const ru = cardRu(def)
  const text = ru ?? c.text
  // One spoken form, reused for the accessible name and for tooltips.
  const label = [
    ru?.name ?? c.name,
    c.role === 'starter' ? '' : `стоимость ${c.cost}`,
    FACTION_RU[c.faction],
    c.type === 'outpost' ? `аванпост, оборона ${c.defense}`
      : c.type === 'base' ? `база, оборона ${c.defense}` : 'корабль',
    speak(text.primary),
    text.ally ? `Союзное свойство: ${speak(text.ally)}` : '',
    text.scrap ? `Утилизационное свойство: ${speak(text.scrap)}` : '',
  ].filter(Boolean).join('. ')

  const style = {
    '--fc': FACTION_VAR[c.faction],
    '--fc-line': `color-mix(in srgb, ${FACTION_VAR[c.faction]} 30%, var(--rule))`,
  } as React.CSSProperties

  return (
    <div className={`card-slot${isBase ? ' card-slot--base' : ''}`}>
      <button
        type="button"
        className={cls}
        style={style}
        onClick={onClick}
        disabled={!onClick}
        aria-label={label}
        title={title ?? (ru?.name ?? c.name)}
      >
        <CardFrame def={def} quiet={quiet} />
      </button>
    </div>
  )
}
