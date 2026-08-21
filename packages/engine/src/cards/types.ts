import { asDefId, type CardDefId, type CardType, type Faction } from '../ids'
import type { Effect, Trigger } from '../effects'

/** How a card enters the game. Only `trade_deck` cards are shuffled into the trade deck. */
export type CardRole =
  | 'trade_deck'
  | 'starter'
  | 'explorer'
  /**
   * Gambit: dealt face down at setup, never shuffled into anything. Revealed at
   * the start of the game or during your main phase.
   */
  | 'gambit'
  /** United: three dealt face down to each player; completing all three wins. */
  | 'mission'
  /** A card that only ever enters play from another card. Secret Outpost. */
  | 'token'
  /**
   * A Command Deck card: it makes up that commander's personal starting deck
   * and is never in the trade deck. The one exception per deck -- the 8-cost
   * megaship -- carries `role: 'trade_deck'` instead and IS shuffled in.
   */
  | 'command'
  /** The Legendary Commander itself: hand size and starting authority, no more. */
  | 'commander'

/**
 * Which product a card comes from.
 *
 * The point of carrying this on the card rather than in a separate list is that
 * turning a set on or off is then a filter over the registry, and a card can
 * never end up in a deck whose set is disabled.
 */
export type SetId =
  | 'core'
  | 'frontiers'
  | 'colony-wars'
  | 'crisis-bases'
  | 'crisis-fleets'
  | 'crisis-heroes'
  | 'crisis-events'
  | 'united-assault'
  | 'united-command'
  | 'united-heroes'
  | 'high-alert-first-strike'
  | 'high-alert-tech'
  | 'high-alert-requisition'
  | 'high-alert-invasion'
  | 'high-alert-heroes'
  | 'stellar-allies'
  | 'promo-1'
  | 'promo-year-2'
  | 'frontiers-promos'
  | 'gambits'
  | 'cosmic-gambits'
  | 'missions'
  | 'command-decks'

/**
 * Printed card text, as tokens. `{trade:2}` / `{combat:4}` / `{authority:3}` are
 * replaced with icons by the renderer.
 *
 * Kept separate from `Effect[]`: effects are what the engine executes, this is what
 * the player reads. Text is NEVER parsed to drive game logic -- the arrow only ever
 * points effects -> text.
 */
export interface CardText {
  readonly primary: string
  readonly ally: string
  /** United: the second faction's ally ability on a dual-faction card. */
  readonly ally2?: string
  readonly ally3?: string
  readonly ally4?: string
  /** Lost Fleet: what three matching Shards buy. */
  readonly splinter?: string
  /** Frontiers: needs TWO other cards of the faction, not one. */
  readonly doubleAlly?: string
  readonly scrap: string
}

/**
 * A mission's objective, as data.
 *
 * Evaluated against the player's own state at the end of every action, so each
 * one has to be answerable from what the engine already tracks -- which is why
 * two of them added per-turn counters rather than being approximated.
 */
export type MissionObjective =
  /** Ally: ally abilities from two different factions in the same turn. */
  | { o: 'ALLY_FACTIONS_THIS_TURN'; n: number }
  /** Armada: play seven or more ships in the same turn. */
  | { o: 'SHIPS_PLAYED_THIS_TURN'; n: number }
  /** Unite: three ships from DIFFERENT factions in the same turn. */
  | { o: 'SHIP_FACTIONS_PLAYED_THIS_TURN'; n: number }
  /** Colonize: two or more bases of the same faction in play. */
  | { o: 'BASES_SAME_FACTION'; n: number }
  /** Rule: bases from two or more factions in play. */
  | { o: 'BASE_FACTIONS'; n: number }
  /** Influence: three ships and/or bases of the same faction in play. */
  | { o: 'CARDS_SAME_FACTION_IN_PLAY'; n: number }
  /** Defend: two or more outposts in play. */
  | { o: 'OUTPOSTS_IN_PLAY'; n: number }
  /** Convert / Dominate / Exterminate / Monopolize: a ship beside its own base. */
  | { o: 'SHIP_PLAYED_WITH_BASE'; faction: Faction }
  /** Diversify: gain this much trade AND combat AND authority in one turn. */
  | { o: 'GAINED_THIS_TURN'; trade: number; combat: number; authority: number }

