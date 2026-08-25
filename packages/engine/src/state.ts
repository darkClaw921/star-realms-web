import type { CardDefId, CardInstance, CardIid, Faction, PlayerId } from './ids'
import type { AbilitySlot, AcquireDest, AcquireRedirect, Effect, EffectBranch } from './effects'
import type { PendingChoice } from './choices'
import type { RngState } from './rng'
import type { BossState } from './boss'
import type { CoopState } from './coop'
import { sharedTurn } from './coop'
import type { ScenarioRules } from './scenario'
import type { WagerState } from './wagers'
import type { VariantState } from './variants'

export const ENGINE_VERSION = 2

/** Starting authority for a standard 2-player game. */
export const STARTING_AUTHORITY = 50
export const TRADE_ROW_SIZE = 5
export const EXPLORER_PILE_SIZE = 10
export const HAND_SIZE = 5
/** The first player's very first hand only. */
export const FIRST_TURN_HAND_SIZE = 3
export const EXPLORER_COST = 2

// Re-exported so the many modules that already import it from here keep working.
export type { CardInstance }

export interface InPlayCard {
  readonly iid: CardIid
  readonly def: CardDefId
  /** Улучшения этой копии. Переезжают вместе с картой из зоны в зону. */
  readonly up?: number
  /**
   * Stealth Needle only: the ship it copied. The Needle then has that ship's
   * abilities AND its faction, in addition to Machine Cult.
   */
  copiedDef: CardDefId | null
  /**
   * The Colossus: the faction chosen as it was played. A real faction for every
   * purpose -- other cards' ally conditions see it, and so does its own count.
   */
  chosenFaction: Faction | null
  /** Once-per-turn bookkeeping, cleared at the start of the controller's turn. */
  used: {
    primary: boolean
    /**
     * Up to four ally slots. Four is the printed ceiling: Promo Pack 1's
     * Mercenary Garrison carries one ability per faction, and no card in any set
     * carries more. Named slots rather than a list because the ACTIVATE action
     * is part of the wire protocol and of every stored replay.
     */
    ally: boolean
    ally2: boolean
    ally3: boolean
    ally4: boolean
    doubleAlly: boolean
    scrap: boolean
    /** Lost Fleet's Splinter, spent by discarding three matching Shards. */
    splinter: boolean
  }
  /** False for bases held over from a previous turn. */
  playedThisTurn: boolean
}

