import type { Faction, PlayerId } from './ids'
import { nextInt, seedRng } from './rng'
import type { FightTally } from './state'

/**
 * Пари — ставка на собственный ход.
 *
 * Ours, like the run it belongs to. A run gives you a deck that grows and
 * relics that change rules; what it did not have was anything to decide DURING
 * a fight. A wager is that decision: once a turn you may bet that this turn
 * will be a big one, and the bet is worth taking only when you can already see
 * how the turn goes. Winning upgrades a card for the rest of the run; losing
 * costs authority, which in a run is the thing you cannot get back cheaply.
 *
 * Deliberately readable off counters the engine already keeps. A wager that
 * needed its own bookkeeping would be a rule the reducer has to enforce; this
 * way it is arithmetic over a turn that was going to be counted anyway.
 */
export type WagerId = 'blitz' | 'buyout' | 'armada' | 'purge' | 'windfall'

export interface Wager {
  readonly id: WagerId
  /** What is counted, all within the turn the wager was taken. */
  readonly k: 'DAMAGE' | 'BUYS' | 'PLAYED' | 'SCRAPPED' | 'TRADE'
  readonly n: number
  /** Authority lost if the turn ends with the bet unmet. */
  readonly stake: number
}

/**
 * The five bets.
 *
 * Each asks for a different kind of turn, so which one is on offer changes
 * which turn you want to build -- and one of them is always a bad bet for the
 * deck you happen to have, which is what makes taking it a decision.
 */
export const WAGERS: readonly Wager[] = [
  { id: 'blitz', k: 'DAMAGE', n: 10, stake: 4 },
  { id: 'buyout', k: 'BUYS', n: 2, stake: 3 },
  { id: 'armada', k: 'PLAYED', n: 4, stake: 3 },
  { id: 'purge', k: 'SCRAPPED', n: 2, stake: 3 },
  { id: 'windfall', k: 'TRADE', n: 8, stake: 4 },
]

export function wagerById(id: string): Wager | null {
  return WAGERS.find((w) => w.id === id) ?? null
}

/**
 * Which bet is on the table for this seat, this turn.
 *
 * Derived from the match and the turn number rather than stored: it must be the
 * same for anyone who looks -- the board, the reducer, a replay -- and a stored
 * offer is one more thing that can disagree with itself. The seat is in the
 * seed so the two sides are not always offered the same bet.
 */
export function wagerFor(matchId: string, turn: number, seat: PlayerId): Wager {
  const [i] = nextInt(seedRng(`${matchId}:wager:${turn}:${seat}`), WAGERS.length)
  return WAGERS[i] as Wager
}

/** Everything a wager can read. Available from a state and from a PlayerView. */
export interface WagerSource {
  readonly tally: FightTally
  /** Cards played from hand this turn. */
  readonly played: number
  readonly scrapped: number
  /** Trade GAINED this turn -- spending it is what the bet is for. */
  readonly trade: number
}

/**
 * Одна функция и для состояния, и для вида.
 *
 * У PlayerState и у SelfView одни и те же поля счётчиков хода, а тип у них
 * разный — поэтому берутся куски, а не целое: иначе движок и стол считали бы
 * ход по двум разным формулам и рано или поздно разошлись бы.
 */
export function wagerSourceOf(tally: FightTally, p: {
  readonly factionPlayedThisTurn: Record<Faction, number>
  readonly scrappedThisTurn: number
  readonly gainedThisTurn: { readonly trade: number }
}): WagerSource {
  return {
    tally,
    played: Object.values(p.factionPlayedThisTurn).reduce((a, b) => a + b, 0),
    scrapped: p.scrappedThisTurn,
    trade: p.gainedThisTurn.trade,
  }
}

export function wagerProgress(
  w: Wager, s: WagerSource,
): { have: number; need: number; met: boolean } {
  const have = w.k === 'DAMAGE' ? s.tally.dmg
    : w.k === 'BUYS' ? s.tally.buys
      : w.k === 'PLAYED' ? s.played
        : w.k === 'SCRAPPED' ? s.scrapped
          : s.trade
  return { have, need: w.n, met: have >= w.n }
}

/** A wager in force, on a player's state. */
export interface WagerState {
  readonly id: WagerId
  /** The turn it was taken on. A bet is settled by the end of that turn. */
  readonly turn: number
  /** Already paid out. A bet is won once, however far past the number the turn goes. */
  readonly won: boolean
}
