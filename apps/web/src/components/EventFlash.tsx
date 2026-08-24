'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cardDef, type CardDefId } from '@sr/engine'
import { SFX } from '@/fx/audio'
import { UI } from '@/i18n/ui'
import { CardFrame } from './Card'
import { FACTION_VAR } from './Icons'
import type { MatchSnapshot } from '@/match/types'

/**
 * Карта события, вскрытая в торговом ряду.
 *
 * Событие — единственная карта, которую никто не разыгрывает: она вскрывается
 * сама, немедленно применяется к обоим игрокам и уходит в утиль. На столе после
 * неё не остаётся ничего — слот занимает следующая карта, — и без этого показа
 * единственным следом была строка в журнале, который по умолчанию закрыт. На
 * ходу бота это выглядело так, будто авторитет убыл сам собой.
 *
 * Закрывается нажатием, а не по таймеру. Секунды здесь не годятся ни при каком
 * значении: текст у событий длинный («каждый игрок сбрасывает столько-то, а
 * затем...»), читают их с разной скоростью, а карта, которую не успели
 * дочитать, ничем не лучше отсутствующей. Пока игрок не закрыл — партия ждёт;
 * ждать ей всё равно нечего, ход уже сделан.
 *
 * События приходят пачкой (Червоточина умеет вскрыть следующее), поэтому они
 * становятся в очередь: закрыли одно — тут же показывается следующее.
 */
export function EventFlash({ snapshot }: { snapshot: MatchSnapshot }): React.JSX.Element | null {
  const [queue, setQueue] = useState<readonly CardDefId[]>([])
  const seen = useRef(-1)
  const [mounted, setMounted] = useState(false)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { setMounted(true) }, [])

  // Одна пачка — один разбор: снимок перерисовывается и от наведения курсора,
  // а показывать событие второй раз незачем.
  useEffect(() => {
    if (snapshot.tick === seen.current) return
    const first = seen.current === -1
    seen.current = snapshot.tick
    if (first) return
    const fresh = snapshot.events.filter((e) => e.e === 'EVENT').map((e) => e.def)
    if (fresh.length > 0) setQueue((q) => [...q, ...fresh])
  }, [snapshot])

  const current = queue[0] ?? null
  const close = useCallback(() => { setQueue((q) => q.slice(1)) }, [])

  // Звук — на каждую карту очереди, а не на пачку: вторую вскрытую увидеть так
  // же важно, как первую.
  useEffect(() => {
    if (!current) return
    SFX.event()
  }, [current])

  // Клавиатура: и Esc, и Enter закрывают — кнопка получает фокус, поэтому
  // пробел работает сам собой.
  useEffect(() => {
    if (!current) return undefined
    okRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); close() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, close])

  if (!mounted || !current) return null

  const c = cardDef(current)
  const more = queue.length - 1

  return createPortal(
    <div
      className="eventflash"
      role="dialog"
      aria-modal="true"
      aria-label={UI.eventRevealed}
      onClick={close}
    >
      <div className="eventflash__inner" onClick={(e) => e.stopPropagation()} role="presentation">
        <span className="eventflash__label">{UI.eventRevealed}</span>
        {/* Обёртка несёт container-type, карта — нет: элемент нельзя оформить
          * запросом к самому себе, а вся вёрстка внутри карты меряна в cqi. */}
        <div className="eventflash__slot">
          <div
            className="card eventflash__card"
            style={{
              '--fc': FACTION_VAR[c.faction],
              '--fc-line': `color-mix(in srgb, ${FACTION_VAR[c.faction]} 30%, var(--rule))`,
            } as React.CSSProperties}
          >
            <CardFrame def={current} />
          </div>
        </div>
        <div className="eventflash__foot">
          <button ref={okRef} type="button" className="btn btn--primary" onClick={close}>
            {UI.eventClose}
          </button>
          {/* Сколько ещё ждёт своей очереди: без этого второе событие подряд
            * выглядит как не закрывшееся первое. */}
          {more > 0 && <span className="eventflash__more">{UI.eventMore(more)}</span>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
