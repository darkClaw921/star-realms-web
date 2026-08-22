/**
 * Звук стола.
 *
 * Ни одного файла: всё синтезируется на месте из осцилляторов и одного буфера
 * белого шума. Причина не в экономии — сэмплы к восьмидесяти картам весили бы
 * больше самой игры, а главное, звук здесь настраивается числом в этом файле,
 * а не переэкспортом из чужого редактора.
 *
 * Варианты выбраны игроком в лаборатории эффектов: «Мостик» почти везде,
 * «Верфь» на добор, авторитет, конец хода и взрыв базы, «Аркада» на утиль.
 * Комментарий у каждого звука называет вариант, чтобы правка не сбила подбор.
 */

let AC: AudioContext | null = null
let MASTER: GainNode | null = null
let NOISE: AudioBuffer | null = null
let VOLUME = 0.5

interface ToneOpts {
  readonly type?: OscillatorType
  readonly f: number
  readonly f2?: number
  readonly dur?: number
  readonly at?: number
  readonly gain?: number
  readonly a?: number
  readonly lp?: number
  readonly hp?: number
  readonly bp?: number
  readonly q?: number
  /** Линейная развёртка вместо экспоненциальной: нужна там, где f2 близко к нулю. */
  readonly lin?: boolean
}

interface HissOpts {
  readonly dur?: number
  readonly at?: number
  readonly gain?: number
  readonly type?: BiquadFilterType
  readonly f?: number
  readonly f2?: number
  readonly q?: number
  readonly a?: number
  readonly rate?: number
}

/**
 * Контекст создаётся лениво и только по жесту пользователя: браузер всё равно
 * держит его в suspended до первого клика, а созданный впустую контекст на
 * мобильных занимает аудиосессию и глушит чужую музыку.
 */
function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!AC) {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    AC = new Ctor()
    MASTER = AC.createGain()
    MASTER.gain.value = VOLUME
    // За ход срабатывает до десятка звуков подряд; без компрессии наложение
    // двух взрывов уходит в клиппинг.
    const comp = AC.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    comp.release.value = 0.25
    MASTER.connect(comp)
    comp.connect(AC.destination)
    const n = AC.sampleRate * 2
    NOISE = AC.createBuffer(1, n, AC.sampleRate)
    const d = NOISE.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  }
  if (AC.state === 'suspended') void AC.resume()
  return AC
}

/** Громкость 0..1. Ноль выключает звук целиком, контекст при этом не создаётся. */
export function setVolume(v: number): void {
  VOLUME = Math.min(1, Math.max(0, v))
  if (MASTER) MASTER.gain.value = VOLUME
}

export function volume(): number { return VOLUME }

/** Разбудить контекст на пользовательском жесте. Без жеста браузер молчит. */
export function armAudio(): void {
  if (VOLUME > 0) ac()
}

function tone(o: ToneOpts): void {
  const c = ac()
  if (!c || !MASTER || VOLUME === 0) return
  const t = c.currentTime + (o.at ?? 0)
  const dur = o.dur ?? 0.2
  const g = c.createGain()
  let out: AudioNode = g
  const cut = o.lp ?? o.hp ?? o.bp
  if (cut !== undefined) {
    const f = c.createBiquadFilter()
    f.type = o.bp !== undefined ? 'bandpass' : o.hp !== undefined ? 'highpass' : 'lowpass'
    f.frequency.value = cut
    f.Q.value = o.q ?? 1
    g.connect(f)
    out = f
  }
  out.connect(MASTER)
  const s = c.createOscillator()
  s.type = o.type ?? 'sine'
  s.frequency.setValueAtTime(o.f, t)
  if (o.f2 !== undefined) {
    const to = Math.max(1, o.f2)
    if (o.lin) s.frequency.linearRampToValueAtTime(to, t + dur)
    else s.frequency.exponentialRampToValueAtTime(to, t + dur)
  }
  const pk = o.gain ?? 0.25
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(pk, t + (o.a ?? 0.006))
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  s.connect(g)
  s.start(t)
  s.stop(t + dur + 0.03)
}

function hiss(o: HissOpts): void {
  const c = ac()
  if (!c || !MASTER || !NOISE || VOLUME === 0) return
  const t = c.currentTime + (o.at ?? 0)
  const dur = o.dur ?? 0.2
  const s = c.createBufferSource()
  s.buffer = NOISE
  s.loop = true
  s.playbackRate.value = o.rate ?? 1
  const f = c.createBiquadFilter()
  f.type = o.type ?? 'lowpass'
  f.Q.value = o.q ?? 1
  f.frequency.setValueAtTime(o.f ?? 1200, t)
  if (o.f2 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, t + (o.a ?? 0.004))
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  s.connect(f)
  f.connect(g)
  g.connect(MASTER)
  s.start(t)
  s.stop(t + dur + 0.03)
}

