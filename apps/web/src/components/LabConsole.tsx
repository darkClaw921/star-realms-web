'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CARDS, cardDef, opponentOf,
  type CardDefId, type CardInstance, type Faction, type GameEvent, type GameState,
  type InPlayCard, type PlayerId, type SetId,
} from '@sr/engine'
import { cardName } from '@/i18n/cards.ru'
import { LAB } from '@/i18n/lab.ru'
import { LabMatchClient } from '@/match/LabMatchClient'

/** Куда пульт умеет класть карту. Зоны те же, что знает движок. */
type Slot = 'hand' | 'inPlay' | 'foeInPlay' | 'tradeRow' | 'discard' | 'deckTop' | 'scrapHeap'

const SLOTS: readonly { id: Slot; name: string }[] = [
  { id: 'hand', name: LAB.slotHand },
  { id: 'inPlay', name: LAB.slotInPlay },
  { id: 'foeInPlay', name: LAB.slotFoeInPlay },
  { id: 'tradeRow', name: LAB.slotTradeRow },
  { id: 'discard', name: LAB.slotDiscard },
  { id: 'deckTop', name: LAB.slotDeckTop },
  { id: 'scrapHeap', name: LAB.slotScrap },
]

function instance(def: CardDefId): CardInstance {
  return { iid: LabMatchClient.iid(), def }
}

function inPlay(def: CardDefId): InPlayCard {
  return {
    ...instance(def),
    copiedDef: null,
    chosenFaction: null,
    used: {
      primary: false, ally: false, ally2: false, ally3: false, ally4: false,
      doubleAlly: false, scrap: false, splinter: false,
    },
    // Карта, положенная пультом, ведёт себя как оставшаяся с прошлого хода:
    // её свойства доступны, но «сыграно за этот ход» она не считается.
    playedThisTurn: false,
  }
}

/**
 * Пересчёт союзов по тому, что стоит на столе.
 *
 * Движок поднимает эти флаги в момент розыгрыша, а пульт кладёт карту мимо
 * розыгрыша. Без пересчёта союзное свойство осталось бы серым при двух картах
 * фракции на столе — то есть полигон врал бы ровно про то правило, которое
 * чаще всего и проверяют.
 */
function recountAlly(d: GameState, seat: PlayerId): void {
  const count = new Map<Faction, number>()
  for (const c of d.players[seat].inPlay) {
    const def = cardDef(c.copiedDef ?? c.def)
    for (const f of [def.faction, def.faction2, c.chosenFaction]) {
      if (f && f !== 'unaligned') count.set(f, (count.get(f) ?? 0) + 1)
    }
  }
  d.players[seat].allyUnlocked = [...count].filter(([, n]) => n >= 2).map(([f]) => f)
  d.players[seat].doubleAllyUnlocked = [...count].filter(([, n]) => n >= 3).map(([f]) => f)
}

/** Первая карта на столе, подходящая под эффект: пульту нужна живая цель. */
function pick(d: GameState, seat: PlayerId, what: 'any' | 'base'): InPlayCard | null {
  for (const c of d.players[seat].inPlay) {
    if (what === 'any') return c
    if (cardDef(c.copiedDef ?? c.def).type !== 'ship') return c
  }
  return null
}