export interface CardDef {
  readonly id: CardDefId
  readonly set: SetId
  readonly name: string
  readonly faction: Faction
  /**
   * United: a card can belong to TWO factions at once. It counts as both for
   * every ally condition, and each faction may carry its own ally ability.
   */
  readonly faction2?: Faction
  readonly cost: number
  readonly type: CardType
  /** null for ships. */
  readonly defense: number | null
  /** Copies in the 80-card trade deck. 0 for starters and Explorer. */
  readonly copies: number
  /**
   * High Alert: "Pay 1 Trade less to acquire this card for each <faction> card
   * you have in play." A discount, never a surcharge, and it floors at zero.
   */
  readonly discount?: { readonly faction: Faction; readonly per: number }
  /**
   * High Alert's Tech: the trade you must pay to use the primary. A Tech is not
   * spent by using it, so this is the whole of what limits it -- that and once
   * per turn.
   */
  readonly primaryCost?: number
  /**
   * Frontiers promo "Docking": during the discard phase, if you have a base of
   * this faction in play, the card is set aside instead of discarded and comes
   * back to your hand at the end of the draw phase.
   *
   * Not a triggered ability, because it fires during a phase where no ability
   * can be activated -- it is a property of the card that the end of turn reads.
   */
  readonly docking?: Faction
  /**
   * Gambits: what happens when the card is revealed, before anything else. An
   * ongoing gambit has none -- it simply starts applying.
   */
  readonly onReveal?: readonly Effect[]
  /** Missions: the objective that claims the card, and what claiming it pays. */
  readonly objective?: MissionObjective
  /** Cosmic Gambit's Secret Outpost: destroyed means gone, not discarded. */
  readonly removeOnDestroy?: boolean
  /**
   * Energy Shield: how much damage this card soaks off an attack on its OWNER.
   * Its own field rather than a reuse of `defense`, which means "what an attack
   * has to get through to destroy this card" and belongs to bases alone.
   */
  readonly damageReduction?: number
  /**
   * An ongoing gambit whose primary is ACTIVATED once per turn rather than
   * granted at the start of it. Frontier Fleet pays automatically; Alliance
   * Procurement waits to be asked.
   */
  readonly activated?: boolean
  /** Unity Warcraft: your bases get +1 defense and the opponent's get -1. */
  readonly baseDefenseBonus?: number
  /** Pact Dominion: the first time you gain authority each turn, also do this. */
  readonly onFirstAuthority?: readonly Effect[]
  /** Legendary Commanders set the hand size and the starting authority. */
  readonly commander?: { readonly handSize: number; readonly authority: number }
  /**
   * Lost Fleet's Splinter: play three matching Shards in a turn and you may
   * discard that set of three from play to use this. A slot of its own, because
   * the cost is the three cards -- nothing else in the game spends its own
   * copies that way.
   */
  readonly splinter: readonly Effect[]
  /** Command Shard: counts as any Shard name when matching a Splinter set. */
  readonly splinterWildcard?: boolean
  readonly role: CardRole
  /** Ships: resolved immediately and mandatorily on play. Bases: activatable once per turn. */
  readonly primary: readonly Effect[]
  /** Needs another card of the same faction in play. Once per turn, optional. */
  readonly ally: readonly Effect[]
  /**
   * Which faction unlocks `ally`. Undefined means "any of this card's own
   * factions" -- which is both the ordinary single-faction case and United's
   * "Coalition Ally (Machine Cult or Trade Federation)", where either will do.
   */
  readonly allyFaction?: Faction
  /**
   * Further per-faction ally abilities, independent of `ally` and of each other.
   * Four is the printed ceiling -- Promo Pack 1's Mercenary Garrison carries one
   * per faction, and no card in any set carries more.
   */
  readonly ally2: readonly Effect[]
  readonly ally2Faction?: Faction
  readonly ally3: readonly Effect[]
  readonly ally3Faction?: Faction
  readonly ally4: readonly Effect[]
  readonly ally4Faction?: Faction
  /**
   * Frontiers' Double Ally: needs TWO other cards of the faction, so three of
   * that faction in play counting this one. A separate slot rather than a flag
   * on `ally` because both can be used in the same turn.
   */
  readonly doubleAlly: readonly Effect[]
  /** Removes the card from play to the scrap heap. Once, optional. */
  readonly scrap: readonly Effect[]
  /** Fires on an event rather than being activated. Fleet HQ is the only base-set user. */
  readonly triggers: readonly Trigger[]
  /** Mech World: satisfies the ally condition of every faction at once. */
  readonly factionWildcard: boolean
  readonly text: CardText
}

export type CardRegistry = ReadonlyMap<CardDefId, CardDef>

/**
 * A card table entry with the boilerplate left out.
 *
 * Lives here rather than in registry.ts so that a set's card table can import
 * it without importing the registry that imports the set.
 */
export type Spec =
  Omit<CardDef,
    'id' | 'set' | 'ally' | 'ally2' | 'ally3' | 'ally4'
    | 'doubleAlly' | 'scrap' | 'splinter' | 'triggers' | 'factionWildcard'> &
  Partial<Pick<CardDef,
    'set' | 'ally' | 'ally2' | 'ally3' | 'ally4'
    | 'doubleAlly' | 'scrap' | 'splinter' | 'triggers' | 'factionWildcard'>>

/** Fills in everything a spec leaves out. Shared by every set's card table. */
export function buildDefs(defs: Record<string, Spec>, set: SetId): [CardDefId, CardDef][] {
  return Object.entries(defs).map(([id, s]) => [
    asDefId(id),
    {
      id: asDefId(id),
      set: s.set ?? set,
      ...s,
      ally: s.ally ?? [],
      ally2: s.ally2 ?? [],
      splinter: s.splinter ?? [],
      ally3: s.ally3 ?? [],
      ally4: s.ally4 ?? [],
      doubleAlly: s.doubleAlly ?? [],
      scrap: s.scrap ?? [],
      triggers: s.triggers ?? [],
      factionWildcard: s.factionWildcard ?? false,
    } satisfies CardDef,
  ])
}
