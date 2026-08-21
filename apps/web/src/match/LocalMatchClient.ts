import {
  actorOf, createGame, enumerateLegalActions, redact, redactEvent, reduce,
  type Action, type BossState, type GameState, type PlayerId, type ScenarioSetup, type SetId,
} from '@sr/engine'
import { chooseAction, type Difficulty } from '@/bot/bot'
import { UI } from '@/i18n/ui'
import { toLines } from './log'
import type { LogLine, MatchClient, MatchSnapshot } from './types'

export interface LocalOptions {
  readonly seed: string
  readonly firstPlayer: PlayerId
  readonly mode: 'hotseat' | 'bot'
  /** Which seat the human holds in bot mode. */
  readonly humanSeat?: PlayerId
  readonly difficulty?: Difficulty
  /** Minimum time the bot appears to think, purely for pacing. */
  readonly botDelayMs?: number
  /** A campaign mission. Absent means the standard game. */
  readonly scenario?: ScenarioSetup | undefined
  /** A Frontiers Challenge boss. */
  readonly boss?: BossState | undefined
  /** Card sets in the trade deck. Read once, at deal time. */
  readonly sets?: readonly SetId[] | undefined
  /** Gambits dealt face down to each player. Zero means playing without them. */
  readonly gambitsPerPlayer?: number | undefined
  /** Missions dealt to each player. Completing all of yours wins the game. */
  readonly missionsPerPlayer?: number | undefined
}

/**
 * Runs the engine in the browser for hot-seat and vs-AI.
 *
 * Note that it STILL calls redact(), with the viewer set to whoever currently
 * owns the input. Skipping redaction because "it's local" would mean the online
 * mode is the first place redaction ever runs in anger -- which is exactly how
 * leaks ship.
 */
export class LocalMatchClient implements MatchClient {
  private state: GameState
  private log: LogLine[] = []
  private subs = new Set<(s: MatchSnapshot) => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private thinking = false

  constructor(private readonly opts: LocalOptions) {
    this.state = createGame({
      matchId: `local-${opts.seed}`,
      seed: opts.seed,
      firstPlayer: opts.firstPlayer,
      scenario: opts.scenario,
      boss: opts.boss,
      sets: opts.sets,
      gambitsPerPlayer: opts.gambitsPerPlayer,
      missionsPerPlayer: opts.missionsPerPlayer,
    })
    this.log = toLines([{ e: 'TURN_START', player: opts.firstPlayer, turn: 1 }], this.names())
    this.maybeScheduleBot()
  }

  private names(): Record<PlayerId, string> {
    if (this.opts.mode === 'bot') {
      const human = this.opts.humanSeat ?? 'p1'
      return human === 'p1'
        ? { p1: UI.you, p2: UI.bot }
        : { p1: UI.bot, p2: UI.you }
    }
    return { p1: UI.playerOne, p2: UI.playerTwo }
  }

  private get botSeat(): PlayerId | null {
    if (this.opts.mode !== 'bot') return null
    return (this.opts.humanSeat ?? 'p1') === 'p1' ? 'p2' : 'p1'
  }

  /** Hot-seat shows the board to whoever must act; vs-AI always shows the human. */
  private get viewer(): PlayerId {
    if (this.opts.mode === 'bot') return this.opts.humanSeat ?? 'p1'
    return actorOf(this.state)
  }

  snapshot(): MatchSnapshot {
    const viewer = this.viewer
    const view = redact(this.state, viewer)
    return {
      view,
      legal: enumerateLegalActions(view, viewer),
      log: this.log,
      botThinking: this.thinking,
    }
  }

  subscribe(cb: (s: MatchSnapshot) => void): () => void {
    this.subs.add(cb)
    cb(this.snapshot())
    return () => { this.subs.delete(cb) }
  }

  private emit(): void {
    if (this.disposed) return
    const snap = this.snapshot()
    for (const cb of this.subs) cb(snap)
  }

  private apply(actor: PlayerId, action: Action): void {
    // Зритель фиксируется ДО применения: события принадлежат тому состоянию, в
    // котором произошли.
    const viewer = this.viewer
    const { state, events } = reduce(this.state, { actor, action })
    this.state = state
    // Локальный режим пропускает события через ту же воронку, что и сервер.
    // Иначе онлайн станет первым местом, где редакция запускается всерьёз,
    // а дыры уже уедут в прод.
    const visible = events.map((e) => redactEvent(e, viewer)).filter((e) => e !== null)
    const lines = toLines(visible, this.names())
    if (lines.length > 0) this.log = [...this.log, ...lines].slice(-400)
  }

  send(action: Action): void {
    if (this.disposed || this.state.phase === 'gameOver') return
    const actor = actorOf(this.state)
    if (actor === this.botSeat) return // not the human's input to give
    try {
      this.apply(actor, action)
    } catch (err) {
      // A rejected action means the UI offered something illegal -- a real bug,
      // not something to paper over. Surface it in the log rather than crashing.
      this.log = [...this.log, {
        id: Date.now(), player: null, text: UI.rejected((err as Error).message), emphasis: true,
      }]
    }
    this.emit()
    this.maybeScheduleBot()
  }

  private maybeScheduleBot(): void {
    const seat = this.botSeat
    if (!seat || this.disposed) return
    if (this.state.phase === 'gameOver') return
    if (actorOf(this.state) !== seat) return
    if (this.timer) return

    this.thinking = true
    this.emit()
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.disposed) return
      this.stepBot(seat)
    }, this.opts.botDelayMs ?? 550)
  }

  private stepBot(seat: PlayerId): void {
    // The bot sees only its own redacted view. Omniscience would be an explicit
    // difficulty flag, not a shortcut taken here.
    const view = redact(this.state, seat)
    const legal = enumerateLegalActions(view, seat)
    if (legal.length === 0) { this.thinking = false; this.emit(); return }
    try {
      const action = chooseAction(view, legal, this.opts.difficulty ?? 'normal', Math.random)
      this.apply(seat, action)
    } catch (err) {
      this.log = [...this.log, {
        id: Date.now(), player: null, text: UI.botError((err as Error).message), emphasis: true,
      }]
      this.thinking = false
      this.emit()
      return
    }
    this.thinking = false
    this.emit()
    this.maybeScheduleBot()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.subs.clear()
  }
}
