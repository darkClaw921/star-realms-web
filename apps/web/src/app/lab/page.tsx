'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Action } from '@sr/engine'
import { Board } from '@/components/Board'
import { LabConsole } from '@/components/LabConsole'
import { LAB } from '@/i18n/lab.ru'
import { UI } from '@/i18n/ui'
import { LabMatchClient } from '@/match/LabMatchClient'
import { useMatch } from '@/match/useMatch'
import { readSettings } from '@/settings/useSettings'

/**
 * Полигон.
 *
 * Настоящий стол против бота плюс пульт, который расставляет положение. Смысл
 * ровно в этом сочетании: макет показал бы, как эффект выглядит на макете, а
 * здесь он ложится на настоящую карту настоящего размера, и механику после
 * расстановки проверяют обычными ходами через тот же движок.
 *
 * Бот сидит на втором месте и ходит сам; чтобы он не мешал, ход ему можно
 * просто не передавать — пульт правит состояние, не заканчивая хода.
 */
export default function LabPage(): React.JSX.Element {
  const [nonce, setNonce] = useState(0)
  // key, а не смена seed: useMatch создаёт клиент один раз за монтирование —
  // без пересоздания компонента «новая раздача» меняла бы только строку seed.
  return <LabTable key={nonce} onDeal={() => setNonce((n) => n + 1)} />
}

function LabTable({ onDeal }: { onDeal: () => void }): React.JSX.Element {
  const router = useRouter()
  const dealt = useMemo(() => readSettings(), [])
  const seed = useMemo(
    () => Math.floor(Math.random() * 2 ** 52).toString(16),
    [],
  )

  const factory = useCallback(
    () => new LabMatchClient({
      seed, firstPlayer: 'p1', mode: 'bot', humanSeat: 'p1', difficulty: 'normal',
      sets: dealt.sets,
      gambitsPerPlayer: dealt.gambits,
      missionsPerPlayer: dealt.missions,
    }),
    [seed, dealt],
  )
  const { snapshot, client } = useMatch(factory)
  const onAction = useCallback((a: Action) => { client?.send(a) }, [client])

  if (!snapshot || !client) {
    return <main className="menu"><p className="eyebrow">{UI.dealing}</p></main>
  }

  const lab = client as LabMatchClient
  // Полигон — инструмент, и его состояние должно быть доступно из консоли
  // браузера: иначе проверять зоны, которых нет на экране (колода, утиль),
  // приходится глазами по счётчикам.
  ;(window as unknown as { __lab?: LabMatchClient }).__lab = lab

  return (
    <>
      <Board
        snapshot={snapshot}
        seatNames={{ p1: UI.you, p2: UI.bot }}
        onAction={onAction}
        onExit={() => router.push('/')}
      />
      <LabConsole
        client={lab}
        state={lab.info.state}
        viewer={snapshot.view.viewer}
        sets={dealt.sets}
      />
      <button
        type="button"
        className="lab__deal"
        onClick={onDeal}
        title={LAB.subtitle}
      >
        {LAB.deal}
      </button>
    </>
  )
}
