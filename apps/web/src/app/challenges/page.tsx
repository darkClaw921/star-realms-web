'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CHALLENGES, MAX_PLAYERS, TEAM_MODE, type BossId, type ChallengeLevel } from '@sr/engine'
import { FACTION_VAR } from '@/components/Icons'
import { CHALLENGE_RU, LEVEL_RU } from '@/i18n/challenges.ru'
import { UI } from '@/i18n/ui'
import { beatenChallenges, resetChallenges } from '@/campaign/progress'

const LEVELS: readonly ChallengeLevel[] = ['beginner', 'intermediate', 'veteran', 'expert']

/** Which of the rulebook's three team rules a challenge is printed with. */
const TEAM_RU: Record<string, string> = {
  hydra: UI.coopHydra,
  pooled: UI.coopPooled,
  individual: UI.coopIndividual,
}

/** Each boss gets the colour of the faction it fights with, or its own tone. */
const BOSS_COLOR: Record<BossId, string> = {
  automatons: FACTION_VAR.unaligned,
  'blob-assault': FACTION_VAR.blob,
  'dimensional-horror': 'var(--authority)',
  'madness-of-the-machine': FACTION_VAR.machine_cult,
  'nemesis-beast': FACTION_VAR.blob,
  'pirates-of-the-dark-star': FACTION_VAR.unaligned,
  'defy-the-empire': FACTION_VAR.star_empire,
  'cost-of-freedom': FACTION_VAR.trade_federation,
}

export default function ChallengesPage(): React.JSX.Element {
  const router = useRouter()
  const [level, setLevel] = useState<ChallengeLevel>('veteran')
  const [beaten, setBeaten] = useState<Readonly<Record<string, true>>>({})
  // How many people are playing. One is the solo game this page has always
  // dealt; more opens a table online, because the whole board is dealt from the
  // player count and the seats cannot be filled in afterwards.
  const [players, setPlayers] = useState(1)
  useEffect(() => { setBeaten(beatenChallenges()) }, [])

  return (
    <main className="menu">
      <div className="menu__inner menu__inner--wide">
        <p className="eyebrow">{UI.challengesEyebrow}</p>
        <h1 className="menu__title">
          <span>{UI.challengesTitleTop}</span>
          <span className="lo">{UI.challengesTitleBottom}</span>
        </h1>
        <p className="menu__sub">{UI.challengesLede}</p>

        <div className="levels" role="group" aria-label={UI.difficultyLabel}>
          <span className="eyebrow">{UI.difficultyLabel}</span>
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              className={`btn btn--sm${l === level ? ' btn--primary' : ''}`}
              onClick={() => setLevel(l)}
              aria-pressed={l === level}
              title={LEVEL_RU[l].desc}
            >
              {LEVEL_RU[l].name}
            </button>
          ))}
          <span className="levels__hint">{LEVEL_RU[level].desc}</span>
        </div>

        <div className="levels" role="group" aria-label={UI.players}>
          <span className="eyebrow">{UI.players}</span>
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              className={`btn btn--sm${n === players ? ' btn--primary' : ''}`}
              onClick={() => setPlayers(n)}
              aria-pressed={n === players}
            >
              {n}
            </button>
          ))}
          <span className="levels__hint">
            {players === 1 ? UI.soloHint : UI.coopSub}
          </span>
        </div>

        <div className="boss-grid">
          {CHALLENGES.map((c) => {
            const t = CHALLENGE_RU[c.id]
            return (
              <section
                key={c.id}
                className={`boss${beaten[c.id] ? ' is-beaten' : ''}`}
                style={{ '--fc': BOSS_COLOR[c.id] } as React.CSSProperties}
              >
                <header className="boss__head">
                  <h2 className="boss__name">{t.name}</h2>
                  {beaten[c.id] && <span className="boss__done">{UI.missionBeaten}</span>}
                </header>

                <p className="boss__story">{t.story}</p>
                <p className="boss__rules">{t.howItWorks}</p>

                <dl className="boss__stats">
                  <div>
                    <dt>{UI.bossAuthority}</dt>
                    <dd>{c.id === 'dimensional-horror' ? UI.tentaclesInstead : c.bossAuthority}</dd>
                  </div>
                  <div>
                    <dt>{UI.yourAuthority}</dt>
                    <dd>{c.playerAuthority}</dd>
                  </div>
                </dl>

                {t.ours && <p className="boss__ours"><span>{UI.ourReconstruction}</span> {t.ours}</p>}

                {players > 1 && (
                  <p className="boss__rules">
                    <b>{TEAM_RU[TEAM_MODE[c.id]]}</b>
                    {players > MAX_PLAYERS[c.id] && ` — ${UI.capAt(MAX_PLAYERS[c.id])}`}
                  </p>
                )}

                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => router.push(players > 1
                    ? `/online?coop=${c.id}&level=${level}&players=${Math.min(players, MAX_PLAYERS[c.id])}`
                    : `/play?mode=challenge&boss=${c.id}&level=${level}`)}
                >
                  {players > 1 ? UI.gatherTeam : UI.missionStart}
                </button>
              </section>
            )
          })}
        </div>

        <p className="menu__foot">{UI.challengesSource}</p>

        <div className="camp-foot">
          <button type="button" className="btn btn--sm" onClick={() => router.push('/')}>
            {UI.back}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => { resetChallenges(); setBeaten({}) }}
          >
            {UI.campaignReset}
          </button>
        </div>
      </div>
    </main>
  )
}
