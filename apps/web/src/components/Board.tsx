'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cardDef, costFor, EXPLORER, TENTACLE_FACTIONS, VARIANT_CARD,
  type Action, type CardDefId, type CardIid, type Faction, type PlayerId,
} from '@sr/engine'
import { cardName } from '@/i18n/cards.ru'
import { objectiveProgressRu, objectiveRu } from '@/i18n/campaign.ru'
import { CHALLENGE_RU, TENTACLE_RU } from '@/i18n/challenges.ru'
import { UI } from '@/i18n/ui'
import type { SeatNames } from '@/match/log'
import type { MatchSnapshot } from '@/match/types'
import { EventFlash } from './EventFlash'
import { FxLayer } from '@/fx/FxLayer'
import { setTempo } from '@/fx/tempo'
import { FanRow } from './FanRow'
import { LogPanel } from './LogPanel'
import { useSettings } from '@/settings/useSettings'
import { Card } from './Card'
import { ChoiceSheet } from './ChoiceSheet'
import { SettingsPanel } from './SettingsPanel'
import { AllyStrip, OpponentHud, SelfHud } from './Hud'
import { SidePlate, SideRail } from './SideRail'
import { FACTION_VAR, Icon } from './Icons'

const SLOT_LABEL: Record<
  'primary' | 'ally' | 'ally2' | 'ally3' | 'ally4' | 'doubleAlly' | 'scrap' | 'splinter',
  string
> = {
  primary: UI.slotPrimary, ally: UI.slotAlly,
  ally2: UI.slotAlly2, ally3: UI.slotAlly3, ally4: UI.slotAlly4,
  doubleAlly: UI.slotDoubleAlly, scrap: UI.slotScrap, splinter: UI.slotSplinter,
}

/** Карты сценариев — по ним зона раскрытых гамбитов делится на две вкладки. */
const VARIANT_DEFS = new Set<CardDefId>(Object.values(VARIANT_CARD))

/** Localised card name, falling back to the engine's English. */
const nameOf = (def: Parameters<typeof cardDef>[0]): string => cardName(def, cardDef(def).name)

export interface BoardProps {
  snapshot: MatchSnapshot
  seatNames: SeatNames
  onAction: (a: Action) => void
  onExit: () => void
  /** Hot-seat only: shown between turns so the device can change hands. */
  passScreen?: boolean
  onPassAcknowledged?: () => void
}

