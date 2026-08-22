import type { PlayerId } from './ids'

/**
 * CO-OPERATIVE CHALLENGES: several players against one Boss.
 *
 * SOURCE. All of it is the Star Realms: Frontiers rulebook -- the Hydra team
 * rules on page 17, the Challenge Card rules and difficulty levels on pages
 * 21-23, the Boss Attacks algorithm on page 24, and each challenge's own setup
 * and player-count scaling on pages 25-40. Nothing here is invented; where the
 * rulebook is silent, the deviation is marked DEVIATION and says what it does
 * instead and why.
 *
 * The rulebook does not give co-op one set of team rules. It gives three, and
 * which one a table plays under is printed on the challenge:
 *
 *   HYDRA      "players are a Hydra team (see page 17)" -- six of the eight
 *              challenges. One shared Authority score for the whole team, one
 *              shared turn, and Trade and Combat freely transferable between
 *              teammates. Each player still has their own deck, hand, discard
 *              pile and play area, so a teammate's cards never trigger your
 *              Ally abilities. As long as ANY teammate has an Outpost in play,
 *              the team may not be attacked and its non-Outpost bases may not
 *              be attacked or targeted.
 *
 *   POOLED     Pirates of the Dark Star: "players have individual Authority
 *              and can be individually eliminated. However, players have a
 *              shared turn, and pool their Trade and Combat like a Hydra team."
 *              So: the shared turn and the transfers, but every player dies on
 *              their own. Outpost protection is therefore individual too --
 *              the team-wide shield on page 17 is stated as a consequence of
 *              the shared Authority score, which this mode does not have.
 *
 *   INDIVIDUAL Dimensional Horror: "Players take individual turns ... After
 *              each player's turn, the Boss takes a turn. The Boss' special
 *              abilities and attacks only affect the player whose turn just
 *              ended." No team at all -- separate Authority, separate turns,
 *              separate everything.
 */
export type TeamMode = 'hydra' | 'pooled' | 'individual'

export interface CoopState {
  /** The human seats, in turn order. Never contains the boss. */
  readonly players: readonly PlayerId[]
  readonly boss: PlayerId
  readonly mode: TeamMode
  /**
   * Seats knocked out. Only reachable in `pooled` and `individual` -- a Hydra
   * team shares one Authority score, so it dies all at once or not at all.
   */
  eliminated: PlayerId[]
  /**
   * `individual` only: the player the Boss's current turn is aimed at. The
   * Horror's abilities and attacks "only affect the player whose turn just
   * ended", so the Boss needs to remember whose that was.
   */
  bossTarget: PlayerId | null
}

export function newCoopState(
  players: readonly PlayerId[], boss: PlayerId, mode: TeamMode,
): CoopState {
  return { players: [...players], boss, mode, eliminated: [], bossTarget: null }
}

/** Do all the players take one turn together? True for Hydra and for Pirates. */
export function sharedTurn(mode: TeamMode): boolean {
  return mode === 'hydra' || mode === 'pooled'
}

/** May teammates hand each other Trade and Combat? Same two modes. */
export function poolsResources(mode: TeamMode): boolean {
  return sharedTurn(mode)
}

/**
 * The seat that physically holds a team's Authority.
 *
 * A Hydra team has ONE score, not N scores that happen to match, and the
 * difference is the whole point: five damage costs the team five, not five
 * each, and healing five heals five. Storing it on the first player and
 * mirroring it onto the others is what lets every existing rule keep reading
 * `player.authority` without knowing about teams.
 */
export function authorityHolder(c: CoopState | null, seat: PlayerId): PlayerId {
  if (c && c.mode === 'hydra' && c.players.includes(seat)) return c.players[0] as PlayerId
  return seat
}

/** Players still in the game, in turn order. */
export function livePlayers(c: CoopState): readonly PlayerId[] {
  return c.players.filter((p) => !c.eliminated.includes(p))
}

/**
 * Seats that share protection with this one.
 *
 * A Hydra team's Outpost shields the whole team (page 17). In the other two
 * modes a player is their own team of one, and so is the Boss in all of them.
 */
/**
 * WHO THE BOSS SHOOTS AT, when the ability names one player.
 *
 * Printed on Defy the Empire: "The first time the Boss makes 'target opponent
 * discard a card' on its turn, randomly determine which player it targets. It
 * will target the same player for the remainder of the turn." That is the only
 * printed guidance on the question and it is applied to every boss here, so a
 * boss card that reads "target opponent" hits one player rather than the table.
 *
 * Abilities that say "each player" -- the Nemesis Beast's whole table does --
 * say so, and go through EACH_FOE instead.
 */
export function guardTeam(c: CoopState | null, seat: PlayerId): readonly PlayerId[] {
  if (c && c.mode === 'hydra' && c.players.includes(seat)) return livePlayers(c)
  return [seat]
}