/** Полутоны от ля первой октавы: аккорды должны строиться, а не примерно совпадать. */
const N = (semi: number): number => 440 * Math.pow(2, semi / 12)

/** Имена соответствуют событиям движка, а не карточкам витрины. */
export const SFX = {
  /** «Мостик»: две ноты вверх. Самый частый звук партии, поэтому тише прочих. */
  playShip(): void {
    tone({ type: 'triangle', f: N(4), dur: 0.13, gain: 0.16 })
    tone({ type: 'triangle', f: N(11), dur: 0.22, gain: 0.13, at: 0.06 })
  },
  /** «Мостик»: низкая квинта. База встаёт надолго — звук тяжелее корабля. */
  playBase(): void {
    tone({ type: 'sine', f: N(-8), dur: 0.5, gain: 0.22 })
    tone({ type: 'sine', f: N(-1), dur: 0.5, gain: 0.14, at: 0.03 })
  },
  /** «Мостик»: колокольчик. */
  acquire(): void {
    tone({ type: 'sine', f: N(12), dur: 0.3, gain: 0.16 })
    tone({ type: 'sine', f: N(19), dur: 0.42, gain: 0.1, at: 0.05 })
  },
  /** «Верфь»: три коротких шороха. Идёт пачкой по пять карт, поэтому очень тихо. */
  draw(): void {
    for (let i = 0; i < 3; i++) {
      hiss({ type: 'bandpass', f: 1600 + i * 400, dur: 0.06, gain: 0.11, q: 1.5, at: i * 0.07 })
    }
  },
  /** «Мостик»: аккорд-подъём. */
  ally(): void {
    for (const [s, at] of [[0, 0], [7, 0.05], [12, 0.1]] as const) {
      tone({ type: 'sine', f: N(s + 3), dur: 0.5, gain: 0.11, at })
    }
  },
  /** «Мостик»: низкий гул с шумом. Кульминация хода. */
  damage(): void {
    tone({ type: 'sine', f: 120, f2: 48, dur: 0.42, gain: 0.32 })
    hiss({ type: 'lowpass', f: 700, f2: 160, dur: 0.3, gain: 0.14 })
  },
  /** «Верфь»: обвал, удар и три металлических осколка. */
  baseDestroyed(): void {
    hiss({ type: 'lowpass', f: 1800, f2: 120, dur: 0.62, gain: 0.32 })
    tone({ type: 'sine', f: 70, f2: 34, dur: 0.5, gain: 0.36 })
    for (let i = 0; i < 3; i++) {
      hiss({ type: 'bandpass', f: 2600 + i * 900, dur: 0.09, gain: 0.11, q: 6, at: 0.1 + i * 0.09 })
    }
  },
  /** «Аркада»: восходящий свип — карта уходит из игры навсегда. */
  scrap(): void {
    tone({ type: 'triangle', f: 620, f2: 2400, dur: 0.22, gain: 0.11 })
    hiss({ type: 'highpass', f: 3000, dur: 0.18, gain: 0.1 })
  },
  /** «Верфь»: два тона. Лечение обязано звучать иначе, чем торговля и бой. */
  authority(): void {
    tone({ type: 'triangle', f: N(2), dur: 0.16, gain: 0.14 })
    tone({ type: 'triangle', f: N(9), dur: 0.26, gain: 0.12, at: 0.12 })
  },
  /** «Верфь»: щелчок реле и гул. Точка в предложении, а не событие. */
  turnEnd(): void {
    hiss({ type: 'bandpass', f: 1100, dur: 0.06, gain: 0.16, q: 3 })
    tone({ type: 'sine', f: 110, f2: 84, dur: 0.4, gain: 0.2, at: 0.04 })
  },
  /** «Мостик»: четыре ноты. Единственный звук длиннее секунды. */
  victory(): void {
    for (const [s, at] of [[0, 0], [7, 0.12], [12, 0.24], [19, 0.36]] as const) {
      tone({ type: 'sine', f: N(s), dur: 1.1 - at, gain: 0.11, at })
    }
  },
} as const

export type SfxName = keyof typeof SFX
