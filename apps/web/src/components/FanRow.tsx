'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Ряд, который начинает складывать карты веером, когда они перестают помещаться.
 *
 * Пока места хватает — обычный ряд: карта целиком, кнопки свойств под ней. Как
 * только сумма ширин перерастает полосу, карты уходят друг под друга ровно
 * настолько, чтобы влезть, — не больше. Наезд считается по факту, а не по числу
 * карт: база в полтора раза шире корабля, и «с шестой карты складываем» врало бы
 * на каждой второй раздаче.
 *
 * Наружу торчит левый край карты — там стоимость и название, то есть ровно то,
 * по чему карту узнают. Карта под курсором, в фокусе или выбранная нажатием
 * поднимается НАД соседями за счёт z-index, а не сдвигает их: смещение соседей
 * увело бы из-под курсора ту самую карту, к которой игрок тянется.
 */

/** Сколько карты видно в самом плотном веере. Меньше — и название не прочесть. */
const MIN_VISIBLE = 0.36

export function FanRow({
  className = '', children, style,
}: {
  className?: string
  children: React.ReactNode
  style?: React.CSSProperties | undefined
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<number | null>(null)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const kids = [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement)
    if (kids.length === 0) {
      el.style.setProperty('--fan', '0px')
      el.classList.remove('is-fanned', 'is-tight')
      return
    }

    // Ширину карты этот ряд не трогает: игрок задал её в настройках, и
    // подгонять карты под высоту полосы значило бы молча отменять его выбор —
    // на большинстве экранов зона игры ниже карты, и карты стали бы мелкими
    // всегда. Нехватку высоты разбирает третий шаг.
    const cs = getComputedStyle(el)

    // ── 2. веер по ширине ──────────────────────────────────────────────────
    const widths = kids.map((k) => Math.max(
      k.getBoundingClientRect().width,
      k.querySelector('.card-slot')?.getBoundingClientRect().width ?? 0,
    ))
    const gap = parseFloat(cs.columnGap || '0') || 0
    const total = widths.reduce((a, b) => a + b, 0) + gap * (kids.length - 1)
    const over = kids.length < 2 ? -1 : total - el.clientWidth
    if (over <= 0) {
      el.style.setProperty('--fan', '0px')
      el.classList.remove('is-fanned')
    } else {
      const narrowest = Math.min(...kids.map(
        (k) => k.querySelector('.card-slot')?.getBoundingClientRect().width ?? Infinity))
      const fan = Math.min(narrowest * (1 - MIN_VISIBLE), over / (kids.length - 1))
      el.style.setProperty('--fan', `${Math.ceil(fan)}px`)
      el.classList.add('is-fanned')
    }

    // ── 3. последняя мера ──────────────────────────────────────────────────
    //
    // Полоса бывает такой низкой, что не спасает и предельно ужатая карта:
    // тогда кнопки прижимаются к низу ВИДИМОЙ части карты и ложатся на
    // иллюстрацию. Кнопка на картинке хуже кнопки под картой, но несравнимо
    // лучше кнопки, до которой не дотянуться.
    const rowRect = el.getBoundingClientRect()
    const slotTop = kids[0]!.getBoundingClientRect().top
    const tallest = Math.max(...kids.map((k) => k.getBoundingClientRect().height))
    if (slotTop + tallest > rowRect.bottom + 1) {
      el.classList.add('is-tight')
      el.style.setProperty('--acts-top', `${Math.max(24, Math.round(rowRect.bottom - 42 - slotTop))}px`)
    } else {
      el.classList.remove('is-tight')
      el.style.removeProperty('--acts-top')
    }
  }, [])

  useLayoutEffect(measure)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  // Выбор нажатием — ради тач-экрана: там нет ни курсора, ни фокуса, и без
  // него до кнопок сложенной карты было бы не добраться.
  useEffect(() => {
    if (open === null) return
    const away = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  /**
   * Наведение раскрывает слот через состояние, а не через CSS :hover.
   *
   * Разница решает задачу: кнопки сложенной карты невидимы и не ловят курсор,
   * поэтому подойти к ним можно было только сверху, с самой карты. Курсор,
   * подходящий снизу или сбоку, попадал на СОСЕДНЮЮ карту — она лежит выше, —
   * и кнопка не появлялась вовсе. Открытый слот поднят над соседями целиком,
   * вместе с кнопками, и добраться до них можно с любой стороны.
   */
  const onOver = (e: React.MouseEvent): void => {
    const el = ref.current
    if (!el?.classList.contains('is-fanned')) return
    const kids = [...el.children]
    const at = kids.findIndex((k) => k.contains(e.target as Node))
    if (at >= 0) setOpen(at)
  }

  const onLeave = (): void => {
    // Клавиатурный фокус внутри ряда важнее мыши: уводить раскрытие из-под
    // человека, который дошёл до кнопки табом, нельзя.
    if (ref.current?.contains(document.activeElement)) return
    setOpen(null)
  }

  const onClick = (e: React.MouseEvent): void => {
    const el = ref.current
    if (!el?.classList.contains('is-fanned')) return
    const target = e.target as HTMLElement
    // Нажатие на саму кнопку свойства ничего не раскрывает и не складывает.
    if (target.closest('.actions')) return
    const kids = [...el.children]
    const at = kids.findIndex((k) => k.contains(target))
    // На тач-экране mouseover не приходит вовсе, поэтому нажатие остаётся
    // вторым способом раскрыть слот.
    if (at >= 0) setOpen(at)
  }

  // Класс ставится на живой узел, а не клонированием детей: сюда приходит
  // готовый список карт с условиями и вложенными массивами, и клонирование
  // разбирало бы чужую разметку ради одного класса.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const kids = [...el.children]
    kids.forEach((k, i) => k.classList.toggle('is-open', i === open))
  }, [open, children])

  return (
    <div
      ref={ref}
      className={`row row--fan ${className}`.trim()}
      {...(style ? { style } : {})}
      onClick={onClick}
      onMouseOver={onOver}
      onMouseLeave={onLeave}
    >
      {children}
    </div>
  )
}
