'use client'

import { cardDef, FACTIONS, type Faction, type PlayerId } from '@sr/engine'
import type { OpponentView, SelfView } from '@sr/engine'
import { UI } from '@/i18n/ui'
import { FACTION_VAR, FactionMark, Icon } from './Icons'

const ALLY_FACTIONS: Faction[] = FACTIONS.filter((f) => f !== 'unaligned')

function Rail({
  authority, trade, combat, shielded, endless, fx,
}: {
  authority: number
  /**
   * Чьи это счётчики — «me» или «them». Слой эффектов ищет ячейки по этому
   * признаку: тряска и осколки должны появиться у того, кто получил урон.
   */
  fx?: 'me' | 'them' | undefined
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
        {...(fx ? { 'data-fx': `authority:${fx}` } : {})}
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
          {...(fx ? { 'data-fx': `combat:${fx}` } : {})}
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
      <Rail
        authority={me.authority} trade={me.trade} combat={me.combat}
        shielded={shielded} fx="me"
      />
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
      <Rail authority={them.authority} shielded={shielded} endless={endless} fx="them" />
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

/**
 * The teammates at a co-op table.
 *
 * Shown exactly as an opponent is -- authority, counts, what is on the table --
 * because that is all the engine will tell you about another seat. The rulebook
 * lets teammates talk and look at each other's hands across the table; a hand
 * sent down the wire would be a hand leak, so the talking stays out of band.
 *
 * The two buttons are the Hydra pooling rule: "Players may, as many times as
 * they like each turn, transfer any amount of their Trade and/or Combat to a
 * teammate's pool." They hand over the whole pool, which is what the rule is
 * almost always used for -- ganging up on one expensive card or one big base.
 */
export function AllyStrip({
  allies, names, myTrade, myCombat, canTransfer, eliminated, onTransfer,
}: {
  allies: readonly { seat: PlayerId; view: OpponentView }[]
  names: Partial<Record<PlayerId, string>>
  myTrade: number
  myCombat: number
  canTransfer: boolean
  eliminated: readonly PlayerId[]
  onTransfer: (to: PlayerId, what: 'trade' | 'combat', n: number) => void
}): React.JSX.Element | null {
  if (allies.length === 0) return null
  return (
    <div className="allies">
      {allies.map(({ seat, view }) => {
        const out = eliminated.includes(seat)
        return (
          <div key={seat} className={`ally${out ? ' is-out' : ''}`}>
            <span className="ally__name">{names[seat] ?? seat}</span>
            <Rail
              authority={view.authority}
              trade={view.trade}
              combat={view.combat}
              shielded={view.inPlay.some((c) => cardDef(c.def).type === 'outpost')}
            />
            <span className="eyebrow">
              {UI.handDeckDiscard(view.handCount, view.deckCount, view.discard.length)}
            </span>
            {out && <span className="ally__out">{UI.eliminated}</span>}
            {!out && canTransfer && (myTrade > 0 || myCombat > 0) && (
              <span className="ally__give">
                {myTrade > 0 && (
                  <button
                    type="button" className="btn btn--sm"
                    title={UI.giveTradeHint}
                    onClick={() => onTransfer(seat, 'trade', myTrade)}
                  >
                    <Icon name="trade" /> →{myTrade}
                  </button>
                )}
                {myCombat > 0 && (
                  <button
                    type="button" className="btn btn--sm"
                    title={UI.giveCombatHint}
                    onClick={() => onTransfer(seat, 'combat', myCombat)}
                  >
                    <Icon name="combat" /> →{myCombat}
                  </button>
                )}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export type { PlayerId }
