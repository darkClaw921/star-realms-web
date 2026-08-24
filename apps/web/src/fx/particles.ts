/**
 * Слой вспышек.
 *
 * Один канвас на весь экран и один цикл rAF на все эффекты: искры от взрыва
 * базы, осколки от удара и залп победы живут в общем списке частиц. Отдельный
 * канвас на зону означал бы обрезку по её границам — а осколки базы обязаны
 * улетать за край своей полосы.
 *
 * Цикл сам останавливается, когда живых частиц не осталось, поэтому в покое
 * страница не тратит ни кадра.
 */

import { pace, tempo } from './tempo'

interface Particle {
  x: number; y: number; vx: number; vy: number; g: number
  life: number; age: number; size: number; grow: number
  color: string; shape: 'dot' | 'shard' | 'spark' | 'ring'
  rot: number; spin: number; shrink: boolean
}

export interface BurstOpts {
  readonly x: number
  readonly y: number
  readonly n?: number
  readonly color: string | readonly string[]
  /** Направление в радианах. Не задано — во все стороны. */
  readonly dir?: number
  readonly spread?: number
  readonly speed?: number
  readonly g?: number
  readonly life?: number
  readonly size?: number
  readonly jitter?: number
  readonly shape?: Particle['shape']
  readonly spin?: number
  readonly shrink?: boolean
}

/**
 * «Поменьше движения» — не стилевая просьба, а медицинская: летящие осколки и
 * тряска ровно то, от чего эта настройка защищает. Проверяется в момент
 * запуска, а не при загрузке модуля: пользователь может включить её на ходу.
 */
export function calm(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let parts: Particle[] = []
let raf = 0
let last = 0

function layer(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.className = 'fx-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    document.body.appendChild(canvas)
    ctx = canvas.getContext('2d')
    window.addEventListener('resize', size, { passive: true })
  }
  size()
  return ctx
}

function size(): void {
  if (!canvas || !ctx) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = window.innerWidth
  const h = window.innerHeight
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function tick(t: number): void {
  const c = ctx
  if (!c || !canvas) { raf = 0; return }
  // Время частиц идёт в темпе стола: ускорять их укорочением жизни нельзя —
  // осколок просто гас бы на середине полёта, вместо того чтобы долететь.
  const dt = Math.min(0.05, (t - last) / 1000 || 0.016) * tempo()
  last = t
  c.clearRect(0, 0, window.innerWidth, window.innerHeight)
  parts = parts.filter((p) => (p.age += dt) < p.life)
  for (const p of parts) {
    const k = p.age / p.life
    const fade = 1 - k
    p.vy += p.g * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.rot += p.spin * dt
    c.save()
    c.globalAlpha = Math.max(0, fade)
    c.translate(p.x, p.y)
    c.rotate(p.rot)
    if (p.shape === 'ring') {
      c.strokeStyle = p.color
      c.lineWidth = Math.max(1, 3 * fade)
      c.beginPath()
      // Радиус не бывает отрицательным: canvas на такое бросает исключение и
      // рвёт весь кадр, а с ним и все остальные частицы.
      c.arc(0, 0, Math.max(0, p.size + k * p.grow), 0, Math.PI * 2)
      c.stroke()
    } else if (p.shape === 'shard') {
      c.fillStyle = p.color
      c.beginPath()
      c.moveTo(0, -p.size)
      c.lineTo(p.size * 0.7, p.size)
      c.lineTo(-p.size * 0.8, p.size * 0.6)
      c.closePath()
      c.fill()
    } else if (p.shape === 'spark') {
      c.strokeStyle = p.color
      c.lineWidth = Math.max(1, p.size * 0.5)
      c.lineCap = 'round'
      c.beginPath()
      c.moveTo(0, 0)
      c.lineTo(-p.vx * 0.022, -p.vy * 0.022)
      c.stroke()
    } else {
      c.fillStyle = p.color
      c.beginPath()
      c.arc(0, 0, Math.max(0, p.size * (p.shrink ? fade : 1)), 0, Math.PI * 2)
      c.fill()
    }
    c.restore()
  }
  // Проверке хватает атрибута: она не умеет смотреть на пиксели канваса, а
  // «эффект вообще запустился» — ровно то, что нужно подтвердить.
  canvas.dataset.live = String(parts.length)
  raf = parts.length > 0 ? requestAnimationFrame(tick) : 0
}

function start(): void {
  if (!raf) {
    last = performance.now()
    raf = requestAnimationFrame(tick)
  }
}

export function burst(o: BurstOpts): void {
  if (calm() || !layer()) return
  const n = o.n ?? 20
  for (let i = 0; i < n; i++) {
    const ang = o.dir !== undefined
      ? o.dir + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2)
      : Math.random() * Math.PI * 2
    const sp = (o.speed ?? 120) * (0.45 + Math.random() * 0.9)
    const col = typeof o.color === 'string' ? o.color : o.color[i % o.color.length]!
    parts.push({
      x: o.x + (Math.random() - 0.5) * (o.jitter ?? 10),
      y: o.y + (Math.random() - 0.5) * (o.jitter ?? 10),
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      g: o.g ?? 0,
      life: (o.life ?? 0.7) * (0.6 + Math.random() * 0.7),
      age: 0,
      size: (o.size ?? 2.4) * (0.6 + Math.random() * 0.8),
      color: col,
      shape: o.shape ?? 'dot',
      shrink: o.shrink ?? true,
      rot: Math.random() * 6.28,
      spin: (Math.random() - 0.5) * (o.spin ?? 6),
      grow: 60,
    })
  }
  start()
}

