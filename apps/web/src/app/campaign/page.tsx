'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CAMPAIGNS, type Campaign, type Mission } from '@sr/engine'
import { FACTION_VAR } from '@/components/Icons'
import {
  CAMPAIGN_RU, DIFFICULTY_RU, MISSION_RU, objectiveRu,
} from '@/i18n/campaign.ru'
import { UI } from '@/i18n/ui'
import {
  campaignDone, isUnlocked, loadProgress, resetProgress, type Progress,
} from '@/campaign/progress'

const CAMPAIGN_COLOR: Record<string, string> = {
  frontier: FACTION_VAR.trade_federation,
  hive: FACTION_VAR.blob,
  foundry: FACTION_VAR.machine_cult,
}

function MissionRow({ m, open, beaten, onPlay }: {
  m: Mission
  open: boolean
  beaten: boolean
  onPlay: () => void
}): React.JSX.Element {
  const t = MISSION_RU[m.id]
  return (
    <li className={`mission${open ? '' : ' is-locked'}${beaten ? ' is-beaten' : ''}`}>
      <span className="mission__no">{m.index}</span>
      <span className="mission__body">
        <span className="mission__head">
          <span className="mission__name">{t?.name ?? m.id}</span>
          <span className="mission__diff">{DIFFICULTY_RU[m.difficulty]}</span>
          {beaten && <span className="mission__done">{UI.missionBeaten}</span>}
        </span>
        <span className="mission__brief">{open ? t?.brief : UI.missionLocked}</span>
        <span className="mission__goal">{objectiveRu(m.setup.rules.objective)}</span>
      </span>
      <button
        type="button"
        className="btn btn--sm"
        onClick={onPlay}
        disabled={!open}
      >
        {beaten ? UI.missionReplay : UI.missionStart}
      </button>
    </li>
  )
}

function CampaignCard({ c, progress, onPlay }: {
  c: Campaign
  progress: Progress
  onPlay: (m: Mission) => void
}): React.JSX.Element {
  const t = CAMPAIGN_RU[c.id]
  const done = campaignDone(c.id, progress)
  return (
    <section className="camp" style={{ '--fc': CAMPAIGN_COLOR[c.id] } as React.CSSProperties}>
      <header className="camp__head">
        <div>
          <p className="eyebrow">{t.tagline}</p>
          <h2 className="camp__name">{t.name}</h2>
        </div>
        <span className="camp__count">{done} / {c.missions.length}</span>
      </header>
      <p className="camp__intro">{t.intro}</p>
      <ol className="mission-list">
        {c.missions.map((m) => (
          <MissionRow
            key={m.id}
            m={m}
            open={isUnlocked(m, progress)}
            beaten={progress[m.id] === true}
            onPlay={() => onPlay(m)}
          />
        ))}
      </ol>
    </section>
  )
}

export default function CampaignPage(): React.JSX.Element {
  const router = useRouter()
  // Progress lives in localStorage, which does not exist during the server
  // render, so the first paint is deliberately the empty state.
  const [progress, setProgress] = useState<Progress>({})
  useEffect(() => { setProgress(loadProgress()) }, [])

  return (
    <main className="menu">
      <div className="menu__inner menu__inner--wide">
        <p className="eyebrow">{UI.campaignEyebrow}</p>
        <h1 className="menu__title">
          <span>{UI.campaignTitleTop}</span>
          <span className="lo">{UI.campaignTitleBottom}</span>
        </h1>
        <p className="menu__sub">{UI.campaignLede}</p>

        <div className="camp-grid">
          {CAMPAIGNS.map((c) => (
            <CampaignCard
              key={c.id}
              c={c}
              progress={progress}
              onPlay={(m) => router.push(`/play?mode=campaign&mission=${m.id}`)}
            />
          ))}
        </div>

        <div className="camp-foot">
          <button type="button" className="btn btn--sm" onClick={() => router.push('/')}>
            {UI.back}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => { resetProgress(); setProgress({}) }}
          >
            {UI.campaignReset}
          </button>
        </div>
      </div>
    </main>
  )
}
