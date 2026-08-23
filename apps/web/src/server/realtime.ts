import type { Server as HttpServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Server, type Socket } from 'socket.io'
import type { GameEvent, PlayerId } from '@sr/engine'
import {
  ENGINE_VERSION, commandSchema, createSchema, joinSchema, rejoinSchema, type WireError,
} from '@sr/protocol'
import {
  MatchError, applyCommand, createMatch, getMatch, joinByCode, updateFor, verifyToken,
  type Match,
} from './matchRegistry'

interface SocketData {
  matchId?: string
  /** THE only source of acting identity. Never read a seat from a payload. */
  seat?: PlayerId
}

type Sock = Socket<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, SocketData>

const fail = (e: unknown): { error: WireError } => {
  if (e instanceof MatchError) return { error: e.wire }
  return { error: { code: 'ILLEGAL', message: (e as Error).message ?? 'Rejected.' } }
}

/**
 * All realtime code lives behind this one function.
 *
 * That is deliberate: extracting it into a separate WS service later (which is
 * what buys back `next build` / standalone / a serverless frontend) is then a
 * file move rather than a refactor.
 */
export function attachRealtime(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: '/rt',
    // engine.io schedules socket.end() ~1000ms after an upgrade on a path it does
    // not own, if nothing has been written. Next's HMR handshake normally beats
    // that by luck. This removes the race outright.
    destroyUpgrade: false,
    serveClient: false,
    pingInterval: 20_000,
    pingTimeout: 25_000,
  })

  /** A seat may hold several sockets, so a second tab works. */
  const room = (matchId: string, seat: PlayerId): string => `${matchId}:${seat}`

  // Every human seat, which at a co-op table is up to four.
  const push = (m: Match, events: readonly GameEvent[]): void => {
    for (const seat of m.humanSeats) {
      io.to(room(m.id, seat)).emit('update', updateFor(m, seat, events))
    }
  }

  const bind = (socket: Sock, m: Match, seat: PlayerId): void => {
    socket.data.matchId = m.id
    socket.data.seat = seat
    void socket.join(room(m.id, seat))
    m.seats[seat].connected += 1
  }

  io.on('connection', (socket: Sock) => {
    socket.on('create', (payload: unknown, ack?: (r: unknown) => void) => {
      try {
        // An unparseable payload is treated as a plain duel rather than an
        // error: the older client sends nothing at all.
        const parsed = createSchema.safeParse(payload ?? {})
        const { match, seat, token } = createMatch(
          parsed.success ? parsed.data.coop : undefined,
          parsed.success ? parsed.data.player : undefined,
        )
        bind(socket, match, seat)
        ack?.({
          matchId: match.id, roomCode: match.roomCode, seat, token,
          update: updateFor(match, seat, []),
        })
      } catch (e) { ack?.(fail(e)) }
    })

    socket.on('join', (payload: unknown, ack?: (r: unknown) => void) => {
      try {
        const { roomCode, player } = joinSchema.parse(payload)
        const { match, seat, token } = joinByCode(roomCode, player)
        bind(socket, match, seat)
        ack?.({
          matchId: match.id, roomCode: match.roomCode, seat, token,
          update: updateFor(match, seat, []),
        })
        push(match, [])
      } catch (e) { ack?.(fail(e)) }
    })

    socket.on('rejoin', (payload: unknown, ack?: (r: unknown) => void) => {
      try {
        const { matchId, token } = rejoinSchema.parse(payload)
        const claim = verifyToken(token)
        if (!claim || claim.matchId !== matchId) {
          throw new MatchError({ code: 'AUTH', message: 'That seat token is not valid.' })
        }
        const match = getMatch(matchId)
        bind(socket, match, claim.seat)
        // Reconnection needs no event buffering: a fresh snapshot supersedes
        // whatever was missed.
        ack?.({
          matchId, roomCode: match.roomCode, seat: claim.seat, token,
          update: updateFor(match, claim.seat, []),
        })
        push(match, [])
      } catch (e) { ack?.(fail(e)) }
    })

    socket.on('cmd', (payload: unknown, ack?: (r: unknown) => void) => {
      try {
        const cmd = commandSchema.parse(payload)
        const seat = socket.data.seat
        const matchId = socket.data.matchId
        if (!seat || !matchId || matchId !== cmd.matchId) {
          throw new MatchError({ code: 'AUTH', message: 'This socket holds no seat in that match.' })
        }
        if (cmd.engineVersion !== ENGINE_VERSION) {
          throw new MatchError({ code: 'VERSION', message: 'Reload: the game rules were updated.' })
        }
        const match = getMatch(matchId)
        const { events } = applyCommand(
          match, seat, cmd.cmdId, cmd.baseVersion, cmd.action as never,
        )
        ack?.({ ok: true })
        push(match, events)
      } catch (e) { ack?.(fail(e)) }
    })

    socket.on('disconnect', () => {
      const { matchId, seat } = socket.data
      if (!matchId || !seat) return
      try {
        const match = getMatch(matchId)
        match.seats[seat].connected = Math.max(0, match.seats[seat].connected - 1)
        push(match, [])
      } catch { /* the match is already gone */ }
    })
  })

  return io
}

export { randomUUID }
