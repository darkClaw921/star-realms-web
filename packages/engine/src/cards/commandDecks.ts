import type { Effect } from '../effects'
import type { Faction } from '../ids'
import type { Spec } from './types'

/**
 * THE COMMAND DECKS.
 *
 * Seven of them, and each is a FORMAT rather than a card pack: you replace your
 * ten Scouts and Vipers with that commander's personal deck, take the hand size
 * and starting authority printed on the Legendary Commander, start with two of
 * its gambits, and shuffle its single eight-cost megaship into the trade deck.
 *
 * That is the whole of the format, and it is why these cards carry
 * `role: 'command'`: they are yours from the first turn and are never in the
 * trade deck. The one card per deck that IS shuffled in carries the ordinary
 * `role: 'trade_deck'`.
 *
 * Contents and text come from the publisher's Card Gallery spreadsheet, which
 * does carry them for this set. The Lost Fleet's Splinter rule is not on any
 * card the gallery carries -- it lives on the commander's rules side -- so it
 * is taken from the publisher's own product description: play three matching
 * Shards in a turn, then discard that set of three from play to use their
 * Splinter ability, keeping the primaries you already resolved.
 */

const trade = (n: number): Effect => ({ k: 'GAIN_TRADE', n })
const combat = (n: number): Effect => ({ k: 'GAIN_COMBAT', n })
const authority = (n: number): Effect => ({ k: 'GAIN_AUTHORITY', n })
const draw = (n: number): Effect => ({ k: 'DRAW', n })
const oppDiscard = (n: number): Effect => ({ k: 'OPPONENT_DISCARD', n })
const destroyBase = (min: 0 | 1): Effect => ({ k: 'DESTROY_BASE', min, max: 1 })
const scrapTradeRow = (min: 0 | 1, max = 1): Effect => ({ k: 'SCRAP_TRADE_ROW', min, max })
const scrapHandDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand', 'discard'], min, max })
const chooseOne = (...branches: { label: string; then: Effect[] }[]): Effect =>
  ({ k: 'CHOOSE_ONE', branches })
const drawThenDiscard = (): Effect =>
  ({ k: 'SEQ', effects: [draw(1), { k: 'SELF_DISCARD', n: 1 }] })
const ally = (faction: Faction): Effect => ({ k: 'GAIN_ALLY', faction })

/** A card in a personal starting deck: free, unbuyable, and yours from turn one. */
const own = (
  name: string, faction: Faction, copies: number, primary: Effect[], text: string,
  extra: Partial<Spec> = {},
): Spec => ({
  name, faction, cost: 0, type: 'ship', defense: null, copies, role: 'command',
  primary,
  text: { primary: text, ally: '', scrap: '' },
  ...extra,
})

const commander = (
  name: string, handSize: number, authorityStart: number,
): Spec => ({
  name, faction: 'unaligned', cost: 0, type: 'ship', defense: null,
  copies: 0, role: 'commander',
  commander: { handSize, authority: authorityStart },
  primary: [],
  text: {
    primary: `Legendary Commander. Hand size ${handSize}, starting authority ${authorityStart}.`,
    ally: '', scrap: '',
  },
})

/** A gambit that comes with a command deck rather than from a gambit pile. */
const deckGambit = (name: string, spec: Partial<Spec> & { text: Spec['text'] }): Spec => ({
  name, faction: 'unaligned', cost: 0, type: 'ship', defense: null,
  copies: 1, role: 'gambit', primary: [],
  ...spec,
})