export function Board({
  snapshot, seatNames, onAction, onExit, passScreen, onPassAcknowledged,
}: BoardProps): React.JSX.Element {
  const { view: v, legal, log, botThinking } = snapshot
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { settings } = useSettings()
  // Темп показа: чужой ход идёт во столько раз быстрее, во сколько попросили в
  // настройках, свой — как обычно.
  //
  // Ставится в РЕНДЕРЕ, а не в эффекте: переезд карт ряды меряют в своих
  // layout-эффектах, а те выполняются раньше родительских — из эффекта доски
  // темп доехал бы до рядов на ход позже.
  const rate = snapshot.botActed ? settings.botSpeed : 1
  setTempo(rate)
  // «Применить всё» шлёт действия ПО ОДНОМУ и перечитывает список законных
  // после каждого: союз может открыться посреди цепочки, а свойство —
  // задать вопрос. Пакетного действия в движке нет намеренно, и придумывать
  // его ради удобства значило бы завести второй способ менять состояние.
  const [auto, setAuto] = useState<null | 'all' | 'ally'>(null)
  const autoSteps = useRef(0)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Порядок карт в игре с прошлого пересчёта: на нём ряд стоит, пока ждёт ответа. */
  const order = useRef<string[]>([])

  /** Index the legal set once so every control can ask "is this allowed?" cheaply. */
  const idx = useMemo(() => {
    const play = new Set<string>()
    const buy = new Set<string>()
    const attack = new Set<string>()
    const activate = new Map<string, Set<string>>()
    let buyExplorer = false
    let endTurn = false
    let maxFace = 0
    let playAll = false
    let canMulligan = false
    const tentacleCards = new Set<string>()
    const revealGambit = new Set<string>()
    const claimMission = new Set<string>()
    for (const a of legal) {
      switch (a.t) {
        case 'PLAY_CARD': play.add(a.card); break
        case 'PLAY_ALL': playAll = true; break
        case 'BUY_CARD': buy.add(a.card); break
        case 'BUY_EXPLORER': buyExplorer = true; break
        case 'ATTACK_BASE': attack.add(a.base); break
        case 'ATTACK_PLAYER': maxFace = Math.max(maxFace, a.amount); break
        case 'END_TURN': endTurn = true; break
        case 'MULLIGAN_ROW': canMulligan = true; break
        case 'ATTACK_TENTACLE': tentacleCards.add(a.card); break
        case 'REVEAL_GAMBIT': revealGambit.add(a.card); break
        case 'CLAIM_MISSION': claimMission.add(a.card); break
        case 'ACTIVATE': {
          const set = activate.get(a.card) ?? new Set<string>()
          set.add(a.slot)
          activate.set(a.card, set)
          break
        }
        default: break
      }
    }
    return {
      play, buy, attack, activate, buyExplorer, endTurn, maxFace, playAll,
      canMulligan, tentacleCards, revealGambit, claimMission,
    }
  }, [legal])

  // A co-op team shares its turn, so "my turn" is membership in the actor set
  // rather than being the single actor.
  const myTurn = v.actors.includes(v.viewer) && v.phase === 'main'
  // Карты с неиспользованным свойством стоят слева.
  //
  // В сложенном ряду наружу торчат левые края, и искать среди отработавших ту,
  // что ещё ждёт нажатия, не приходится.
  //
  // Порядок ЛИПКИЙ: сортируется не заново разложенная зона, а тот ряд, который
  // уже стоит на столе. Разница видна ровно в том случае, ради которого это и
  // сделано — карта, потратившая последнее свойство, уезжает за последнюю ещё
  // активную и дальше не двигается. Если активных больше нет, ехать некуда, и
  // она остаётся на месте: пересортировка «по порядку разыгрывания» гоняла бы
  // весь ряд туда-обратно на каждом нажатии.
  //
  // Переезд при этом не мгновенный: карта переползает на новое место (см.
  // FanRow) — иначе стол дёргается под рукой, которая по нему только что
  // кликнула.
  const inPlayOrdered = useMemo(() => {
    // Ряд, как он стоит сейчас. Карта, которой в нём не было, — только что
    // выложенная, и её место в хвосте.
    const rank = new Map(order.current.map((iid, i) => [iid, i]))
    const asIs = [...v.me.inPlay].sort(
      (a, b) => (rank.get(a.iid) ?? Infinity) - (rank.get(b.iid) ?? Infinity),
    )
    // Пока висит вопрос — и пока ход не наш — законных действий нет ВООБЩЕ, и
    // пересчёт сказал бы, что ни одна карта ничего не ждёт. Ряд схлопывался бы,
    // а ответ на вопрос возвращал бы его обратно: те самые прыжки после покупки
    // карты, которая о чём-то спрашивает.
    if (v.pendingChoice !== null || !myTurn) return asIs

    // Утиль и сплинтер не считаются: они есть почти у каждой карты и никогда
    // не «тратятся», так что карта с ними осталась бы слева навсегда. Да и
    // ждёт такое свойство не нажатия, а решения расстаться с картой.
    const open = (iid: string): number => {
      const slots = idx.activate.get(iid)
      if (!slots) return 1
      for (const s of slots) if (s !== 'scrap' && s !== 'splinter') return 0
      return 1
    }
    const sorted = [...asIs].sort((a, b) => open(a.iid) - open(b.iid))
    order.current = sorted.map((c) => c.iid)
    return sorted
  }, [v.me.inPlay, idx.activate, v.pendingChoice, myTurn])
  // У соперника порядок остаётся тем, в каком карты выложены. «Ждёт хода» там
  // значит «хватает боя снести», то есть меняется от каждой прибавки к
  // счётчику, — ряд переставлялся бы почти на каждое действие.
  const foeOrdered = v.opponent.inPlay
  // Базы и аванпосты уходят в свою колонку слева и ложатся стопкой, как на
  // столе: у базы напечатанная кромка — верхняя, поэтому наезд идёт сверху
  // вниз, а не вбок. Корабли остаются рядом справа. Тип берётся по видимой
  // карте: скопированный Иглой корабль — корабль, чем бы она ни была.
  const isBase = useCallback(
    (c: (typeof v.me.inPlay)[number]): boolean =>
      cardDef(c.copiedDef ?? c.def).type !== 'ship',
    [],
  )
  /**
   * Технология — не база.
   *
   * High Alert кладёт её в игру навсегда, атаковать её нельзя, и свойство у неё
   * одно и то же каждый ход. В стопке баз она занимала место тем, по чему
   * решение принимают: своя колонка — это ряд щитов, которые надо пересчитать
   * перед ударом, и постоянная карта посреди них сбивает счёт. Поэтому свои
   * технологии уезжают в боковую вкладку, а чужие — в ряд кораблей, чтобы
   * колонка баз соперника показывала ровно то, что можно снести.
   */
  const isTech = useCallback(
    (c: (typeof v.me.inPlay)[number]): boolean =>
      cardDef(c.copiedDef ?? c.def).type === 'tech',
    [],
  )
  /**
   * Герой — тоже не база.
   *
   * Он стоит в игре, пока его не потратят, атаковать его нельзя, а вся его
   * способность — в утиле: нажали один раз, и карта ушла. Ровно как
   * технология, он занимал место в стопке щитов, по которой считают удар.
   */
  const isHero = useCallback(
    (c: (typeof v.me.inPlay)[number]): boolean =>
      cardDef(c.copiedDef ?? c.def).type === 'hero',
    [],
  )
  /** Постоянные карты, которым не место в стопке баз. */
  const aside = useCallback(
    (c: (typeof v.me.inPlay)[number]): boolean => isTech(c) || isHero(c), [isTech, isHero],
  )
  const myTech = useMemo(() => inPlayOrdered.filter(isTech), [inPlayOrdered, isTech])
  const myHeroes = useMemo(() => inPlayOrdered.filter(isHero), [inPlayOrdered, isHero])
  const myBases = useMemo(
    () => inPlayOrdered.filter((c) => isBase(c) && !aside(c)), [inPlayOrdered, isBase, aside],
  )
  const myShips = useMemo(() => inPlayOrdered.filter((c) => !isBase(c)), [inPlayOrdered, isBase])
  const foeBases = useMemo(
    () => foeOrdered.filter((c) => isBase(c) && !aside(c)), [foeOrdered, isBase, aside],
  )
  const foeShips = useMemo(
    () => foeOrdered.filter((c) => !isBase(c) || aside(c)), [foeOrdered, isBase, aside],
  )
  // Карта в своей зоне рисуется одинаково, где бы она ни лежала: базы стоят
  // стопкой слева, корабли рядом справа, но кнопки свойств у них те же самые.
  /**
   * Цена карты глазами покупателя, а не типографии.
   *
   * Три сценария меняют цены — Рынок покупателя копит скидку на самых дорогих
   * картах ряда, Набор рекрутов удешевляет базы, Укоренившаяся верность — свою
   * фракцию, — и движок считает по ним честно. А на карте стояла печатная
   * цифра: игрок видел восьмёрку, платил шестёрку и не понимал, за что.
   */
  const priceOf = useCallback(
    (def: Parameters<typeof cardDef>[0], iid?: string): number => costFor(
      cardDef(def), v.me.inPlay,
      { variant: v.variant, buyer: v.viewer, counters: iid ? v.marketCounters[iid] ?? 0 : 0 },
    ),
    [v.me.inPlay, v.variant, v.viewer, v.marketCounters],
  )

  const slotButtons = (iid: string): React.JSX.Element | null => {
    const slots = idx.activate.get(iid)
    if (!slots || slots.size === 0) return null
    return (
      <div className="actions">
        {(['primary', 'ally', 'ally2', 'ally3', 'ally4', 'doubleAlly', 'scrap', 'splinter'] as const)
          .filter((s) => slots.has(s)).map((s) => (
          <button
            key={s}
            type="button"
            className={`btn btn--sm${s === 'scrap' ? ' btn--danger' : ''}`}
            onClick={() => onAction({ t: 'ACTIVATE', card: iid as CardIid, slot: s })}
          >
            {SLOT_LABEL[s]}
          </button>
        ))}
      </div>
    )
  }
  const myInPlayCard = (c: (typeof v.me.inPlay)[number]): React.JSX.Element => (
    <div key={c.iid} className="zone">
      <Card def={c.copiedDef ?? c.def} iid={c.iid} title={nameOf(c.def)} />
      {slotButtons(c.iid)}
    </div>
  )

  /**
   * Карта сценария живёт в зоне раскрытых гамбитов, но гамбитом не является.
   *
   * Зона переиспользована движком не зря — это тоже карта сбоку от стола со
   * свойством раз в ход. А вот вкладка у неё своя: сценарий действует на обоих
   * игроков всю партию, и лежать он должен там, где его ищут глазами, а не под
   * ярлыком «Гамбиты», которых в этой партии может не быть вовсе.
   */
  const scenarioCards = v.me.gambitsInPlay.filter((c) => VARIANT_DEFS.has(c.def))
  const revealedGambits = v.me.gambitsInPlay.filter((c) => !VARIANT_DEFS.has(c.def))
  const hasGambits = v.me.gambits.length > 0 || revealedGambits.length > 0
  const hasMissions = v.me.missions.length > 0 || v.me.missionsDone.length > 0
  const hasTech = myTech.length > 0
  const hasHeroes = myHeroes.length > 0
  const hasCommander = v.me.commander !== null
  const hasVariant = scenarioCards.length > 0
  const hasRail = hasGambits || hasMissions || hasTech || hasHeroes || hasCommander || hasVariant
  const meName = seatNames[v.viewer] ?? v.viewer
  const themName = seatNames[v.opponentSeat] ?? UI.opponent

  // Утилизация и сплинтер уничтожают карту, поэтому в пакет не входят: их
  // выбирают поимённо, а не «применить всё».
  const AUTO_SLOTS = ['primary', 'ally', 'ally2', 'ally3', 'ally4', 'doubleAlly'] as const
  const autoFits = (slot: string, mode: 'all' | 'ally'): boolean =>
    mode === 'all'
      ? (AUTO_SLOTS as readonly string[]).includes(slot)
      : (AUTO_SLOTS as readonly string[]).includes(slot) && slot !== 'primary'

  /**
   * Зона, как её видно: базы слева колонкой, корабли справа рядом.
   *
   * Очередь свойств идёт по ЭТОМУ порядку, а не по тому, в каком движок
   * перечисляет законные действия: игрок смотрит на стол, а не на список.
   */
  const visualOrder = useMemo(
    // Технологии первыми: на экране они левее всего — своей вкладкой у самого
    // края, — и очередь идёт по тому, что видно, а не по внутреннему списку.
    () => [...myTech, ...myHeroes, ...myBases, ...myShips],
    [myTech, myHeroes, myBases, myShips],
  )

  /**
   * Следующее свойство в очереди — с правого края.
   *
   * Справа налево, потому что отработавшая карта уезжает вправо: начав слева,
   * очередь толкала бы перед собой уже применённые карты и переставляла ряд на
   * каждом шаге. С правого края отработавшая остаётся там, где стояла, и стол
   * стоит смирно до конца очереди.
   */
  const nextAuto = (mode: 'all' | 'ally'): Action | undefined => {
    for (let i = visualOrder.length - 1; i >= 0; i--) {
      const card = visualOrder[i]
      if (!card) continue
      const slots = idx.activate.get(card.iid)
      if (!slots) continue
      for (const slot of AUTO_SLOTS) {
        if (autoFits(slot, mode) && slots.has(slot)) {
          return { t: 'ACTIVATE', card: card.iid as CardIid, slot }
        }
      }
    }
    return undefined
  }

  /**
   * Первое свойство применяется СРАЗУ, остальные — по очереди.
   *
   * Отклик на нажатие обязан быть мгновенным: очередь, которая начинается
   * через паузу, неотличима от кнопки, которая ничего не сделала.
   */
  const startAuto = (mode: 'all' | 'ally'): void => {
    autoSteps.current = 0
    const first = nextAuto(mode)
    setAuto(mode)
    if (first) onAction(first)
  }
  const stopAuto = (): void => {
    setAuto(null)
    autoSteps.current = 0
    if (autoTimer.current) {
      clearTimeout(autoTimer.current)
      autoTimer.current = null
    }
  }

  useEffect(() => {
    if (!auto) return
    // Не наш ход — цепочке нечего делать. Иначе она осталась бы включённой,
    // а кнопка — нажатой и бесполезной до конца партии.
    if (!myTurn) { stopAuto(); return }
    // Вопрос ждёт ответа игрока — цепочка продолжится сама, как только он
    // ответит: прерывать её значило бы заставить начинать заново.
    if (v.pendingChoice) return
    // Шаг уже запланирован. Проверка обязательна: эффект выполняется после
    // КАЖДОЙ перерисовки, а их во время хода десятки — снимок от бота, ответ
    // сервера, любое движение мыши по карте. Раньше каждая из них отменяла
    // отложенный шаг и ставила новый, и при частых перерисовках очередь не
    // двигалась вовсе: кнопка выглядела нажатой и не делала ничего.
    if (autoTimer.current) return
    const next = nextAuto(auto)
    if (!next || autoSteps.current > 40) {
      setAuto(null)
      autoSteps.current = 0
      return
    }
    autoSteps.current += 1
    // Пауза не для красоты: без неё десяток свойств срабатывает в один кадр,
    // звуки сливаются в кашу, а журнал прокручивается быстрее, чем читается.
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null
      onAction(next)
    }, 140)
  })

  useEffect(() => () => {
    if (autoTimer.current) clearTimeout(autoTimer.current)
  }, [])

  if (passScreen) {
    return (
      <div className="menu">
        <div className="menu__inner" style={{ textAlign: 'center' }}>
          <p className="eyebrow">{UI.passEyebrow}</p>
          <h1 className="menu__title"><span>{meName}</span></h1>
          <p className="menu__sub" style={{ margin: '0 auto 24px' }}>
            {UI.passHint}
          </p>
          <button type="button" className="btn btn--primary" onClick={onPassAcknowledged}>
            {UI.ready}
          </button>
        </div>
      </div>
    )
  }

  return (
    // Полоса вкладок стоит СЛЕВА ОТ стола, а не поверх него: отступ обязан
    // появляться от любой вкладки, а не только от гамбитов с миссиями — иначе
    // технологии и герои накрывают собой карты крайней колонки.
    <div className={`table${hasRail ? ' has-rail' : ''}`}>
      {/* ── opponent ─────────────────────────────────────────────────────── */}
      <section className="band">
        <OpponentHud
        endless={v.scenario?.objective.k === 'DESTROY_TENTACLES'}
        them={v.opponent} name={themName} active={v.activePlayer !== v.viewer}>
          {idx.maxFace > 0 && (
            <button
              type="button"
              className="btn btn--danger btn--sm"
              onClick={() => onAction({ t: 'ATTACK_PLAYER', amount: idx.maxFace })}
            >
              <Icon name="combat" /> {UI.attackFor(idx.maxFace)}
            </button>
          )}
        </OpponentHud>
        {/* Зона игры складывается веером, когда карты перестают помещаться:
          * стол растёт до шести-семи карт, а полоса шире не становится. */}
        <div className="play">
        {foeBases.length > 0 && (
          <FanRow axis="y" className="play__bases">
            {foeBases.map((c) => (
              <div key={c.iid} className="zone">
                <Card
                  def={c.copiedDef ?? c.def}
                  iid={c.iid}
                  playable={idx.attack.has(c.iid)}
                  onClick={idx.attack.has(c.iid)
                    ? () => onAction({ t: 'ATTACK_BASE', base: c.iid as CardIid })
                    : undefined}
                  title={idx.attack.has(c.iid)
                    ? UI.destroyTitle(nameOf(c.def), cardDef(c.def).defense ?? 0)
                    : nameOf(c.def)}
                />
                {idx.attack.has(c.iid) && (
                  <span className="eyebrow" style={{ color: 'var(--combat)' }}>
                    {UI.destroyFor(cardDef(c.def).defense ?? 0)}
                  </span>
                )}
              </div>
            ))}
          </FanRow>
        )}
        <FanRow className="row--scroll play__ships" style={{ '--row-gap-top': '8px' } as React.CSSProperties}>
          {v.opponent.inPlay.length === 0 && (
            <span className="eyebrow" style={{ padding: '8px 2px' }}>{UI.nothingInPlay}</span>
          )}
          {foeShips.map((c) => (
            <div key={c.iid} className="zone">
              <Card
                def={c.copiedDef ?? c.def}
                iid={c.iid}
                playable={idx.attack.has(c.iid)}
                onClick={idx.attack.has(c.iid)
                  ? () => onAction({ t: 'ATTACK_BASE', base: c.iid as CardIid })
                  : undefined}
                title={idx.attack.has(c.iid)
                  ? UI.destroyTitle(nameOf(c.def), cardDef(c.def).defense ?? 0)
                  : nameOf(c.def)}
              />
              {idx.attack.has(c.iid) && (
                <span className="eyebrow" style={{ color: 'var(--combat)' }}>
                  {UI.destroyFor(cardDef(c.def).defense ?? 0)}
                </span>
              )}
            </div>
          ))}
        </FanRow>
        </div>
      </section>

      {/* ── the market ───────────────────────────────────────────────────── */}
      {v.scenario && (
        <div className="objective">
          <span className="objective__label">{UI.objectiveLabel}</span>
          <span className="objective__text">{objectiveRu(v.scenario.objective)}</span>
          {(() => {
            const p = objectiveProgressRu(
              v.scenario.objective, v.turn,
              v.basesDestroyed[v.scenario.hero], v.me.authority,
            )
            return p ? <span className="objective__progress">{p}</span> : null
          })()}
        </div>
      )}

      {v.boss && (
        <div className="bossbar">
          <span className="bossbar__name">{CHALLENGE_RU[v.boss.id].name}</span>

          {v.boss.id === 'automatons' && (
            <span className="bossbar__stat">
              {UI.assimilation}: <b>{v.boss.assimilation}</b>
            </span>
          )}
          {v.boss.id === 'nemesis-beast' && (
            <span className="bossbar__stat">
              {UI.facedown}: <b>{v.boss.facedown.length}</b>
            </span>
          )}
          {v.boss.id === 'dimensional-horror' && (
            <span className="tentacles">
              {TENTACLE_FACTIONS.map((f: Faction) => {
                const pile = v.boss!.tentacles[f]
                return (
                  <span
                    key={f}
                    className={`tentacle${pile.length === 0 ? ' is-dead' : ''}`}
                    style={{ '--fc': FACTION_VAR[f] } as React.CSSProperties}
                  >
                    <span className="tentacle__label">{TENTACLE_RU[f]}</span>
                    {pile.length === 0 && <span className="tentacle__n">—</span>}
                    {/* One button per card: each is shot off for its own cost. */}
                    {pile.map((c) => {
                      const cost = cardDef(c.def).cost
                      const can = idx.tentacleCards.has(c.iid)
                      return (
                        <button
                          key={c.iid}
                          type="button"
                          className={`tcard${can ? ' is-open' : ''}`}
                          disabled={!can}
                          title={`${nameOf(c.def)} — ${UI.attackTentacle} (${cost})`}
                          onClick={() => onAction({
                            t: 'ATTACK_TENTACLE', faction: f, card: c.iid as CardIid,
                          })}
                        >
                          {cost}
                        </button>
                      )
                    })}
                  </span>
                )
              })}
            </span>
          )}

          {!v.boss.mulliganUsed && (
            <button
              type="button"
              className="btn btn--sm bossbar__mull"
              onClick={() => onAction({ t: 'MULLIGAN_ROW' })}
              disabled={!idx.canMulligan}
              title={UI.mulliganHint}
            >
              {UI.mulliganRow}
            </button>
          )}
        </div>
      )}

      <section className="band band--market">
        <div className="zone__head">
          <span className="eyebrow">{UI.tradeRow}</span>
          <span className="eyebrow" style={{ color: 'var(--ink-faint)' }}>
            {UI.inTradeDeck(v.tradeDeckCount)}
          </span>
        </div>
        <div className="row row--scroll" style={{ '--row-gap-top': '8px' } as React.CSSProperties}>
          {v.tradeRow.map((c, i) =>
            c ? (
              <Card
                key={c.iid}
                def={c.def}
                iid={c.iid}
                playable={idx.buy.has(c.iid)}
                dimmed={!idx.buy.has(c.iid) && myTurn}
                onClick={idx.buy.has(c.iid)
                  ? () => onAction({ t: 'BUY_CARD', card: c.iid as CardIid })
                  : undefined}
                cost={priceOf(c.def, c.iid)}
                title={idx.buy.has(c.iid)
                  ? UI.buyFor(nameOf(c.def), priceOf(c.def, c.iid))
                  : UI.costs(nameOf(c.def), priceOf(c.def, c.iid))}
              />
            ) : (
              <div key={`empty-${i}`} className="empty-slot" />
            ),
          )}
          <div className="zone">
            <Card
              def={EXPLORER}
              playable={idx.buyExplorer}
              dimmed={!idx.buyExplorer && myTurn}
              onClick={idx.buyExplorer ? () => onAction({ t: 'BUY_EXPLORER' }) : undefined}
              title={UI.explorerTitle}
            />
            <span className="eyebrow">{UI.explorersLeft(v.explorerPile)}</span>
          </div>
          {/* Patience Rewarded's set-aside cards buy exactly like row cards, so
            * they sit beside the row rather than in a panel of their own -- a
            * buyable card the player cannot see is worse than no card. */}
          {v.setAside.length > 0 && (
            <div className="zone">
              {v.setAside.map((c) => (
                <Card
                  key={c.iid}
                  def={c.def}
                  playable={idx.buy.has(c.iid)}
                  dimmed={!idx.buy.has(c.iid) && myTurn}
                  onClick={idx.buy.has(c.iid)
                    ? () => onAction({ t: 'BUY_CARD', card: c.iid as CardIid })
                    : undefined}
                  cost={priceOf(c.def, c.iid)}
                  title={UI.setAsideTitle(nameOf(c.def))}
                />
              ))}
              <span className="eyebrow">{UI.setAside}</span>
            </div>
          )}
        </div>
      </section>

      {/* ── gambits and missions, docked to the left edge ────────────────── */}
      {hasRail && (
        <SideRail>
          {hasGambits && (
            <SidePlate
              label={UI.gambitsName}
              count={v.me.gambits.length + v.me.gambitsInPlay.length}
              alert={v.me.gambits.some((c) => idx.revealGambit.has(c.iid))}
            >
              {v.me.gambits.map((c) => (
                <div key={c.iid} className="zone">
                  <Card
                    def={c.def}
                    playable={idx.revealGambit.has(c.iid)}
                    dimmed={!idx.revealGambit.has(c.iid) && myTurn}
                    onClick={idx.revealGambit.has(c.iid)
                      ? () => onAction({ t: 'REVEAL_GAMBIT', card: c.iid as CardIid })
                      : undefined}
                    title={UI.revealGambit(nameOf(c.def))}
                  />
                  <span className="eyebrow">{UI.gambitFaceDown}</span>
                </div>
              ))}
              {revealedGambits.map((c) => (
                <div key={c.iid} className="zone">
                  <Card def={c.def} iid={c.iid} title={nameOf(c.def)} />
                  {slotButtons(c.iid)}
                  <span className="eyebrow">{UI.gambitRevealed}</span>
                </div>
              ))}
            </SidePlate>
          )}

          {hasVariant && (
            <SidePlate
              label={UI.variantName}
              count={scenarioCards.length}
              alert={scenarioCards.some((c) => (idx.activate.get(c.iid)?.size ?? 0) > 0)}
            >
              {scenarioCards.map((c) => (
                <div key={c.iid} className="zone">
                  <Card def={c.def} iid={c.iid} title={nameOf(c.def)} />
                  {slotButtons(c.iid)}
                </div>
              ))}
            </SidePlate>
          )}

          {hasMissions && (
            <SidePlate
              label={UI.missionsName}
              count={v.me.missions.length}
              alert={v.me.missions.some((c) => idx.claimMission.has(c.iid))}
            >
              {v.me.missions.map((c) => (
                <div key={c.iid} className="zone">
                  <Card
                    def={c.def}
                    playable={idx.claimMission.has(c.iid)}
                    dimmed={!idx.claimMission.has(c.iid) && myTurn}
                    onClick={idx.claimMission.has(c.iid)
                      ? () => onAction({ t: 'CLAIM_MISSION', card: c.iid as CardIid })
                      : undefined}
                    title={idx.claimMission.has(c.iid)
                      ? UI.claimMission(nameOf(c.def))
                      : UI.missionPending(nameOf(c.def))}
                  />
                  <span className="eyebrow">{UI.missionOpen}</span>
                </div>
              ))}
              {/* Completed missions are the win track, so the count is the point. */}
              {v.me.missionsDone.length > 0 && (
                <div className="zone">
                  <span className="eyebrow">
                    {UI.missionsDone(v.me.missionsDone.length,
                      v.me.missionsDone.length + v.me.missions.length)}
                  </span>
                </div>
              )}
            </SidePlate>
          )}
          {/* Технологии. Свойство у них включается кнопкой каждый ход, поэтому
            * внутри плашки они рисуются так же, как карты на столе, а точка на
            * вкладке горит, пока есть что применить. */}
          {hasTech && (
            <SidePlate
              label={UI.techName}
              count={myTech.length}
              alert={myTech.some((c) => (idx.activate.get(c.iid)?.size ?? 0) > 0)}
            >
              {myTech.map(myInPlayCard)}
            </SidePlate>
          )}

          {/* Герои. Свойство у героя одно и оно же его конец: нажали утиль —
            * карта ушла. Поэтому точка на вкладке горит ровно до тех пор, пока
            * герой не потрачен. */}
          {hasHeroes && (
            <SidePlate
              label={UI.heroesName}
              count={myHeroes.length}
              alert={myHeroes.some((c) => (idx.activate.get(c.iid)?.size ?? 0) > 0)}
            >
              {myHeroes.map(myInPlayCard)}
            </SidePlate>
          )}

          {/* Командир. Ничего не делает и никуда не ходит — он задаёт размер
            * руки и стартовый авторитет, — но до сих пор его нельзя было
            * увидеть вовсе: карта лежала только в состоянии партии. */}
          {hasCommander && v.me.commander && (
            <SidePlate label={UI.commanderName} count={1} alert={false}>
              <div className="zone">
                <Card def={v.me.commander} title={nameOf(v.me.commander)} />
                <span className="eyebrow">
                  {UI.commanderStats(
                    cardDef(v.me.commander).commander?.handSize ?? 5,
                    cardDef(v.me.commander).commander?.authority ?? 50,
                  )}
                </span>
              </div>
              {/* Чужой командир тоже публичен: его размер руки объясняет, почему
                * соперник добирает не пять карт. */}
              {v.opponent.commander && (
                <div className="zone">
                  <Card def={v.opponent.commander} title={nameOf(v.opponent.commander)} />
                  <span className="eyebrow">{UI.commanderTheirs(themName)}</span>
                </div>
              )}
            </SidePlate>
          )}

        </SideRail>
      )}

      {/* ── my board ─────────────────────────────────────────────────────── */}
      <section className="band band--board">
        {/* clip с полем, а не auto: зона по-прежнему не растит полосу, но
          * поднятой карте оставлено место выйти за край — иначе её срезало
          * ровно на те несколько пикселей, на которые она выросла. */}
        <div className="zone zone--play">
          <div className="zone__head">
            <span className="eyebrow">{UI.inPlay}</span>
            {/* Пакетные кнопки появляются только когда есть что применять:
              * кнопка, которая всегда есть и обычно ничего не делает, читается
              * как сломанная. */}
            {(nextAuto('all') || auto === 'all') && (
              <button
                type="button"
                className={`btn btn--sm${auto === 'all' ? ' btn--primary' : ''}`}
                title={UI.applyAllHint}
                // Пока цепочка идёт, кнопка её останавливает, а не отключается:
                // мёртвая кнопка неотличима от сломанной, а прервать очередь
                // после первой же неожиданности хочется чаще, чем кажется.
                onClick={() => (auto ? stopAuto() : startAuto('all'))}
              >
                {auto === 'all' ? UI.applyStop : UI.applyAll}
              </button>
            )}
            {(nextAuto('ally') || auto === 'ally') && (
              <button
                type="button"
                className={`btn btn--sm${auto === 'ally' ? ' btn--primary' : ''}`}
                title={UI.applyAlliesHint}
                onClick={() => (auto ? stopAuto() : startAuto('ally'))}
              >
                {auto === 'ally' ? UI.applyStop : UI.applyAllies}
              </button>
            )}
          </div>
          <div className="play">
            {myBases.length > 0 && (
              <FanRow axis="y" className="play__bases">
                {myBases.map(myInPlayCard)}
              </FanRow>
            )}
            <FanRow className="row--scroll play__ships">
              {v.me.inPlay.length === 0 && (
                <span className="eyebrow" style={{ padding: '8px 2px' }}>{UI.nothingInPlay}</span>
              )}
              {myShips.map(myInPlayCard)}
            </FanRow>
          </div>
        </div>
      </section>

      {/* ── my hand ──────────────────────────────────────────────────────── */}
      {v.coop && v.allies.length > 0 && (
        <AllyStrip
          allies={v.allies}
          names={seatNames}
          myTrade={v.me.trade}
          myCombat={v.me.combat}
          canTransfer={myTurn && v.coop.mode !== 'individual' && !v.pendingChoice}
          eliminated={v.coop.eliminated}
          onTransfer={(to, what, n) => onAction({ t: 'TRANSFER', to, what, n })}
        />
      )}

      <section className="band band--hand">
        <SelfHud
          me={v.me}
          name={meName}
          active={v.activePlayer === v.viewer}
          shielded={false}
        >
          <div className="actions" style={{ marginLeft: 'auto' }}>
            {idx.playAll && (
              <button type="button" className="btn btn--sm" onClick={() => onAction({ t: 'PLAY_ALL' })}>
                {UI.playAllShips}
              </button>
            )}
            <button
              type="button"
              className="btn btn--primary"
              disabled={!idx.endTurn}
              onClick={() => onAction({ t: 'END_TURN' })}
            >
              {UI.endTurn}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setSettingsOpen(true)}
              aria-label={UI.openSettings}
              title={UI.openSettings}
            >
              <Icon name="settings" />
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onExit}>
              {UI.quit}
            </button>
          </div>
        </SelfHud>

        <div className="row row--scroll" style={{ '--row-gap-top': '8px' } as React.CSSProperties}>
          {v.me.hand.length === 0 && (
            <span className="eyebrow" style={{ padding: '8px 2px' }}>{UI.handEmpty}</span>
          )}
          {v.me.hand.map((c) => (
            <Card
              key={c.iid}
              def={c.def}
              iid={c.iid}
              playable={idx.play.has(c.iid)}
              dimmed={!idx.play.has(c.iid)}
              onClick={idx.play.has(c.iid)
                ? () => onAction({ t: 'PLAY_CARD', card: c.iid as CardIid })
                : undefined}
            />
          ))}
        </div>
      </section>

      {/* Журнал закрыт по умолчанию: читают его редко, а место он занимал
        * постоянно — четверть ширины у зоны игры. */}
      <LogPanel log={log} />

      {/* Слой эффектов ничего не рисует в разметку: он слушает события
        * последней команды и запускает звук и вспышки по элементам стола. */}
      <FxLayer snapshot={snapshot} enabled={settings.effects} rate={rate} />

      {/* Вскрытое событие. Не часть слоя эффектов: это не вспышка, а
        * сообщение — его показывают и при выключенных эффектах, потому что
        * иначе о случившемся не узнать. */}
      <EventFlash snapshot={snapshot} />

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {v.pendingChoice && !settingsOpen && (
        <ChoiceSheet
          choice={v.pendingChoice}
          onResolve={onAction}
          viewer={v.viewer}
          seatNames={seatNames}
        />
      )}

      {v.phase === 'gameOver' && (
        <div className="overlay">
          <div className="sheet" style={{ textAlign: 'center' }}>
            <p className="eyebrow">{UI.gameOver}</p>
            <h2 className="sheet__title" style={{ fontSize: 28, margin: '6px 0 14px' }}>
              {v.coop
                ? (v.winner === v.coop.boss ? UI.bossWins : UI.teamWins)
                : v.boss
                ? (v.winner === v.scenario?.hero ? UI.challengeWon : UI.challengeLost)
                : v.scenario
                  ? (v.winner === v.scenario.hero ? UI.missionComplete : UI.missionFailed)
                  : UI.wins(seatNames[v.winner as PlayerId] ?? String(v.winner))}
            </h2>
            <button type="button" className="btn btn--primary" onClick={onExit}>
              {v.boss ? UI.toChallenges : v.scenario ? UI.toCampaign : UI.toMenu}
            </button>
          </div>
        </div>
      )}

      {botThinking && !v.pendingChoice && (
        <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 30 }}>
          <div className="banner banner--turn">{UI.botThinking}</div>
        </div>
      )}
    </div>
  )
}
