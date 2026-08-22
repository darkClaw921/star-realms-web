'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Action, ChallengeLevel } from '@sr/engine'
import { challengeById } from '@sr/engine'
import { Board } from '@/components/Board'
import {
  RemoteMatchClient, seatNamesFor,
  type CoopIntent, type RemoteInfo, type RemoteIntent,
} from '@/match/RemoteMatchClient'
import { CHALLENGE_RU } from '@/i18n/challenges.ru'
import { UI } from '@/i18n/ui'
import type { MatchSnapshot } from '@/match/types'

type Phase = { s: 'lobby' } | { s: 'connecting' } | { s: 'playing' }

export default function OnlinePage(): React.JSX.Element {
  // useSearchParams needs a Suspense boundary; the fallback is the same shell
  // the lobby renders, so nothing flashes.
  return (
    <Suspense fallback={<main className="menu"><div className="menu__inner" /></main>}>
      <Online />
    </Suspense>
  )
}

function Online(): React.JSX.Element {
  const router = useRouter()
  const params = useSearchParams()

  /**
   * A co-op table, if the challenge screen sent us here with one.
   *
   * Read from the URL rather than from state so the link can be shared and so a
   * reload keeps the table it was opening.
   */
  const coop: CoopIntent | null = useMemo(() => {
    const challenge = params.get('coop')
    if (!challenge || !challengeById(challenge)) return null
    const level = (params.get('level') ?? 'veteran') as ChallengeLevel
    const players = Math.max(2, Math.min(4, Number(params.get('players') ?? 2)))
    return { challenge, level, players }
  }, [params])
  const [phase, setPhase] = useState<Phase>({ s: 'lobby' })
  const [code, setCode] = useState('')
  const [info, setInfo] = useState<RemoteInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null)
  const clientRef = useRef<RemoteMatchClient | null>(null)

  useEffect(() => () => { clientRef.current?.dispose(); clientRef.current = null }, [])

  const start = useCallback((intent: RemoteIntent) => {
    setError(null)
    setPhase({ s: 'connecting' })
    clientRef.current?.dispose()
    const c = new RemoteMatchClient({
      intent,
      onInfo: (i) => { setInfo(i); setPhase({ s: 'playing' }) },
      onError: (m) => { setError(m); setPhase({ s: 'lobby' }) },
      onCredentials: (cr) => {
        try {
          localStorage.setItem('sr:seat', JSON.stringify(cr))
        } catch { /* private browsing; reconnect will just not be offered */ }
      },
    })
    clientRef.current = c
    c.subscribe(setSnapshot)
  }, [])

  const onAction = useCallback((a: Action) => { clientRef.current?.send(a) }, [])
  const onExit = useCallback(() => {
    clientRef.current?.dispose(); clientRef.current = null; router.push('/')
  }, [router])

  if (phase.s === 'playing' && snapshot && info) {
    const seatNames = seatNamesFor(info.seat, snapshot.view)
    // A co-op table is short until every seat is claimed; a duel is short until
    // the one opponent arrives. Both are the same banner with the code to share.
    const short = info.waitingFor > 0 || (!snapshot.view.coop && !info.opponentConnected)
    return (
      <>
        {short && (
          <div style={{ position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }}>
            <div className="banner banner--turn">
              {info.waitingFor > 0 ? UI.waitingForPlayers(info.waitingFor) : UI.waitingOpponent}{' '}
              <b style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.18em' }}>{info.roomCode}</b>
            </div>
          </div>
        )}
        <Board snapshot={snapshot} seatNames={seatNames} onAction={onAction} onExit={onExit} />
      </>
    )
  }

  return (
    <main className="menu">
      <div className="menu__inner">
        <p className="eyebrow">{coop ? UI.coopTitle : UI.onlineEyebrow}</p>
        <h1 className="menu__title">
          {coop
            ? <span>{CHALLENGE_RU[coop.challenge as keyof typeof CHALLENGE_RU].name}</span>
            : <>
                <span>{UI.onlineTitleTop}</span>
                <span className="lo">{UI.onlineTitleBottom}</span>
              </>}
        </h1>
        <p className="menu__sub">{coop ? UI.coopSub : UI.onlineLede}</p>

        {error && (
          <div className="banner" style={{ marginBottom: 16, borderColor: 'var(--combat)' }}>{error}</div>
        )}

        <div className="menu__grid">
          <button
            type="button"
            className="mode"
            disabled={phase.s === 'connecting'}
            onClick={() => start(coop ? { kind: 'create', coop } : { kind: 'create' })}
          >
            <div className="mode__name" style={{ color: 'var(--blob)' }}>
              {coop ? UI.gatherTeam : UI.createMatch}
            </div>
            <div className="mode__desc">
              {coop ? `${UI.players}: ${coop.players}` : UI.createMatchDesc}
            </div>
          </button>

          <div className="mode" style={{ cursor: 'default' }}>
            <div className="mode__name" style={{ color: 'var(--empire)' }}>{UI.joinMatch}</div>
            <div className="mode__desc" style={{ marginBottom: 10 }}>{UI.joinMatchDesc}</div>
            <div className="actions">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="ABCDE"
                aria-label={UI.roomCodeLabel}
                style={{
                  font: '600 16px/1 var(--font-mono)', letterSpacing: '0.2em', width: 118,
                  padding: '9px 11px', borderRadius: 6, background: 'var(--void)',
                  border: '1px solid var(--rule-hi)', color: 'var(--ink)',
                }}
              />
              <button
                type="button"
                className="btn btn--primary"
                disabled={code.length < 4 || phase.s === 'connecting'}
                onClick={() => start({ kind: 'join', roomCode: code })}
              >
                {UI.join}
              </button>
            </div>
          </div>
        </div>

        <p className="menu__foot">
          {phase.s === 'connecting' ? UI.connecting : UI.serverHint}
          {' '}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => router.push('/')}>
            {UI.back}
          </button>
        </p>
      </div>
    </main>
  )
}
