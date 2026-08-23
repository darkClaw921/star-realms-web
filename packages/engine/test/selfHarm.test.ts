import { describe, expect, it } from 'vitest'
import { asDefId } from '../src/ids'
import { reduce } from '../src/reduce'
import type { PendingChoice } from '../src/choices'
import type { GameState } from '../src/state'
import {
  byDef, choose, decline, handIid, inPlay, legalFor, pending, playIid, run, scenario,
} from './scenario'

/** Сам вопрос со списком целей: хелпер `pending` отдаёт только его сводку. */
function ask(s: GameState): PendingChoice | null {
  const top = s.resolution[0]
  return top && top.f === 'choice' ? top.choice : null
}

/** Кому принадлежит каждая предложенная карта, в порядке предъявления. */
function owners(s: GameState): (string | null)[] {
  return (ask(s)?.options ?? []).map((o) => (o.o === 'CARD' ? o.owner : null))
}

const D = asDefId

/**
 * Вырожденные выборы, бьющие по своим.
 *
 * «Уничтожьте выбранную базу» у Командного корабля обязательно, а собственная
 * база — законная цель. Когда у соперника баз нет, единственной целью
 * оказывается своя, и раньше движок сносил её МОЛЧА: правило «вариантов не
 * больше, чем требуется, — решать нечего» не различало, чью карту оно тратит.
 * В очереди «применить все союзы» это выглядело так, будто игра сама съела
 * аванпост игрока.
 *
 * Правило не изменилось — база всё равно будет уничтожена, отказаться нельзя.
 * Изменилось то, что выбор теперь предъявляется.
 */

/**
 * Стол с Командным кораблём, у которого открыт союз.
 *
 * Карты именно РАЗЫГРЫВАЮТСЯ из руки, а не расставляются: союзное условие
 * пересчитывается по ходу игры, и стол, собранный руками, оставил бы союз
 * закрытым — свойство было бы просто нелегальным.
 */
function commandShip(opts: { myBases?: string[]; foeBases?: string[] }): GameState {
  const s = scenario({
    me: {
      hand: ['command-ship', 'federation-shuttle'],
      inPlay: (opts.myBases ?? []).map((d) => inPlay(d)),
    },
    them: { inPlay: (opts.foeBases ?? []).map((d) => inPlay(d)) },
  })
  return run(s,
    { t: 'PLAY_CARD', card: handIid(s, 'p1', 'command-ship') },
    { t: 'PLAY_CARD', card: handIid(s, 'p1', 'federation-shuttle') },
  ).state
}

describe('обязательное «уничтожьте базу»', () => {
  it('спрашивает, когда единственная цель — своя база', () => {
    const s = commandShip({ myBases: ['trading-post'] })
    const st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'command-ship'), slot: 'ally' }).state

    // Ключевое: ход остановлен вопросом, а база ещё на столе.
    expect(pending(st)?.prompt).toBe('DESTROY_BASE')
    expect(st.players.p1.inPlay.some((c) => c.def === D('trading-post'))).toBe(true)

    // Отказаться нельзя: эффект обязательный, вариант один.
    expect(pending(st)?.min).toBe(1)
    const answered = run(st, choose(st, byDef('trading-post'))).state
    expect(answered.players.p1.inPlay.some((c) => c.def === D('trading-post'))).toBe(false)
  })

  it('по-прежнему решает само, когда цель — база соперника', () => {
    const s = commandShip({ foeBases: ['trading-post'] })
    const { state, events } = run(s, {
      t: 'ACTIVATE', card: playIid(s, 'p1', 'command-ship'), slot: 'ally',
    })
    // Ничего не спрашиваем: терять игроку нечего, а лишний клик посреди
    // очереди свойств — плата ни за что.
    expect(pending(state)).toBeNull()
    expect(state.players.p2.inPlay).toHaveLength(0)
    expect(events.some((e) => e.e === 'CHOICE_AUTO_RESOLVED')).toBe(true)
  })

  it('предлагает выбор, когда есть и своя база, и чужая', () => {
    const s = commandShip({ myBases: ['trading-post'], foeBases: ['defense-center'] })
    const st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'command-ship'), slot: 'ally' }).state
    expect(pending(st)?.n).toBe(2)
    // Чужая база в списке первой: по ней бьют в подавляющем большинстве случаев.
    expect(owners(st)).toEqual(['p2', 'p1'])
  })

  it('каждая цель названа вместе с владельцем — иначе своя неотличима от чужой', () => {
    const s = commandShip({ myBases: ['trading-post'], foeBases: ['defense-center'] })
    const st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'command-ship'), slot: 'ally' }).state
    expect(owners(st).every((o) => o !== null)).toBe(true)
  })

  it('впустую, когда баз нет вовсе', () => {
    const s = commandShip({})
    const { state, events } = run(s, {
      t: 'ACTIVATE', card: playIid(s, 'p1', 'command-ship'), slot: 'ally',
    })
    expect(pending(state)).toBeNull()
    expect(events.some((e) => e.e === 'FIZZLE')).toBe(true)
  })

  it('аванпост соперника закрывает его базы, а свою всё равно можно выбрать', () => {
    const s = commandShip({ myBases: ['trading-post'], foeBases: ['defense-center', 'blob-wheel'] })
    const st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'command-ship'), slot: 'ally' }).state
    const defs = (ask(st)?.options ?? []).map((o) => (o.o === 'CARD' ? o.def : null))
    // Defense Center — аванпост; «Колесо слизней» за ним недосягаемо.
    expect(defs).toContain(D('defense-center'))
    expect(defs).not.toContain(D('blob-wheel'))
    expect(defs).toContain(D('trading-post'))
  })
})