// ─────────────────────────── shared personal cards ──────────────────────────
// Several decks print the same card. They are defined once and referenced by
// id from each deck's list, because two definitions of one card would be two
// cards that could both be in a deck at once.
const SHARED: Record<string, Spec> = {
  'cd-scout': own('Scout', 'unaligned', 0, [trade(1)], '{trade:1}'),
  'cd-viper': own('Viper', 'unaligned', 0, [combat(1)], '{combat:1}'),
  ranger: own('Ranger', 'unaligned', 0,
    [chooseOne(
      { label: '{trade:1}', then: [trade(1)] },
      { label: '{combat:2}', then: [combat(2)] },
    )],
    '{trade:1} OR {combat:2}'),
  'cargo-boat': own('Cargo Boat', 'trade_federation', 0, [trade(2)], '{trade:2}',
    { ally: [authority(2)], text: { primary: '{trade:2}', ally: '{authority:2}', scrap: '' } }),
  'diplomatic-shuttle': own('Diplomatic Shuttle', 'trade_federation', 0,
    [chooseOne(
      { label: '{trade:1}', then: [trade(1)] },
      { label: '{authority:5}', then: [authority(5)] },
    )],
    '{trade:1} OR {authority:5}'),
  'federation-scout': own('Federation Scout', 'unaligned', 0, [trade(1)], '{trade:1}', {
    ally: [{ k: 'DISCOUNT_NEXT_ACQUIRED', faction: 'trade_federation', n: 1 }],
    allyFaction: 'trade_federation',
    text: {
      primary: '{trade:1}',
      ally: 'The next Trade Federation card you acquire this turn costs {trade:1} less.',
      scrap: '',
    },
  }),
  'imperial-viper': own('Imperial Viper', 'unaligned', 0, [combat(1)], '{combat:1}', {
    ally: [{ k: 'DISCARD_THEN_DRAW', max: 1 }], allyFaction: 'star_empire',
    text: {
      primary: '{combat:1}',
      ally: 'You may discard a card. If you do, draw a card.', scrap: '',
    },
  }),
  'stellar-falcon': own('Stellar Falcon', 'star_empire', 0, [combat(2)], '{combat:2}', {
    ally: [oppDiscard(1)],
    text: { primary: '{combat:2}', ally: 'Target opponent discards a card.', scrap: '' },
  }),
  'tribute-transport': own('Tribute Transport', 'star_empire', 0,
    [chooseOne(
      { label: '{trade:2}', then: [trade(2)] },
      { label: 'Draw a card, then discard a card', then: [drawThenDiscard()] },
    )],
    '{trade:2} OR draw a card, then discard a card.'),
  'imperial-talon': own('Imperial Talon', 'star_empire', 0, [combat(2)], '{combat:2}', {
    ally: [combat(2)],
    text: { primary: '{combat:2}', ally: '{combat:2}', scrap: '' },
  }),
  'salvage-drone': own('Salvage Drone', 'machine_cult', 0,
    [chooseOne(
      { label: '{trade:1}', then: [trade(1)] },
      { label: 'Scrap a card in your hand or discard pile', then: [scrapHandDiscard(1, 1)] },
    )],
    '{trade:1} OR scrap a card in your hand or discard pile.'),
  'scout-bot': own('Scout Bot', 'unaligned', 0, [trade(1)], '{trade:1}', {
    ally: [{ k: 'TOPDECK_FROM_DISCARD', filter: 'any', maxCost: 2, min: 1, max: 1 }],
    allyFaction: 'machine_cult',
    text: {
      primary: '{trade:1}',
      ally: 'Choose a card of cost two or less in your discard pile. Put it on top of your deck.',
      scrap: '',
    },
  }),
  'welder-drone': own('Welder Drone', 'machine_cult', 0,
    [chooseOne(
      { label: '{trade:2}', then: [trade(2)] },
      { label: '{combat:2}', then: [combat(2)] },
    )],
    '{trade:2} OR {combat:2}'),
  'laser-drone': own('Laser Drone', 'machine_cult', 0, [combat(2)], '{combat:2}', {
    ally: [combat(1)], doubleAlly: [combat(2)],
    text: { primary: '{combat:2}', ally: '{combat:1}', doubleAlly: '{combat:2}', scrap: '' },
  }),
  'frontier-tug': own('Frontier Tug', 'trade_federation', 0, [trade(2)], '{trade:2}', {
    ally: [{
      k: 'REDIRECT_NEXT_ACQUIRED',
      redirect: { filter: 'base', dest: 'deck_shuffle', optional: false },
    }],
    text: {
      primary: '{trade:2}',
      ally: 'Shuffle the next base you acquire this turn into your deck.', scrap: '',
    },
  }),
  'viper-bot': own('Viper Bot', 'unaligned', 0, [combat(2)], '{combat:2}', {
    ally: [{ k: 'IF', cond: { c: 'SCRAPPED_THIS_TURN', n: 1 }, then: [combat(3)] }],
    allyFaction: 'machine_cult',
    text: {
      primary: '{combat:2}',
      ally: "If you've scrapped a card from your hand or discard pile this turn, gain {combat:3}",
      scrap: '',
    },
  }),
  'cluster-scout': own('Cluster Scout', 'unaligned', 0, [trade(1)], '{trade:1}', {
    ally: [combat(1), scrapTradeRow(0)], allyFaction: 'blob',
    text: {
      primary: '{trade:1}',
      ally: '{combat:1} You may scrap a card in the trade row.', scrap: '',
    },
  }),
  'escort-viper': own('Escort Viper', 'unaligned', 0, [combat(1)], '{combat:1}', {
    ally: [trade(1)], allyFaction: 'trade_federation',
    text: { primary: '{combat:1}', ally: '{trade:1}', scrap: '' },
  }),
  ripper: own('Ripper', 'blob', 0, [combat(3)], '{combat:3}'),
  swarmling: own('Swarmling', 'blob', 0, [combat(2)], '{combat:2}', {
    ally: [combat(1), scrapTradeRow(0)],
    text: {
      primary: '{combat:2}',
      ally: '{combat:1} You may scrap a card in the trade row.', scrap: '',
    },
  }),
  'cluster-viper': own('Cluster Viper', 'unaligned', 0, [combat(2)], '{combat:2}', {
    ally: [combat(1)], allyFaction: 'blob',
    text: { primary: '{combat:2}', ally: '{combat:1}', scrap: '' },
  }),
  'imperial-scout': own('Imperial Scout', 'unaligned', 0, [trade(1)], '{trade:1}', {
    ally: [combat(2)], allyFaction: 'star_empire',
    text: { primary: '{trade:1}', ally: '{combat:2}', scrap: '' },
  }),
  protopod: own('Protopod', 'blob', 0, [trade(2)], '{trade:2}', {
    ally: [combat(1)],
    text: { primary: '{trade:2}', ally: '{combat:1}', scrap: '' },
  }),
}