export interface PlayerState {
  authority: number
  /** index 0 = TOP. Order is secret even from its owner. */
  deck: CardInstance[]
  /** Secret from the opponent. */
  hand: CardInstance[]
  /** Public: discard piles are face up in Star Realms. */
  discard: CardInstance[]
  /** Ships played this turn plus all bases/outposts. Public. */
  inPlay: InPlayCard[]
  trade: number
  combat: number
  /**
   * Cards of each faction PLAYED FROM HAND this turn. Blob World reads this.
   * Not incremented by acquisitions, nor by a Stealth Needle copy (the copy
   * happens after the card has already entered play).
   */
  factionPlayedThisTurn: Record<Faction, number>
  /**
   * Factions whose ally condition has been met at some point this turn.
   * Once triggered, an ally ability stays available for the rest of the turn even
   * if the enabling card leaves play -- the rulebook is trigger-then-use.
   */
  allyUnlocked: Faction[]
  /**
   * Factions with THREE cards in play, which is what a Double Ally needs. Kept
   * separate from allyUnlocked, and like it, never un-unlocks once triggered.
   */
  doubleAllyUnlocked: Faction[]
  /**
   * Ships played from hand this turn, in order. Stealth Needle copies from this
   * list rather than from `inPlay`, because a ship played this turn and then
   * scrapped is still a legal copy target.
   */
  shipsPlayedThisTurn: CardInstance[]
  /**
   * Armed "put the next card you acquire this turn somewhere else" effects, in
   * the order they were armed. These STACK (official ruling): each qualifying
   * acquisition consumes exactly one, the player picks which when more than one
   * matches, and unused ones expire at end of turn.
   */
  pendingRedirects: AcquireRedirect[]
  /** Cards this player has scrapped this turn. Reclamation Station reads it. */
  scrappedThisTurn: number
  /**
   * Ally abilities already used this turn, in order. Stellar Allies' Needle
   * Lancer copies one of them, so the list has to survive the card that used it
   * leaving play -- which is why it stores definitions and slots, not instances.
   */
  alliesUsedThisTurn: {
    iid: CardIid
    def: CardDefId
    slot: 'ally' | 'ally2' | 'ally3' | 'ally4' | 'doubleAlly'
  }[]
  /**
   * High Alert's Stealth: factions you count as having an extra card of this
   * turn. Phantom cards -- they satisfy ally conditions and nothing else, and
   * they are cleared with the rest of the per-turn bookkeeping.
   */
  phantomFactions: Faction[]
  /**
   * Gambit cards dealt to this player and not yet revealed. Secret to their
   * owner: an opponent who knew them would play around them, and the whole
   * point of dealing them face down is that they cannot.
   */
  gambits: CardInstance[]
  /**
   * Revealed gambits that keep applying. One-shots never land here.
   *
   * InPlayCard rather than CardInstance because several of them have abilities
   * you activate -- once per turn, so they need the same used-flag bookkeeping
   * every other card in play has.
   */
  gambitsInPlay: InPlayCard[]
  /** Missions dealt to this player and not yet completed. Secret, like gambits. */
  missions: CardInstance[]
  /** Missions completed. Completing all of them wins the game outright. */
  missionsDone: CardDefId[]
  /**
   * Resources gained this turn, for Diversify -- which asks what you GAINED,
   * not what you still have, so a spent trade point still counts.
   */
  gainedThisTurn: { trade: number; combat: number; authority: number }
  /** Pact Dominion fires on the FIRST authority gain of each of your turns. */
  gainedAuthorityThisTurn: boolean
  /** Rapid Construction: whether this turn's first acquisition has happened. */
  acquiredThisTurn: boolean
  /**
   * Armed "the next card of this faction costs less" discounts. Like the
   * acquisition redirects they stack and expire at end of turn.
   */
  pendingDiscounts: { faction: Faction; n: number }[]
  /** Cards that return from the scrap heap to the discard pile at end of turn. */
  returnAtEndOfTurn: CardIid[]
  /**
   * Cards drawn at the end of your turn. Five, unless a Legendary Commander
   * says otherwise -- their hand size is the whole of what makes one commander
   * feel different from another before a single card is played.
   */
  handSize: number
  /** The Legendary Commander in charge, or null in an ordinary game. Public. */
  commander: CardDefId | null
  /**
   * Забег: пари, взятое на этот ход, или null.
   *
   * Публично: ставка соперника — часть того, что он делает на столе, и прятать
   * её значило бы прятать причину его хода.
   */
  wager: WagerState | null
}

export interface EffectCtx {
  readonly controller: PlayerId
  readonly source: CardIid | null
  readonly slot: AbilitySlot
  /**
   * Aims "the opponent" at one seat instead of at everyone.
   *
   * Only the Boss needs it, and only in co-op: Pirates of the Dark Star reveals
   * one card per player and does what that card says TO THAT PLAYER, and the
   * Dimensional Horror affects only the player whose turn just ended. Plain
   * data, like every other field here, so a suspended boss turn still
   * round-trips through JSON.
   */
  readonly target?: PlayerId
}

/**
 * Data a choice needs in order to apply its answer.
 *
 * This is the continuation, expressed as DATA. A closure would be the obvious
 * implementation and is exactly what must not be used: the resolution stack lives
 * inside GameState, so every frame has to survive JSON round-tripping,
 * persistence, replay and version migration.
 */
