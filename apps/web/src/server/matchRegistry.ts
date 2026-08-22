import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ALL_SEATS, ENGINE_VERSION, actorsOf, challengeById, challengeSetup, createGame,
  enumerateLegalActions, redact, redactEvent, reduce,
  type Action, type ChallengeLevel, type GameEvent, type GameState, type PlayerId,
} from '@sr/engine'
import { ROOM_CODE_ALPHABET, type WireError } from '@sr/protocol'
import { chooseAction } from '@/bot/bot'

const DATA_DIR = process.env.SR_DATA_DIR ?? join(process.cwd(), '..', '..', 'data', 'matches')
/** Per-process: matches live in memory, so tokens need not outlive the process. */
const SECRET = randomBytes(32)

export interface Seat {
  readonly token: string
  connected: number
}

export interface CoopOptions {
  readonly challenge: string
  readonly level: ChallengeLevel
  readonly players: number
}

export interface Match {
  readonly id: string
  readonly roomCode: string
  readonly seed: string
  state: GameState
  readonly seats: Record<PlayerId, Seat>
  /** Human seats, in order. Excludes the Challenge boss, which nobody sits in. */
  readonly humanSeats: PlayerId[]
  /** The boss's seat, driven by the server rather than by a player. */
  readonly bossSeat: PlayerId | null
  /** Append-only command log. Folding the reducer over it rebuilds the match. */
  readonly commands: { seat: PlayerId; action: Action }[]
  /** Idempotency: a reconnect replaying a queued command must not apply twice. */
  readonly seenCmdIds: Map<string, number>
  createdAt: number
  joined: PlayerId[]
}

export class MatchError extends Error {
  constructor(readonly wire: WireError) { super(wire.message) }
}

const matches = new Map<string, Match>()
const byCode = new Map<string, string>()

function id(bytes = 8): string { return randomBytes(bytes).toString('hex') }

function roomCode(len = 5): string {
  const b = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) {
    out += ROOM_CODE_ALPHABET[(b[i] as number) % ROOM_CODE_ALPHABET.length]
  }
  return out
}

function sign(matchId: string, seat: PlayerId): string {
  const payload = `${matchId}:${seat}`
  const mac = createHmac('sha256', SECRET).update(payload).digest('base64url')
  return `${payload}:${mac}`
}

/** Constant-time verification, so a token cannot be probed byte by byte. */
export function verifyToken(token: string): { matchId: string; seat: PlayerId } | null {
  const parts = token.split(':')
  if (parts.length !== 3) return null
  const [matchId, seat, mac] = parts as [string, string, string]
  if (!(ALL_SEATS as readonly string[]).includes(seat)) return null
  const claimed = seat as PlayerId
  const expected = createHmac('sha256', SECRET).update(`${matchId}:${seat}`).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return { matchId, seat: claimed }
}

/**
 * Open a table.
 *
 * A duel is two seats. A co-op Challenge is the players plus the Boss, and the
 * whole board is dealt from the player count at this moment -- boss Authority,
 * the team's shared score, the boss's hand size and the Assimilation Count all
 * scale with it, so the table size is chosen here and not renegotiated later.
 */