// ───────────────────────────── the megaships ────────────────────────────────
// `copies: 0` on purpose: a megaship belongs to its commander, not to the set.
// Switching the Command Decks on must not put seven eight-cost ships in the
// trade deck; setup adds exactly the one whose commander is actually playing.
const MEGASHIPS: Record<string, Spec> = {
  'super-freighter': {
    name: 'Super Freighter', faction: 'star_empire', faction2: 'trade_federation',
    cost: 8, type: 'ship', defense: null, copies: 0, role: 'trade_deck',
    primary: [trade(4), draw(2)], ally: [draw(1)],
    text: { primary: '{trade:4} Draw two cards.', ally: 'Draw a card.', scrap: '' },
  },
  'mech-battleship': {
    name: 'Mech Battleship', faction: 'machine_cult', faction2: 'star_empire',
    cost: 8, type: 'ship', defense: null, copies: 0, role: 'trade_deck',
    primary: [{ k: 'SCRAP_DRAW_DISCARD', zones: ['hand', 'discard'], max: 2 }],
    ally: [combat(6)],
    text: {
      primary: 'You may scrap up to two cards from your hand and/or discard pile. Draw ' +
        'cards equal to the number scrapped this way, then discard an equal number.',
      ally: '{combat:6}', scrap: '',
    },
  },
  'mech-command-ship': {
    name: 'Mech Command Ship', faction: 'trade_federation', faction2: 'machine_cult',
    cost: 8, type: 'ship', defense: null, copies: 0, role: 'trade_deck',
    primary: [{
      k: 'SCRAP_THEN_GAIN', zones: ['hand', 'discard'], max: 2, per: 3, what: 'authority',
    }],
    ally: [draw(1), destroyBase(0)],
    text: {
      primary: 'You may scrap up to two cards from your hand and/or discard pile. ' +
        'Gain {authority:3} for each card scrapped this way.',
      ally: 'Draw a card. You may destroy target base.', scrap: '',
    },
  },
  'super-carrier': {
    name: 'Super Carrier', faction: 'blob', faction2: 'trade_federation',
    cost: 8, type: 'ship', defense: null, copies: 0, role: 'trade_deck',
    primary: [{ k: 'ACQUIRE_FREE', filter: 'ship', maxCost: null, dest: 'hand', min: 0 }],
    ally: [draw(1)],
    text: {
      primary: 'You may acquire a ship for free and put it into your hand.',
      ally: 'Draw a card.', scrap: '',
    },
  },
  meganaut: {
    name: 'Meganaut', faction: 'blob', faction2: 'star_empire',
    cost: 8, type: 'ship', defense: null, copies: 0, role: 'trade_deck',
    primary: [combat(7), draw(1)], ally: [draw(1)], scrap: [combat(6)],
    text: {
      primary: '{combat:7} Draw a card.', ally: 'Draw a card.', scrap: '{combat:6}',
    },
  },
  'mech-wurm': {
    name: 'Mech Wurm', faction: 'blob', faction2: 'machine_cult',
    cost: 8, type: 'ship', defense: null, copies: 0, role: 'trade_deck',
    primary: [{
      k: 'SCRAP_THEN_GAIN', zones: ['hand', 'discard'], max: 2, per: 4, what: 'combat',
    }],
    ally: [draw(1)],
    text: {
      primary: 'You may scrap up to two cards from your hand and/or discard pile. ' +
        'Gain {combat:4} for each card scrapped this way.',
      ally: 'Draw a card.', scrap: '',
    },
  },
  'lost-dreadnaught': {
    name: 'Lost Dreadnaught', faction: 'unaligned',
    cost: 8, type: 'ship', defense: null, copies: 0, role: 'trade_deck',
    factionWildcard: true,
    primary: [combat(7), draw(2)],
    text: {
      primary: '{combat:7} Draw two cards. Lost Dreadnaught has all factions.',
      ally: '', scrap: '',
    },
  },
}

