import type { Effect } from '../effects'
import type { Spec } from './types'

/**
 * The four Arena scenarios whose rule is something a player DOES rather than
 * something that is simply true.
 *
 * They are cards because that is the shape the rule has: a once-per-turn
 * ability, sometimes with a price. Each player gets a copy in front of them,
 * face up from the start -- so they reuse the revealed-gambit zone rather than
 * inventing a fifth place for a card to live.
 *
 * The wording is quoted from the publisher's own Arena Tips articles, which are
 * the only place the Scenario cards' text appears.
 */

const combat = (n: number): Effect => ({ k: 'GAIN_COMBAT', n })

const scenario = (
  name: string, primary: Effect[], text: string, extra: Partial<Spec> = {},
): Spec => ({
  name, faction: 'unaligned', cost: 0, type: 'ship', defense: null,
  copies: 0, role: 'token',
  activated: true,
  primary,
  text: { primary: text, ally: '', scrap: '' },
  ...extra,
})

export const VARIANT_CARDS: Record<string, Spec> = {
  'sc-total-war': scenario('Total War', [combat(3)],
    'Once per turn a player may pay {trade:1} to gain {combat:3}',
    { primaryCost: 1 }),
  'sc-emergency-repairs': scenario('Emergency Repairs',
    [{ k: 'SHUFFLE_DISCARD_INTO_DECK' }],
    'Once per turn, you may pay {trade:1} to shuffle your discard pile into your deck.',
    { primaryCost: 1 }),
  'sc-ruthless-efficiency': scenario('Ruthless Efficiency',
    [{ k: 'SCRAP_FROM_ZONES', zones: ['hand'], min: 1, max: 1 }],
    'Each player can spend {trade:1} to scrap a card in their hand.',
    { primaryCost: 1 }),
  'sc-maximum-warp': scenario('Maximum Warp', [{ k: 'DRAW', n: 1 }],
    "At the start of each player's turn, they draw a card.",
    // Not activated: it simply happens, like Frontier Fleet's combat.
    { activated: false }),
}

/** Scenarios whose rule is simply true, and so have no ability to activate. */
export const VARIANT_NOTES: Record<string, string> = {
  'rushed-defenses': 'Bases go directly into play when acquired, and are scrapped ' +
    'when destroyed.',
  'recruiting-drive': 'Whenever a player acquires a ship, they put it on top of their ' +
    'deck. Bases cost {trade:1} less to acquire.',
  'entrenched-loyalties': 'At the start of the game, each player is assigned a faction ' +
    'at random. Cards of that faction cost that player {trade:1} less to acquire.',
  'commitment-to-the-cause': 'Scouts and Explorers produce an additional {trade:1} ' +
    'Vipers produce an additional {combat:1}',
  'frontier-expedition': 'Each player starts the game with two Explorers in the place ' +
    'of two Scouts in their starting deck.',
  'frantic-preparations': "Before the game begins, a Viper and a Scout are removed from " +
    "each player's deck.",
}