export type ChoiceCont =
  | { c: 'BRANCHES'; branches: readonly EffectBranch[] }
  | { c: 'ACQUIRE'; dest: AcquireDest }
  | { c: 'MAY'; then: readonly Effect[] }
  /**
   * Which armed redirect to spend on the card just acquired. `dests` is parallel
   * to the choice's BRANCH options, and `redirects` indexes back into the
   * player's armed list so exactly the chosen one is consumed.
   */
  | { c: 'REDIRECT'; iid: CardIid; dests: readonly AcquireDest[]; redirects: readonly number[] }
  /** One card discarded for Supply Depot; the branch decides trade or combat. */
  | { c: 'DISCARD_RESOURCE'; per: number }
  /** Black Hole: the penalty depends on how far short of `max` the answer was. */
  | { c: 'DISCARD_OR_LOSE'; max: number; per: number }
  /** Bombardment: declining to destroy a base is choosing the authority loss. */
  | { c: 'DESTROY_OR_LOSE'; n: number }
  /** Stealth: how many phantom cards of the chosen faction to add. */
  | { c: 'PHANTOM'; n: number }
  /** The Colossus: which in-play card the chosen faction is being pinned to. */
  | { c: 'OWN_FACTION'; iid: CardIid }
  /** Mech Command Ship / Mech Wurm: pay `per` of `what` per card scrapped. */
  | { c: 'SCRAP_GAIN'; per: number; what: 'trade' | 'combat' | 'authority' }
  /** Mech Battleship: draw and then discard as many as were scrapped. */
  | { c: 'SCRAP_DRAW_DISCARD' }
  /** Midgate Station: the resource is worth the discards plus this. */
  | { c: 'DISCARD_PLUS'; plus: number }
  /** Convert's reward: which of the three revealed cards still need a home. */
  | { c: 'REVEAL_SPLIT'; iids: readonly CardIid[]; dest: 'hand' | 'discard' }
  /** Needle Lancer: the ally abilities on offer, parallel to the branch options. */
  | { c: 'COPY_ALLY'; used: readonly { def: CardDefId; slot: string }[] }

/** One item on the resolution stack. Both variants are plain JSON. */
export type ResolutionFrame =
  | { f: 'effect'; effect: Effect; ctx: EffectCtx }
  | { f: 'choice'; choice: PendingChoice; cont?: ChoiceCont }

/**
 * A fight, in five numbers.
 *
 * The per-turn pairs keep a running value and the best turn so far, because
 * "twenty damage in one turn" is not answerable from a total -- and a total is
 * not answerable from a maximum, so both are kept.
 */
export interface FightTally {
  /** Combat damage put into the opponent, this turn and on the best turn. */
  dmg: number
  dmgBest: number
  /** Cards PAID for, this turn and on the best turn. A free acquisition is not a buy. */
  buys: number
  buysBest: number
  /** Cards this side scrapped, all fight. `scrappedThisTurn` resets; this does not. */
  scrapped: number
}

export function emptyTally(): FightTally {
  return { dmg: 0, dmgBest: 0, buys: 0, buysBest: 0, scrapped: 0 }
}

