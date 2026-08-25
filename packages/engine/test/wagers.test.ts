import { describe, expect, it } from 'vitest'
import type { CardDefId, CardIid } from '../src/ids'
import { enumerateLegalActions } from '../src/legal'
import { reduce } from '../src/reduce'
import {
  applyReward, harvestRun, runNode, runSetup, runStartCarry, type RunCarry,
} from '../src/run'
import { createGame } from '../src/setup'
import { actorOf, type GameState } from '../src/state'
import { redact } from '../src/view'
import { WAGERS, wagerFor, type WagerId } from '../src/wagers'
import { choose, run } from './scenario'

const carry = (over: Partial<RunCarry> = {}): RunCarry => ({ ...runStartCarry(), ...over })

/** Бой первого узла забега — единственный режим, где пари вообще существуют. */
function fight(seed = 'wager', over: Partial<RunCarry> = {}): GameState {
  const node = runNode(1)
  if (!node) throw new Error('no node 1')
  return createGame({
    matchId: 'w', seed, firstPlayer: 'p1', scenario: runSetup(node, carry(over)),
  })
}

/**
 * На каком ходу выпадает нужная ставка.
 *
 * Предложение выводится из матча и номера хода, и подделать его иначе — значит
 * подделать ровно ту функцию, которую тест и проверяет. Поэтому тест ищет ход,
 * а не подсовывает ставку.
 */
const offerOn = (matchId: string, id: WagerId): number => {
  for (let t = 1; t < 400; t++) if (wagerFor(matchId, t, 'p1').id === id) return t
  throw new Error(`wager ${id} never offered`)
}

const hand = (s: GameState, defs: string[]): GameState => {
  const next = structuredClone(s)
  next.players.p1.hand = defs.map((d, i) => ({ iid: `h${i}` as CardIid, def: d as CardDefId }))
  return next
}

describe('the offer', () => {
  it('is one of the five, and the same for anyone who asks', () => {
    const w = wagerFor('m', 3, 'p1')
    expect(WAGERS).toContain(w)
    expect(wagerFor('m', 3, 'p1')).toEqual(w)
    // Разным игрокам и разным ходам — своё.
    const others = [wagerFor('m', 4, 'p1'), wagerFor('m', 3, 'p2'), wagerFor('n', 3, 'p1')]
    expect(others.some((o) => o.id !== w.id)).toBe(true)
  })

  it('is offered only in a run, only on your turn, and only once', () => {
    const plain = createGame({ matchId: 'w', seed: 'plain', firstPlayer: 'p1' })
    const legal = (s: GameState, seat = 'p1' as const): boolean =>
      enumerateLegalActions(redact(s, seat), seat).some((a) => a.t === 'TAKE_WAGER')
    expect(legal(plain)).toBe(false)

    const s = fight()
    expect(legal(s)).toBe(true)
    const taken = run(s, { t: 'TAKE_WAGER' })
    expect(taken.state.players.p1.wager?.id).toBe(wagerFor(s.matchId, s.turn, 'p1').id)
    expect(legal(taken.state)).toBe(false)
    expect(() => reduce(taken.state, { actor: 'p1', action: { t: 'TAKE_WAGER' } })).toThrow()
    // И не соперником в чужой ход.
    expect(legal(taken.state, 'p2' as never)).toBe(false)
  })
})