/** Кольцо ударной волны: одна частица, но заметнее двадцати точек. */
export function ring(
  x: number, y: number, color: string,
  o: { size?: number; grow?: number; life?: number } = {},
): void {
  if (calm() || !layer()) return
  parts.push({
    x, y, vx: 0, vy: 0, g: 0,
    life: o.life ?? 0.5, age: 0,
    size: o.size ?? 8, grow: o.grow ?? 90,
    color, shape: 'ring', rot: 0, spin: 0, shrink: false,
  })
  start()
}

/** Каждому запуску — свой номер, чтобы уборка не трогала чужую анимацию. */
let runs = 0

/**
 * Перезапуск CSS-анимации.
 *
 * Две тонкости, и обе стоили по багу. Первая: без рефлоу второе срабатывание
 * подряд молчит — браузер не видит смены значения. Вторая: инлайновый стиль
 * надо снять, иначе элемент навсегда останется в конечном кадре (карта —
 * прозрачной), но снимать его может ТОЛЬКО тот запуск, который его поставил.
 * Уборка за предыдущей анимацией гасила следующую, и эффект пропадал ровно
 * тогда, когда два события приходили по одной карте подряд.
 */
export function anim(el: Element | null | undefined, keyframes: string, dur: number,
  ease = 'cubic-bezier(.2,.7,.3,1)'): void {
  if (calm() || !(el instanceof HTMLElement)) return
  const token = String(++runs)
  const run = pace(dur)
  el.dataset.fxRun = token
  el.style.animation = 'none'
  void el.offsetWidth
  el.style.animation = `${keyframes} ${run}s ${ease} both`
  window.setTimeout(() => {
    if (el.dataset.fxRun !== token) return
    el.style.animation = ''
    delete el.dataset.fxRun
  }, run * 1000 + 60)
}

/** Всплывающее число: «−8» над HUD, «+12» над счётчиком боя. */
export function popText(x: number, y: number, text: string, color: string,
  kind: 'fx-pop-up' | 'fx-pop-punch' = 'fx-pop-up'): void {
  if (calm() || typeof document === 'undefined') return
  const el = document.createElement('span')
  el.className = 'fx-pop'
  el.textContent = text
  el.style.color = color
  // HUD соперника стоит у самой кромки экрана, а число ещё и всплывает вверх:
  // без зажима «−21» показывается наполовину срезанным как раз в тот момент,
  // ради которого эффект и сделан.
  el.style.left = `${Math.min(window.innerWidth - 40, Math.max(40, x))}px`
  el.style.top = `${Math.min(window.innerHeight - 30, Math.max(58, y))}px`
  el.setAttribute('aria-hidden', 'true')
  document.body.appendChild(el)
  anim(el, kind, 0.9, 'ease-out')
  window.setTimeout(() => el.remove(), pace(0.9) * 1000 + 100)
}

/** Вспышка по всему экрану: край темнеет красным на входящем уроне. */
export function screenFlash(background: string, dur = 0.45): void {
  if (calm() || typeof document === 'undefined') return
  const el = document.createElement('div')
  el.className = 'fx-flash'
  el.style.background = background
  el.setAttribute('aria-hidden', 'true')
  document.body.appendChild(el)
  anim(el, 'fx-flash-out', dur, 'ease-out')
  window.setTimeout(() => el.remove(), pace(dur) * 1000 + 80)
}

/** Полный сброс — уход со стола не должен оставлять на экране чужие искры. */
export function clearFx(): void {
  parts = []
  if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
  document.querySelectorAll('.fx-pop, .fx-flash').forEach((e) => e.remove())
}
