import type { AcquireRedirect } from './effects'
import type { ChoiceOption, PendingChoice, PromptKind } from './choices'
import type { GameEvent } from './events'
import type { BossState } from './boss'
import type { ScenarioRules } from './scenario'
import type { CardDefId, CardIid, ChoiceId, Faction, PlayerId } from './ids'
import { opponentOf } from './ids'
import { actorOf, currentChoice, type CardInstance, type GameState, type InPlayCard } from './state'

/**
 * REDACTION.
 *
 * PlayerView is a DISTINCT TYPE built field by field -- a projection, never a
 * deep-clone-and-delete. That is the whole point: this type has no `rng` and no
 * `deck: CardInstance[]`, so a new secret field added to GameState tomorrow
 * cannot silently reach the wire. Deny by default, structurally.
 *
 * Exactly two functions may produce bytes for a client: `redact` and
 * `redactEvent`. Nothing else may be sent, anywhere.
 */

export interface InPlayCardView {
  readonly iid: CardIid
  readonly def: CardDefId
  readonly copiedDef: CardDefId | null
  readonly used: {
    readonly primary: boolean; readonly ally: boolean
    readonly ally2: boolean; readonly ally3: boolean; readonly ally4: boolean
    readonly doubleAlly: boolean; readonly scrap: boolean
  }
  readonly playedThisTurn: boolean
}

/** The viewer's own side. Includes the hand; never the deck ORDER. */
export interface SelfView {
  readonly authority: number
  readonly hand: readonly CardInstance[]
  readonly discard: readonly CardInstance[]
  readonly inPlay: readonly InPlayCardView[]
  readonly deckCount: number
  /**
   * What is left in the viewer's own deck, as an unordered multiset.
   *
   * Shown to the OWNER ONLY, and that restriction is load-bearing. Every card a
   * player owns is public (acquisitions and discards are face up), so handing the
   * opponent this list would let them compute
   * `hand = owned - deck - discard - inPlay - scrapped` exactly -- a complete
   * hand leak dressed up as public information.
   */
  readonly deckComposition: readonly CardDefId[]
  readonly trade: number
  readonly combat: number
  readonly allyUnlocked: readonly Faction[]
  readonly doubleAllyUnlocked: readonly Faction[]
  /**
   * Armed acquisition redirects. Public to the owner only, and only because the
   * UI has to explain why a bought card went somewhere unexpected.
   */
  readonly pendingRedirects: readonly AcquireRedirect[]
  readonly factionPlayedThisTurn: Readonly<Record<Faction, number>>
}

/** The other side. Counts where the physical game shows only a card back. */
export interface OpponentView {
  readonly authority: number
  readonly handCount: number
  readonly discard: readonly CardInstance[]
  readonly inPlay: readonly InPlayCardView[]
  readonly deckCount: number
  readonly trade: number
  readonly combat: number
  readonly allyUnlocked: readonly Faction[]
  readonly factionPlayedThisTurn: Readonly<Record<Faction, number>>
}

export interface PendingChoiceView {
  readonly id: ChoiceId
  readonly actor: PlayerId
  readonly prompt: PromptKind
  readonly source: CardIid | null
  readonly label: string
  readonly min: number
  readonly max: number
  /** Populated for the ACTOR ONLY. Everyone else gets null plus a count. */
  readonly options: readonly ChoiceOption[] | null
  readonly optionCount: number
}

export interface PlayerView {
  readonly engineVersion: number
  readonly matchId: string
  readonly version: number
  readonly turn: number
  readonly activePlayer: PlayerId
  readonly phase: 'main' | 'gameOver'
  readonly viewer: PlayerId
  /** Whose input the game is waiting on. Not always `activePlayer`. */
  readonly actor: PlayerId
  readonly me: SelfView
  readonly opponent: OpponentView
  readonly tradeRow: readonly (CardInstance | null)[]
  readonly tradeDeckCount: number
  readonly explorerPile: number
  readonly scrapHeap: readonly CardInstance[]
  readonly pendingChoice: PendingChoiceView | null
  readonly winner: PlayerId | null
  /** Campaign rules in force, or null. Public -- both sides play under them. */
  readonly scenario: ScenarioRules | null
  /** Enemy bases each side has destroyed. Public; a DESTROY_BASES objective
   *  is scored from it and the UI shows the progress. */
  readonly basesDestroyed: Record<PlayerId, number>
  /**
   * The challenge boss. Every field of it is public by construction: the piles
   * it builds are laid out face up on the table, and the counts it attacks with
   * have to be readable or the player cannot plan.
   */
  readonly boss: BossState | null
}