describe('settling a bet', () => {
  /** Ход, на котором предлагается «Блиц» — 10 боевого урона. */
  const blitzTurn = offerOn('w', 'blitz')

  it('pays the moment the turn gets there, not at the end of it', () => {
    const base = fight()
    const s = { ...structuredClone(base), turn: blitzTurn }
    expect(wagerFor(s.matchId, s.turn, 'p1').id).toBe('blitz')
    const taken = run(s, { t: 'TAKE_WAGER' }).state
    const armed = structuredClone(taken)
    armed.players.p1.combat = 10
    const hit = run(armed, { t: 'ATTACK_PLAYER', amount: 10 })
    expect(hit.state.players.p1.wager?.won).toBe(true)
    expect(hit.events.some((e) => e.e === 'WAGER_WON')).toBe(true)
    // И тут же спрашивает, какую карту улучшить.
    expect(hit.state.resolution.length).toBeGreaterThan(0)
    const choice = redact(hit.state, 'p1').pendingChoice
    expect(choice?.prompt).toBe('UPGRADE_CARD')
  })

  it('pays exactly once, however far past the number the turn goes', () => {
    const s = { ...structuredClone(fight()), turn: blitzTurn }
    const taken = run(s, { t: 'TAKE_WAGER' }).state
    const armed = structuredClone(taken)
    armed.players.p1.combat = 20
    let st = run(armed, { t: 'ATTACK_PLAYER', amount: 10 }).state
    st = run(st, choose(st, (o: never) => (o as { o: string }).o === 'CARD')).state
    const before = st.players.p1.hand.concat(st.players.p1.discard)
      .reduce((n, c) => n + (c.up ?? 0), 0)
    const again = run(st, { t: 'ATTACK_PLAYER', amount: 10 }).state
    const after = again.players.p1.hand.concat(again.players.p1.discard)
      .reduce((n, c) => n + (c.up ?? 0), 0)
    expect(after).toBe(before)
  })

  it('costs the stake if the turn ends short', () => {
    const s = { ...structuredClone(fight()), turn: blitzTurn }
    const taken = run(s, { t: 'TAKE_WAGER' }).state
    const before = taken.players.p1.authority
    const ended = run(taken, { t: 'END_TURN' })
    expect(ended.state.players.p1.authority).toBe(before - 4)
    expect(ended.events.some((e) => e.e === 'WAGER_LOST')).toBe(true)
    // И не переносится на следующий ход.
    expect(ended.state.players.p1.wager).toBeNull()
  })

  it('cannot be taken on a turn that already met it', () => {
    const s = { ...structuredClone(fight()), turn: blitzTurn }
    const armed = structuredClone(s)
    armed.players.p1.combat = 12
    const hit = run(armed, { t: 'ATTACK_PLAYER', amount: 12 }).state
    expect(enumerateLegalActions(redact(hit, 'p1'), 'p1').some((a) => a.t === 'TAKE_WAGER'))
      .toBe(false)
    expect(() => reduce(hit, { actor: 'p1', action: { t: 'TAKE_WAGER' } })).toThrow()
  })
})

describe('an upgraded card', () => {
  const upgraded = (s: GameState, iid: string): GameState => {
    const next = structuredClone(s)
    for (const zone of [next.players.p1.hand, next.players.p1.discard, next.players.p1.inPlay]) {
      const c = zone.find((x) => x.iid === iid)
      if (c) (c as { up?: number }).up = 1
    }
    return next
  }

  it('pays more of its own resource, and only its own', () => {
    const s = hand(fight(), ['viper', 'scout'])
    const withUp = upgraded(s, 'h0')
    const played = run(withUp, { t: 'PLAY_CARD', card: 'h0' as CardIid })
    // Гадюка даёт бой, поэтому улучшение — тоже бой, а не торговля.
    expect(played.state.players.p1.combat).toBe(2)
    expect(played.state.players.p1.trade).toBe(0)

    const scoutUp = upgraded(s, 'h1')
    const traded = run(scoutUp, { t: 'PLAY_CARD', card: 'h1' as CardIid })
    expect(traded.state.players.p1.trade).toBe(2)
    expect(traded.state.players.p1.combat).toBe(0)
  })

  it('stacks, and a base pays on activation rather than on play', () => {
    const s = hand(fight(), ['space-station'])
    const twice = structuredClone(s)
    const c = twice.players.p1.hand[0]
    if (c) (c as { up?: number }).up = 2
    const played = run(twice, { t: 'PLAY_CARD', card: 'h0' as CardIid })
    // База разыграна — но её основное свойство ещё не использовано.
    expect(played.state.players.p1.combat).toBe(0)
    const used = run(played.state, { t: 'ACTIVATE', card: 'h0' as CardIid, slot: 'primary' })
    // Космическая станция даёт 2 боя; с двумя улучшениями — 4.
    expect(used.state.players.p1.combat).toBe(4)
  })

  it('keeps its upgrade through the discard pile and back', () => {
    const s = hand(fight(), ['viper'])
    const withUp = upgraded(s, 'h0')
    const played = run(withUp, { t: 'PLAY_CARD', card: 'h0' as CardIid }).state
    const ended = run(played, { t: 'END_TURN' }).state
    const inDiscard = ended.players.p1.discard.find((x) => x.iid === 'h0')
    expect(inDiscard?.up).toBe(1)
  })

  it('rides into the next fight of the run', () => {
    const s = hand(fight(), ['viper'])
    const withUp = upgraded(s, 'h0')
    const next = harvestRun(withUp, 'p1', runStartCarry())
    expect(next.deck.find((c) => c.def === 'viper' && c.up === 1)).toBeDefined()

    const node = runNode(2)
    if (!node) throw new Error('no node 2')
    const second = createGame({
      matchId: 'w', seed: 'second', firstPlayer: 'p1', scenario: runSetup(node, next),
    })
    const all = [...second.players.p1.deck, ...second.players.p1.hand]
    expect(all.filter((c) => c.up === 1).length).toBe(1)
    expect(JSON.parse(JSON.stringify(second))).toEqual(second)
  })

  it('is a separate card to the run: scrapping one copy keeps the other', () => {
    let c = runStartCarry()
    c = { ...c, deck: [{ def: 'viper' as CardDefId, up: 2 }, ...c.deck] }
    const cut = applyReward(c, { k: 'SCRAP', def: 'viper' as CardDefId, up: 0 })
    expect(cut.deck.some((x) => x.def === 'viper' && x.up === 2)).toBe(true)
    expect(cut.deck.filter((x) => x.def === 'viper').length).toBe(2)
  })
})

