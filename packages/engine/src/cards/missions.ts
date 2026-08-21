import type { Effect } from '../effects'
import type { MissionObjective, Spec } from './types'

/**
 * STAR REALMS: UNITED -- the Missions pack.
 *
 * Three missions are dealt face down to each player. When your objective holds,
 * you reveal the mission and take its reward; completing all three wins the
 * game outright, whatever the authority track says. That makes Missions the
 * only positive win condition in the game.
 *
 * The objective is data, not text: `objective` is evaluated against your own
 * state, and the legality of claiming a mission IS that evaluation -- there is
 * no second rule that could drift from it. The reward is an ordinary effect
 * list, so it goes through the same machinery as every card ability.
 *
 * Every text here was read off the publisher's card scans: the Card Gallery
 * spreadsheet has no text at all for missions.
 */

const trade = (n: number): Effect => ({ k: 'GAIN_TRADE', n })
const combat = (n: number): Effect => ({ k: 'GAIN_COMBAT', n })
const authority = (n: number): Effect => ({ k: 'GAIN_AUTHORITY', n })
const draw = (n: number): Effect => ({ k: 'DRAW', n })
const chooseOne = (...branches: { label: string; then: Effect[] }[]): Effect =>
  ({ k: 'CHOOSE_ONE', branches })

const mission = (
  name: string, objective: MissionObjective, reward: Effect[],
  objectiveText: string, rewardText: string,
): Spec => ({
  name, faction: 'unaligned', cost: 0, type: 'ship',
  defense: null, copies: 1, role: 'mission',
  objective,
  primary: reward,
  text: { primary: `Objective: ${objectiveText} Reward: ${rewardText}`, ally: '', scrap: '' },
})

export const MISSIONS: Record<string, Spec> = {
  ally: mission('Ally',
    { o: 'ALLY_FACTIONS_THIS_TURN', n: 2 },
    [{ k: 'ACQUIRE_FREE', filter: 'any', maxCost: 4, dest: 'deck_top', min: 1 }],
    'Use ally abilities from two different factions in the same turn.',
    'Acquire a ship or base of cost four or less for free and put it on top of your deck.'),
  armada: mission('Armada',
    { o: 'SHIPS_PLAYED_THIS_TURN', n: 7 },
    [draw(1), { k: 'ACQUIRE_EXPLORER_FREE', dest: 'hand', min: 1 }],
    'Play seven or more ships in the same turn.',
    'Draw a card. Acquire an Explorer for free and put it into your hand.'),
  colonize: mission('Colonize',
    { o: 'BASES_SAME_FACTION', n: 2 },
    [draw(2)],
    'Have two or more bases of the same faction in play.',
    'Draw two cards.'),
  convert: mission('Convert',
    { o: 'SHIP_PLAYED_WITH_BASE', faction: 'machine_cult' },
    [{ k: 'REVEAL_THREE_SPLIT' }],
    'Play a Machine Cult ship while you have a Machine Cult base in play.',
    'Reveal the top three cards of your deck. Put one in your hand, one in your ' +
    'discard pile, and one on top of your deck.'),
  defend: mission('Defend',
    { o: 'OUTPOSTS_IN_PLAY', n: 2 },
    [draw(1), { k: 'RETURN_BASE_TO_HAND', min: 1 }],
    'Have two or more outposts in play.',
    "Draw a card. Return target base to its controller's hand."),
  diversify: mission('Diversify',
    { o: 'GAINED_THIS_TURN', trade: 4, combat: 5, authority: 3 },
    [chooseOne(
      { label: '{trade:4}', then: [trade(4)] },
      { label: '{combat:5}', then: [combat(5)] },
      { label: '{authority:6}', then: [authority(6)] },
    )],
    'In a single turn, gain {trade:4} and {combat:5} and {authority:3}',
    '{trade:4} OR {combat:5} OR {authority:6}'),
  dominate: mission('Dominate',
    { o: 'SHIP_PLAYED_WITH_BASE', faction: 'star_empire' },
    [combat(3), draw(1)],
    'Play a Star Empire ship while you have a Star Empire base in play.',
    '{combat:3} Draw a card.'),
  exterminate: mission('Exterminate',
    { o: 'SHIP_PLAYED_WITH_BASE', faction: 'blob' },
    [combat(3), { k: 'SCRAP_TRADE_ROW', min: 0, max: 6 }],
    'Play a Blob ship while you have a Blob base in play.',
    '{combat:3} Scrap any number of cards currently in the trade row.'),
  influence: mission('Influence',
    { o: 'CARDS_SAME_FACTION_IN_PLAY', n: 3 },
    [
      { k: 'ACQUIRE_EXPLORER_FREE', dest: 'hand', min: 1 },
      { k: 'ACQUIRE_EXPLORER_FREE', dest: 'hand', min: 1 },
    ],
    'Have at least three ships and/or bases of the same faction in play.',
    'Acquire two Explorers for free and put them both into your hand.'),
  monopolize: mission('Monopolize',
    { o: 'SHIP_PLAYED_WITH_BASE', faction: 'trade_federation' },
    [authority(5)],
    'Play a Trade Federation ship while you have a Trade Federation base in play.',
    '{authority:5}'),
  rule: mission('Rule',
    { o: 'BASE_FACTIONS', n: 2 },
    [{ k: 'ACQUIRE_FREE', filter: 'any', maxCost: 3, dest: 'hand', min: 1 }],
    'Have bases from two or more factions in play.',
    'Acquire a card of cost three or less for free and put it into your hand.'),
  unite: mission('Unite',
    { o: 'SHIP_FACTIONS_PLAYED_THIS_TURN', n: 3 },
    [authority(5), draw(1)],
    'Play three ships from different factions in the same turn.',
    '{authority:5} Draw a card.'),
}
