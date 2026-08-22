import type { AcquireRedirect } from './effects'
import type { ChoiceOption, PendingChoice, PromptKind } from './choices'
import type { GameEvent } from './events'
import type { BossState } from './boss'
import type { ScenarioRules } from './scenario'
import type { VariantState } from './variants'
import type { CardDefId, CardIid, ChoiceId, Faction, PlayerId } from './ids'
import type { CoopState } from './coop'
import { foeOf } from './helpers'
import {
  actorOf, actorsOf, currentChoice,
  type CardInstance, type GameState, type InPlayCard,
} from './state'

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
    readonly doubleAlly: boolean; readonly scrap: boolean; readonly splinter: boolean
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
  /**
   * Your own face-down gambits and missions. Shown to you and to nobody else:
   * an opponent who knew them would play around them, which is the whole reason
   * they are dealt face down.
   */
  readonly gambits: readonly CardInstance[]
  readonly missions: readonly CardInstance[]
  /** Revealed gambits and completed missions are public. */
  readonly gambitsInPlay: readonly InPlayCardView[]
  readonly missionsDone: readonly CardDefId[]
  /**
   * Per-turn history a mission objective reads. Yours and public to you, and
   * present in the view for one reason: legality has to be decidable from the
   * view alone, and "can I claim this mission" is a legality question.
   */
  readonly shipsPlayedThisTurn: readonly CardInstance[]
  readonly alliesUsedThisTurn: readonly {
    readonly def: CardDefId
    readonly slot: 'ally' | 'ally2' | 'ally3' | 'ally4' | 'doubleAlly'
  }[]
  readonly gainedThisTurn: { readonly trade: number; readonly combat: number; readonly authority: number }
}

/** The other side. Counts where the physical game shows only a card back. */
export interface OpponentView {
  readonly authority: number
  readonly handCount: number
  /** Face-down counts only, exactly as the physical game shows. */
  readonly gambitCount: number
  readonly missionCount: number
  /** Face up, so public. */
  readonly gambitsInPlay: readonly InPlayCardView[]
  readonly missionsDone: readonly CardDefId[]
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
  /**
   * The card that asked the question, when it is a card anyone can see.
   *
   * Resolved here rather than by the client, and resolved ONLY out of face-up
   * zones -- play, revealed gambits, the trade row, the set-aside pile and the
   * scrap heap. A source that is not in one of those (a card being played out
   * of hand, say) stays null: the prompt is not worth leaking a card from a
   * hidden zone for, and "look it up in the zones you can see" is a rule the
   * projection can enforce, unlike a client-side lookup.
   */
  readonly sourceDef: CardDefId | null
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
  /**
   * EVERYONE whose input the game will accept right now.
   *
   * One seat, except during a co-op team's shared turn, where the rulebook has
   * all the teammates playing together with no printed order between them. The
   * UI and the server both authorize against this list; `actor` is its first
   * entry and stays for the many places that only ever need one.
   */
  readonly actors: readonly PlayerId[]
  readonly me: SelfView
  /** The side this seat is fighting: in a co-op Challenge, always the Boss. */
  readonly opponent: OpponentView
  /** Which seat that is. Named so the UI can label it without guessing. */
  readonly opponentSeat: PlayerId
  /**
   * Teammates, in seat order. Exactly what an opponent would be shown -- a
   * teammate's hand is not yours to see, even though the rulebook lets Raiders
   * discuss strategy out loud, because the engine has no way to tell the table
   * from the wire.
   */
  readonly allies: readonly { readonly seat: PlayerId; readonly view: OpponentView }[]
  /** Co-op team rules in force, or null. Public. */
  readonly coop: CoopState | null
  /** Seats in the game, in turn order. */
  readonly seats: readonly PlayerId[]
  readonly tradeRow: readonly (CardInstance | null)[]
  readonly tradeDeckCount: number
  readonly explorerPile: number
  readonly scrapHeap: readonly CardInstance[]
  /** Patience Rewarded's set-aside cards: buyable, and public like the row. */
  readonly setAside: readonly CardInstance[]
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
  /** The Arena scenario in force. Public: both sides play under it. */
  readonly variant: VariantState | null
  /** Buyer's Market: counters on trade row cards. Public. */
  readonly marketCounters: Readonly<Record<string, number>>
}

