import { z } from 'zod'

/**
 * The wire contract.
 *
 * Three vocabularies stay rigidly separate: clients send ACTIONS (intents), the
 * server sends EVENTS (what happened, redacted) and VIEWS (redacted truth).
 * Clients never send events or state.
 *
 * Note what is NOT in the command envelope: the acting seat. It is derived from
 * the authenticated socket binding on the server. Trusting a client-supplied
 * player id would let either client act as the other.
 */
export const ENGINE_VERSION = 1
export const PROTOCOL_VERSION = 1

const zone = z.enum(['deck', 'hand', 'discard', 'inPlay', 'tradeRow', 'scrapHeap', 'explorerPile'])
const playerId = z.enum(['p1', 'p2', 'p3', 'p4', 'p5'])

export const choiceOptionSchema = z.discriminatedUnion('o', [
  z.object({
    o: z.literal('CARD'),
    iid: z.string().max(64),
    def: z.string().max(64),
    zone,
    owner: playerId.nullable(),
  }),
  z.object({ o: z.literal('BRANCH'), index: z.number().int().min(0).max(16), label: z.string().max(200) }),
  z.object({ o: z.literal('EXPLORER') }),
  z.object({ o: z.literal('CONFIRM') }),
])

const faction = z.enum(['trade_federation', 'blob', 'star_empire', 'machine_cult', 'unaligned'])

export const actionSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('PLAY_CARD'), card: z.string().max(64) }),
  z.object({ t: z.literal('PLAY_ALL') }),
  z.object({
    t: z.literal('ACTIVATE'),
    card: z.string().max(64),
    // Every printed slot. Four ally slots is the ceiling in any set, and
    // Splinter is Lost Fleet's; a slot missing here is a card that silently
    // cannot be used online, which is why the list is exhaustive rather than
    // the three the base set needed.
    slot: z.enum([
      'primary', 'ally', 'ally2', 'ally3', 'ally4', 'doubleAlly', 'scrap', 'splinter',
    ]),
  }),
  z.object({ t: z.literal('BUY_CARD'), card: z.string().max(64) }),
  z.object({ t: z.literal('BUY_EXPLORER') }),
  z.object({ t: z.literal('ATTACK_PLAYER'), amount: z.number().int().min(1).max(999) }),
  z.object({ t: z.literal('ATTACK_BASE'), base: z.string().max(64) }),
  z.object({ t: z.literal('REVEAL_GAMBIT'), card: z.string().max(64) }),
  z.object({ t: z.literal('CLAIM_MISSION'), card: z.string().max(64) }),
  z.object({ t: z.literal('MULLIGAN_ROW') }),
  z.object({ t: z.literal('ATTACK_TENTACLE'), faction, card: z.string().max(64) }),
  z.object({
    t: z.literal('TRANSFER'),
    to: playerId,
    what: z.enum(['trade', 'combat']),
    n: z.number().int().min(1).max(999),
  }),
  z.object({
    t: z.literal('RESOLVE_CHOICE'),
    choiceId: z.string().max(64),
    // Bounded: no base-set card selects more than two, and an unbounded array is
    // free memory for anyone who feels like sending one.
    selected: z.array(choiceOptionSchema).max(16),
  }),
  z.object({ t: z.literal('END_TURN') }),
])

export const commandSchema = z.object({
  matchId: z.string().max(64),
  /** Idempotency key. Socket.IO reconnects make a replayed command likely. */
  cmdId: z.string().max(64),
  /** Optimistic concurrency: reject if the server has moved on. */
  baseVersion: z.number().int().min(0),
  engineVersion: z.number().int(),
  action: actionSchema,
})

/**
 * Opening a table.
 *
 * A duel needs nothing. A co-op Challenge needs the challenge, the difficulty
 * and how many players are expected, because the whole board is dealt from
 * those three numbers -- boss Authority, team Authority, boss hand size and the
 * Assimilation Count all scale with the table, so the seats cannot be filled in
 * later.
 */
export const createSchema = z.object({
  name: z.string().max(40).optional(),
  coop: z.object({
    challenge: z.string().max(40),
    level: z.enum(['beginner', 'intermediate', 'veteran', 'expert']),
    players: z.number().int().min(2).max(4),
  }).optional(),
})
export const joinSchema = z.object({ roomCode: z.string().min(4).max(12) })
export const rejoinSchema = z.object({ matchId: z.string().max(64), token: z.string().max(512) })

export type WireAction = z.infer<typeof actionSchema>
export type WireCommand = z.infer<typeof commandSchema>

export type WireSeat = 'p1' | 'p2' | 'p3' | 'p4' | 'p5'

export interface SeatCredentials {
  readonly matchId: string
  readonly roomCode: string
  readonly seat: WireSeat
  readonly token: string
}

export interface MatchUpdate {
  readonly v: number
  /** A PlayerView, already redacted for this seat. Typed loosely to keep the
   *  protocol package free of an engine import cycle. */
  readonly state: unknown
  readonly events: unknown[]
  /** True while any other human seat holds a live socket. */
  readonly opponentConnected: boolean
  /** Per-seat presence, so a co-op table can show who is actually here. */
  readonly present: Record<string, boolean>
  /** Seats still waiting for someone to sit in them. */
  readonly waitingFor: number
}

export interface WireError {
  readonly message: string
  readonly code: 'ILLEGAL' | 'AUTH' | 'STALE' | 'NOT_FOUND' | 'FULL' | 'VERSION'
}

/** Unambiguous alphabet: no I/1/O/0, so a code read aloud survives the round trip. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
