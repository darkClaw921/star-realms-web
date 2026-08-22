'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  cardDef, costFor, EXPLORER, TENTACLE_FACTIONS,
  type Action, type CardIid, type Faction, type PlayerId,
} from '@sr/engine'
import { cardName } from '@/i18n/cards.ru'
import { objectiveProgressRu, objectiveRu } from '@/i18n/campaign.ru'
import { CHALLENGE_RU, TENTACLE_RU } from '@/i18n/challenges.ru'
import { UI } from '@/i18n/ui'
import type { SeatNames } from '@/match/log'
import type { MatchSnapshot } from '@/match/types'
import { FxLayer } from '@/fx/FxLayer'
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
  // «Применить всё» шлёт действия ПО ОДНОМУ и перечитывает список законных
  // после каждого: союз может открыться посреди цепочки, а свойство —
  // задать вопрос. Пакетного действия в движке нет намеренно, и придумывать
  // его ради удобства значило бы завести второй способ менять состояние.
  const [auto, setAuto] = useState<null | 'all' | 'ally'>(null)
  const autoSteps = useRef(0)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  // Карты, у которых осталось непримененное свойство, идут первыми: в
  // сложенном ряду левые видны целиком, и искать среди отработавших то, что
  // ещё ждёт нажатия, не приходится. Сортировка устойчива, поэтому порядок
  // разыгрывания внутри каждой группы сохраняется.
  const inPlayOrdered = useMemo(() => {
    const open = (iid: string): number => ((idx.activate.get(iid)?.size ?? 0) > 0 ? 0 : 1)
    return [...v.me.inPlay].sort((a, b) => open(a.iid) - open(b.iid))
  }, [v.me.inPlay, idx.activate])
  // У соперника «ждёт хода» значит другое: базу можно снести прямо сейчас.
  // Она и должна лежать слева, а не искаться в сложенном ряду.
  const foeOrdered = useMemo(
    () => [...v.opponent.inPlay].sort(
      (a, b) => Number(idx.attack.has(b.iid)) - Number(idx.attack.has(a.iid)),
    ),
    [v.opponent.inPlay, idx.attack],
  )
  const hasGambits = v.me.gambits.length > 0 || v.me.gambitsInPlay.length > 0
  const hasMissions = v.me.missions.length > 0 || v.me.missionsDone.length > 0
  const meName = seatNames[v.viewer] ?? v.viewer
  const themName = seatNames[v.opponentSeat] ?? UI.opponent

  // Утилизация и сплинтер уничтожают карту, поэтому в пакет не входят: их
  // выбирают поимённо, а не «применить всё».
  const AUTO_SLOTS: readonly string[] = ['primary', 'ally', 'ally2', 'ally3', 'ally4', 'doubleAlly']
  const autoFits = (slot: string, mode: 'all' | 'ally'): boolean =>
    mode === 'all' ? AUTO_SLOTS.includes(slot) : AUTO_SLOTS.includes(slot) && slot !== 'primary'
  const nextAuto = (mode: 'all' | 'ally'): Action | undefined =>
    legal.find((a) => a.t === 'ACTIVATE' && autoFits(a.slot, mode))

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
    <div className={`table${hasGambits || hasMissions ? ' has-rail' : ''}`}>
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
        <FanRow className="row--scroll" style={{ '--row-gap-top': '8px' } as React.CSSProperties}>
          {v.opponent.inPlay.length === 0 && (
            <span className="eyebrow" style={{ padding: '8px 2px' }}>{UI.nothingInPlay}</span>
          )}
          {foeOrdered.map((c) => (
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
                cost={costFor(cardDef(c.def), v.me.inPlay)}
                title={idx.buy.has(c.iid)
                  ? UI.buyFor(nameOf(c.def), costFor(cardDef(c.def), v.me.inPlay))
                  : UI.costs(nameOf(c.def), costFor(cardDef(c.def), v.me.inPlay))}
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
                  cost={costFor(cardDef(c.def), v.me.inPlay)}
                  title={UI.setAsideTitle(nameOf(c.def))}
                />
              ))}
              <span className="eyebrow">{UI.setAside}</span>
            </div>
          )}
        </div>
      </section>

      {/* ── gambits and missions, docked to the left edge ────────────────── */}
      {(hasGambits || hasMissions) && (
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
              {v.me.gambitsInPlay.map((c) => (
                <div key={c.iid} className="zone">
                  <Card def={c.def} title={nameOf(c.def)} />
                  <span className="eyebrow">{UI.gambitRevealed}</span>
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
        </SideRail>
      )}

      {/* ── my board ─────────────────────────────────────────────────────── */}
      <section className="band band--board">
        <div className="zone" style={{ minHeight: 0, overflow: 'auto' }}>
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
          <FanRow className="row--scroll">
            {v.me.inPlay.length === 0 && (
              <span className="eyebrow" style={{ padding: '8px 2px' }}>{UI.nothingInPlay}</span>
            )}
            {inPlayOrdered.map((c) => {
              const slots = idx.activate.get(c.iid)
              return (
                <div key={c.iid} className="zone">
                  <Card def={c.copiedDef ?? c.def} iid={c.iid} title={nameOf(c.def)} />
                  {slots && slots.size > 0 && (
                    <div className="actions">
                      {(['primary', 'ally', 'ally2', 'ally3', 'ally4', 'doubleAlly', 'scrap', 'splinter'] as const)
                        .filter((s) => slots.has(s)).map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={`btn btn--sm${s === 'scrap' ? ' btn--danger' : ''}`}
                          onClick={() => onAction({ t: 'ACTIVATE', card: c.iid as CardIid, slot: s })}
                        >
                          {SLOT_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </FanRow>
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
      <FxLayer snapshot={snapshot} enabled={settings.effects} />

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {v.pendingChoice && !settingsOpen && (
        <ChoiceSheet choice={v.pendingChoice} onResolve={onAction} />
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
