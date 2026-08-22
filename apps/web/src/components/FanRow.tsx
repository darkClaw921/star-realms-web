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
    if (kids.length < 2) {
      el.style.setProperty('--fan', '0px')
      el.classList.remove('is-fanned')
      return
    }
    // Считаем по собственной ширине карты, а не по ширине обёртки: обёртку
    // уже мог сжать флексбокс, и тогда измерение подтвердило бы само себя.
    const widths = kids.map((k) => k.querySelector('.card-slot')?.getBoundingClientRect().width
      ?? k.getBoundingClientRect().width)
    const gap = parseFloat(getComputedStyle(el).columnGap || '0') || 0
    const total = widths.reduce((a, b) => a + b, 0) + gap * (kids.length - 1)
    const avail = el.clientWidth
    const over = total - avail
    if (over <= 0) {
      el.style.setProperty('--fan', '0px')
      el.classList.remove('is-fanned')
      return
    }
    const narrowest = Math.min(...widths)
    const cap = narrowest * (1 - MIN_VISIBLE)
    const fan = Math.min(cap, over / (kids.length - 1))
    el.style.setProperty('--fan', `${Math.ceil(fan)}px`)
    el.classList.add('is-fanned')
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

  const onClick = (e: React.MouseEvent): void => {
    const el = ref.current
    if (!el?.classList.contains('is-fanned')) return
    const target = e.target as HTMLElement
    // Нажатие на саму кнопку свойства ничего не раскрывает и не складывает.
    if (target.closest('.actions')) return
    const kids = [...el.children]
    const at = kids.findIndex((k) => k.contains(target))
    if (at >= 0) setOpen((cur) => (cur === at ? null : at))
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
    >
      {children}
    </div>
  )
}