// ──────────────────────────── the Lost Fleet shards ─────────────────────────
const shard = (
  name: string, primary: Effect[], primaryText: string,
  splinter: Effect[], splinterText: string, extra: Partial<Spec> = {},
): Spec => ({
  name, faction: 'unaligned', cost: 0, type: 'ship', defense: null,
  copies: 0, role: 'command',
  primary, splinter,
  text: { primary: primaryText, ally: '', splinter: splinterText, scrap: '' },
  ...extra,
})

const SHARDS: Record<string, Spec> = {
  'assault-shard': shard('Assault Shard', [combat(1)], '{combat:1}',
    [combat(4)], '{combat:4}'),
  'command-shard': shard('Command Shard', [trade(1)], '{trade:1}', [], '', {
    splinterWildcard: true,
    text: {
      primary: '{trade:1} You may treat this card as having any name when using a ' +
        'Splinter ability.',
      ally: '', scrap: '',
    },
  }),
  'recon-shard': shard('Recon Shard', [trade(1)], '{trade:1}',
    [authority(5)], '{authority:5}'),
  'salvage-shard': shard('Salvage Shard', [trade(1)], '{trade:1}',
    [scrapHandDiscard(1, 1)], 'Scrap a card in your hand or discard pile.'),
  'transport-shard': shard('Transport Shard', [trade(1)], '{trade:1}',
    [drawThenDiscard()], 'Draw a card, then discard a card.'),
}