export interface GameState {
  readonly engineVersion: number
  readonly matchId: string
  /** Number of commands applied. Used for optimistic concurrency. */
  version: number
  turn: number
  /**
   * Seats in the game, in turn order, with the Boss last when there is one.
   * Everything that means "for every player" iterates THIS, never the seat
   * type -- a two-player duel must stay exactly two players.
   */
  seats: PlayerId[]
  /** The Challenge boss's seat, or null in a game without one. */
  bossSeat: PlayerId | null
  /** Co-operative team rules in force, or null. Public. */
  coop: CoopState | null
  activePlayer: PlayerId
  phase: 'main' | 'gameOver'
  /**
   * Every seat has a PlayerState, occupied or not. `seats` says which of them
   * are playing; the rest are inert and are never dealt, drawn or shown.
   */
  players: Record<PlayerId, PlayerState>
  /**
   * Public. Always exactly TRADE_ROW_SIZE entries; a bought slot becomes null
   * until refilled. Fixed slots keep the UI's card animations stable, and match
   * the physical game where the replacement card fills the gap in place.
   */
  tradeRow: (CardInstance | null)[]
  /** Contents are derivable from public play; the ORDER is secret. */
  tradeDeck: CardInstance[]
  explorerPile: number
  /** Removed from the game. Public. */
  scrapHeap: CardInstance[]
  /**
   * Patience Rewarded: cards set aside from the trade row, which stay buyable
   * for the rest of the game "as if they were in the trade row". Public, and a
   * separate list rather than extra row slots -- the row has a fixed size and
   * refills, and these do neither.
   */
  setAside: CardInstance[]
  /** Gambits nobody was dealt. Wild Gambit deals itself more from here. */
  unclaimedGambits: CardInstance[]
  /**
   * Cosmic Gambit's Black Market: extra trade row slots, and who may buy from
   * them a point cheaper. The slots are public and shared; only the discount
   * belongs to one player.
   */
  extraRowSlots: number
  blackMarketOwner: PlayerId | null
  /** The Black Market discount is once per turn, not once per purchase. */
  blackMarketUsedThisTurn: boolean
  /** LIFO. Index 0 is the next thing to do. */
  resolution: ResolutionFrame[]
  /** SERVER ONLY. Must never appear in any PlayerView, event, log or error. */
  rng: RngState
  winner: PlayerId | null
  /**
   * Campaign rules in force, or null for a standard game. Public: both sides
   * must be able to see what they are playing under.
   */
  scenario: ScenarioRules | null
  /** Enemy bases each side has destroyed. Only a DESTROY_BASES objective reads
   *  it, but it is cheap and public, so it is always tracked. */
  basesDestroyed: Record<PlayerId, number>
  /**
   * What each side has managed this fight. Public, and tracked always, for the
   * same reason `basesDestroyed` is: five integers cost nothing, and the
   * alternative is a rules-engine that cannot answer "how hard did they hit".
   *
   * Nothing in the reducer reads it -- a run's feats do, from outside. That is
   * on purpose: the engine counts, and what a count is WORTH is somebody else's
   * question.
   */
  tally: Record<PlayerId, FightTally>
  /** A Frontiers Challenge boss, or null. Entirely public. */
  boss: BossState | null
  /** The Arena scenario in force, or null. Entirely public. */
  variant: VariantState | null
  /**
   * Buyer's Market: counters sitting on trade row cards, keyed by instance.
   * Public, and keyed by iid rather than by slot because a counter belongs to
   * the card, and the card can be bought out from under the slot.
   */
  marketCounters: Record<string, number>
}

export function emptyFactionCounts(): Record<Faction, number> {
  return { trade_federation: 0, blob: 0, star_empire: 0, machine_cult: 0, unaligned: 0 }
}

/** The choice currently blocking resolution, if any. */
export function currentChoice(s: GameState): PendingChoice | null {
  const top = s.resolution[0]
  return top && top.f === 'choice' ? top.choice : null
}

/**
 * Who is allowed to act right now.
 *
 * Input ownership is NOT turn ownership: a forced discard is answered by the
 * non-active player. Authorization must consult this, never `activePlayer`.
 */
export function actorOf(s: GameState): PlayerId {
  return actorsOf(s)[0] as PlayerId
}

/**
 * Everyone allowed to act right now.
 *
 * Usually one seat. A Hydra team shares its Main, Discard and Draw Phases, so
 * during the team's turn every living teammate may play, buy, activate and
 * attack -- the rulebook has them acting together at the table, and there is no
 * printed order between them. A pending choice always narrows this back to the
 * one player who has to answer it.
 */
export function actorsOf(s: GameState): readonly PlayerId[] {
  const choice = currentChoice(s)
  if (choice) return [choice.actor]
  const c = s.coop
  if (c && sharedTurn(c.mode) && c.players.includes(s.activePlayer)) {
    const live = c.players.filter((p) => !c.eliminated.includes(p))
    return live.length > 0 ? live : [s.activePlayer]
  }
  return [s.activePlayer]
}
