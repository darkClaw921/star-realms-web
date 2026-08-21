import type { Action, GameEvent, PlayerId, PlayerView } from '@sr/engine'

export interface LogLine {
  readonly id: number
  readonly player: PlayerId | null
  readonly text: string
  readonly emphasis?: boolean
}

export interface MatchSnapshot {
  /** Already redacted. The UI never sees anything else. */
  readonly view: PlayerView
  readonly legal: readonly Action[]
  readonly log: readonly LogLine[]
  /** True while a bot is deciding, so the UI can show it is thinking. */
  readonly botThinking: boolean
}

/**
 * One interface, three modes.
 *
 * Hot-seat and the AI game run the engine in the browser; online runs it on the
 * server. The board components cannot tell which, because all three hand back the
 * same redacted snapshot.
 */
export interface MatchClient {
  subscribe(cb: (s: MatchSnapshot) => void): () => void
  send(action: Action): void
  dispose(): void
}

export type { GameEvent }