// ───────────────────────────────── gambits ──────────────────────────────────
const GAMBITS: Record<string, Spec> = {
  "nandi-s-onslaught": deckGambit("Nandi's Onslaught", {
    scrap: [
      ally('star_empire'), ally('trade_federation'), draw(2),
      { k: 'SELF_DISCARD', n: 1 }, oppDiscard(1),
    ],
    text: {
      primary: '', ally: '',
      scrap: 'Gain a Star Empire Ally and a Trade Federation Ally. Draw two cards, ' +
        'then you and each opponent discard a card.',
    },
  }),
  'alliance-procurement': deckGambit('Alliance Procurement', {
    activated: true,
    primary: [chooseOne(
      { label: '{trade:2}', then: [trade(2)] },
      {
        label: 'Top-deck the next ship or base you acquire',
        then: [{
          k: 'REDIRECT_NEXT_ACQUIRED',
          redirect: { filter: 'any', dest: 'deck_top', optional: false },
        }],
      },
    )],
    text: {
      primary: 'Once each turn, you may gain {trade:2} or put the next ship or base ' +
        'you acquire on top of your deck.',
      ally: '', scrap: '',
    },
  }),
  "le-s-foray": deckGambit("Le's Foray", {
    scrap: [
      ally('star_empire'), ally('machine_cult'),
      { k: 'SCRAP_THEN_DRAW', zones: ['hand', 'discard'], max: 1 },
    ],
    text: {
      primary: '', ally: '',
      scrap: 'Gain a Star Empire Ally and a Machine Cult Ally. You may scrap a card in ' +
        'your hand or discard pile. If you do, draw a card.',
    },
  }),
  'alignment-ingenuity': deckGambit('Alignment Ingenuity', {
    triggers: [{ on: 'SCRAP_ABILITY', effects: [{ k: 'MAY', label: 'Draw, then discard', then: [drawThenDiscard()] }] }],
    text: {
      primary: 'Whenever you use a Scrap ability of a ship or base, you may draw a card, ' +
        'then discard a card.',
      ally: '', scrap: '',
    },
  }),
  "valken-s-enterprise": deckGambit("Valken's Enterprise", {
    scrap: [{ k: 'DEPLOY_TOKEN', def: 'coalition-stronghold' }],
    text: {
      primary: '', ally: '',
      scrap: 'Flip this gambit over and put it into play as a base.',
    },
  }),
  'coalition-stronghold': {
    name: 'Coalition Stronghold', faction: 'unaligned', cost: 0, type: 'base',
    defense: 4, copies: 0, role: 'token',
    removeOnDestroy: true,
    primary: [chooseOne(
      { label: '{combat:2}', then: [combat(2)] },
      { label: '{authority:2}', then: [authority(2)] },
    )],
    text: {
      primary: '{combat:2} OR {authority:2} If this base would leave play, scrap it instead.',
      ally: '', scrap: '',
    },
  },
  'coalition-efficiency': deckGambit('Coalition Efficiency', {
    triggers: [{ on: 'WOULD_SCRAP', effects: [authority(5)] }],
    text: {
      primary: 'Once per turn, if you would scrap a card in your hand or discard pile, ' +
        'you may choose to gain {authority:5} instead.',
      ally: '', scrap: '',
    },
  }),
  "newburg-s-game": deckGambit("Newburg's Game", {
    scrap: [combat(3), authority(4), ally('blob'), ally('trade_federation'), draw(1)],
    text: {
      primary: '', ally: '',
      scrap: '{combat:3} {authority:4} Gain a Blob Ally and a Trade Federation Ally. Draw a card.',
    },
  }),
  'pact-dominion': deckGambit('Pact Dominion', {
    onFirstAuthority: [combat(3)],
    text: {
      primary: 'Each turn, the first time you gain authority also gain {combat:3}',
      ally: '', scrap: '',
    },
  }),
  "mccready-s-maneuver": deckGambit("McCready's Maneuver", {
    scrap: [combat(5), ally('blob'), ally('star_empire'), draw(1)],
    text: {
      primary: '', ally: '',
      scrap: '{combat:5} Gain a Blob Ally and a Star Empire Ally. Draw a card.',
    },
  }),
  'union-blitz': deckGambit('Union Blitz', {
    ally: [combat(1)], allyFaction: 'blob',
    ally2: [combat(1)], ally2Faction: 'star_empire',
    text: { primary: '', ally: '{combat:1}', ally2: '{combat:1}', scrap: '' },
  }),
  "walsh-s-stratagem": deckGambit("Walsh's Stratagem", {
    scrap: [
      trade(2), ally('machine_cult'), ally('blob'),
      { k: 'REDIRECT_NEXT_ACQUIRED', redirect: { filter: 'base', dest: 'in_play', optional: false } },
    ],
    text: {
      primary: '', ally: '',
      scrap: '{trade:2} Gain a Machine Cult Ally and a Blob Ally. Put the next base you ' +
        'acquire this turn directly into play.',
    },
  }),
  'unity-warcraft': deckGambit('Unity Warcraft', {
    baseDefenseBonus: 1,
    text: {
      primary: "Your bases get +1 defense. Your opponent's bases get -1 defense. " +
        '(This affects both regular bases and outposts.)',
      ally: '', scrap: '',
    },
  }),
  'splinter-tech': deckGambit('Splinter Tech', {
    triggers: [{ on: 'SPLINTER', effects: [{ k: 'PHANTOM_FACTION', n: 1 }] }],
    text: {
      primary: 'Whenever you use a Splinter ability, choose a faction. You count as ' +
        'having a card of that faction in play this turn.',
      ally: '', scrap: '',
    },
  }),
  "jochum-s-grand-design": deckGambit("Jochum's Grand Design", {
    scrap: [
      ally('star_empire'), ally('trade_federation'), ally('machine_cult'), ally('blob'),
      { k: 'DISCARD_TO_HAND', min: 1 },
    ],
    text: {
      primary: '', ally: '',
      scrap: 'Gain an ally of every faction. Put a card from your discard pile into your hand.',
    },
  }),
}

