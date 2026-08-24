import { io, type Socket } from 'socket.io-client'
import { enumerateLegalActions, type Action, type GameEvent, type PlayerId, type PlayerView } from '@sr/engine'
import { ENGINE_VERSION } from '@sr/protocol'
import { CHALLENGE_RU } from '@/i18n/challenges.ru'
import { UI } from '@/i18n/ui'
import { playerRef } from '@/profile/identity'
import { toLines, type SeatNames } from './log'
import type { LogLine, MatchClient, MatchSnapshot } from './types'

export interface RemoteInfo {
  readonly matchId: string
  readonly roomCode: string
  readonly seat: PlayerId
  readonly opponentConnected: boolean
  /** Seats nobody has claimed yet. Non-zero means the table is still filling. */
  readonly waitingFor: number
}

/** Opening a co-op table: the challenge, its difficulty, and the table size. */
export interface CoopIntent {
  readonly challenge: string
  readonly level: 'beginner' | 'intermediate' | 'veteran' | 'expert'
  readonly players: number
}

export type RemoteIntent =
  | { kind: 'create'; coop?: CoopIntent }
  | { kind: 'join'; roomCode: string }
  | { kind: 'rejoin'; matchId: string; token: string }

export interface RemoteOptions {
  readonly intent: RemoteIntent
  readonly onInfo?: (info: RemoteInfo) => void
  readonly onError?: (message: string) => void
  readonly onCredentials?: (c: { matchId: string; token: string; seat: PlayerId }) => void
}

interface Update {
  v: number
  state: PlayerView
  events: GameEvent[]
  opponentConnected: boolean
  present?: Record<string, boolean>
  waitingFor?: number
}

/**
 * The online mode. Implements the SAME MatchClient interface as the local one,
 * so no board component changes between hot-seat, AI and online.
 */
export class RemoteMatchClient implements MatchClient {
  private socket: Socket
  private view: PlayerView | null = null
  private log: LogLine[] = []
  private events: readonly GameEvent[] = []
  private tick = 0
  private subs = new Set<(s: MatchSnapshot) => void>()
  private seat: PlayerId | null = null
  /** Held from the join ack: later updates do not carry it, and reporting an
   *  empty string on every update would blank the code the player must share. */
  private roomCode = ''
  private opponentConnected = false
  private disposed = false

  constructor(private readonly opts: RemoteOptions) {
    this.socket = io({ path: '/rt', transports: ['websocket', 'polling'] })

    this.socket.on('connect', () => {
      const i = opts.intent
      const event = i.kind === 'create' ? 'create' : i.kind === 'join' ? 'join' : 'rejoin'
      // Профиль называется при первом входе за стол: возвращение по токену
      // садится на уже занятое место, за которым профиль записан.
      const me = playerRef()
      const payload = i.kind === 'join' ? { roomCode: i.roomCode, player: me }
        : i.kind === 'rejoin' ? { matchId: i.matchId, token: i.token }
        : i.coop ? { coop: i.coop, player: me } : { player: me }
      this.socket.emit(event, payload, (res: unknown) => {
        const r = res as {
          error?: { message: string }
          matchId?: string; roomCode?: string; seat?: PlayerId; token?: string; update?: Update
        }
        if (r?.error) { opts.onError?.(r.error.message); return }
        if (!r?.seat || !r.matchId || !r.token) {
          opts.onError?.('Сервер вернул некорректный ответ.')
          return
        }
        this.seat = r.seat
        this.roomCode = r.roomCode ?? ''
        opts.onCredentials?.({ matchId: r.matchId, token: r.token, seat: r.seat })
        opts.onInfo?.({
          matchId: r.matchId, roomCode: this.roomCode, seat: r.seat,
          opponentConnected: r.update?.opponentConnected ?? false,
          waitingFor: r.update?.waitingFor ?? 0,
        })
        if (r.update) this.ingest(r.update)
      })
    })

    this.socket.on('update', (u: Update) => this.ingest(u))
    this.socket.on('connect_error', (e: Error) => opts.onError?.(e.message))
  }

  private ingest(u: Update): void {
    if (this.disposed) return
    this.view = u.state
    this.opponentConnected = u.opponentConnected
    this.events = u.events ?? []
    this.tick += 1
    const lines = toLines(u.events ?? [], this.seatNames())
    if (lines.length > 0) this.log = [...this.log, ...lines].slice(-400)
    this.opts.onInfo?.({
      matchId: u.state.matchId, roomCode: this.roomCode, seat: this.seat ?? 'p1',
      opponentConnected: u.opponentConnected,
      waitingFor: u.waitingFor ?? 0,
    })
    this.emit()
  }

  /**
   * Names for the log and the HUD.
   *
   * At a co-op table the seats are you, your teammates by number, and the Boss
   * -- there is no "opponent" to point at other than the Boss, and calling a
   * teammate one would be actively misleading.
   */
  private seatNames(): SeatNames {
    const me = this.seat ?? 'p1'
    return seatNamesFor(me, this.view)
  }

  private snapshot(): MatchSnapshot | null {
    if (!this.view || !this.seat) return null
    return {
      view: this.view,
      legal: enumerateLegalActions(this.view, this.seat),
      log: this.log,
      botThinking: false,
      botActed: false,
      events: this.events,
      tick: this.tick,
    }
  }

  private emit(): void {
    const s = this.snapshot()
    if (!s) return
    for (const cb of this.subs) cb(s)
  }

  get connectedOpponent(): boolean { return this.opponentConnected }

  subscribe(cb: (s: MatchSnapshot) => void): () => void {
    this.subs.add(cb)
    const s = this.snapshot()
    if (s) cb(s)
    return () => { this.subs.delete(cb) }
  }

  send(action: Action): void {
    if (!this.view || !this.seat || this.disposed) return
    this.socket.emit('cmd', {
      matchId: this.view.matchId,
      // Idempotency key: a Socket.IO reconnect replaying a queued command is
      // likely, not theoretical.
      cmdId: `${this.seat}-${this.view.version}-${Math.random().toString(36).slice(2, 10)}`,
      baseVersion: this.view.version,
      engineVersion: ENGINE_VERSION,
      action,
    }, (res: unknown) => {
      const r = res as { error?: { message: string } }
      if (r?.error) this.opts.onError?.(r.error.message)
    })
  }

  dispose(): void {
    this.disposed = true
    this.subs.clear()
    this.socket.close()
  }
}

const CHALLENGE_NAME = (id: keyof typeof CHALLENGE_RU): string => CHALLENGE_RU[id].name

/**
 * Shared by the client and the page, so the board and the log agree on who is
 * who. Falls back to the duel labels when there is no co-op table.
 */
export function seatNamesFor(me: PlayerId, view: PlayerView | null): SeatNames {
  const names: SeatNames = { [me]: UI.you }
  const coop = view?.coop
  if (coop) {
    let n = 1
    for (const seat of coop.players) {
      if (seat !== me) names[seat] = UI.seatOf(n)
      n += 1
    }
    names[coop.boss] = view?.boss ? CHALLENGE_NAME(view.boss.id) : UI.opponent
    return names
  }
  for (const seat of view?.seats ?? ['p1', 'p2'] as PlayerId[]) {
    if (seat !== me) names[seat] = UI.opponent
  }
  return names
}
