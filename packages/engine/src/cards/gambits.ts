import type { Effect } from '../effects'
import { asDefId } from '../ids'
import type { Spec } from './types'

/**
 * GAMBITS -- the Gambit set and the Cosmic Gambit set.
 *
 * From the card itself: "When playing with Gambit cards, choose a number of
 * them to be dealt face down to each player. You may reveal any Gambits at the
 * start of the game or during your Main Phase."
 *
 * So a gambit is neither bought nor drawn. It sits face down beside you, and
 * revealing it is a free action on your turn. Two shapes:
 *
 *   - ONE-SHOT (printed with the trash icon): it pays out and is gone. Its
 *     effects live in the scrap slot, which is what the icon means.
 *   - ONGOING (no icon): it stays face up and keeps applying for the rest of
 *     the game. Its effects live in `primary`, which is granted at the start of
 *     every one of your turns -- Frontier Fleet's combat -- or read directly off
 *     the card, as Energy Shield's damage reduction is.
 *
 * `onReveal` is the third case: text that happens once when the card is turned
 * up, whether or not the card then stays.
 *
 * Every text here was read off the publisher's card scans: the Card Gallery
 * spreadsheet has no text at all for gambits.
 */

const trade = (n: number): Effect => ({ k: 'GAIN_TRADE', n })
const combat = (n: number): Effect => ({ k: 'GAIN_COMBAT', n })
const authority = (n: number): Effect => ({ k: 'GAIN_AUTHORITY', n })
const draw = (n: number): Effect => ({ k: 'DRAW', n })
const destroyBase = (min: 0 | 1): Effect => ({ k: 'DESTROY_BASE', min, max: 1 })
const scrapHand = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand'], min, max })
const scrapHandDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand', 'discard'], min, max })

/** A one-shot gambit: everything is in the scrap slot, matching the trash icon. */
const oneShot = (name: string, copies: number, then: Effect[], text: string): Spec => ({
  name, faction: 'unaligned', cost: 0, type: 'ship',
  defense: null, copies, role: 'gambit',
  primary: [], scrap: then,
  text: { primary: '', ally: '', scrap: text },
})

/** An ongoing gambit: `primary` is granted at the start of each of your turns. */
const ongoing = (
  name: string, copies: number, perTurn: Effect[], text: string,
  extra: Partial<Spec> = {},
): Spec => ({
  name, faction: 'unaligned', cost: 0, type: 'ship',
  defense: null, copies, role: 'gambit',
  primary: perTurn,
  text: { primary: text, ally: '', scrap: '' },
  ...extra,
})

export const GAMBITS: Record<string, Spec> = {
  'bold-raid': oneShot('Bold Raid', 1, [destroyBase(1), draw(1)],
    'Destroy target base. Draw a card.'),
  'energy-shield': ongoing('Energy Shield', 2, [],
    'Whenever you (not your bases) are attacked, reduce the damage by 1.',
    { damageReduction: 1 }),
  'frontier-fleet': ongoing('Frontier Fleet', 2, [combat(1)], 'Each turn gain {combat:1}'),
  'political-maneuver': oneShot('Political Maneuver', 1, [trade(2)], '{trade:2}'),
  'rise-to-power': oneShot('Rise to Power', 2, [authority(8), draw(1)],
    '{authority:8} Draw a card.'),
  'salvage-operation': oneShot('Salvage Operation', 1,
    [{ k: 'DISCARD_TO_DECK_TOP', min: 1 }],
    'Put target card from your discard pile on top of your deck.'),
  'smuggling-run': oneShot('Smuggling Run', 1,
    [{ k: 'ACQUIRE_FREE', filter: 'any', maxCost: 4, dest: 'discard', min: 1 }],
    'Acquire a card of cost four or less without paying its cost.'),
  'surprise-assault': oneShot('Surprise Assault', 1, [combat(8)], '{combat:8}'),
  'unlikely-alliance': oneShot('Unlikely Alliance', 1, [draw(2)], 'Draw two cards.'),
  'wild-gambit': {
    // Simplified, and marked as such: the printed card shuffles the UNCLAIMED
    // gambits and deals you X to pick one from. We deal one at random from the
    // unclaimed pile for a fixed price of one trade -- same source, same
    // randomness, without a nested draft the rest of the engine has no shape for.
    name: 'Wild Gambit', faction: 'unaligned', cost: 0, type: 'ship',
    defense: null, copies: 1, role: 'gambit',
    primary: [], scrap: [{ k: 'DRAW_GAMBIT', n: 1 }],
    text: {
      primary: '', ally: '',
      scrap: 'Take a random gambit from the unclaimed pile.',
    },
  },
}

