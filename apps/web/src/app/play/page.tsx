'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SeatNames } from '@/match/log'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  challengeById, challengeSetup, missionById,
  type Action, type ChallengeLevel, type PlayerId,
} from '@sr/engine'
import type { Difficulty } from '@/bot/bot'
import { Board } from '@/components/Board'
import { UI } from '@/i18n/ui'
import { LocalMatchClient } from '@/match/LocalMatchClient'
import type { VariantId } from '@sr/engine'
import { useMatch } from '@/match/useMatch'
import { markBeaten, markChallengeBeaten } from '@/campaign/progress'
import { MISSION_RU } from '@/i18n/campaign.ru'
import { CHALLENGE_RU } from '@/i18n/challenges.ru'
import { BOT_RU } from '@/i18n/profile.ru'
import { reportMatch } from '@/profile/identity'
import type { PlayMode } from '@/profile/types'
import { readSettings } from '@/settings/useSettings'

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

  // Sets are read ONCE, when the match is created. Reading them live would let
  // a settings change rewrite the trade deck mid-game.
  // Same for gambits and missions: they are dealt at setup, so a change made
  // mid-match must not reach into the game already on the table.
  const dealt = useMemo(() => {
    const st = readSettings()
    return {
      sets: st.sets, gambits: st.gambits, missions: st.missions,
      commandDeck: st.commandDeck, variant: st.variant,
    }
  }, [])
  const sets = dealt.sets

  // One seed per mount. Deliberately not derived from the URL so a refresh deals
  // a new game rather than replaying the same one.
  const seed = useMemo(
    () => Math.floor(Math.random() * 2 ** 52).toString(16).padStart(16, '0'),
    [],
  )

  // Под каким именем партия ляжет в статистику. Кампания и испытание — не
  // «игра с ботом»: соперник там сценарный, и мешать их в один счёт значило бы
  // считать прохождение обычной партией.
  const playMode: PlayMode = mission ? 'campaign'
    : challenge ? 'challenge'
      : mode === 'hotseat' ? 'hotseat' : 'bot'
  const opponentName = mission ? MISSION_RU[mission.id]?.name ?? mission.id
    : challenge ? CHALLENGE_RU[challenge.spec.id]?.name ?? challenge.spec.id
      : mode === 'hotseat' ? UI.playerTwo
        : BOT_RU[difficulty] ?? UI.bot

  const factory = useCallback(
    () => new LocalMatchClient({
      seed, firstPlayer: 'p1', mode, humanSeat: 'p1', difficulty,
      // Не из `dealt`: темп — не часть раздачи, и менять его посреди партии
      // законно. Поэтому настройка читается на каждую паузу заново.
      pace: () => readSettings().botSpeed,
      scenario: mission?.setup ?? challenge?.scenario,
      boss: challenge?.boss,
      // A challenge or a mission fixes its own card pool, so the player's set
      // choice only applies to an ordinary game.
      // A challenge is played on the Frontiers trade deck regardless of the
      // player's own set choice -- that is what the challenge is built for.
      sets: challenge ? challenge.sets : mission ? undefined : sets,
      // A challenge or a mission is a fixed setup; gambits and missions belong
      // to the ordinary game the player configured.
      gambitsPerPlayer: challenge || mission ? 0 : dealt.gambits,
      missionsPerPlayer: challenge || mission ? 0 : dealt.missions,
      // Only the player's own seat: the opponent keeps the standard deck.
      commandDeck: challenge || mission || !dealt.commandDeck
        ? undefined
        : { p1: dealt.commandDeck },
      variant: challenge || mission || !dealt.variant
        ? undefined
        : (dealt.variant as VariantId),
    }),
    [seed, mode, difficulty, mission, challenge, sets, dealt],
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

  // Партия начинается с раздачи, а не с открытия страницы: секунды до первого
  // хода — не игра.
  const startedAt = useMemo(() => Date.now(), [seed])
  const reported = useRef(false)
  useEffect(() => {
    if (!won || reported.current || !client) return
    // Ровно один раз за партию: снимок с победителем приходит ещё не раз —
    // на каждую перерисовку экрана победы.
    reported.current = true
    const at = Date.now()
    const result = client.outcome('p1', {
      mode: playMode, opponent: opponentName, durationMs: at - startedAt, at,
    })
    if (result) void reportMatch(result)
  }, [won, client, playMode, opponentName, startedAt])

  if (!snapshot) {
    return <main className="menu"><p className="eyebrow">{UI.dealing}</p></main>
  }

  const seatNames: SeatNames =
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