describe('необязательное «уничтожьте базу»', () => {
  /**
   * У «Линейного крейсера» утилизация уничтожает базу ПО ЖЕЛАНИЮ (min 0).
   * Такой выбор никогда не решался автоматически и не должен: отказ — законный
   * ответ, и своя база остаётся на столе.
   */
  it('оставляет отказ, даже если цель одна и она своя', () => {
    const s0 = scenario({ me: { hand: ['battlecruiser'], inPlay: [inPlay('trading-post')] } })
    const s = run(s0, { t: 'PLAY_CARD', card: handIid(s0, 'p1', 'battlecruiser') }).state
    const st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'battlecruiser'), slot: 'scrap' }).state
    expect(pending(st)?.prompt).toBe('DESTROY_BASE')
    expect(pending(st)?.min).toBe(0)
    const kept = run(st, decline(st)).state
    expect(kept.players.p1.inPlay.some((c) => c.def === D('trading-post'))).toBe(true)
  })
})

describe('прочие вырожденные выборы остались автоматическими', () => {
  it('вынужденный сброс с единственной картой в руке не спрашивает', () => {
    // «Имперский истребитель» заставляет соперника сбросить карту. Выбирать ему
    // не из чего, и спрашивать не о чем — карта уходит сама.
    const s0 = scenario({ me: { hand: ['imperial-fighter'] }, them: { hand: ['scout'] } })
    const st = run(s0, { t: 'PLAY_CARD', card: handIid(s0, 'p1', 'imperial-fighter') }).state
    expect(pending(st)).toBeNull()
    expect(st.players.p2.hand).toHaveLength(0)
    expect(st.players.p2.discard.some((c) => c.def === D('scout'))).toBe(true)
  })

  it('ветка «или» остаётся вопросом даже с одним доступным исходом', () => {
    // «Станция переработки»: выбор между торговлей и сбросом — настоящий, и
    // автоматически он решаться не должен.
    const s = scenario({ me: { hand: ['scout'], inPlay: [inPlay('recycling-station')] } })
    const st = run(s, {
      t: 'ACTIVATE', card: playIid(s, 'p1', 'recycling-station'), slot: 'primary',
    }).state
    // Станция переработки предлагает ветку — это настоящий выбор, он остаётся.
    expect(pending(st)?.prompt).toBe('CHOOSE_BRANCH')
  })
})

describe('очередь «все союзы» и свои базы', () => {
  /**
   * То, на что жаловался игрок: цепочка свойств доходит до Командного корабля
   * и упирается в вопрос вместо того, чтобы тихо снести свою базу.
   */
  it('останавливается на вопросе, а не сносит базу на ходу', () => {
    const s = commandShip({ myBases: ['trading-post'] })
    const acts = legalFor(s, 'p1').filter((a) => a.t === 'ACTIVATE' && a.slot === 'ally')
    expect(acts.length).toBeGreaterThan(0)
    const st = reduce(s, { actor: 'p1', action: acts[0]! }).state
    expect(pending(st)).not.toBeNull()
    // Пока вопрос висит, других свойств применить нельзя — очередь стоит.
    expect(legalFor(st, 'p1').every((a) => a.t === 'RESOLVE_CHOICE')).toBe(true)
  })
})
