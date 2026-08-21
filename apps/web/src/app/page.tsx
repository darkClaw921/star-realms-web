'use client'

import { useRouter } from 'next/navigation'
import { FACTION_VAR } from '@/components/Icons'
import { UI } from '@/i18n/ui'

const MODES = [
  {
    href: '/play?mode=bot&difficulty=normal',
    name: UI.modeBot,
    desc: UI.modeBotDesc,
    fc: FACTION_VAR.blob,
  },
  {
    href: '/play?mode=hotseat',
    name: UI.modeHotseat,
    desc: UI.modeHotseatDesc,
    fc: FACTION_VAR.trade_federation,
  },
  {
    href: '/campaign',
    name: UI.modeCampaign,
    desc: UI.modeCampaignDesc,
    fc: FACTION_VAR.machine_cult,
  },
  {
    href: '/online',
    name: UI.modeOnline,
    desc: UI.modeOnlineDesc,
    fc: FACTION_VAR.star_empire,
  },
] as const

export default function Menu(): React.JSX.Element {
  const router = useRouter()
  return (
    <main className="menu">
      <div className="menu__inner">
        <p className="eyebrow">{UI.eyebrow}</p>
        <h1 className="menu__title">
          <span>{UI.titleTop}</span>
          <span className="lo">{UI.titleBottom}</span>
        </h1>
        <p className="menu__sub">{UI.lede}</p>

        <div className="menu__grid">
          {MODES.map((m) => (
            <button
              key={m.href}
              type="button"
              className="mode"
              style={{ '--fc': m.fc } as React.CSSProperties}
              onClick={() => router.push(m.href)}
            >
              <div className="mode__name" style={{ color: m.fc }}>{m.name}</div>
              <div className="mode__desc">{m.desc}</div>
            </button>
          ))}
        </div>

        <p className="menu__foot">{UI.legal}</p>
      </div>
    </main>
  )
}
