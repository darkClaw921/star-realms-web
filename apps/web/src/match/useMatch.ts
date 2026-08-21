'use client'

import { useEffect, useRef, useState } from 'react'
import type { MatchClient, MatchSnapshot } from './types'

/**
 * Bind a MatchClient to React.
 *
 * The client is created once via a factory and disposed on unmount. React 19
 * StrictMode double-invokes effects in development, so the guard below matters:
 * without it two clients (and in online mode, two sockets) would exist per match.
 */
export function useMatch(factory: () => MatchClient): {
  snapshot: MatchSnapshot | null
  client: MatchClient | null
} {
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null)
  const ref = useRef<MatchClient | null>(null)
  const factoryRef = useRef(factory)

  useEffect(() => {
    const client = factoryRef.current()
    ref.current = client
    const unsub = client.subscribe(setSnapshot)
    return () => {
      unsub()
      client.dispose()
      ref.current = null
    }
  }, [])

  return { snapshot, client: ref.current }
}