function viewInPlay(c: InPlayCard): InPlayCardView {
  return {
    iid: c.iid,
    def: c.def,
    copiedDef: c.copiedDef,
    used: {
      primary: c.used.primary, ally: c.used.ally,
      ally2: c.used.ally2, ally3: c.used.ally3, ally4: c.used.ally4,
      doubleAlly: c.used.doubleAlly, scrap: c.used.scrap,
    },
    playedThisTurn: c.playedThisTurn,
  }
}

function redactChoice(c: PendingChoice, viewer: PlayerId): PendingChoiceView {
  // A forced-discard choice's options literally ARE the opponent's hand. Sending
  // them to both players is the single most common hand leak in this design.
  const isActor = c.actor === viewer
  return {
    id: c.id,
    actor: c.actor,
    prompt: c.prompt,
    source: c.source,
    label: c.label,
    min: c.min,
    max: c.max,
    options: isActor ? c.options : null,
    optionCount: c.options.length,
  }
}

export function redact(s: GameState, viewer: PlayerId): PlayerView {
  const meState = s.players[viewer]
  const oppId = opponentOf(viewer)
  const oppState = s.players[oppId]
  const choice = currentChoice(s)

  return {
    engineVersion: s.engineVersion,
    matchId: s.matchId,
    version: s.version,
    turn: s.turn,
    activePlayer: s.activePlayer,
    phase: s.phase,
    viewer,
    actor: actorOf(s),
    me: {
      authority: meState.authority,
      hand: meState.hand.map((c) => ({ iid: c.iid, def: c.def })),
      discard: meState.discard.map((c) => ({ iid: c.iid, def: c.def })),
      inPlay: meState.inPlay.map(viewInPlay),
      deckCount: meState.deck.length,
      // Sorted, so the order of the real deck cannot be read off the list.
      deckComposition: meState.deck.map((c) => c.def).sort(),
      trade: meState.trade,
      combat: meState.combat,
      allyUnlocked: [...meState.allyUnlocked],
      doubleAllyUnlocked: [...meState.doubleAllyUnlocked],
      pendingRedirects: meState.pendingRedirects.map((r) => ({ ...r })),
      factionPlayedThisTurn: { ...meState.factionPlayedThisTurn },
    },
    opponent: {
      authority: oppState.authority,
      handCount: oppState.hand.length,
      discard: oppState.discard.map((c) => ({ iid: c.iid, def: c.def })),
      inPlay: oppState.inPlay.map(viewInPlay),
      deckCount: oppState.deck.length,
      trade: oppState.trade,
      combat: oppState.combat,
      allyUnlocked: [...oppState.allyUnlocked],
      factionPlayedThisTurn: { ...oppState.factionPlayedThisTurn },
    },
    tradeRow: s.tradeRow.map((c) => (c ? { iid: c.iid, def: c.def } : null)),
    tradeDeckCount: s.tradeDeck.length,
    explorerPile: s.explorerPile,
    scrapHeap: s.scrapHeap.map((c) => ({ iid: c.iid, def: c.def })),
    pendingChoice: choice ? redactChoice(choice, viewer) : null,
    winner: s.winner,
    scenario: s.scenario,
    basesDestroyed: { p1: s.basesDestroyed.p1, p2: s.basesDestroyed.p2 },
    boss: s.boss,
  }
}

/**
 * Redact one event. Returns null when the viewer should not learn of it at all.
 *
 * The only base-set leak here is DRAW: which cards someone drew is secret, the
 * fact that they drew is not. Everything else moves cards into public zones.
 */
export function redactEvent(e: GameEvent, viewer: PlayerId): GameEvent | null {
  if (e.e === 'DRAW' && e.player !== viewer) {
    return { e: 'DRAW', player: e.player, n: e.n, defs: null }
  }
  return e
}
