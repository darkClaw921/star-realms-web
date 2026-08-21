'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Action, PlayerId } from '@sr/engine'
import type { Difficulty } from '@/bot/bot'
import { Board } from '@/components/Board'
import { UI } from '@/i18n/ui'
import { LocalMatchClient } from '@/match/LocalMatchClient'
import { useMatch } from '@/match/useMatch'

function Play(): React.JSX.Element {
  const params = useSearchParams()
  const router = useRouter()
  const mode = params.get('mode') === 'hotseat' ? 'hotseat' : 'bot'
  const difficulty = (params.get('difficulty') ?? 'normal') as Difficulty

  // One seed per mount. Deliberately not derived from the URL so a refresh deals
  // a new game rather than replaying the same one.
  const seed = useMemo(
    () => Math.floor(Math.random() * 2 ** 52).toString(16).padStart(16, '0'),
    [],
  )

  const factory = useCallback(
    () => new LocalMatchClient({ seed, firstPlayer: 'p1', mode, humanSeat: 'p1', difficulty }),
    [seed, mode, difficulty],
  )
  const { snapshot, client } = useMatch(factory)

  const [revealed, setRevealed] = useState<PlayerId | null>(null)
  useEffect(() => {
    if (snapshot && revealed === null) setRevealed(snapshot.view.viewer)
  }, [snapshot, revealed])

  const onAction = useCallback((a: Action) => { client?.send(a) }, [client])
  const onExit = useCallback(() => { router.push('/') }, [router])

  if (!snapshot) {
    return <main className="menu"><p className="eyebrow">{UI.dealing}</p></main>
  }

  const seatNames: Record<PlayerId, string> =
    mode === 'bot' ? { p1: UI.you, p2: UI.bot } : { p1: UI.playerOne, p2: UI.playerTwo }

  // Hot-seat only: gate the board when the device changes hands, so the incoming
  // player never sees the outgoing player's cards.
  const needsPass =
    mode === 'hotseat' && revealed !== null && snapshot.view.viewer !== revealed &&
    snapshot.view.phase === 'main'

  return (
    <Board
      snapshot={snapshot}
      seatNames={seatNames}
      onAction={onAction}
      onExit={onExit}
      passScreen={needsPass}
      onPassAcknowledged={() => setRevealed(snapshot.view.viewer)}
    />
  )
}

export default function PlayPage(): React.JSX.Element {
  return (
    <Suspense fallback={<main className="menu"><p className="eyebrow">{UI.loading}</p></main>}>
      <Play />
    </Suspense>
  )
}
