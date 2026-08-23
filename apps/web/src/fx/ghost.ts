/**
 * Призрак ушедшей карты.
 *
 * Утиль — единственный эффект, который обязан показать карту в тот момент,
 * когда её на столе уже нет: событие приходит вместе со снимком, где карта из
 * зоны вычеркнута, и React успевает снять узел раньше, чем эффект до него
 * доберётся. Вешать анимацию было не на что — оставались только искры, и утиль
 * читался как мгновенное исчезновение.
 *
 * Поэтому карта растворяется не на месте, а копией: слепок прошлого кадра
 * кладётся поверх стола ровно туда, где карта стояла, и уже он доигрывает
 * анимацию. Слепок неинтерактивен и не помечен `data-iid` — иначе следующий же
 * эффект принял бы призрака за живую карту.
 */

import { calm } from './particles'

export type Box = { x: number; y: number; w: number; h: number }

let layer: HTMLDivElement | null = null

function stage(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null
  if (layer?.isConnected) return layer
  const el = document.createElement('div')
  el.className = 'fx-ghosts'
  el.setAttribute('aria-hidden', 'true')
  document.body.appendChild(el)
  layer = el
  return el
}

export function clearGhosts(): void {
  layer?.remove()
  layer = null
}

/** Снять с копии всё, что заставило бы её продолжать жизнь оригинала. */
function strip(el: HTMLElement): void {
  el.style.animation = 'none'
  el.style.transition = 'none'
  delete el.dataset.fxRun
}

/**
 * Снять слепок карты со стола.
 *
 * Копия отвязывается от разметки стола: у неё нет ни `data-iid`, ни `data-def`,
 * по которым эффекты ищут живые карты, и ни один её потомок не ловит фокус.
 */
export function traceCard(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement
  copy.removeAttribute('data-iid')
  copy.removeAttribute('data-def')
  // Эффекты стола пишут анимацию прямо в стиль карты, и слепок снимается уже
  // с ней. Такая копия, попав в слой, начинала бы чужую анимацию заново —
  // утиль карты, сыгранной ход назад, выглядел бы её въездом на стол.
  strip(copy)
  copy.querySelectorAll<HTMLElement>('*').forEach(strip)
  for (const inner of copy.querySelectorAll('[data-iid], [data-def]')) {
    inner.removeAttribute('data-iid')
    inner.removeAttribute('data-def')
  }
  for (const focusable of copy.querySelectorAll('button, a, [tabindex]')) {
    focusable.setAttribute('tabindex', '-1')
  }
  // Иллюстрация проявляется по событию загрузки, а у копии слушателя нет: не
  // отметив уже загруженную картинку, призрак растворялся бы пустой рамкой.
  const live = el.querySelectorAll<HTMLImageElement>('img')
  copy.querySelectorAll<HTMLImageElement>('img').forEach((img, i) => {
    if (live[i]?.complete) img.classList.add('is-loaded')
  })
  return copy
}

/**
 * Доиграть анимацию за карту, которой на столе уже нет.
 *
 * `trace` — слепок из `traceCard`, `box` — место, где карта стояла в прошлом
 * кадре. Ширина ставится переменной, а не свойством: внутренности карты меряны
 * в cqi от слота, и слот обязан остаться контейнером своего размера.
 */
export function ghost(
  trace: HTMLElement, box: Box, keyframes: string, dur: number, ease = 'ease-in',
): void {
  if (calm()) return
  const st = stage()
  if (!st) return
  const cell = document.createElement('div')
  cell.className = 'fx-ghost'
  cell.style.left = `${box.x - box.w / 2}px`
  cell.style.top = `${box.y - box.h / 2}px`
  cell.style.setProperty('--card-w', `${box.w}px`)
  cell.style.animation = `${keyframes} ${dur}s ${ease} both`
  cell.appendChild(trace)
  st.appendChild(cell)
  window.setTimeout(() => cell.remove(), dur * 1000 + 60)
}
