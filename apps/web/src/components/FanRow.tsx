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
/**
 * Сколько базы видно в самой плотной стопке — в пикселях, а не в долях карты.
 * Наружу торчит верхняя кромка, где напечатаны имя, стоимость и защита: её
 * высота от размера карты почти не зависит: имя, стоимость и защита кончаются
 * на 38-м пикселе при любой ширине карты, потому что кромка набрана в cqi от
 * ШИРИНЫ базы, а базы — единственные карты в альбомной ориентации.
 */
const MIN_VISIBLE_Y_PX = 34

export function FanRow({
  className = '', children, style, axis = 'x',
}: {
  className?: string
  children: React.ReactNode
  style?: React.CSSProperties | undefined
  /**
   * Куда складывать. 'x' — ряд кораблей: карты уходят друг под друга влево.
   * 'y' — стопка баз: базы ложатся одна на другую сверху вниз, как на столе.
   */
  axis?: 'x' | 'y'
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

    // ── 2. веер по ширине (или стопка по высоте) ───────────────────────────
    //
    // Мерится всегда фактический размер карты, а не число карт: база в полтора
    // раза шире корабля, и правило «с шестой карты складываем» врало бы на
    // каждой второй раздаче.
    const side = (k: HTMLElement): number => {
      const slot = k.querySelector('.card-slot')?.getBoundingClientRect()
      const own = k.getBoundingClientRect()
      return axis === 'y'
        ? Math.max(own.height, slot?.height ?? 0)
        : Math.max(own.width, slot?.width ?? 0)
    }
    const sizes = kids.map(side)
    const gap = parseFloat((axis === 'y' ? cs.rowGap : cs.columnGap) || '0') || 0
    const total = sizes.reduce((a, b) => a + b, 0) + gap * (kids.length - 1)
    // clientHeight включает отступы, а карты стоят внутри них: без вычета ряд
    // считает, что места на 30 пикселей запаса больше, чем есть, и нижняя
    // карта выходит за полосу.
    const pad = axis === 'y'
      ? (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
      : (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
    // Кнопки нижней базы висят ПОД ней и в высоту стопки не входят — значит
    // место под них надо занять заранее, иначе карты укладываются впритык, а
    // кнопки последней оказываются за полосой.
    const acts = axis === 'y' ? el.querySelector('.actions') : null
    const reserve = acts ? acts.getBoundingClientRect().height + 10 : 0
    const room = (axis === 'y' ? el.clientHeight : el.clientWidth) - pad - reserve
    const over = kids.length < 2 ? -1 : total - room
    if (over <= 0) {
      el.style.setProperty('--fan', '0px')
      el.classList.remove('is-fanned')
    } else {
      const smallest = Math.min(...kids.map((k) => {
        const slot = k.querySelector('.card-slot')?.getBoundingClientRect()
        if (!slot) return Infinity
        return axis === 'y' ? slot.height : slot.width
      }))
      // Видно карты столько, сколько её торчит из-под следующей: размер минус
      // наезд плюс промежуток ряда. Промежуток в этом счёте забывать нельзя —
      // из-за него стопка не сходилась к пределу и переполняла полосу.
      const limit = axis === 'y'
        ? Math.max(0, smallest + gap - MIN_VISIBLE_Y_PX)
        : smallest * (1 - MIN_VISIBLE)
      const fan = Math.min(limit, over / (kids.length - 1))
      el.style.setProperty('--fan', `${Math.ceil(fan)}px`)
      el.classList.add('is-fanned')
      // Баз столько, что даже вплотную они не влезают: остаток честнее отдать
      // прокрутке, чем срезать кромки до нечитаемых полосок.
      // Порог, а не ноль: прокрутка отбирает у колонки ширину под ползунок, а
      // ползунок меняет замер — на нуле состояние начинало мигать между
      // «влезло» и «не влезло». Включается, только когда не хватает заметно.
      if (axis === 'y') el.classList.toggle('is-scroll', over - fan * (kids.length - 1) > 24)
    }
    if (axis === 'y' && !el.classList.contains('is-fanned')) el.classList.remove('is-scroll')

    // Стопка мерится по высоте — та самая теснота, которую разбирает шаг 3,
    // здесь уже учтена, и прижимать кнопки к иллюстрации незачем.
    if (axis === 'y') {
      el.classList.remove('is-tight')
      el.style.removeProperty('--acts-top')
      return
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
  }, [axis])

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
      className={`row row--fan${axis === 'y' ? ' row--stack' : ''} ${className}`.trim()}
      {...(style ? { style } : {})}
      onClick={onClick}
      onMouseOver={onOver}
      onMouseLeave={onLeave}
    >
      {children}
    </div>
  )
}
