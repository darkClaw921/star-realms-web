'use client'

import { useRouter } from 'next/navigation'
import { cardDef, type CardDefId } from '@sr/engine'
import { FACTION_VAR } from '@/components/Icons'
import { FACTION_RU, cardName } from '@/i18n/cards.ru'
import { MODE_RU, PROFILE_RU as P, humanDate, humanDuration } from '@/i18n/profile.ru'
import {
  avgDuration, avgTurns, factionRows, playedModes, topCards, total, winRate,
} from '@/profile/derive'
import { useProfile } from '@/profile/useProfile'
import type { MatchResult, Profile } from '@/profile/types'

/**
 * Вся статистика игрока.
 *
 * Разделов четыре, и порядок в них не случайный: сначала общий счёт, потом
 * разбивка по режимам (партия с ботом и партия с человеком — разные игры),
 * затем чем игрок играл, и только в конце список последних партий. Сводка
 * отвечает на «как я играю», список — на «что было вчера», и первый вопрос
 * задают чаще.
 */
export default function ProfilePage(): React.JSX.Element {
  const { state } = useProfile()
  const router = useRouter()

  return (
    <main className="menu">
      <div className="menu__inner menu__inner--wide">
        <p className="eyebrow">{P.eyebrow}</p>
        <h1 className="menu__title menu__title--sm">{P.title}</h1>

        {state.status === 'loading' && <p className="profile__empty">{P.loading}</p>}
        {state.status === 'anonymous' && <p className="profile__empty">{P.storageOff}</p>}
        {state.status === 'offline' && <p className="profile__empty">{P.offline}</p>}
        {state.status === 'ready' && <Everything profile={state.profile} />}

        <p className="menu__foot">
          <button type="button" className="linkish" onClick={() => router.push('/')}>
            {P.back}
          </button>
        </p>
      </div>
    </main>
  )
}

function Everything({ profile }: { profile: Profile }): React.JSX.Element {
  const t = total(profile)
  if (t.games === 0) {
    return (
      <>
        <p className="profile__empty">{P.empty}</p>
        <p className="menu__foot">{P.emptyHint}</p>
      </>
    )
  }

  const rate = winRate(t)
  const avg = avgTurns(t)
  const dur = avgDuration(t)
  const factions = factionRows(profile)
  const cards = topCards(profile)

  return (
    <>
      <p className="profile__who">{profile.name || P.guest}</p>

      <div className="profile__stats profile__stats--wide">
        <Stat label={P.games} value={String(t.games)} />
        <Stat label={P.wins} value={String(t.wins)} tone="win" />
        <Stat label={P.losses} value={String(t.losses)} tone="loss" />
        <Stat label={P.winRate} value={rate === null ? P.noData : P.percent(rate)} />
        <Stat label={P.bestStreak} value={t.bestStreak > 0 ? `+${t.bestStreak}` : P.noData} />
        <Stat
          label={P.worstStreak}
          value={t.worstStreak < 0 ? String(t.worstStreak) : P.noData}
        />
        <Stat label={P.avgTurns} value={avg === null ? P.noData : String(Math.round(avg))} />
        <Stat
          label={P.fastestWin}
          value={t.fastestWin === null ? P.noData : P.turns(t.fastestWin)}
        />
        <Stat label={P.longest} value={t.longest > 0 ? P.turns(t.longest) : P.noData} />
        <Stat label={P.avgDuration} value={dur === null ? P.noData : humanDuration(dur)} />
        <Stat label={P.totalTime} value={humanDuration(t.durationMs)} />
      </div>

      <Section title={P.byMode}>
        <div className="tblwrap"><table className="tbl">
          <thead>
            <tr>
              <th>{P.colMode}</th><th>{P.colGames}</th><th>{P.colRecord}</th>
              <th>{P.colRate}</th><th>{P.colStreak}</th><th>{P.colAvgTurns}</th>
            </tr>
          </thead>
          <tbody>
            {playedModes(profile).map((mode) => {
              const m = profile.modes[mode]
              const r = winRate(m)
              const a = avgTurns(m)
              return (
                <tr key={mode}>
                  <td>{MODE_RU[mode]}</td>
                  <td>{m.games}</td>
                  <td>{m.wins}–{m.losses}</td>
                  <td>{r === null ? P.noData : P.percent(r)}</td>
                  <td>{m.streak === 0 ? P.noData : m.streak > 0 ? `+${m.streak}` : m.streak}</td>
                  <td>{a === null ? P.noData : Math.round(a)}</td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      </Section>

      {factions.length > 0 && (
        <Section title={P.factions} hint={P.factionHint}>
          <div className="tblwrap"><table className="tbl">
            <thead>
              <tr>
                <th>{P.factions}</th><th>{P.colCards}</th>
                <th>{P.colLeading}</th><th>{P.colRate}</th>
              </tr>
            </thead>
            <tbody>
              {factions.map((f) => (
                <tr key={f.faction}>
                  <td>
                    <span className="dot" style={{ background: FACTION_VAR[f.faction] }} />
                    {FACTION_RU[f.faction]}
                  </td>
                  <td>{f.cards}</td>
                  <td>{f.leading > 0 ? P.gamesN(f.leading) : P.noData}</td>
                  <td>{f.rate === null ? P.noData : P.percent(f.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Section>
      )}

      {cards.length > 0 && (
        <Section title={P.cards} hint={P.cardsHint}>
          <div className="tblwrap"><table className="tbl">
            <thead>
              <tr><th>{P.colCard}</th><th>{P.colTaken}</th><th>{P.colWinsWith}</th><th>{P.colRate}</th></tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.def}>
                  <td>{cardTitle(c.def)}</td>
                  <td>{c.taken}</td>
                  <td>{c.wins}</td>
                  <td>{c.rate === null ? P.noData : P.percent(c.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Section>
      )}

      <Section title={P.recent}>
        <div className="tblwrap"><table className="tbl">
          <thead>
            <tr>
              <th>{P.colResult}</th><th>{P.colMode}</th><th>{P.colOpponent}</th>
              <th>{P.colTurns}</th><th>{P.colScore}</th><th>{P.colWhen}</th>
            </tr>
          </thead>
          <tbody>
            {profile.recent.map((r, i) => <RecentRow key={`${r.at}-${i}`} r={r} />)}
          </tbody>
        </table></div>
      </Section>
    </>
  )
}

function RecentRow({ r }: { r: MatchResult }): React.JSX.Element {
  return (
    <tr>
      <td className={r.won ? 'is-win' : 'is-loss'}>{r.won ? P.win : P.loss}</td>
      <td>{MODE_RU[r.mode]}</td>
      <td>{r.opponent || P.noData}</td>
      <td>{r.turns}</td>
      <td className="num">{P.score(r.authority, r.foeAuthority)}</td>
      <td>{humanDate(r.at)}</td>
    </tr>
  )
}

function Section(
  { title, hint, children }: { title: string; hint?: string; children: React.ReactNode },
): React.JSX.Element {
  return (
    <section className="profile__section">
      <h2 className="profile__h2">{title}</h2>
      {hint && <p className="profile__hint">{hint}</p>}
      {children}
    </section>
  )
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

/**
 * Название карты по-русски.
 *
 * Профиль переживает наборы: карта могла прийти из набора, который потом
 * выключили или переименовали, — и тогда в таблице честнее показать её
 * идентификатор, чем уронить всю страницу статистики.
 */
function cardTitle(def: string): string {
  try {
    return cardName(def as CardDefId, cardDef(def as CardDefId).name)
  } catch {
    return def
  }
}
