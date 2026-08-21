'use client'

import { useMemo, useState } from 'react'
import {
  cardDef, costFor, EXPLORER, TENTACLE_FACTIONS,
  type Action, type CardIid, type Faction, type PlayerId,
} from '@sr/engine'
import { cardName } from '@/i18n/cards.ru'
import { objectiveProgressRu, objectiveRu } from '@/i18n/campaign.ru'
import { CHALLENGE_RU, TENTACLE_RU } from '@/i18n/challenges.ru'
import { UI } from '@/i18n/ui'
import type { MatchSnapshot } from '@/match/types'
import { Card } from './Card'
import { ChoiceSheet } from './ChoiceSheet'
import { SettingsPanel } from './SettingsPanel'
import { OpponentHud, SelfHud } from './Hud'
import { FACTION_VAR, Icon } from './Icons'

const SLOT_LABEL: Record<
  'primary' | 'ally' | 'ally2' | 'ally3' | 'ally4' | 'doubleAlly' | 'scrap', string
> = {
  primary: UI.slotPrimary, ally: UI.slotAlly,
  ally2: UI.slotAlly2, ally3: UI.slotAlly3, ally4: UI.slotAlly4,
  doubleAlly: UI.slotDoubleAlly, scrap: UI.slotScrap,
}

/** Localised card name, falling back to the engine's English. */
const nameOf = (def: Parameters<typeof cardDef>[0]): string => cardName(def, cardDef(def).name)

export interface BoardProps {
  snapshot: MatchSnapshot
  seatNames: Record<PlayerId, string>
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
      canMulligan, tentacleCards,
    }
  }, [legal])

  const myTurn = v.actor === v.viewer && v.phase === 'main'
  const meName = seatNames[v.viewer]
  const themName = seatNames[v.viewer === 'p1' ? 'p2' : 'p1']

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
    <div className="table">
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
        <div className="row row--scroll" style={{ '--row-gap-top': '8px' } as React.CSSProperties}>
          {v.opponent.inPlay.length === 0 && (
            <span className="eyebrow" style={{ padding: '8px 2px' }}>{UI.nothingInPlay}</span>
          )}
          {v.opponent.inPlay.map((c) => (
            <div key={c.iid} className="zone">
              <Card
                def={c.copiedDef ?? c.def}
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
        </div>
      </section>

      {/* ── my board ─────────────────────────────────────────────────────── */}
      <section className="band band--board">
        <div className="zone" style={{ minHeight: 0, overflow: 'auto' }}>
          <span className="eyebrow">{UI.inPlay}</span>
          <div className="row row--scroll">
            {v.me.inPlay.length === 0 && (
              <span className="eyebrow" style={{ padding: '8px 2px' }}>{UI.nothingInPlay}</span>
            )}
            {v.me.inPlay.map((c) => {
              const slots = idx.activate.get(c.iid)
              return (
                <div key={c.iid} className="zone">
                  <Card def={c.copiedDef ?? c.def} title={nameOf(c.def)} />
                  {slots && slots.size > 0 && (
                    <div className="actions">
                      {(['primary', 'ally', 'ally2', 'ally3', 'ally4', 'doubleAlly', 'scrap'] as const)
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
          </div>
        </div>
        <div className="zone" style={{ minHeight: 0 }}>
          <span className="eyebrow">{UI.log}</span>
          <div className="log">
            {[...log].reverse().map((l) => (
              <div key={l.id} className="log__line">
                {l.emphasis ? <b>{l.text}</b> : l.text}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── my hand ──────────────────────────────────────────────────────── */}
      <section className="band">
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
              playable={idx.play.has(c.iid)}
              dimmed={!idx.play.has(c.iid)}
              onClick={idx.play.has(c.iid)
                ? () => onAction({ t: 'PLAY_CARD', card: c.iid as CardIid })
                : undefined}
            />
          ))}
        </div>
      </section>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {v.pendingChoice && !settingsOpen && (
        <ChoiceSheet choice={v.pendingChoice} onResolve={onAction} />
      )}

      {v.phase === 'gameOver' && (
        <div className="overlay">
          <div className="sheet" style={{ textAlign: 'center' }}>
            <p className="eyebrow">{UI.gameOver}</p>
            <h2 className="sheet__title" style={{ fontSize: 28, margin: '6px 0 14px' }}>
              {v.boss
                ? (v.winner === v.scenario?.hero ? UI.challengeWon : UI.challengeLost)
                : v.scenario
                  ? (v.winner === v.scenario.hero ? UI.missionComplete : UI.missionFailed)
                  : UI.wins(seatNames[v.winner as PlayerId])}
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
