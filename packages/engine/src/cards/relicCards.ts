import { asDefId } from '../ids'
import type { Spec } from './types'

/**
 * Реликвии забега.
 *
 * Ours, not the publisher's: Star Realms has no relics. They exist because a
 * run needs something to accumulate besides cards -- a deck gets better by
 * degrees, and a rule that changes outright is what makes one run feel unlike
 * the last.
 *
 * They are CARDS because that is what they already are. A permanent modifier
 * that watches your play, pays out at the start of your turn, or waits to be
 * activated is exactly what a revealed gambit is, and the reducer has watched
 * that zone for all of them since long before this feature existed. So a relic
 * is a `role: 'token'` card standing beside the board, like an Arena scenario
 * (see variantCards.ts) -- and the rules engine needed no new code at all to
 * make any of these work.
 *
 * `faction: 'unaligned'` throughout, and deliberately: `allyCountFor` reads the
 * play area rather than this zone, but an aligned relic would still read as a
 * faction card to a player counting allies, and that is a lie the board should
 * not tell.
 */

const relic = (name: string, text: string, extra: Partial<Spec> = {}): Spec => ({
  name,
  faction: 'unaligned',
  cost: 0,
  type: 'ship',
  defense: null,
  // Zero copies keeps it out of tradeDeckComposition no matter which sets are on.
  copies: 0,
  role: 'token',
  primary: [],
  text: { primary: text, ally: '', scrap: '' },
  ...extra,
})

const VIPER = asDefId('viper')
const SCOUT = asDefId('scout')

export const RELIC_CARDS: Record<string, Spec> = {
  'rl-viper-fangs': relic('Viper Fangs',
    'Each Viper you play gains you an additional {combat:2}.',
    { triggers: [{ on: 'PLAY_SHIP', cardId: VIPER, effects: [{ k: 'GAIN_COMBAT', n: 2 }] }] }),

  'rl-scout-scanners': relic('Scout Scanners',
    'Each Scout you play gains you an additional {trade:1}.',
    { triggers: [{ on: 'PLAY_SHIP', cardId: SCOUT, effects: [{ k: 'GAIN_TRADE', n: 1 }] }] }),

  'rl-dock-crew': relic('Dock Crew',
    'Whenever you PLAY a base from your hand, gain {authority:3}.',
    { triggers: [{ on: 'PLAY_BASE', effects: [{ k: 'GAIN_AUTHORITY', n: 3 }] }] }),

  // Two triggers rather than one: PLAY_SHIP and PLAY_BASE are separate events,
  // and a Blob base is as much a Blob card as a Blob ship.
  'rl-swarm-doctrine': relic('Swarm Doctrine',
    'Each Blob card you play gains you an additional {combat:1}.',
    {
      triggers: [
        { on: 'PLAY_SHIP', faction: 'blob', effects: [{ k: 'GAIN_COMBAT', n: 1 }] },
        { on: 'PLAY_BASE', faction: 'blob', effects: [{ k: 'GAIN_COMBAT', n: 1 }] },
      ],
    }),

  // Not activated: it simply pays, like Frontier Fleet.
  'rl-war-drums': relic('War Drums',
    'At the start of your turn, gain {combat:1}.',
    { activated: false, primary: [{ k: 'GAIN_COMBAT', n: 1 }] }),

  'rl-trade-charter': relic('Trade Charter',
    'At the start of your turn, gain {trade:1}.',
    { activated: false, primary: [{ k: 'GAIN_TRADE', n: 1 }] }),

  'rl-hull-plating': relic('Hull Plating',
    'Your bases have +1 defense.',
    { baseDefenseBonus: 1 }),

  'rl-shield-array': relic('Shield Array',
    'Attacks against you deal 1 less damage.',
    { damageReduction: 1 }),

  // SCRAP_ABILITY, not SCRAP_OWN: the scrap-trigger loop reads the play area
  // only, so a SCRAP_OWN relic would sit here and never fire.
  'rl-salvage-rig': relic('Salvage Rig',
    "Whenever you use a card's scrap ability, gain {combat:2}.",
    { triggers: [{ on: 'SCRAP_ABILITY', effects: [{ k: 'GAIN_COMBAT', n: 2 }] }] }),

  'rl-overclock': relic('Overclock',
    'Once per turn, you may pay {trade:1} to draw a card.',
    { activated: true, primaryCost: 1, primary: [{ k: 'DRAW', n: 1 }] }),

  // The last four have no ability of their own -- their rule is applied by the
  // opening position (hand size, price, a base already standing, authority).
  // They are still cards, so that "what am I playing with" is one place on the
  // board rather than two.
  'rl-deep-reserves': relic('Deep Reserves',
    'You draw a hand of six cards instead of five.'),

  'rl-black-market-pass': relic('Black Market Pass',
    'Cards cost you {trade:1} less to acquire. Explorers are unaffected.'),

  'rl-outpost-cache': relic('Outpost Cache',
    'You begin every fight with a Defense Center already in play.'),

  'rl-field-hospital': relic('Field Hospital',
    'You begin every fight with {authority:8} more.'),
}