export function createMatch(coop?: CoopOptions): { match: Match; seat: PlayerId; token: string } {
  const matchId = id()
  let code = roomCode()
  while (byCode.has(code)) code = roomCode()
  const seed = randomBytes(16).toString('hex')

  let state: GameState
  if (coop) {
    const spec = challengeById(coop.challenge)
    if (!spec) throw new MatchError({ code: 'NOT_FOUND', message: 'No such challenge.' })
    const built = challengeSetup(spec, coop.level, coop.players)
    state = createGame({
      matchId, seed, firstPlayer: 'p1',
      scenario: built.scenario, boss: built.boss, sets: built.sets, coop: built.coop,
    })
  } else {
    state = createGame({ matchId, seed, firstPlayer: 'p1' })
  }

  const bossSeat = state.bossSeat
  const humanSeats = state.seats.filter((x) => x !== bossSeat)
  const seats = Object.fromEntries(
    ALL_SEATS.map((pid) => [pid, { token: sign(matchId, pid), connected: 0 }]),
  ) as Record<PlayerId, Seat>

  const match: Match = {
    id: matchId,
    roomCode: code,
    seed,
    state,
    seats,
    humanSeats,
    bossSeat,
    commands: [],
    seenCmdIds: new Map(),
    createdAt: Date.now(),
    joined: ['p1'],
  }
  matches.set(matchId, match)
  byCode.set(code, matchId)
  void persistHeader(match)
  return { match, seat: 'p1', token: seats.p1.token }
}

export function joinByCode(code: string): { match: Match; seat: PlayerId; token: string } {
  const matchId = byCode.get(code.toUpperCase())
  if (!matchId) throw new MatchError({ code: 'NOT_FOUND', message: 'No match with that code.' })
  const match = matches.get(matchId)
  if (!match) throw new MatchError({ code: 'NOT_FOUND', message: 'That match has ended.' })
  const seat = match.humanSeats.find((p) => !match.joined.includes(p))
  if (!seat) {
    throw new MatchError({ code: 'FULL', message: 'Every seat at that table is taken.' })
  }
  match.joined.push(seat)
  // The code is a join ticket, not an auth token, and it expires the moment the
  // last seat is filled rather than on the first use -- a co-op table needs to
  // hand the same code to three people.
  if (match.joined.length >= match.humanSeats.length) byCode.delete(code.toUpperCase())
  return { match, seat, token: match.seats[seat].token }
}

export function getMatch(matchId: string): Match {
  const m = matches.get(matchId)
  if (!m) throw new MatchError({ code: 'NOT_FOUND', message: 'That match has ended.' })
  return m
}

export interface ApplyResult {
  readonly version: number
  readonly events: readonly GameEvent[]
}

/**
 * The full pipeline, in the one order that is safe:
 *   authorize turn/input ownership -> check legality -> reduce -> persist.
 *
 * Schema validation and authentication happen upstream in realtime.ts, before
 * this is ever called. No `await` sits between the legality check and the state
 * write, so Node's single thread makes the critical section atomic without a lock.
 */
export function applyCommand(
  match: Match, seat: PlayerId, cmdId: string, baseVersion: number, action: Action,
): ApplyResult {
  const already = match.seenCmdIds.get(cmdId)
  if (already !== undefined) {
    // Idempotent replay: acknowledge without applying twice.
    return { version: match.state.version, events: [] }
  }
  if (match.state.phase === 'gameOver') {
    throw new MatchError({ code: 'ILLEGAL', message: 'The game is over.' })
  }
  // Input ownership, not turn ownership -- a forced discard is answered by the
  // player whose turn it is NOT, and a co-op team shares one turn between
  // several seats.
  if (!actorsOf(match.state).includes(seat)) {
    throw new MatchError({ code: 'ILLEGAL', message: 'It is not your turn to act.' })
  }
  if (baseVersion !== match.state.version) {
    throw new MatchError({ code: 'STALE', message: 'The board moved on; retry.' })
  }
  const legal = enumerateLegalActions(redact(match.state, seat), seat)
  if (!legal.some((a) => JSON.stringify(a) === JSON.stringify(action))) {
    throw new MatchError({ code: 'ILLEGAL', message: 'That move is not legal.' })
  }

  const { state, events } = reduce(match.state, { actor: seat, action })
  match.state = state
  match.commands.push({ seat, action })
  match.seenCmdIds.set(cmdId, state.version)
  void persistCommand(match, seat, action)
  return { version: state.version, events: [...events, ...driveBoss(match)] }
}

