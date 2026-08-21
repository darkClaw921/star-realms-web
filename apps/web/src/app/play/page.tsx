'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  challengeById, challengeSetup, missionById,
  type Action, type ChallengeLevel, type PlayerId,
} from '@sr/engine'
import type { Difficulty } from '@/bot/bot'
import { Board } from '@/components/Board'
import { UI } from '@/i18n/ui'
import { LocalMatchClient } from '@/match/LocalMatchClient'
import { useMatch } from '@/match/useMatch'
import { markBeaten, markChallengeBeaten } from '@/campaign/progress'

function Play(): React.JSX.Element {
  const params = useSearchParams()
  const router = useRouter()
  const urlMode = params.get('mode')
  const mission = urlMode === 'campaign' ? missionById(params.get('mission') ?? '') : null
  // A campaign mission is a bot game with a scenario attached; an unknown
  // mission id degrades to a plain bot game rather than to a broken screen.
  const mode = urlMode === 'hotseat' ? 'hotseat' : 'bot'
  const difficulty = (params.get('difficulty') ?? 'normal') as Difficulty

  // A Frontiers challenge: the boss seat is driven by the engine for script
  // bosses and by the ordinary bot for deck bosses, so both are just bot games
  // with a scenario and a boss attached.
  const challenge = useMemo(() => {
    if (urlMode !== 'challenge') return null
    const spec = challengeById(params.get('boss') ?? '')
    if (!spec) return null
    const level = (params.get('level') ?? 'veteran') as ChallengeLevel
    return { spec, ...challengeSetup(spec, level) }
  }, [urlMode, params])

  // One seed per mount. Deliberately not derived from the URL so a refresh deals
  // a new game rather than replaying the same one.
  const seed = useMemo(
    () => Math.floor(Math.random() * 2 ** 52).toString(16).padStart(16, '0'),
    [],
  )

  const factory = useCallback(
    () => new LocalMatchClient({
      seed, firstPlayer: 'p1', mode, humanSeat: 'p1', difficulty,
      scenario: mission?.setup ?? challenge?.scenario,
      boss: challenge?.boss,
    }),
    [seed, mode, difficulty, mission, challenge],
  )
  const { snapshot, client } = useMatch(factory)

  const [revealed, setRevealed] = useState<PlayerId | null>(null)
  useEffect(() => {
    if (snapshot && revealed === null) setRevealed(snapshot.view.viewer)
  }, [snapshot, revealed])

  const onAction = useCallback((a: Action) => { client?.send(a) }, [client])
  const onExit = useCallback(
    () => { router.push(mission ? '/campaign' : challenge ? '/challenges' : '/') },
    [router, mission, challenge],
  )

  // Recording the win here rather than inside the engine keeps progress out of
  // the rules: the same mission has to produce the same game every attempt.
  const won = snapshot?.view.winner
  useEffect(() => {
    if (mission && won === 'p1') markBeaten(mission.id)
    if (challenge && won === 'p1') markChallengeBeaten(challenge.spec.id)
  }, [mission, challenge, won])

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
