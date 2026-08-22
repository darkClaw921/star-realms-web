/**
 * Полёт ресурсов: «капель».
 *
 * Ресурс всегда проходит два отрезка — карта → счётчик, когда его получают, и
 * счётчик → цель, когда тратят: в купленную карту, в базу соперника или в его
 * авторитет. Летит он в своей собственной форме: тот же значок, что нарисован
 * в счётчике и на карте, а не абстрактная искра.
 *
 * Правило, ради которого всё это и делалось: СКОЛЬКО РЕСУРСА — СТОЛЬКО ШТУК.
 * Восемь боя — восемь значков; один — один. Иначе эффект превращается во
 * вспышку «что-то произошло», а игроку нужно видеть, сколько именно.
 *
 * Движение подчинено тяжести: значок разгоняется вниз, проскакивает цель,
 * отскакивает и втекает в неё. Считает его браузер (Web Animations), рисуют
 * обычные DOM-узлы поверх стола — канва занята частицами, а тут нужен
 * настоящий <svg><use>, чтобы форма один в один совпадала со счётчиком.
 */

import { calm } from './particles'

export type Res = 'trade' | 'combat' | 'authority'

const COLOR: Record<Res, string> = {
  trade: 'var(--trade)',
  combat: 'var(--combat)',
  authority: 'var(--authority)',
}

/** Больше — и очередь значков растягивается на секунды посреди хода. */
const MAX_SPAN = 620
const STEP = 66

let layer: HTMLDivElement | null = null

function stage(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null
  if (layer?.isConnected) return layer
  const el = document.createElement('div')
  el.className = 'fx-flight'
  document.body.appendChild(el)
  layer = el
  return el
}

/** Живой счётчик летящих значков — на нём держатся проверки. */
function mark(n: number): void {
  const el = layer
  if (!el) return
  const now = Math.max(0, Number(el.dataset.flying ?? 0) + n)
  el.dataset.flying = String(now)
}

export function clearFlight(): void {
  layer?.remove()
  layer = null
}

function centre(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/**
 * Пролить `n` значков ресурса из одной точки стола в другую.
 *
 * `from` и `to` — живые элементы; если какого-то нет (карту уже смахнули со
 * стола), можно передать готовую точку. Возвращает ничего: эффект никому не
 * отчитывается и не задерживает ход.
 */
export function rain(
  from: Element | { x: number; y: number } | null,
  to: Element | { x: number; y: number } | null,
  kind: Res,
  n: number,
): void {
  if (n <= 0 || calm()) return
  const box = stage()
  if (!box || !from || !to) return
  const a = from instanceof Element ? centre(from) : from
  const b = to instanceof Element ? centre(to) : to
  if (!Number.isFinite(a.x) || !Number.isFinite(b.x)) return

  const count = Math.min(n, 24)
  const step = Math.min(STEP, MAX_SPAN / Math.max(1, count))

  for (let i = 0; i < count; i++) {
    const drop = document.createElement('span')
    drop.className = 'fx-drop'
    drop.style.color = COLOR[kind]
    drop.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">`
      + `<use href="#i-${kind}"></use></svg>`
    box.appendChild(drop)
    mark(1)

    // Каждая капля берёт свой чуть иной старт: вылетевшие из одной точки
    // восемь значков читаются как один толстый значок.
    const jx = (i - (count - 1) / 2) * 7
    const dur = 460 + (i % 3) * 40
    const delay = i * step

    // По горизонтали — равномерно, по вертикали — с ускорением и отскоком у
    // самой цели: это и есть «капель», а не полёт по прямой.
    drop.animate(
      [{ transform: `translate(${a.x + jx}px, 0)` }, { transform: `translate(${b.x}px, 0)` }],
      { duration: dur, delay, easing: 'linear', fill: 'both' },
    )
    const inner = drop.firstElementChild as SVGElement
    inner.animate(
      [
        { transform: `translate(-50%, ${a.y}px) scale(.5)`, opacity: 0 },
        { transform: `translate(-50%, ${a.y + 6}px) scale(1)`, opacity: 1, offset: 0.14 },
        { transform: `translate(-50%, ${b.y + 12}px) scale(1)`, opacity: 1, offset: 0.78 },
        { transform: `translate(-50%, ${b.y - 7}px) scale(.92)`, opacity: 1, offset: 0.9 },
        { transform: `translate(-50%, ${b.y}px) scale(.55)`, opacity: 0 },
      ],
      { duration: dur, delay, easing: 'cubic-bezier(.5,0,.85,.4)', fill: 'both' },
    ).finished.then(() => {
      drop.remove()
      mark(-1)
      // Счётчик отзывается на КАЖДУЮ прилетевшую каплю: так восемь боя видно
      // и по числу значков, и по восьми щелчкам цели.
      if (to instanceof Element) tick(to)
    }).catch(() => {
      drop.remove()
      mark(-1)
    })
  }
}

/** Короткий щелчок цели: она приняла одну единицу. */
function tick(el: Element): void {
  if (!(el instanceof HTMLElement)) return
  el.classList.remove('is-tick')
  void el.offsetWidth
  el.classList.add('is-tick')
  window.setTimeout(() => el.classList.remove('is-tick'), 220)
}
