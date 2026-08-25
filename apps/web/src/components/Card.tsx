'use client'

import { Fragment, memo, useCallback, useRef, useState } from 'react'
import { cardDef, RELIC_DEFS, type CardDefId, type Effect } from '@sr/engine'
import { ART_MANIFEST } from '@/cards/artManifest.gen'

/** Размер иллюстраций артефактов. Тот же 4:3, что у остального арта. */
const RELIC_ART_W = 320
const RELIC_ART_H = 240
import { cardRu, FACTION_RU } from '@/i18n/cards.ru'
import { CardText, speak } from './cardText'
import { CardPreview } from './CardPreview'
import { FACTION_VAR, FactionMark, Icon, type IconName } from './Icons'
import { useHold } from './useHold'
import { useTilt } from './useTilt'

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
  /**
   * What this card costs the viewer right now, when the board changes it --
   * High Alert's "pay 1 less for each ... card you have in play". Absent means
   * the printed price stands.
   */
  cost?: number | undefined
}

/**
 * The pure card. Knows only which card it is -- no game state -- so it is cheap
 * to re-render with 30+ on screen and reusable in the gallery and rules screens.
 */
export const CardFrame = memo(function CardFrame({ def, quiet, cost }: CardFrameProps): React.JSX.Element {
  const c = cardDef(def)
  // Russian is the only locale shipped; the engine's English text is the fallback
  // so a card can never render nameless if a translation is missing.
  const ru = cardRu(def)
  const name = ru?.name ?? c.name
  const text = ru ?? c.text
  const [loaded, setLoaded] = useState(false)
  /**
   * A cached image finishes loading BEFORE React hydrates the markup, so its
   * `load` event has already fired by the time an onLoad handler is attached
   * and the fade-in never runs -- the art stays at opacity 0 and the card looks
   * artless. Reading `complete` off the element as it mounts is the only way to
   * catch that case, so this ref does it and onLoad covers the slow path.
   */
  const markLoaded = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) setLoaded(true)
  }, [])
  const entry = ART_MANIFEST[def]
  /**
   * Арт артефакта лежит в репозитории, а не в гитигнорной папке издателя.
   *
   * Артефактов в Star Realms нет — их иллюстрации нарисованы здесь
   * (scripts/relic-art.mjs), поэтому они единственные, кого можно и нужно
   * коммитить. Отсюда и второй источник: манифест описывает то, чего в
   * репозитории нет, а это — то, что в нём есть всегда.
   */
  const isRelic = RELIC_DEFS.has(def)
  const art = entry ? `/cards/art/${def}-320.webp`
    : isRelic ? `/cards/relics/${def}.svg`
      : null
  const chips = [...chipsFor(c.primary).entries()].filter(([, n]) => n !== 0)

  return (
    <>
      {/* Art first, and full bleed: everything else floats above it. */}
      <span className="card__window">
        {art && (
          <img
            className={`card__art${loaded ? ' is-loaded' : ''}`}
            ref={markLoaded}
            src={art}
            alt=""
            loading="lazy"
            decoding="async"
            width={entry?.w ?? RELIC_ART_W}
            height={entry?.h ?? RELIC_ART_H}
            onLoad={() => setLoaded(true)}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        )}
        {/* The veil is what makes text on full-bleed art safe. It is a sibling
          * of the image rather than a shadow on the text, so it also darkens the
          * procedural ground and both cases end up identical. */}
        {/* Under the veil, so it can never sit on top of the ability text. */}
        <FactionMark faction={c.faction} className="card__faction" />
        {/* United's dual-faction cards carry both marks: which factions a card
          * counts as is the whole reason to buy one, so it has to be readable
          * without opening the card. */}
        {c.faction2 && (
          <FactionMark faction={c.faction2} className="card__faction card__faction--2" />
        )}
        <span className="card__veil" />
      </span>

      <span className="card__body">
        <span className="card__top">
          {/* Цена — только у того, что действительно покупают. Стартовые карты,
            * гамбиты, миссии, командиры, командные колоды и события печатаются
            * без цены, и «0» в углу читается как «взять бесплатно» — то есть
            * как предложение, которого нет. */}
          {(c.role === 'trade_deck' || c.role === 'explorer') && c.type !== 'event' && (
            /* `cost` overrides the printed number where the board changes it --
             * High Alert discounts. Showing the printed price would offer a
             * card at 7 and then charge 5, or worse, look unaffordable. */
            <span className={`card__cost${cost !== undefined && cost !== c.cost ? ' is-discounted' : ''}`}>
              {cost ?? c.cost}
            </span>
          )}
          <span className="card__name">{name}</span>
          {c.defense !== null && (
            <span className={`card__defense ${c.type === 'outpost' ? 'is-outpost' : 'is-base'}`}>
              {c.defense}
            </span>
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
              {/* Up to four ally abilities, one per faction on Mercenary
                * Garrison. They are numbered rather than named because the
                * faction is already carried by the card's own marks. */}
              {([text.ally2, text.ally3, text.ally4] as const).map((t, i) => t && (
                <Fragment key={i}>
                  <span className="card__rule" />
                  <span className="card__slot-label">{`Союз ${i + 2}`}</span>{' '}
                  <CardText src={t} />
                </Fragment>
              ))}
              {text.splinter && (
                <>
                  <span className="card__rule" />
                  <span className="card__slot-label is-double">Сплинтер</span>{' '}
                  <CardText src={text.splinter} />
                </>
              )}
              {text.doubleAlly && (
                <>
                  <span className="card__rule" />
                  <span className="card__slot-label is-double">Двойной союз</span>{' '}
                  <CardText src={text.doubleAlly} />
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
    </>
  )
})

export interface CardProps {
  def: CardDefId
  /** Absent means the card is inert: not clickable, and not focusable. */
  onClick?: (() => void) | undefined
  playable?: boolean | undefined
  selected?: boolean | undefined
  dimmed?: boolean | undefined
  title?: string | undefined
  quiet?: boolean | undefined
  /** See CardFrameProps. */
  cost?: number | undefined
  /**
   * Экземпляр карты на столе.
   *
   * Нужен слою эффектов: взрыв базы и утиль привязываются к тому месту, где
   * карта стояла. Ставится там, где карта — предмет партии; в галерее и
   * предпросмотре карты экземпляра нет и атрибута тоже.
   */
  iid?: string | undefined
}

/**
 * One spoken form of a card, reused for the accessible name, for tooltips and
 * for the preview dialog's label. Derived from the same structured text the
 * card renders, so the two can never drift apart.
 */
/** Как тип карты называется вслух. Оборона озвучивается только там, где она есть. */
function TYPE_RU(c: ReturnType<typeof cardDef>): string {
  switch (c.type) {
    case 'outpost': return `аванпост, оборона ${c.defense}`
    case 'base': return `база, оборона ${c.defense}`
    case 'hero': return 'герой'
    case 'event': return 'событие'
    case 'ship': return 'корабль'
    case 'tech': return 'технология'
  }
}

export function cardLabel(def: CardDefId): string {
  const c = cardDef(def)
  const ru = cardRu(def)
  const text = ru ?? c.text
  return [
    ru?.name ?? c.name,
    c.role === 'starter' ? '' : `стоимость ${c.cost}`,
    c.faction2 ? `${FACTION_RU[c.faction]} и ${FACTION_RU[c.faction2]}` : FACTION_RU[c.faction],
    TYPE_RU(c),
    speak(text.primary),
    text.ally ? `Союзное свойство: ${speak(text.ally)}` : '',
    text.ally2 ? `Второе союзное свойство: ${speak(text.ally2)}` : '',
    text.ally3 ? `Третье союзное свойство: ${speak(text.ally3)}` : '',
    text.ally4 ? `Четвёртое союзное свойство: ${speak(text.ally4)}` : '',
    text.splinter ? `Свойство сплинтера: ${speak(text.splinter)}` : '',
    text.doubleAlly ? `Двойное союзное свойство: ${speak(text.doubleAlly)}` : '',
    text.scrap ? `Утилизационное свойство: ${speak(text.scrap)}` : '',
  ].filter(Boolean).join('. ')
}

/**
 * Лежит ли карта на боку.
 *
 * Ориентация всюду следует напечатанной: база в торговом ряду и в руке лежит
 * так же, как на столе. Список, а не «всё, что не корабль»: герои и события
 * печатаются стоя, и правило «не корабль — значит на боку» молча положило бы
 * их набок. Технологии High Alert, наоборот, печатаются поперёк — как базы.
 *
 * Одна функция на все места, где карта рисуется: пока их было две, увеличенная
 * карта и карта на столе показывали одну и ту же технологию по-разному.
 */
export function isLandscape(def: CardDefId): boolean {
  const t = cardDef(def).type
  return t === 'base' || t === 'outpost' || t === 'tech'
}

export function Card({
  def, onClick, playable, selected, dimmed, title, quiet, cost, iid,
}: CardProps): React.JSX.Element {
  const c = cardDef(def)
  const isBase = isLandscape(def)
  const cls = [
    'card',
    isBase ? 'is-base' : '',
    playable ? 'is-playable' : '',
    selected ? 'is-selected' : '',
    dimmed ? 'is-dimmed' : '',
  ].filter(Boolean).join(' ')

  const ru = cardRu(def)
  const label = cardLabel(def)
  const [preview, setPreview] = useState(false)
  const hold = useHold(useCallback(() => setPreview(true), []))
  // The slot listens and the card rotates: the slot keeps its layout box while
  // the card's own box grows with the rotation, and measuring against a rotating
  // box would feed the tilt back into itself.
  const cardRef = useRef<HTMLButtonElement>(null)
  const tilt = useTilt({ target: cardRef })

  // A dual-faction card is tinted from both ends, so the pair reads at a glance
  // in a row of five. The line colour stays on the primary, or the border would
  // stop being a reliable faction cue.
  const fc = FACTION_VAR[c.faction]
  const fc2 = c.faction2 ? FACTION_VAR[c.faction2] : fc
  const style = {
    '--fc': fc,
    '--fc2': fc2,
    '--fc-line': `color-mix(in srgb, ${fc} 30%, var(--rule))`,
  } as React.CSSProperties

  return (
    <div
      className={`card-slot${isBase ? ' card-slot--base' : ''}`}
      data-def={def}
      data-faction={c.faction}
      {...(iid ? { 'data-iid': iid } : {})}
      {...tilt.handlers}
    >
      <button
        ref={cardRef}
        type="button"
        className={`${cls}${hold.holding ? ' is-holding' : ''}${tilt.active ? ' is-tilting' : ''}`}
        style={style}
        onClick={onClick}
        // Never disabled: a card with no move still has something to show, and a
        // disabled button receives no pointer events at all, so holding it would
        // silently do nothing.
        aria-label={label}
        aria-haspopup="dialog"
        title={title ?? (ru?.name ?? c.name)}
        {...hold.handlers}
      >
        <CardFrame def={def} quiet={quiet} cost={cost} />
        {/* The fill is the whole affordance: without it a hold that has not
          * completed yet is indistinguishable from a click that did nothing. */}
        <span className="card__hold" aria-hidden="true" />
      </button>

      {preview && (
        <CardPreview def={def} label={label} onClose={() => setPreview(false)} />
      )}
    </div>
  )
}
