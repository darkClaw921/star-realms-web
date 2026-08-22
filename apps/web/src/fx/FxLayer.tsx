'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { cardDef, type CardDefId, type GameEvent, type PlayerId } from '@sr/engine'
import type { MatchSnapshot } from '@/match/types'
import { armAudio, SFX } from './audio'
import { anim, burst, clearFx, popText, ring, screenFlash } from './particles'

const BLOB = '#5fd08a'
const CULT = '#ff7a6b'
const GOLD = '#f0b429'
const SMOKE = '#6b7484'
const WHITE = '#eef2f7'
const FACTION_COLOR: Record<string, string> = {
  trade_federation: '#6fb7f0', blob: BLOB, star_empire: '#f2c24b',
  machine_cult: CULT, unaligned: '#9aa6b4',
}

type Point = { x: number; y: number; w: number; h: number }

function centreOf(el: Element): Point {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
}

/**
 * Вспышки и звук стола.
 *
 * Компонент ничего не рисует в разметку: он слушает поток событий последней
 * команды и запускает эффекты по элементам, которые уже стоят на столе. Отсюда
 * два реестра позиций — карта, которую уничтожили или купили, к моменту
 * обработки события со стола уже исчезла, и её место можно узнать только по
 * снимку предыдущего кадра.
 *
 * События берутся из того же редактированного потока, что и журнал партии:
 * взрыв базы в чужой руке невозможен, потому что такого события зрителю просто
 * не приходит.
 */
export function FxLayer({
  snapshot, enabled,
}: {
  snapshot: MatchSnapshot
  enabled: boolean
}): null {
  const byIid = useRef(new Map<string, Point>())
  const byDef = useRef(new Map<string, Point>())
  // -1, а не 0: нулевой tick — это раздача, у неё событий нет, но реестр
  // позиций с неё нужен, иначе первый же взрыв не найдёт, где стояла карта.
  const seen = useRef(-1)

  // Контекст звука рождается только на жесте: браузер всё равно держит его
  // спящим до первого клика, а созданный впустую он занимает аудиосессию
  // телефона и глушит чужую музыку.
  useEffect(() => {
    const wake = (): void => armAudio()
    document.addEventListener('pointerdown', wake, { once: true, passive: true })
    document.addEventListener('keydown', wake, { once: true })
    return () => {
      document.removeEventListener('pointerdown', wake)
      document.removeEventListener('keydown', wake)
    }
  }, [])

  useEffect(() => clearFx, [])

  useLayoutEffect(() => {
    const fresh = snapshot.tick !== seen.current
    // Первый снимок после монтирования не озвучивается: игрок только что
    // открыл стол, и раздача не должна встречать его залпом звуков.
    const first = seen.current === -1
    seen.current = snapshot.tick
    // Реестры на этот момент хранят прошлый кадр — именно он и нужен для
    // карт, которых на столе уже нет. Обновляются они ниже, после эффектов.
    if (enabled && fresh && !first) {
      run(snapshot.events, snapshot.view.viewer, byIid.current, byDef.current)
    }
    // Снимок позиций — на каждый рендер: строка карт прокручивается и
    // переливается, и вчерашние координаты годятся только для исчезнувших карт.
    snap(byIid.current, byDef.current)
  })

  return null
}

/** Снимок позиций текущего кадра: карта на столе живёт до следующей команды. */
function snap(iids: Map<string, Point>, defs: Map<string, Point>): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-iid]')) {
    const p = centreOf(el)
    if (p.w > 0) iids.set(el.dataset.iid!, p)
  }
  // Купленная карта не имеет iid в событии — только определение, поэтому ряд
  // запоминается отдельно и по def.
  for (const el of document.querySelectorAll<HTMLElement>('.band--market [data-def]')) {
    const p = centreOf(el)
    if (p.w > 0) defs.set(el.dataset.def!, p)
  }
}

function anchorIid(iid: string | null, iids: Map<string, Point>): Point | null {
  if (!iid) return null
  const live = document.querySelector(`[data-iid="${CSS.escape(iid)}"]`)
  return live ? centreOf(live) : iids.get(iid) ?? null
}

function hudPoint(who: 'me' | 'them', what: 'authority' | 'combat'): Point | null {
  const el = document.querySelector(`[data-fx="${what}:${who}"]`)
  return el ? centreOf(el) : null
}

function colorOf(def: CardDefId): string {
  return FACTION_COLOR[cardDef(def).faction] ?? WHITE
}