export function LabConsole({
  client, state, viewer, sets,
}: {
  client: LabMatchClient
  state: GameState
  viewer: PlayerId
  sets: readonly SetId[]
}): React.JSX.Element {
  const [open, setOpen] = useState(true)
  // Стол не должен уезжать под панель: торговый ряд и кнопка конца хода
  // обязаны оставаться доступными, иначе полигон перестаёт быть игрой.
  useEffect(() => {
    document.body.classList.toggle('has-lab', open)
    return () => document.body.classList.remove('has-lab')
  }, [open])
  const [tab, setTab] = useState<'cards' | 'board' | 'fx' | 'cases'>('cards')
  const [q, setQ] = useState('')
  const [slot, setSlot] = useState<Slot>('hand')
  const foe = opponentOf(viewer)

  // Реестр не меняется, а перебирать его на каждое нажатие клавиши в поиске
  // незачем: список готовится один раз.
  const all = useMemo(() => {
    const out: { def: CardDefId; name: string; hay: string; set: SetId }[] = []
    for (const [id, def] of CARDS) {
      const name = cardName(id, def.name)
      out.push({ def: id, name, hay: `${name} ${def.name} ${id}`.toLowerCase(), set: def.set })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [])

  const found = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const pool = all.filter((c) => sets.includes(c.set))
    if (!needle) return pool.slice(0, 60)
    return pool.filter((c) => c.hay.includes(needle)).slice(0, 60)
  }, [all, q, sets])

  const put = (def: CardDefId): void => {
    client.patch((d) => {
      const me = d.players[viewer]
      switch (slot) {
        case 'hand': me.hand.push(instance(def)); break
        case 'inPlay': me.inPlay.push(inPlay(def)); recountAlly(d, viewer); break
        case 'foeInPlay': d.players[foe].inPlay.push(inPlay(def)); recountAlly(d, foe); break
        case 'discard': me.discard.push(instance(def)); break
        case 'deckTop': me.deck.unshift(instance(def)); break
        case 'scrapHeap': d.scrapHeap.push(instance(def)); break
        case 'tradeRow': {
          // Ряд фиксированного размера: если свободного места нет, карта
          // ЗАМЕНЯЕТ первый слот. Молча ничего не делать хуже — нажатие
          // выглядело бы сломанным.
          const free = d.tradeRow.findIndex((c) => c === null)
          d.tradeRow[free >= 0 ? free : 0] = instance(def)
          break
        }
      }
    })
    client.say(LAB.saidPut(cardName(def, cardDef(def).name), SLOTS.find((s) => s.id === slot)!.name))
  }

  const res = (what: 'trade' | 'combat', n: number): void => {
    client.patch((d) => {
      const p = d.players[viewer]
      if (what === 'trade') p.trade = Math.max(0, p.trade + n)
      else p.combat = Math.max(0, p.combat + n)
    })
  }

  const auth = (who: PlayerId, n: number): void => {
    client.patch((d) => { d.players[who].authority = Math.max(0, d.players[who].authority + n) })
  }

  /**
   * Эффекты запускаются НАСТОЯЩИМ событием по настоящей карте на столе, а не
   * макетом: только так видно, как вспышка ложится на реальные размеры карты и
   * реальное место HUD.
   */
  const fx = (make: (d: GameState) => GameEvent[] | string): void => {
    const out = make(state)
    if (typeof out === 'string') { client.say(out); return }
    client.fire(out)
  }

  const FX: readonly { name: string; run: () => void }[] = [
    {
      name: LAB.fxPlayShip,
      run: () => fx((d) => {
        const c = pick(d, viewer, 'any')
        return c ? [{ e: 'PLAY_CARD', player: viewer, iid: c.iid, def: c.def }] : LAB.needInPlay
      }),
    },
    {
      name: LAB.fxAbility,
      run: () => fx((d) => {
        const c = pick(d, viewer, 'any')
        return c
          ? [{ e: 'ABILITY_USED', player: viewer, iid: c.iid, def: c.def, slot: 'primary' }]
          : LAB.needInPlay
      }),
    },
    {
      name: LAB.fxAlly,
      run: () => fx((d) => {
        const c = pick(d, viewer, 'any')
        if (!c) return LAB.needInPlay
        return [{ e: 'ALLY_UNLOCKED', player: viewer, faction: cardDef(c.def).faction }]
      }),
    },
    {
      name: LAB.fxAcquire,
      run: () => fx((d) => {
        const c = d.tradeRow.find((x) => x !== null)
        return c
          ? [{ e: 'ACQUIRE', player: viewer, def: c.def, dest: 'discard', cost: cardDef(c.def).cost }]
          : LAB.needRow
      }),
    },
    { name: LAB.fxDraw, run: () => fx(() => [{ e: 'DRAW', player: viewer, n: 2, defs: null }]) },
    {
      name: LAB.fxDamageMe,
      run: () => fx(() => [{ e: 'AUTHORITY_LOST', player: viewer, n: 8 }]),
    },
    {
      name: LAB.fxDamageFoe,
      run: () => fx(() => [{ e: 'AUTHORITY_LOST', player: foe, n: 8 }]),
    },
    {
      name: LAB.fxBaseBoom,
      run: () => fx((d) => {
        const c = pick(d, foe, 'base') ?? pick(d, viewer, 'base')
        if (!c) return LAB.needBase
        const owner = d.players[foe].inPlay.includes(c) ? foe : viewer
        return [{ e: 'BASE_DESTROYED', owner, iid: c.iid, def: c.def, by: 'combat' }]
      }),
    },
    {
      name: LAB.fxScrap,
      run: () => fx((d) => {
        const c = pick(d, viewer, 'any')
        return c
          ? [{ e: 'SCRAP', from: 'inPlay', owner: viewer, iid: c.iid, def: c.def }]
          : LAB.needInPlay
      }),
    },
    { name: LAB.fxCombat, run: () => fx(() => [{ e: 'GAIN', player: viewer, what: 'combat', n: 5 }]) },
    { name: LAB.fxAuthority, run: () => fx(() => [{ e: 'GAIN', player: viewer, what: 'authority', n: 4 }]) },
    { name: LAB.fxTurnEnd, run: () => fx(() => [{ e: 'TURN_END', player: viewer }]) },
    { name: LAB.fxVictory, run: () => fx(() => [{ e: 'GAME_OVER', winner: viewer }]) },
  ]

  /** Ситуации: одна кнопка собирает положение, которое иначе ждёшь полпартии. */
  const CASES: readonly { name: string; hint: string; run: () => void }[] = [
    {
      name: LAB.caseOutpost, hint: LAB.caseOutpostHint,
      run: () => {
        client.patch((d) => {
          d.players[foe].inPlay.push(inPlay('battle-station' as CardDefId))
          d.players[foe].inPlay.push(inPlay('barter-world' as CardDefId))
          d.players[viewer].combat += 10
          recountAlly(d, foe)
        })
        client.say(LAB.caseOutpostHint)
      },
    },
    {
      name: LAB.caseAlly, hint: LAB.caseAllyHint,
      run: () => {
        client.patch((d) => {
          d.players[viewer].inPlay.push(inPlay('blob-wheel' as CardDefId))
          d.players[viewer].hand.push(instance('blob-fighter' as CardDefId))
          d.players[viewer].hand.push(instance('battle-pod' as CardDefId))
          recountAlly(d, viewer)
        })
        client.say(LAB.caseAllyHint)
      },
    },
    {
      name: LAB.caseNeedle, hint: LAB.caseNeedleHint,
      run: () => {
        client.patch((d) => {
          d.players[viewer].hand.push(instance('stealth-needle' as CardDefId))
          d.players[viewer].hand.push(instance('battlecruiser' as CardDefId))
          d.players[viewer].trade += 5
        })
        client.say(LAB.caseNeedleHint)
      },
    },
    {
      name: LAB.caseEmptyDeck, hint: LAB.caseEmptyDeckHint,
      run: () => {
        client.patch((d) => {
          d.players[viewer].deck = []
          d.players[viewer].discard = []
          d.players[viewer].hand.push(instance('freighter' as CardDefId))
        })
        client.say(LAB.caseEmptyDeckHint)
      },
    },
    {
      name: LAB.caseRecycling, hint: LAB.caseRecyclingHint,
      run: () => {
        client.patch((d) => {
          d.players[viewer].inPlay.push(inPlay('recycling-station' as CardDefId))
          d.players[viewer].deck = d.players[viewer].deck.slice(0, 1)
          for (const def of ['scout', 'scout', 'viper']) {
            d.players[viewer].hand.push(instance(def as CardDefId))
          }
          recountAlly(d, viewer)
        })
        client.say(LAB.caseRecyclingHint)
      },
    },
    {
      name: LAB.caseTopdeck, hint: LAB.caseTopdeckHint,
      run: () => {
        client.patch((d) => {
          d.players[viewer].hand.push(instance('blob-carrier' as CardDefId))
          d.players[viewer].hand.push(instance('central-office' as CardDefId))
          d.players[viewer].trade += 12
        })
        client.say(LAB.caseTopdeckHint)
      },
    },
    {
      name: LAB.caseRich, hint: LAB.caseRichHint,
      run: () => {
        client.patch((d) => { d.players[viewer].trade += 20; d.players[viewer].combat += 20 })
        client.say(LAB.caseRichHint)
      },
    },
    {
      name: LAB.caseEndgame, hint: LAB.caseEndgameHint,
      run: () => {
        client.patch((d) => { d.players[foe].authority = 5; d.players[viewer].combat += 12 })
        client.say(LAB.caseEndgameHint)
      },
    },
  ]

  const me = state.players[viewer]
  const them = state.players[foe]

  if (!open) {
    return (
      <button type="button" className="lab__tab" onClick={() => setOpen(true)}>
        {LAB.open}
      </button>
    )
  }

  return (
    <aside className="lab" aria-label={LAB.title}>
      <header className="lab__head">
        <span className="lab__title">{LAB.title}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>
          {LAB.hide}
        </button>
      </header>

      <div className="lab__meters">
        <span>{LAB.meterMe(me.authority, me.trade, me.combat)}</span>
        <span>{LAB.meterFoe(them.authority, them.inPlay.length)}</span>
        <span>{LAB.meterTurn(state.turn, state.activePlayer === viewer ? LAB.mine : LAB.theirs)}</span>
      </div>

      <div className="tabs tabs--lab" role="tablist">
        {([['cards', LAB.tabCards], ['board', LAB.tabBoard], ['fx', LAB.tabFx], ['cases', LAB.tabCases]] as const)
          .map(([id, name]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`tab${tab === id ? ' is-on' : ''}`}
              onClick={() => setTab(id)}
            >
              {name}
            </button>
          ))}
      </div>

      <div className="lab__body">
        {tab === 'cards' && (
          <>
            <div className="lab__row">
              {SLOTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`btn btn--sm${slot === s.id ? ' btn--primary' : ''}`}
                  onClick={() => setSlot(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <input
              className="lab__search"
              type="search"
              value={q}
              placeholder={LAB.searchPlaceholder}
              onChange={(e) => setQ(e.target.value)}
            />
            <p className="lab__note">{LAB.cardsHint}</p>
            <ul className="lab__list">
              {found.map((c) => (
                <li key={c.def}>
                  <button type="button" className="lab__card" onClick={() => put(c.def)}>
                    <span>{c.name}</span>
                    <span className="lab__cost">{cardDef(c.def).cost}</span>
                  </button>
                </li>
              ))}
              {found.length === 0 && <li className="lab__note">{LAB.nothingFound}</li>}
            </ul>
          </>
        )}

        {tab === 'board' && (
          <>
            <h4 className="lab__group">{LAB.groupResources}</h4>
            <div className="lab__row">
              <button type="button" className="btn btn--sm" onClick={() => res('trade', 1)}>{LAB.tradePlus}</button>
              <button type="button" className="btn btn--sm" onClick={() => res('trade', 5)}>{LAB.tradePlus5}</button>
              <button type="button" className="btn btn--sm" onClick={() => res('combat', 1)}>{LAB.combatPlus}</button>
              <button type="button" className="btn btn--sm" onClick={() => res('combat', 5)}>{LAB.combatPlus5}</button>
              <button
                type="button" className="btn btn--sm btn--ghost"
                onClick={() => client.patch((d) => { d.players[viewer].trade = 0; d.players[viewer].combat = 0 })}
              >
                {LAB.poolsZero}
              </button>
            </div>

            <h4 className="lab__group">{LAB.groupAuthority}</h4>
            <div className="lab__row">
              <button type="button" className="btn btn--sm" onClick={() => auth(viewer, 10)}>{LAB.myAuthPlus}</button>
              <button type="button" className="btn btn--sm" onClick={() => auth(viewer, -10)}>{LAB.myAuthMinus}</button>
              <button type="button" className="btn btn--sm" onClick={() => auth(foe, 10)}>{LAB.foeAuthPlus}</button>
              <button type="button" className="btn btn--sm" onClick={() => auth(foe, -10)}>{LAB.foeAuthMinus}</button>
            </div>

            <h4 className="lab__group">{LAB.groupZones}</h4>
            <div className="lab__row">
              <button
                type="button" className="btn btn--sm"
                onClick={() => client.patch((d) => {
                  const p = d.players[viewer]
                  p.discard.push(...p.hand)
                  p.hand = []
                  for (let i = 0; i < 5 && p.deck.length > 0; i++) p.hand.push(p.deck.shift()!)
                })}
              >
                {LAB.redraw}
              </button>
              <button
                type="button" className="btn btn--sm"
                onClick={() => client.patch((d) => {
                  const p = d.players[viewer]
                  p.discard.push(...p.inPlay.map((c) => ({ iid: c.iid, def: c.def })))
                  p.inPlay = []
                  recountAlly(d, viewer)
                })}
              >
                {LAB.clearMine}
              </button>
              <button
                type="button" className="btn btn--sm"
                onClick={() => client.patch((d) => { d.players[foe].inPlay = []; recountAlly(d, foe) })}
              >
                {LAB.clearFoe}
              </button>
              <button
                type="button" className="btn btn--sm"
                onClick={() => client.patch((d) => { d.tradeRow = d.tradeRow.map(() => null) })}
              >
                {LAB.clearRow}
              </button>
            </div>
            <p className="lab__note">{LAB.boardHint}</p>
          </>
        )}

        {tab === 'fx' && (
          <>
            <p className="lab__note">{LAB.fxHint}</p>
            <div className="lab__grid">
              {FX.map((f) => (
                <button key={f.name} type="button" className="btn btn--sm" onClick={f.run}>
                  {f.name}
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'cases' && (
          <>
            <p className="lab__note">{LAB.casesHint}</p>
            <ul className="lab__cases">
              {CASES.map((c) => (
                <li key={c.name}>
                  <button type="button" className="lab__case" onClick={c.run}>
                    <span className="lab__case-name">{c.name}</span>
                    <span className="lab__case-hint">{c.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </aside>
  )
}