describe('what the player is shown', () => {
  it('carries the upgrade into every zone the view rebuilds', () => {
    const s = hand(fight(), ['viper', 'scout'])
    const marked = structuredClone(s)
    // По одной улучшенной карте в каждой открытой зоне.
    const h = marked.players.p1.hand[0]
    if (h) (h as { up?: number }).up = 1
    marked.players.p1.discard = [{ iid: 'd0' as CardIid, def: 'ram' as CardDefId, up: 2 }]
    marked.scrapHeap = [{ iid: 's0' as CardIid, def: 'cutter' as CardDefId, up: 3 }]
    marked.players.p2.discard = [{ iid: 'e0' as CardIid, def: 'ram' as CardDefId, up: 1 }]

    const v = redact(marked, 'p1')
    // Рука была тем местом, где улучшение терялось: вид собирается полем за
    // полем, и карта там пересобиралась из двух полей вместо трёх.
    expect(v.me.hand.find((c) => c.iid === 'h0')?.up).toBe(1)
    expect(v.me.discard.find((c) => c.iid === 'd0')?.up).toBe(2)
    expect(v.scrapHeap.find((c) => c.iid === 's0')?.up).toBe(3)
    expect(v.opponent.discard.find((c) => c.iid === 'e0')?.up).toBe(1)

    // И на столе, где оно и раньше доезжало.
    const played = run(marked, { t: 'PLAY_CARD', card: 'h0' as CardIid }).state
    expect(redact(played, 'p1').me.inPlay.find((c) => c.iid === 'h0')?.up).toBe(1)
  })

  it('offers the upgrade choice with each copy\'s current level on it', () => {
    const s = hand(fight(), ['viper'])
    // На ходу, где предлагают «Блиц»: его и выигрывает удар ниже.
    const marked = { ...structuredClone(s), turn: offerOn('w', 'blitz') }
    const h = marked.players.p1.hand[0]
    if (h) (h as { up?: number }).up = 2
    marked.players.p1.discard = [{ iid: 'd0' as CardIid, def: 'ram' as CardDefId }]
    const asked = run(marked, { t: 'TAKE_WAGER' }).state
    const armed = structuredClone(asked)
    // Ровно столько, чтобы взять ставку и не добить соперника: конец партии
    // остановил бы разрешение раньше, чем дошло бы до выбора карты.
    armed.players.p1.combat = 12
    const hit = run(armed, { t: 'ATTACK_PLAYER', amount: 12 }).state
    const choice = redact(hit, 'p1').pendingChoice
    expect(choice?.prompt).toBe('UPGRADE_CARD')
    const upgraded = choice.options.find((o) => o.o === 'CARD' && o.iid === 'h0')
    expect(upgraded && upgraded.o === 'CARD' ? upgraded.up : null).toBe(2)
    const plain = choice.options.find((o) => o.o === 'CARD' && o.iid === 'd0')
    expect(plain && plain.o === 'CARD' ? plain.up : 'missing').toBeUndefined()
  })
})

describe('the whole loop', () => {
  it('plays a run turn with a bet and never stalls', () => {
    let st = fight('loop')
    for (let i = 0; i < 200 && !st.winner; i++) {
      const seat = actorOf(st)
      const acts = enumerateLegalActions(redact(st, seat), seat)
      expect(acts.length).toBeGreaterThan(0)
      const bet = acts.find((a) => a.t === 'TAKE_WAGER')
      const pick = bet ?? acts[i % acts.length]
      st = reduce(st, { actor: seat, action: pick! }).state
    }
    expect(st.turn).toBeGreaterThan(1)
  })
})
