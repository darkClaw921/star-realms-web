'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { calm } from '@/fx/particles'

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

/**
 * Прибой: новая база въезжает снизу, а стопка отступает вверх.
 *
 * Карта, которую только что поставили, лежит ПОВЕРХ старых и снизу — там же,
 * куда её кладут на столе. Заметить это движение важнее, чем кажется: базы
 * ставят посреди хода, взгляд в этот момент в торговом ряду, и без короткого
 * толчка новая карта появляется словно всегда там и была.
 *
 * Признак «новая» — отсутствие метки на узле: React переиспользует узлы между
 * перерисовками, поэтому по индексу или числу детей отличить добавление от
 * перестановки нельзя.
 */
function surf(el: HTMLElement, kids: readonly HTMLElement[]): void {
  const fresh: HTMLElement[] = []
  for (const k of kids) {
    if (k.dataset.stacked === '1') continue
    k.dataset.stacked = '1'
    fresh.push(k)
  }
  // Первая же раскладка помечает всё, что уже стояло: анимировать раздачу
  // нечего, карты просто были на столе.
  const known = kids.length - fresh.length
  // Прокрутка всегда к свежей карте: она нижняя, и в переполненной колонке
  // именно она уезжает за край. Кадром позже — на этой строке раскладка ещё
  // считается по старому числу карт, и доехать «до конца» значит доехать до
  // конца, которого уже нет.
  if (fresh.length > 0) {
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: calm() ? 'auto' : 'smooth' })
    })
  }
  if (known === 0 || fresh.length === 0 || calm()) return

  for (const k of fresh) {
    k.animate(
      [
        { transform: 'translateY(46px)', opacity: 0 },
        { transform: 'translateY(-7px)', opacity: 1, offset: 0.72 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 420, easing: 'cubic-bezier(.22,1.2,.36,1)' },
    )
  }
  // Старые карты отступают вверх — коротко и тем сильнее, чем ближе к новой.
  const old = kids.filter((k) => !fresh.includes(k))
  old.forEach((k, i) => {
    k.animate(
      [{ transform: `translateY(${Math.min(14, 3 + i)}px)` }, { transform: 'none' }],
      { duration: 360, easing: 'cubic-bezier(.22,.9,.3,1)' },
    )
  })
}

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
  /** К какой карте колонка уже подавалась: без этого прокрутка зациклится. */
  const rolledTo = useRef<number | null>(null)

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
    // Место под кнопки нижней базы уже вычтено вместе с отступами: колонка
    // держит его нижним полем, а не считает отдельно.
    const room = (axis === 'y' ? el.clientHeight : el.clientWidth) - pad
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
      surf(el, kids)
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

    // Поднятая база должна быть видна целиком — вместе с кнопками.
    //
    // В прокрученной колонке карта, к которой потянулись, часто наполовину за
    // краем: показывать её обрезанной и предлагать нажать обрезанную кнопку
    // нельзя. Колонка подаётся ровно настолько, чтобы карта поместилась, и
    // только когда открыли другую карту — иначе прокрутка, меняющая наведение,
    // гоняла бы стопку сама с собой.
    if (axis !== 'y' || open === null || !el.classList.contains('is-scroll')) {
      rolledTo.current = null
      return
    }
    if (rolledTo.current === open) return
    rolledTo.current = open
    const k = kids[open]
    if (!(k instanceof HTMLElement)) return
    const box = el.getBoundingClientRect()
    const top = k.getBoundingClientRect().top
    const foot = (k.querySelector('.actions') ?? k).getBoundingClientRect().bottom
    const dy = foot > box.bottom ? foot - box.bottom : (top < box.top ? top - box.top : 0)
    if (Math.abs(dy) > 2) el.scrollBy({ top: dy, behavior: calm() ? 'auto' : 'smooth' })
  }, [open, children, axis])

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