function run(
  events: readonly GameEvent[], viewer: PlayerId,
  iids: Map<string, Point>, defs: Map<string, Point>,
): void {
  for (const e of events) {
    switch (e.e) {
      case 'PLAY_CARD': {
        const base = cardDef(e.def).type !== 'ship'
        if (base) SFX.playBase(); else SFX.playShip()
        const el = document.querySelector(`[data-iid="${CSS.escape(e.iid)}"]`)
        if (el) {
          anim(el, 'fx-lift', 0.45)
          const p = centreOf(el)
          burst({
            x: p.x, y: p.y + p.h / 3, n: 12, dir: -Math.PI / 2, spread: 1.4,
            speed: 90, color: colorOf(e.def), life: 0.7, size: 1.8, jitter: p.w / 2,
          })
        }
        break
      }

      case 'ACQUIRE': {
        SFX.acquire()
        const p = defs.get(e.def)
        if (p) {
          burst({
            x: p.x, y: p.y, n: 14, speed: 150, g: 420,
            color: [GOLD, '#8a7440'], shape: 'shard', size: 3, life: 0.8, jitter: 20,
          })
          ring(p.x, p.y, GOLD, { size: 12, grow: 70, life: 0.4 })
        }
        break
      }

      case 'DRAW':
        // Добор соперника не виден и звучать не должен: звук без картинки
        // читается как «что-то произошло у меня».
        if (e.player === viewer) SFX.draw()
        break

      case 'ALLY_UNLOCKED': {
        if (e.player !== viewer) break
        SFX.ally()
        const colour = FACTION_COLOR[e.faction] ?? WHITE
        const lit = document.querySelectorAll<HTMLElement>(
          `.band--board [data-faction="${CSS.escape(e.faction)}"]`,
        )
        lit.forEach((el, i) => {
          el.style.setProperty('--fx-glow', colour)
          anim(el, 'fx-ally', 0.8, 'ease-out')
          el.style.animationDelay = `${i * 0.06}s`
          const p = centreOf(el)
          burst({
            x: p.x, y: p.y, n: 8, dir: -Math.PI / 2, spread: 0.9, speed: 60,
            color: colour, life: 0.9, size: 1.8, jitter: p.w / 2,
          })
        })
        break
      }

      case 'AUTHORITY_LOST': {
        SFX.damage()
        const mine = e.player === viewer
        const p = hudPoint(mine ? 'me' : 'them', 'authority')
        const hud = document.querySelector(`[data-fx="authority:${mine ? 'me' : 'them'}"]`)
        anim(hud?.closest('.hud') ?? null, 'fx-shake', 0.45, 'ease-out')
        if (p) {
          burst({
            x: p.x, y: p.y, n: 20, speed: 170, g: 500,
            color: ['#c9d2e0', SMOKE], shape: 'shard', size: 3.4, life: 0.8, jitter: 16,
          })
          popText(p.x, p.y - 26, `−${e.n}`, '#ffb2a8')
        }
        // Красным подсвечивается только СВОЙ урон: иначе экран вспыхивает на
        // каждом ударе по сопернику, то есть на любом удачном ходу.
        if (mine) screenFlash(`radial-gradient(120% 100% at 50% 50%, transparent 45%, ${CULT}44 100%)`, 0.5)
        break
      }

      case 'BASE_DESTROYED': {
        SFX.baseDestroyed()
        const p = anchorIid(e.iid, iids)
        if (p) {
          ring(p.x, p.y, '#ffd0a0', { life: 0.45, size: 10, grow: 150 })
          burst({
            x: p.x, y: p.y, n: 30, speed: 260, g: 620,
            color: ['#ffd0a0', CULT, SMOKE], shape: 'shard', size: 4, life: 1, jitter: 24,
          })
          burst({ x: p.x, y: p.y, n: 16, speed: 40, g: -30, color: SMOKE, life: 1.3, size: 7, jitter: 40 })
        }
        break
      }

      case 'SCRAP': {
        SFX.scrap()
        const p = anchorIid(e.iid, iids)
        const el = e.iid ? document.querySelector(`[data-iid="${CSS.escape(e.iid)}"]`) : null
        if (el) anim(el, 'fx-dissolve', 0.7, 'ease-in')
        if (p) {
          burst({
            x: p.x, y: p.y, n: 26, dir: -Math.PI / 2, spread: 1.2, speed: 70,
            color: [WHITE, '#58cfe0'], life: 1, size: 1.6, jitter: Math.max(20, p.w / 2),
          })
        }
        break
      }

      case 'GAIN': {
        if (e.player !== viewer) break
        if (e.what === 'authority') { SFX.authority(); break }
        if (e.what !== 'combat') break
        // Прирост боя без звука: он капает почти с каждой карты, и озвученный
        // превращает ход в очередь сигналов.
        const p = hudPoint('me', 'combat')
        const cell = document.querySelector('[data-fx="combat:me"]')
        if (cell) anim(cell, 'fx-tickle', 0.35)
        if (p) {
          burst({
            x: p.x, y: p.y, n: 12, dir: -Math.PI / 2, spread: 2, speed: 150, g: 400,
            color: ['#ffd0a0', CULT], shape: 'spark', size: 2.2, life: 0.5, jitter: 12,
          })
        }
        break
      }

      case 'TURN_END':
        SFX.turnEnd()
        break

      case 'GAME_OVER': {
        SFX.victory()
        // Залпами, а не одним взрывом: победа — единственный момент, где
        // эффекту позволено занять две секунды.
        for (let i = 0; i < 4; i++) {
          window.setTimeout(() => {
            const x = 80 + Math.random() * Math.max(1, window.innerWidth - 160)
            const y = 80 + Math.random() * Math.max(1, window.innerHeight * 0.45)
            ring(x, y, [GOLD, BLOB, '#58cfe0'][i % 3]!, { life: 0.5, size: 6, grow: 90 })
            burst({
              x, y, n: 22, speed: 210, g: 260,
              color: [GOLD, BLOB, '#58cfe0', WHITE], life: 1.1, size: 2.2, shape: 'spark', jitter: 8,
            })
          }, i * 260)
        }
        break
      }

      default:
        break
    }
  }
}