/**
 * Play the Boss's turn, where the Boss has one to play.
 *
 * The four SCRIPT bosses need nothing: their turn is a list of effects pushed
 * onto the resolution stack inside END_TURN, and it runs itself. The four DECK
 * bosses hold a hand and must be played, and online there is no client to play
 * them -- so the server does it, with the same policy the solo game already
 * uses for that seat.
 *
 * DEVIATION, and it predates co-op: the rulebook prints an explicit Order of
 * Play for each deck boss ("use an available Primary Ability of a Base, then an
 * Ally, then play the most expensive card in hand..."), and this uses the
 * ordinary opponent policy instead. The boss plays competently but not in the
 * printed order.
 */
function driveBoss(match: Match): GameEvent[] {
  const bossSeat = match.bossSeat
  if (!bossSeat || match.state.boss?.kind !== 'deck') return []
  const out: GameEvent[] = []
  let guard = 0
  while (
    match.state.phase !== 'gameOver'
    && actorsOf(match.state).includes(bossSeat)
    && actorsOf(match.state).length === 1
    && guard++ < 200
  ) {
    const view = redact(match.state, bossSeat)
    const legal = enumerateLegalActions(view, bossSeat)
    if (legal.length === 0) break
    const action = chooseAction(view, legal, 'hard', Math.random)
    const { state, events } = reduce(match.state, { actor: bossSeat, action })
    match.state = state
    match.commands.push({ seat: bossSeat, action })
    void persistCommand(match, bossSeat, action)
    out.push(...events)
  }
  return out
}

/** Everything a seat is allowed to know, and nothing else. */
export function updateFor(match: Match, seat: PlayerId, events: readonly GameEvent[]): {
  v: number; state: unknown; events: unknown[]; opponentConnected: boolean
  present: Record<string, boolean>; waitingFor: number
} {
  const present: Record<string, boolean> = {}
  for (const pid of match.humanSeats) present[pid] = match.seats[pid].connected > 0
  const others = match.humanSeats.filter((p) => p !== seat)
  return {
    v: match.state.version,
    state: redact(match.state, seat),
    events: events.map((e) => redactEvent(e, seat)).filter(Boolean),
    opponentConnected: others.some((p) => match.seats[p].connected > 0),
    present,
    waitingFor: Math.max(0, match.humanSeats.length - match.joined.length),
  }
}

export function legalFor(match: Match, seat: PlayerId): Action[] {
  return enumerateLegalActions(redact(match.state, seat), seat)
}

// ── durability ───────────────────────────────────────────────────────────────
// In-memory state dies on every restart, and for a solo developer that is every
// edit to server.ts. The log is what makes a crash mid-playtest survivable.

async function persistHeader(m: Match): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true })
    await appendFile(
      join(DATA_DIR, `${m.id}.jsonl`),
      JSON.stringify({ t: 'header', engineVersion: ENGINE_VERSION, matchId: m.id, seed: m.seed, firstPlayer: 'p1' }) + '\n',
    )
  } catch { /* durability is best-effort; never fail a move over it */ }
}

async function persistCommand(m: Match, seat: PlayerId, action: Action): Promise<void> {
  try {
    await appendFile(
      join(DATA_DIR, `${m.id}.jsonl`),
      JSON.stringify({ t: 'cmd', v: m.state.version, seat, action }) + '\n',
    )
  } catch { /* as above */ }
}

/** Reap abandoned matches, keeping their logs on disk. */
export function reap(maxIdleMs = 6 * 60 * 60 * 1000): number {
  const now = Date.now()
  let n = 0
  for (const [key, m] of matches) {
    const live = m.humanSeats.reduce((n, p) => n + m.seats[p].connected, 0)
    if (live === 0 && now - m.createdAt > maxIdleMs) {
      matches.delete(key)
      byCode.delete(m.roomCode)
      n++
    }
  }
  return n
}

export function stats(): { matches: number; open: number } {
  return { matches: matches.size, open: byCode.size }
}
