'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  cardDef, RUN_LADDER, RUN_LENGTH, RUN_REPAIR, runNode, runOffer, scrappable,
  type CardDefId, type RunNode, type RunReward,
} from '@sr/engine'
import { Card } from '@/components/Card'
import { FACTION_VAR } from '@/components/Icons'
import { cardName } from '@/i18n/cards.ru'
import { RUN_KIND_RU, RUN_NODE_RU, RUN_RU } from '@/i18n/run.ru'
import { UI } from '@/i18n/ui'
import {
  abandonRun, deckTally, loadRun, runRecord, startRun, takeReward, type RunSave,
} from '@/run/state'

const KIND_COLOR: Record<string, string> = {
  battle: FACTION_VAR.trade_federation,
  elite: FACTION_VAR.star_empire,
  boss: FACTION_VAR.machine_cult,
}

const nameOf = (def: CardDefId): string => cardName(def, cardDef(def).name)

/** Лестница целиком: где игрок был, где он сейчас и что ещё впереди. */
function Ladder({ at, cleared }: { at: number; cleared: number }): React.JSX.Element {
  return (
    <ol className="ladder">
      {RUN_LADDER.map((n) => {
        const done = n.index <= cleared
        const here = n.index === at
        return (
          <li
            key={n.index}
            className={`ladder__step${done ? ' is-done' : ''}${here ? ' is-here' : ''}`}
            style={{ '--fc': KIND_COLOR[n.kind] } as React.CSSProperties}
          >
            <span className="ladder__no">{n.index}</span>
            <span className="ladder__name">{RUN_NODE_RU[n.index]?.name ?? n.index}</span>
            <span className="ladder__kind">{RUN_KIND_RU[n.kind]}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Что известно о следующем противнике. Забег не про сюрпризы, а про подготовку. */
function Briefing({ n }: { n: RunNode }): React.JSX.Element {
  const t = RUN_NODE_RU[n.index]
  return (
    <section className="run-brief" style={{ '--fc': KIND_COLOR[n.kind] } as React.CSSProperties}>
      <p className="eyebrow">{RUN_RU.nodeLabel(n.index)} · {RUN_KIND_RU[n.kind]}</p>
      <h2 className="run-brief__name">{t?.name ?? `#${n.index}`}</h2>
      <p className="run-brief__text">{t?.brief}</p>
      <dl className="run-facts">
        <div><dt>{RUN_RU.authority}</dt><dd>{n.enemyAuthority}</dd></div>
        <div>
          <dt>{RUN_RU.enemy}</dt>
          <dd>
            {n.enemyCombat || n.enemyTrade
              ? RUN_RU.enemyIncome(n.enemyCombat, n.enemyTrade)
              : RUN_RU.enemyNoIncome}
          </dd>
        </div>
        <div>
          <dt>{RUN_RU.deck}</dt>
          <dd>{n.enemyDeck ? RUN_RU.enemyDeckOwn : RUN_RU.enemyDeckPrinted}</dd>
        </div>
        {n.enemyBases.length > 0 && (
          <div>
            <dt>{RUN_RU.enemyBases}</dt>
            <dd>{n.enemyBases.map(nameOf).join(', ')}</dd>
          </div>
        )}
      </dl>
    </section>
  )
}

/** Колода забега стопками: одна карта — одна плитка со счётчиком копий. */
function DeckStrip({ save, onPick, picking }: {
  save: RunSave
  onPick?: (def: CardDefId) => void
  picking?: boolean
}): React.JSX.Element {
  const tally = useMemo(() => {
    const t = deckTally(save.carry)
    // По стоимости, потом по имени: игрок ищет глазами «что тут дешёвого и
    // ненужного», и это ровно левый край.
    return t.sort((a, b) =>
      cardDef(a.def).cost - cardDef(b.def).cost || nameOf(a.def).localeCompare(nameOf(b.def)))
  }, [save.carry])
  return (
    <div className="run-deck">
      {tally.map(({ def, n }) => (
        <div className="run-deck__slot" key={def}>
          <Card
            def={def}
            title={nameOf(def)}
            {...(onPick ? { onClick: () => onPick(def), playable: true } : {})}
          />
          {n > 1 && <span className="run-deck__n">×{n}</span>}
        </div>
      ))}
      {picking && tally.length === 0 && <p className="run-note">{RUN_RU.deckCount(0)}</p>}
    </div>
  )
}

function RewardPicker({ save, onTake }: {
  save: RunSave
  onTake: (r: RunReward) => void
}): React.JSX.Element {
  const [mode, setMode] = useState<'card' | 'scrap' | null>(null)
  const node = runNode(save.cleared)
  // Награда привязана к пройденному узлу, а не к следующему: её выдал тот бой.
  const offer = useMemo(
    () => (node ? runOffer(save.seed, node) : []),
    [save.seed, node],
  )
  const canScrap = scrappable(save.carry)

  if (mode === 'card') {
    return (
      <section className="run-reward">
        <p className="eyebrow">{RUN_RU.pickCard}</p>
        <div className="run-offer">
          {offer.map((def) => (
            <button
              key={def}
              type="button"
              className="run-offer__pick"
              onClick={() => onTake({ k: 'CARD', def })}
            >
              <Card def={def} title={nameOf(def)} cost={cardDef(def).cost} />
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--sm" onClick={() => setMode(null)}>
          {RUN_RU.back}
        </button>
      </section>
    )
  }

  if (mode === 'scrap') {
    return (
      <section className="run-reward">
        <p className="eyebrow">{RUN_RU.pickScrap}</p>
        <DeckStrip save={save} picking onPick={(def) => onTake({ k: 'SCRAP', def })} />
        <button type="button" className="btn btn--sm" onClick={() => setMode(null)}>
          {RUN_RU.back}
        </button>
      </section>
    )
  }

  return (
    <section className="run-reward">
      <p className="eyebrow">{RUN_RU.rewardTitle}</p>
      <p className="run-note">{RUN_RU.rewardLede}</p>
      <div className="run-choices">
        <button type="button" className="run-choice" onClick={() => setMode('card')}>
          <span className="run-choice__name">{RUN_RU.rewardCard}</span>
          <span className="run-choice__hint">{RUN_RU.rewardCardHint}</span>
        </button>
        <button
          type="button"
          className="run-choice"
          disabled={canScrap.length === 0}
          onClick={() => setMode('scrap')}
        >
          <span className="run-choice__name">{RUN_RU.rewardScrap}</span>
          <span className="run-choice__hint">{RUN_RU.rewardScrapHint}</span>
        </button>
        <button
          type="button"
          className="run-choice"
          onClick={() => onTake({ k: 'REPAIR', n: RUN_REPAIR })}
        >
          <span className="run-choice__name">{RUN_RU.rewardRepair(RUN_REPAIR)}</span>
          <span className="run-choice__hint">{RUN_RU.rewardRepairHint}</span>
        </button>
      </div>
    </section>
  )
}

export default function RunPage(): React.JSX.Element {
  const router = useRouter()
  // Сохранение живёт в localStorage, которого нет на сервере: первый кадр —
  // намеренно пустой, как и на экране кампании.
  const [save, setSave] = useState<RunSave | null>(null)
  const [record, setRecord] = useState(0)
  const [ready, setReady] = useState(false)
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    setSave(loadRun())
    setRecord(runRecord())
    setReady(true)
  }, [])

  const onTake = useCallback((r: RunReward) => {
    setSave((s) => (s ? takeReward(s, r) : s))
  }, [])

  if (!ready) return <main className="menu"><p className="eyebrow">{UI.loading}</p></main>

  const node = save && save.index <= RUN_LENGTH ? runNode(save.index) : null

  return (
    <main className="menu">
      <div className="menu__inner menu__inner--wide">
        <p className="eyebrow">{RUN_RU.eyebrow}</p>
        <h1 className="menu__title">
          <span>{RUN_RU.titleTop}</span>
          <span className="lo">{RUN_RU.titleBottom}</span>
        </h1>
        <p className="menu__sub">{RUN_RU.lede}</p>

        {!save && (
          <div className="run-start">
            <p className="run-note">
              {RUN_RU.record}: {record > 0 ? `${record} / ${RUN_LENGTH}` : RUN_RU.recordNone}
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => setSave(startRun())}
            >
              {RUN_RU.start}
            </button>
          </div>
        )}

        {save && (
          <>
            <div className="run-bar">
              <span className="run-bar__stat">
                {RUN_RU.authority}<b>{save.carry.authority}</b>
              </span>
              <span className="run-bar__stat">
                {RUN_RU.deck}<b>{save.carry.deck.length}</b>
              </span>
              <span className="run-bar__stat">
                {RUN_RU.cleared}<b>{save.cleared} / {RUN_LENGTH}</b>
              </span>
              <span className="run-bar__stat">
                {RUN_RU.record}<b>{record > 0 ? record : '—'}</b>
              </span>
            </div>

            <Ladder at={save.stage === 'reward' ? save.index + 1 : save.index} cleared={save.cleared} />

            {save.stage === 'reward' && <RewardPicker save={save} onTake={onTake} />}

            {save.stage === 'fight' && node && (
              <>
                <Briefing n={node} />
                <div className="run-start">
                  <button type="button" className="btn" onClick={() => router.push('/play?mode=run')}>
                    {RUN_RU.fight}
                  </button>
                </div>
              </>
            )}

            {(save.stage === 'won' || save.stage === 'lost') && (
              <section className="run-over">
                <h2 className="run-brief__name">
                  {save.stage === 'won' ? RUN_RU.wonTitle : RUN_RU.lostTitle}
                </h2>
                <p className="run-note">
                  {save.stage === 'won' ? RUN_RU.wonLede : RUN_RU.lostLede(save.cleared)}
                </p>
                <button type="button" className="btn" onClick={() => setSave(startRun())}>
                  {RUN_RU.again}
                </button>
              </section>
            )}

            {save.carry.bases.length > 0 && save.stage !== 'lost' && (
              <section className="run-section">
                <p className="eyebrow">{RUN_RU.bases}</p>
                <p className="run-note">{RUN_RU.basesHint}</p>
                <div className="run-deck">
                  {save.carry.bases.map((def, i) => (
                    <div className="run-deck__slot" key={`${def}-${i}`}>
                      <Card def={def} title={nameOf(def)} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="run-section">
              <p className="eyebrow">{RUN_RU.deck} · {RUN_RU.deckCount(save.carry.deck.length)}</p>
              <DeckStrip save={save} />
            </section>
          </>
        )}

        <div className="camp-foot">
          <button type="button" className="btn btn--sm" onClick={() => router.push('/')}>
            {UI.back}
          </button>
          {save && save.stage !== 'lost' && save.stage !== 'won' && (
            <button
              type="button"
              className="btn btn--sm btn--danger"
              // Второе нажатие, а не окно подтверждения: браузерный confirm
              // блокирует страницу целиком, а цена ошибки здесь — весь забег.
              onClick={() => {
                if (!confirming) { setConfirming(true); return }
                abandonRun()
                setSave(null)
                setConfirming(false)
              }}
            >
              {confirming ? RUN_RU.abandonConfirm : RUN_RU.abandon}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