function viewInPlay(c: InPlayCard): InPlayCardView {
  return {
    iid: c.iid,
    def: c.def,
    copiedDef: c.copiedDef,
    used: {
      primary: c.used.primary, ally: c.used.ally,
      ally2: c.used.ally2, ally3: c.used.ally3, ally4: c.used.ally4,
      doubleAlly: c.used.doubleAlly, scrap: c.used.scrap, splinter: c.used.splinter,
    },
    playedThisTurn: c.playedThisTurn,
  }
}

/** The def of a card, looked up in FACE-UP ZONES ONLY. See `sourceDef`. */
function publicDefOf(s: GameState, iid: CardIid | null): CardDefId | null {
  if (iid === null) return null
  for (const seat of s.seats) {
    const p = s.players[seat]
    for (const c of p.inPlay) if (c.iid === iid) return c.copiedDef ?? c.def
    for (const c of p.gambitsInPlay) if (c.iid === iid) return c.def
  }
  for (const c of s.tradeRow) if (c && c.iid === iid) return c.def
  for (const c of s.setAside) if (c.iid === iid) return c.def
  for (const c of s.scrapHeap) if (c.iid === iid) return c.def
  return null
}

function redactChoice(s: GameState, c: PendingChoice, viewer: PlayerId): PendingChoiceView {
  // A forced-discard choice's options literally ARE the opponent's hand. Sending
  // them to both players is the single most common hand leak in this design.
  const isActor = c.actor === viewer
  return {
    id: c.id,
    actor: c.actor,
    prompt: c.prompt,
    source: c.source,
    sourceDef: publicDefOf(s, c.source),
    label: c.label,
    min: c.min,
    max: c.max,
    options: isActor ? c.options : null,
    optionCount: c.options.length,
  }
}

/** The other side, as the physical game shows it: face-up zones and counts. */
function viewOpponent(st: GameState['players'][PlayerId]): OpponentView {
  return {
    authority: st.authority,
    handCount: st.hand.length,
    gambitCount: st.gambits.length,
    missionCount: st.missions.length,
    gambitsInPlay: st.gambitsInPlay.map(viewInPlay),
    missionsDone: [...st.missionsDone],
    discard: st.discard.map((c) => ({ iid: c.iid, def: c.def })),
    inPlay: st.inPlay.map(viewInPlay),
    deckCount: st.deck.length,
    trade: st.trade,
    combat: st.combat,
    allyUnlocked: [...st.allyUnlocked],
    factionPlayedThisTurn: { ...st.factionPlayedThisTurn },
  }
}

export function redact(s: GameState, viewer: PlayerId): PlayerView {
  const meState = s.players[viewer]
  const oppId = foeOf(s, viewer)
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
    actors: [...actorsOf(s)],
    seats: [...s.seats],
    coop: s.coop ? { ...s.coop, eliminated: [...s.coop.eliminated] } : null,
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
      gambits: meState.gambits.map((c) => ({ iid: c.iid, def: c.def })),
      missions: meState.missions.map((c) => ({ iid: c.iid, def: c.def })),
      gambitsInPlay: meState.gambitsInPlay.map(viewInPlay),
      missionsDone: [...meState.missionsDone],
      shipsPlayedThisTurn: meState.shipsPlayedThisTurn.map((c) => ({ iid: c.iid, def: c.def })),
      alliesUsedThisTurn: meState.alliesUsedThisTurn.map((u) => ({ def: u.def, slot: u.slot })),
      gainedThisTurn: { ...meState.gainedThisTurn },
      factionPlayedThisTurn: { ...meState.factionPlayedThisTurn },
    },
    opponent: viewOpponent(oppState),
    opponentSeat: oppId,
    allies: s.seats
      .filter((seat) => seat !== viewer && seat !== oppId)
      .map((seat) => ({ seat, view: viewOpponent(s.players[seat]) })),
    tradeRow: s.tradeRow.map((c) => (c ? { iid: c.iid, def: c.def } : null)),
    tradeDeckCount: s.tradeDeck.length,
    explorerPile: s.explorerPile,
    scrapHeap: s.scrapHeap.map((c) => ({ iid: c.iid, def: c.def })),
    setAside: s.setAside.map((c) => ({ iid: c.iid, def: c.def })),
    pendingChoice: choice ? redactChoice(s, choice, viewer) : null,
    winner: s.winner,
    scenario: s.scenario,
    basesDestroyed: Object.fromEntries(
      s.seats.map((seat) => [seat, s.basesDestroyed[seat]]),
    ) as Record<PlayerId, number>,
    boss: s.boss,
    variant: s.variant ? { ...s.variant } : null,
    marketCounters: { ...s.marketCounters },
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
