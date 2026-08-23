'use client'

import { useEffect, useRef, useState } from 'react'
import type { MatchClient, MatchSnapshot } from './types'

/**
 * Bind a MatchClient to React.
 *
 * The client is created once via a factory and disposed on unmount. React 19
 * StrictMode double-invokes effects in development, so the guard below matters:
 * without it two clients (and in online mode, two sockets) would exist per match.
 *
 * Generic over the client type so a caller that builds a local match keeps the
 * local client's own API -- the end-of-game summary reads the board state, which
 * only the client that owns it can produce.
 */
export function useMatch<T extends MatchClient>(factory: () => T): {
  snapshot: MatchSnapshot | null
  client: T | null
} {
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null)
  const ref = useRef<T | null>(null)
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