export const COSMIC_GAMBITS: Record<string, Spec> = {
  'acceptable-losses': oneShot('Acceptable Losses', 1, [scrapHand(0, 2)],
    'Scrap up to two cards in your hand.'),
  'asteroid-mining': {
    name: 'Asteroid Mining', faction: 'unaligned', cost: 0, type: 'ship',
    defense: null, copies: 2, role: 'gambit',
    primary: [], onReveal: [trade(1)], scrap: [draw(1)],
    text: {
      primary: '', ally: '',
      scrap: 'When you reveal this Gambit, gain {trade:1} Draw a card.',
    },
  },
  'black-market': ongoing('Black Market', 1, [],
    'Add an additional space to the trade row. Once per turn the player who ' +
    'revealed Black Market may acquire a card from it for one less than its cost; ' +
    'otherwise it is a normal trade row space for all players.',
    { onReveal: [{ k: 'OPEN_BLACK_MARKET' }] }),
  exploration: oneShot('Exploration', 2,
    [scrapHandDiscard(1, 1), { k: 'ACQUIRE_EXPLORER_FREE', dest: 'deck_top', min: 1 }],
    'Scrap a card from your hand or discard pile. Acquire an Explorer for free ' +
    'and put it on top of your deck.'),
  'hidden-base': {
    name: 'Hidden Base', faction: 'unaligned', cost: 0, type: 'ship',
    defense: null, copies: 1, role: 'gambit',
    primary: [], onReveal: [{ k: 'DEPLOY_TOKEN', def: 'secret-outpost' }],
    scrap: [authority(4)],
    text: {
      primary: '', ally: '',
      scrap: '{authority:4} When you reveal this Gambit, put a Secret Outpost into ' +
        'play and choose a faction. This turn Secret Outpost has that faction.',
    },
  },
  'secret-outpost': {
    // A token: it only ever enters play from Hidden Base, and destroying it
    // removes it rather than putting it in anyone's discard pile.
    name: 'Secret Outpost', faction: 'unaligned', cost: 0, type: 'outpost',
    defense: 4, copies: 0, role: 'token',
    removeOnDestroy: true,
    primary: [],
    triggers: [{ on: 'PLAY_SELF', effects: [{ k: 'CHOOSE_OWN_FACTION' }] }],
    text: {
      primary: 'When this base is destroyed, remove it from the game.',
      ally: '', scrap: '',
    },
  },
  'rapid-deployment': oneShot('Rapid Deployment', 2,
    [trade(1), {
      k: 'REDIRECT_NEXT_ACQUIRED',
      redirect: { filter: 'ship', dest: 'deck_top', optional: true },
    }],
    '{trade:1} You may put the next ship you acquire this turn on top of your deck.'),
  'triumphant-return': {
    name: 'Triumphant Return', faction: 'unaligned', cost: 0, type: 'ship',
    defense: null, copies: 1, role: 'gambit',
    primary: [], onReveal: [{ k: 'BUY_FROM_SCRAP_HEAP', min: 0 }], scrap: [draw(1)],
    text: {
      primary: '', ally: '',
      scrap: 'Draw a card. When you reveal this Gambit, you may pay the cost of a ' +
        'card in the scrap heap and put it into your hand. (Scouts and Vipers cost 0.)',
    },
  },
  'two-pronged-attack': {
    name: 'Two-Pronged Attack', faction: 'unaligned', cost: 0, type: 'ship',
    defense: null, copies: 1, role: 'gambit',
    primary: [], onReveal: [combat(2)], scrap: [combat(3), draw(1)],
    text: {
      primary: '', ally: '',
      scrap: 'When you reveal this Gambit, gain {combat:2} {combat:3} Draw a card.',
    },
  },
  'veteran-pilots': ongoing('Veteran Pilots', 1, [],
    'Whenever you play a Viper, gain an additional {combat:2}',
    { triggers: [{ on: 'PLAY_SHIP', cardId: asDefId('viper'), effects: [combat(2)] }] }),
}
