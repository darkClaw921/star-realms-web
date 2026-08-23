'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MODE_RU, PROFILE_RU as P } from '@/i18n/profile.ru'
import { avgTurns, total, winRate } from '@/profile/derive'
import { useProfile } from '@/profile/useProfile'
import type { Profile } from '@/profile/types'

/**
 * Профиль в меню.
 *
 * Здесь стоит короткая сводка, а не вся статистика: игрок открыл меню, чтобы
 * сыграть, и таблица фракций между ним и кнопкой «играть» — препятствие.
 * Развёрнутый разбор живёт на своей странице, ссылка на неё — из заголовка.
 *
 * Пока профиль грузится, место под него держится пустым блоком той же высоты:
 * подставлять нули и заменять их через миг — значит показать игроку чужой счёт,
 * пусть и на долю секунды.
 */
export function ProfileCard(): React.JSX.Element | null {
  const { state, rename } = useProfile()
  const router = useRouter()

  if (state.status === 'loading') return <div className="profile profile--ghost" aria-hidden="true" />
  // Без хранилища профиля нет вовсе: сказать об этом в меню незачем, игре это
  // не мешает. Строка о выключенном хранилище ждёт на странице статистики.
  if (state.status === 'anonymous') return null
  if (state.status === 'offline') {
    return (
      <div className="profile">
        <div className="profile__head">
          <span className="profile__name">{state.name || P.guest}</span>
        </div>
        <p className="profile__empty">{P.offline}</p>
      </div>
    )
  }

  const p = state.profile
  const t = total(p)
  const rate = winRate(t)
  const avg = avgTurns(t)

  return (
    <div className="profile">
      <div className="profile__head">
        <NameField name={p.name} onSave={rename} />
        <button type="button" className="linkish" onClick={() => router.push('/profile')}>
          {P.full}
        </button>
      </div>

      {t.games === 0 ? (
        <p className="profile__empty">{P.empty}</p>
      ) : (
        <>
          <div className="profile__stats">
            <Stat label={P.games} value={String(t.games)} />
            <Stat label={P.wins} value={String(t.wins)} tone="win" />
            <Stat label={P.losses} value={String(t.losses)} tone="loss" />
            <Stat label={P.winRate} value={rate === null ? P.noData : P.percent(rate)} />
            <Stat label={P.streak} value={streakText(p)} />
            <Stat label={P.avgTurns} value={avg === null ? P.noData : String(Math.round(avg))} />
          </div>
          <ModeStrip profile={p} />
        </>
      )}
    </div>
  )
}

/** Серия показывается по режиму, где она сейчас идёт: они не складываются. */
function streakText(p: Profile): string {
  let best = 0
  for (const t of Object.values(p.modes)) {
    if (Math.abs(t.streak) > Math.abs(best)) best = t.streak
  }
  if (best === 0) return P.noData
  return best > 0 ? `+${best}` : String(best)
}

function Stat(
  { label, value, tone }: { label: string; value: string; tone?: 'win' | 'loss' },
): React.JSX.Element {
  return (
    <div className="stat">
      <div className={`stat__value${tone ? ` stat__value--${tone}` : ''}`}>{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  )
}

/** Полоска режимов: сколько партий и какая доля побед — без чисел, полосой. */
function ModeStrip({ profile }: { profile: Profile }): React.JSX.Element | null {
  const rows = (['bot', 'online'] as const)
    .map((mode) => ({ mode, t: profile.modes[mode] }))
    .filter((r) => r.t.games > 0)
  if (rows.length === 0) return null
  return (
    <div className="profile__modes">
      {rows.map(({ mode, t }) => {
        const rate = winRate(t)
        return (
          <div key={mode} className="modebar">
            <div className="modebar__top">
              <span>{MODE_RU[mode]}</span>
              <span className="modebar__count">
                {t.wins}–{t.losses}
                {rate === null ? '' : ` · ${P.percent(rate)}`}
              </span>
            </div>
            <div className="modebar__track">
              <div
                className="modebar__fill"
                style={{ width: `${(rate ?? 0) * 100}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Имя игрока: подпись, которую правят на месте.
 *
 * Отдельной страницы настроек под одно поле нет, а имя нужно как раз там, где
 * игрок видит свой счёт. Пустое имя не сохраняется — безымянный капитан лучше
 * пустой строки на месте подписи.
 */
function NameField(
  { name, onSave }: { name: string; onSave: (name: string) => Promise<void> },
): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  if (!editing) {
    return (
      <button
        type="button"
        className="profile__name"
        title={P.rename}
        onClick={() => { setDraft(name); setEditing(true) }}
      >
        {name || P.guest}
      </button>
    )
  }

  const commit = (): void => {
    const next = draft.trim().slice(0, 24)
    setEditing(false)
    if (next && next !== name) void onSave(next)
  }

  return (
    <form
      className="profile__rename"
      onSubmit={(e) => { e.preventDefault(); commit() }}
    >
      <input
        className="profile__input"
        value={draft}
        autoFocus
        maxLength={24}
        placeholder={P.namePlaceholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
      />
      <button type="submit" className="btn btn--sm">{P.save}</button>
    </form>
  )
}