const COMMANDERS: Record<string, Spec> = {
  'fleet-director-nandi': commander('Fleet Director Nandi', 5, 68),
  'divine-admiral-le': commander('Divine Admiral Le', 6, 64),
  'high-director-valken': commander('High Director Valken', 6, 62),
  'overlord-newburg': commander('Overlord Newburg', 6, 66),
  'hive-admiral-mccready': commander('Hive Admiral McCready', 6, 60),
  'biolord-walsh': commander('Biolord Walsh', 6, 70),
  'high-admiral-jochum': commander('High Admiral Jochum', 7, 72),
}

export const COMMAND_DECK_CARDS: Record<string, Spec> = {
  ...SHARED, ...MEGASHIPS, ...SHARDS, ...GAMBITS, ...COMMANDERS,
}

export interface CommandDeckSpec {
  readonly id: string
  readonly name: string
  readonly commander: string
  /** The megaship shuffled into the trade deck. */
  readonly megaship: string
  /** The personal starting deck, one entry per physical card. */
  readonly deck: readonly string[]
  /** The two gambits it opens with. */
  readonly gambits: readonly string[]
}

const S = (n: number, id: string): string[] => Array(n).fill(id)

export const COMMAND_DECKS: readonly CommandDeckSpec[] = [
  {
    id: 'alliance', name: 'The Alliance',
    commander: 'fleet-director-nandi', megaship: 'super-freighter',
    deck: [
      ...S(4, 'cd-scout'), 'cd-viper', 'cargo-boat', 'diplomatic-shuttle',
      'federation-scout', 'imperial-viper', 'ranger', 'stellar-falcon',
      'tribute-transport',
    ],
    gambits: ['nandi-s-onslaught', 'alliance-procurement'],
  },
  {
    id: 'alignment', name: 'The Alignment',
    commander: 'divine-admiral-le', megaship: 'mech-battleship',
    deck: [
      ...S(4, 'cd-scout'), 'cd-viper', 'imperial-talon', 'imperial-viper',
      'ranger', 'salvage-drone', 'scout-bot', 'stellar-falcon', 'welder-drone',
    ],
    gambits: ['le-s-foray', 'alignment-ingenuity'],
  },
  {
    id: 'coalition', name: 'The Coalition',
    commander: 'high-director-valken', megaship: 'mech-command-ship',
    deck: [
      ...S(4, 'cd-scout'), 'cd-viper', 'cargo-boat', 'federation-scout',
      'frontier-tug', 'laser-drone', 'ranger', 'salvage-drone', 'viper-bot',
    ],
    gambits: ['valken-s-enterprise', 'coalition-efficiency'],
  },
  {
    id: 'pact', name: 'The Pact',
    commander: 'overlord-newburg', megaship: 'super-carrier',
    deck: [
      ...S(4, 'cd-scout'), 'cd-viper', 'cluster-scout', 'diplomatic-shuttle',
      'escort-viper', 'frontier-tug', 'ranger', 'ripper', 'swarmling',
    ],
    gambits: ['newburg-s-game', 'pact-dominion'],
  },
  {
    id: 'union', name: 'The Union',
    commander: 'hive-admiral-mccready', megaship: 'meganaut',
    deck: [
      ...S(4, 'cd-scout'), 'cd-viper', 'cluster-viper', 'imperial-scout',
      'imperial-talon', 'protopod', 'ranger', 'ripper', 'tribute-transport',
    ],
    gambits: ['mccready-s-maneuver', 'union-blitz'],
  },
  {
    id: 'unity', name: 'The Unity',
    commander: 'biolord-walsh', megaship: 'mech-wurm',
    deck: [
      ...S(4, 'cd-scout'), 'cd-viper', 'cluster-viper', 'laser-drone',
      'protopod', 'ranger', 'scout-bot', 'swarmling', 'welder-drone',
    ],
    gambits: ['walsh-s-stratagem', 'unity-warcraft'],
  },
  {
    id: 'lost-fleet', name: 'The Lost Fleet',
    commander: 'high-admiral-jochum', megaship: 'lost-dreadnaught',
    deck: [
      ...S(3, 'assault-shard'), ...S(2, 'command-shard'), ...S(3, 'recon-shard'),
      ...S(3, 'salvage-shard'), ...S(3, 'transport-shard'),
    ],
    gambits: ['splinter-tech', 'jochum-s-grand-design'],
  },
]
