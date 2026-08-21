'use client'

import { cardDef, FACTIONS, type Faction, type PlayerId } from '@sr/engine'
import type { OpponentView, SelfView } from '@sr/engine'
import { UI } from '@/i18n/ui'
import { FACTION_VAR, FactionMark, Icon } from './Icons'

const ALLY_FACTIONS: Faction[] = FACTIONS.filter((f) => f !== 'unaligned')

function Rail({
  authority, trade, combat, shielded, endless,
}: {
  authority: number
  /** The Dimensional Horror has no authority; its pool is a placeholder. */
  endless?: boolean | undefined
  trade?: number
  combat?: number
  shielded: boolean
}): React.JSX.Element {
  return (
    <div className={`rail${shielded ? ' shielded' : ''}`}>
      <div
        className="rail__cell is-live"
        style={{ '--cell': 'var(--authority)' } as React.CSSProperties}
        title={UI.authority}
      >
        <Icon name="authority" />
        {endless ? '∞' : authority}
      </div>
      {trade !== undefined && (
        <div
          className={`rail__cell${trade > 0 ? ' is-live' : ''}`}
          style={{ '--cell': 'var(--trade)' } as React.CSSProperties}
          title={UI.trade}
        >
          <Icon name="trade" />
          {trade}
        </div>
      )}
      {combat !== undefined && (
        <div
          className={`rail__cell${combat > 0 ? ' is-live' : ''}`}
          style={{ '--cell': 'var(--combat)' } as React.CSSProperties}
          title={UI.combat}
        >
          <Icon name="combat" />
          {combat}
        </div>
      )}
    </div>
  )
}

/** Which factions have gone live this turn -- the rule players forget most often. */
function AllyPips({ unlocked }: { unlocked: readonly Faction[] }): React.JSX.Element {
  return (
    <div className="pips" title={UI.allyPips}>
      {ALLY_FACTIONS.map((f) => (
        <FactionMark
          key={f}
          faction={f}
          className={`pip${unlocked.includes(f) ? ' is-live' : ''}`}
          {...{ style: { '--pip': FACTION_VAR[f] } as React.CSSProperties }}
        />
      ))}
    </div>
  )
}

export function SelfHud({
  me, name, active, shielded, children,
}: {
  me: SelfView
  name: string
  active: boolean
  shielded: boolean
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="hud">
      <span className={`hud__name${active ? ' is-active' : ''}`}>{name}</span>
      <Rail authority={me.authority} trade={me.trade} combat={me.combat} shielded={shielded} />
      <AllyPips unlocked={me.allyUnlocked} />
      <span className="eyebrow">{UI.deckDiscard(me.deckCount, me.discard.length)}</span>
      {children}
    </div>
  )
}

export function OpponentHud({
  them, name, active, endless, children,
}: {
  them: OpponentView
  name: string
  active: boolean
  endless?: boolean | undefined
  children?: React.ReactNode
}): React.JSX.Element {
  const shielded = them.inPlay.some((c) => cardDef(c.def).type === 'outpost')
  return (
    <div className="hud">
      <span className={`hud__name${active ? ' is-active' : ''}`}>{name}</span>
      <Rail authority={them.authority} shielded={shielded} endless={endless} />
      <AllyPips unlocked={them.allyUnlocked} />
      <span className="eyebrow">
        {UI.handDeckDiscard(them.handCount, them.deckCount, them.discard.length)}
      </span>
      {shielded && (
        <span className="shield-note">
          <Icon name="outpost" />
          {UI.outpostShield}
        </span>
      )}
      {children}
    </div>
  )
}

export type { PlayerId }
