import type { Effect } from '../effects'
import type { Faction } from '../ids'
import type { Spec } from './types'

/**
 * STAR REALMS: HIGH ALERT -- all five packs.
 *
 * Two things arrive with High Alert, and both are priced into the card rather
 * than bolted onto the rules:
 *
 *   - TECH. A card type that goes straight into play when acquired, like a
 *     Hero, but is never spent: you pay trade to use its ability, once per turn,
 *     for the rest of the game.
 *   - BOARD-DEPENDENT COST. "Pay 1 Trade less to acquire this card for each
 *     <faction> card you have in play." A discount, never a surcharge, floored
 *     at zero. Every place that reads a price goes through costFor.
 *
 * SOURCE NOTE, and it is load-bearing. The publisher's Card Gallery spreadsheet
 * is wrong about this set in ways that would have shipped as real bugs: it omits
 * the Outpost marker on eight bases (The Armory, Arcadia, Battle Star, Sapphire
 * City Base, Scrap Factory, Mech Fortress, Naval Yard, Operations Platform),
 * prints Blob Builder's discount in Combat rather than Trade, gives Swarm Colony
 * "Discard a card" where the card says "Draw a card", and garbles several
 * abilities outright ("bsaes", "ocunt"). Every card here was therefore read off
 * the publisher's own card scans, and the gallery was used only for copy counts.
 *
 * The Heroes pack pairs factions the way United does, and its ally icon is a
 * single combined symbol for the pair. We read "Gain an Alliance Ally" as
 * granting an ally of BOTH factions of the pair, which is what a card counting
 * as both would do.
 */

const trade = (n: number): Effect => ({ k: 'GAIN_TRADE', n })
const combat = (n: number): Effect => ({ k: 'GAIN_COMBAT', n })
const authority = (n: number): Effect => ({ k: 'GAIN_AUTHORITY', n })
const draw = (n: number): Effect => ({ k: 'DRAW', n })
const oppDiscard = (n: number): Effect => ({ k: 'OPPONENT_DISCARD', n })
const scrapHandDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand', 'discard'], min, max })
const scrapHand = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['hand'], min, max })
const scrapDiscard = (min: number, max: number): Effect =>
  ({ k: 'SCRAP_FROM_ZONES', zones: ['discard'], min, max })
const scrapTradeRow = (min: 0 | 1, max = 1): Effect => ({ k: 'SCRAP_TRADE_ROW', min, max })
const chooseOne = (...branches: { label: string; then: Effect[] }[]): Effect =>
  ({ k: 'CHOOSE_ONE', branches })
const drawThenDiscard = (): Effect =>
  ({ k: 'SEQ', effects: [draw(1), { k: 'SELF_DISCARD', n: 1 }] })
const ally = (faction: Faction): Effect => ({ k: 'GAIN_ALLY', faction })

/** "Pay 1 Trade less for each <faction> card you have in play." */
const per = (faction: Faction) => ({ faction, per: 1 })

const DISCOUNT_TEXT: Record<Faction, string> = {
  blob: 'Pay {trade:1} less to acquire this card for each Blob card you have in play.',
  machine_cult: 'Pay {trade:1} less to acquire this card for each Machine Cult card you have in play.',
  star_empire: 'Pay {trade:1} less to acquire this card for each Star Empire card you have in play.',
  trade_federation: 'Pay {trade:1} less to acquire this card for each Trade Federation card you have in play.',
  unaligned: '',
}

export const HIGH_ALERT_FIRST_STRIKE: Record<string, Spec> = {
  arcadia: {
    name: 'Arcadia', faction: 'machine_cult', cost: 6, type: 'outpost',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [scrapHand(1, 1)],
    ally: [scrapDiscard(1, 1)],
    doubleAlly: [combat(6)],
    text: {
      primary: 'Scrap a card in your hand.',
      ally: 'Scrap a card in your discard pile.',
      doubleAlly: '{combat:6}',
      scrap: '',
    },
  },
  'battle-star': {
    name: 'Battle Star', faction: 'star_empire', cost: 6, type: 'outpost',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [combat(3)], ally: [combat(3)], doubleAlly: [oppDiscard(1)],
    text: {
      primary: '{combat:3}', ally: '{combat:3}',
      doubleAlly: 'Target opponent discards a card.', scrap: '',
    },
  },
  'blob-builder': {
    name: 'Blob Builder', faction: 'blob', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    discount: per('blob'),
    primary: [trade(5), scrapTradeRow(0, 5)],
    ally: [{ k: 'ACQUIRE_FREE', filter: 'base', maxCost: null, dest: 'deck_top', min: 1 }],
    text: {
      primary: `{trade:5} You may scrap any number of cards currently in the trade row. ${DISCOUNT_TEXT.blob}`,
      ally: 'Acquire a base for free and put it directly on top of your deck.',
      scrap: '',
    },
  },
  'cargo-barge': {
    name: 'Cargo Barge', faction: 'star_empire', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    discount: per('star_empire'),
    primary: [trade(3)], ally: [oppDiscard(1)], scrap: [draw(1)],
    text: {
      primary: `{trade:3} ${DISCOUNT_TEXT.star_empire}`,
      ally: 'Target opponent discards a card.', scrap: 'Draw a card.',
    },
  },
  'command-cruiser': {
    name: 'Command Cruiser', faction: 'star_empire', cost: 6, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(8)], ally: [draw(1)], doubleAlly: [draw(1)],
    text: {
      primary: '{combat:8}', ally: 'Draw a card.', doubleAlly: 'Draw a card.', scrap: '',
    },
  },
  'fighter-pod': {
    name: 'Fighter Pod', faction: 'blob', cost: 1, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(3)], ally: [trade(2)], doubleAlly: [combat(3)],
    text: { primary: '{combat:3}', ally: '{trade:2}', doubleAlly: '{combat:3}', scrap: '' },
  },
  'freight-hauler': {
    name: 'Freight Hauler', faction: 'trade_federation', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [trade(4)], ally: [combat(4)],
    doubleAlly: [{
      k: 'REDIRECT_NEXT_ACQUIRED',
      redirect: { filter: 'any', dest: 'hand', optional: false },
    }],
    text: {
      primary: '{trade:4}', ally: '{combat:4}',
      doubleAlly: 'Put the next card you acquire this turn directly into your hand.',
      scrap: '',
    },
  },
  'industrial-upgrade': {
    name: 'Industrial Upgrade', faction: 'unaligned', cost: 5, type: 'tech',
    defense: null, copies: 1, role: 'trade_deck',
    primaryCost: 3, primary: [draw(1)],
    text: { primary: 'Pay {trade:3}: Draw a card.', ally: '', scrap: '' },
  },
  'missile-launcher': {
    name: 'Missile Launcher', faction: 'unaligned', cost: 4, type: 'tech',
    defense: null, copies: 1, role: 'trade_deck',
    primaryCost: 3, primary: [combat(3)],
    text: { primary: 'Pay {trade:3}: {combat:3}', ally: '', scrap: '' },
  },
  'operations-center': {
    name: 'Operations Center', faction: 'trade_federation', cost: 4, type: 'base',
    defense: 4, copies: 1, role: 'trade_deck',
    primary: [trade(2)], ally: [authority(2)], doubleAlly: [draw(1)],
    text: {
      primary: '{trade:2}', ally: '{authority:2}', doubleAlly: 'Draw a card.', scrap: '',
    },
  },
  'parks-station': {
    name: 'Parks Station', faction: 'star_empire', cost: 4, type: 'base',
    defense: 4, copies: 1, role: 'trade_deck',
    discount: per('star_empire'),
    primary: [trade(2)], ally: [combat(3)],
    text: {
      primary: `{trade:2} ${DISCOUNT_TEXT.star_empire}`, ally: '{combat:3}', scrap: '',
    },
  },
  'port-cutter': {
    name: 'Port Cutter', faction: 'trade_federation', cost: 2, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    discount: per('trade_federation'),
    primary: [trade(2), combat(2)], ally: [authority(3)],
    text: {
      primary: `{trade:2} {combat:2} ${DISCOUNT_TEXT.trade_federation}`,
      ally: '{authority:3}', scrap: '',
    },
  },
  'sapphire-city-base': {
    name: 'Sapphire City Base', faction: 'trade_federation', cost: 5, type: 'outpost',
    defense: 5, copies: 1, role: 'trade_deck',
    discount: per('trade_federation'),
    primary: [combat(2), authority(2)],
    text: {
      primary: `{combat:2} {authority:2} ${DISCOUNT_TEXT.trade_federation}`, ally: '', scrap: '',
    },
  },
  'scavenger-bot': {
    name: 'Scavenger Bot', faction: 'machine_cult', cost: 2, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(1), scrapHandDiscard(0, 1)],
    ally: [combat(3)], doubleAlly: [draw(1)],
    text: {
      primary: '{trade:1} You may scrap a card in your hand or discard pile.',
      ally: '{combat:3}', doubleAlly: 'Draw a card.', scrap: '',
    },
  },
  'scrap-factory': {
    name: 'Scrap Factory', faction: 'machine_cult', cost: 7, type: 'outpost',
    defense: 7, copies: 1, role: 'trade_deck',
    discount: per('machine_cult'),
    primary: [scrapHandDiscard(1, 1)],
    text: {
      primary: `Scrap a card in your hand or discard pile. ${DISCOUNT_TEXT.machine_cult}`,
      ally: '', scrap: '',
    },
  },
  'spike-colony': {
    name: 'Spike Colony', faction: 'blob', cost: 5, type: 'base',
    defense: 5, copies: 1, role: 'trade_deck',
    discount: per('blob'),
    primary: [combat(4)],
    text: { primary: `{combat:4} ${DISCOUNT_TEXT.blob}`, ally: '', scrap: '' },
  },
  'trading-colony': {
    name: 'Trading Colony', faction: 'blob', cost: 6, type: 'base',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [trade(2)], ally: [combat(4)],
    doubleAlly: [{ k: 'ACQUIRE_FREE', filter: 'ship', maxCost: null, dest: 'deck_top', min: 1 }],
    text: {
      primary: '{trade:2}', ally: '{combat:4}',
      doubleAlly: 'Acquire a ship for free and put it directly on top of your deck.',
      scrap: '',
    },
  },
  'war-mech': {
    name: 'War Mech', faction: 'machine_cult', cost: 8, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    discount: per('machine_cult'),
    primary: [combat(10), {
      k: 'TOPDECK_FROM_DISCARD', filter: 'base', maxCost: null, min: 0, max: 2,
    }],
    ally: [draw(1)],
    text: {
      primary: '{combat:10} Put up to two bases from your discard pile on top of your deck. ' +
        DISCOUNT_TEXT.machine_cult,
      ally: 'Draw a card.', scrap: '',
    },
  },
}

export const HIGH_ALERT_TECH: Record<string, Spec> = {
  guidance: {
    name: 'Guidance', faction: 'unaligned', cost: 1, type: 'tech',
    defense: null, copies: 2, role: 'trade_deck',
    primaryCost: 1, primary: [scrapTradeRow(1)],
    text: { primary: 'Pay {trade:1}: Scrap a card in the trade row.', ally: '', scrap: '' },
  },
  laser: {
    name: 'Laser', faction: 'unaligned', cost: 2, type: 'tech',
    defense: null, copies: 2, role: 'trade_deck',
    primaryCost: 1, primary: [combat(1)],
    text: { primary: 'Pay {trade:1}: {combat:1}', ally: '', scrap: '' },
  },
  processing: {
    name: 'Processing', faction: 'unaligned', cost: 4, type: 'tech',
    defense: null, copies: 1, role: 'trade_deck',
    primaryCost: 2,
    primary: [{
      k: 'REDIRECT_NEXT_ACQUIRED',
      redirect: { filter: 'any', dest: 'deck_top', optional: false },
    }],
    text: {
      primary: 'Pay {trade:2}: Put the next card you acquire this turn directly on top of your deck.',
      ally: '', scrap: '',
    },
  },
  shield: {
    name: 'Shield', faction: 'unaligned', cost: 1, type: 'tech',
    defense: null, copies: 2, role: 'trade_deck',
    primaryCost: 1, primary: [authority(1)],
    text: { primary: 'Pay {trade:1}: {authority:1}', ally: '', scrap: '' },
  },
  stealth: {
    name: 'Stealth', faction: 'unaligned', cost: 3, type: 'tech',
    defense: null, copies: 1, role: 'trade_deck',
    primaryCost: 2, primary: [{ k: 'PHANTOM_FACTION', n: 1 }],
    text: {
      primary: 'Pay {trade:2}: Choose a faction. You count as having an additional card ' +
        'of that faction in play this turn.',
      ally: '', scrap: '',
    },
  },
  'stellar-link': {
    name: 'Stellar Link', faction: 'unaligned', cost: 3, type: 'tech',
    defense: null, copies: 2, role: 'trade_deck',
    primaryCost: 2, primary: [{ k: 'SCRY', n: 2 }],
    text: {
      primary: 'Pay {trade:2}: Look at the top two cards of your deck. Put one into your ' +
        'discard pile and the other back on top of your deck.',
      ally: '', scrap: '',
    },
  },
  'tractor-beam': {
    name: 'Tractor Beam', faction: 'unaligned', cost: 4, type: 'tech',
    defense: null, copies: 1, role: 'trade_deck',
    primaryCost: 2, primary: [{ k: 'RETURN_BASE_TO_HAND', min: 1 }],
    text: {
      primary: "Pay {trade:2}: Return target base to its owner's hand.", ally: '', scrap: '',
    },
  },
  warp: {
    name: 'Warp', faction: 'unaligned', cost: 4, type: 'tech',
    defense: null, copies: 1, role: 'trade_deck',
    primaryCost: 2, primary: [drawThenDiscard()],
    text: { primary: 'Pay {trade:2}: Draw a card, then discard a card.', ally: '', scrap: '' },
  },
}

export const HIGH_ALERT_REQUISITION: Record<string, Spec> = {
  corsair: {
    name: 'Corsair', faction: 'trade_federation', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    discount: per('trade_federation'),
    primary: [trade(3)], ally: [combat(4)],
    text: {
      primary: `{trade:3} ${DISCOUNT_TEXT.trade_federation}`, ally: '{combat:4}', scrap: '',
    },
  },
  hellfire: {
    name: 'Hellfire', faction: 'star_empire', cost: 4, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    discount: per('star_empire'),
    primary: [combat(5), oppDiscard(1)], ally: [drawThenDiscard()],
    text: {
      primary: `{combat:5} Target opponent discards a card. ${DISCOUNT_TEXT.star_empire}`,
      ally: 'Draw a card, then discard a card.', scrap: '',
    },
  },
  'lunar-landing': {
    name: 'Lunar Landing', faction: 'trade_federation', cost: 9, type: 'base',
    defense: 5, copies: 1, role: 'trade_deck',
    discount: per('trade_federation'),
    primary: [{
      k: 'PER',
      ref: { counter: 'faction_in_play', faction: 'trade_federation' },
      then: [authority(1), draw(1)],
    }],
    text: {
      primary: 'For each Trade Federation card you have in play, gain {authority:1} and ' +
        `draw a card. ${DISCOUNT_TEXT.trade_federation}`,
      ally: '', scrap: '',
    },
  },
  'operations-platform': {
    name: 'Operations Platform', faction: 'machine_cult', cost: 3, type: 'outpost',
    defense: 4, copies: 2, role: 'trade_deck',
    discount: per('machine_cult'),
    primary: [chooseOne(
      { label: '{trade:1}', then: [trade(1)] },
      { label: '{combat:1}', then: [combat(1)] },
    )],
    text: {
      primary: `{trade:1} OR {combat:1} ${DISCOUNT_TEXT.machine_cult}`, ally: '', scrap: '',
    },
  },
  'swarm-colony': {
    name: 'Swarm Colony', faction: 'blob', cost: 6, type: 'base',
    defense: 5, copies: 1, role: 'trade_deck',
    discount: per('blob'),
    primary: [draw(1)], ally: [combat(4)],
    text: { primary: `Draw a card. ${DISCOUNT_TEXT.blob}`, ally: '{combat:4}', scrap: '' },
  },
  'tanker-mech': {
    name: 'Tanker Mech', faction: 'machine_cult', cost: 5, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    discount: per('machine_cult'),
    primary: [trade(4)], ally: [scrapHandDiscard(1, 1)], scrap: [draw(1)],
    text: {
      primary: `{trade:4} ${DISCOUNT_TEXT.machine_cult}`,
      ally: 'Scrap a card in your hand or discard pile.', scrap: 'Draw a card.',
    },
  },
  'the-armory': {
    name: 'The Armory', faction: 'star_empire', cost: 7, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    discount: per('star_empire'),
    primary: [trade(3), oppDiscard(1)],
    text: {
      primary: `{trade:3} Target opponent discards a card. ${DISCOUNT_TEXT.star_empire}`,
      ally: '', scrap: '',
    },
  },
  'warrior-pod': {
    name: 'Warrior Pod', faction: 'blob', cost: 2, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    discount: per('blob'),
    primary: [combat(4)], ally: [combat(3)],
    text: { primary: `{combat:4} ${DISCOUNT_TEXT.blob}`, ally: '{combat:3}', scrap: '' },
  },
}

export const HIGH_ALERT_INVASION: Record<string, Spec> = {
  'alpha-max': {
    name: 'Alpha Max', faction: 'blob', cost: 7, type: 'ship',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [combat(5), draw(1)], ally: [draw(1)], doubleAlly: [draw(1)],
    text: {
      primary: '{combat:5} Draw a card.', ally: 'Draw a card.',
      doubleAlly: 'Draw a card.', scrap: '',
    },
  },
  arsenal: {
    name: 'Arsenal', faction: 'star_empire', cost: 5, type: 'base',
    defense: 5, copies: 1, role: 'trade_deck',
    primary: [combat(2), drawThenDiscard()],
    text: { primary: '{combat:2} Draw a card, then discard a card.', ally: '', scrap: '' },
  },
  'cargo-raptor': {
    name: 'Cargo Raptor', faction: 'star_empire', cost: 2, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(3)], ally: [combat(2)], doubleAlly: [oppDiscard(1)],
    text: {
      primary: '{trade:3}', ally: '{combat:2}',
      doubleAlly: 'Target opponent discards a card.', scrap: '',
    },
  },
  'fusion-bot': {
    name: 'Fusion Bot', faction: 'machine_cult', cost: 3, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [combat(5)], ally: [scrapHandDiscard(1, 1)], doubleAlly: [draw(1)],
    text: {
      primary: '{combat:5}', ally: 'Scrap a card in your hand or discard pile.',
      doubleAlly: 'Draw a card.', scrap: '',
    },
  },
  'mech-fortress': {
    name: 'Mech Fortress', faction: 'machine_cult', cost: 8, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [draw(1), scrapHandDiscard(0, 1)], ally: [combat(5)],
    text: {
      primary: 'Draw a card. You may scrap a card in your hand or discard pile.',
      ally: '{combat:5}', scrap: '',
    },
  },
  'naval-yard': {
    name: 'Naval Yard', faction: 'trade_federation', cost: 6, type: 'outpost',
    defense: 6, copies: 1, role: 'trade_deck',
    primary: [chooseOne(
      { label: '{trade:3}', then: [trade(3)] },
      { label: '{authority:4}', then: [authority(4)] },
    )],
    text: { primary: '{trade:3} OR {authority:4}', ally: '', scrap: '' },
  },
  'swarm-cell': {
    name: 'Swarm Cell', faction: 'blob', cost: 2, type: 'base',
    defense: 3, copies: 2, role: 'trade_deck',
    primary: [combat(2)], ally: [combat(2)],
    text: { primary: '{combat:2}', ally: '{combat:2}', scrap: '' },
  },
  voyager: {
    name: 'Voyager', faction: 'trade_federation', cost: 1, type: 'ship',
    defense: null, copies: 2, role: 'trade_deck',
    primary: [trade(2)], ally: [combat(2)], doubleAlly: [authority(4)],
    text: {
      primary: '{trade:2}', ally: '{combat:2}', doubleAlly: '{authority:4}', scrap: '',
    },
  },
}

/**
 * The Heroes pack: dual-faction Heroes, one per pair per price point.
 *
 * "Gain an Alliance Ally" is printed as one combined icon for the pair, and we
 * read it as granting an ally of both factions -- the same thing a card counting
 * as both would do for ally purposes.
 */
const PAIR_NAME: Record<string, string> = {
  'star_empire+trade_federation': 'Alliance',
  'blob+star_empire': 'Union',
  'blob+machine_cult': 'Unity',
  'trade_federation+machine_cult': 'Coalition',
  'machine_cult+star_empire': 'Alignment',
  'blob+trade_federation': 'Pact',
}

const pairHero = (
  name: string, cost: number, a: Faction, b: Faction,
  onScrapExtra: readonly Effect[] = [], onScrapExtraText = '',
): Spec => {
  const pair = PAIR_NAME[`${a}+${b}`] ?? 'Allied'
  const grant = `Gain ${/^[AEIOU]/.test(pair) ? 'an' : 'a'} ${pair} Ally.`
  return {
    name, faction: a, faction2: b, cost, type: 'hero',
    defense: null, copies: 1, role: 'trade_deck',
    primary: [ally(a), ally(b)],
    scrap: [ally(a), ally(b), ...onScrapExtra],
    text: {
      primary: grant,
      ally: '',
      scrap: `${grant} ${onScrapExtraText}`.trim(),
    },
  }
}

export const HIGH_ALERT_HEROES: Record<string, Spec> = {
  'administrator-tung': pairHero('Administrator Tung', 1, 'machine_cult', 'star_empire'),
  'templar-brehmer': pairHero('Templar Brehmer', 3, 'machine_cult', 'star_empire',
    [chooseOne(
      { label: '{combat:2} Target opponent discards a card', then: [combat(2), oppDiscard(1)] },
      { label: 'Scrap a card in your hand or discard pile', then: [scrapHandDiscard(1, 1)] },
    )],
    'Choose one: {combat:2} and target opponent discards a card; ' +
    'or scrap a card in your hand or discard pile.'),
  'bio-warrior-storm': pairHero('Bio-Warrior Storm', 1, 'blob', 'star_empire'),
  'bio-captain-kalle': pairHero('Bio-Captain Kalle', 3, 'blob', 'star_empire',
    [chooseOne(
      { label: '{combat:2} Target opponent discards a card', then: [combat(2), oppDiscard(1)] },
      { label: '{combat:3} Scrap a card in the trade row', then: [combat(3), scrapTradeRow(1)] },
    )],
    'Choose one: {combat:2} and target opponent discards a card; ' +
    'or {combat:3} and scrap a card in the trade row.'),
  'bioform-freeman': pairHero('Bioform Freeman', 1, 'blob', 'machine_cult'),
  'biodroid-otto': pairHero('Biodroid Otto', 4, 'blob', 'machine_cult',
    [chooseOne(
      { label: '{combat:3} Scrap a card in the trade row', then: [combat(3), scrapTradeRow(1)] },
      { label: 'Scrap a card in your hand or discard pile', then: [scrapHandDiscard(1, 1)] },
    )],
    'Choose one: {combat:3} and scrap a card in the trade row; ' +
    'or scrap a card in your hand or discard pile.'),
  'data-priest-kaufman': pairHero('Data Priest Kaufman', 1, 'trade_federation', 'machine_cult'),
  'strategist-thompson': pairHero('Strategist Thompson', 3, 'trade_federation', 'machine_cult',
    [chooseOne(
      { label: 'Scrap a card in your hand or discard pile', then: [scrapHandDiscard(1, 1)] },
      { label: '{authority:6}', then: [authority(6)] },
    )],
    'Choose one: scrap a card in your hand or discard pile; or {authority:6}'),
  'doctor-clark': pairHero('Doctor Clark', 1, 'star_empire', 'trade_federation'),
  'high-admiral-shaner': pairHero('High Admiral Shaner', 3, 'star_empire', 'trade_federation',
    [chooseOne(
      { label: '{combat:2} Target opponent discards a card', then: [combat(2), oppDiscard(1)] },
      { label: '{authority:6}', then: [authority(6)] },
    )],
    'Choose one: {combat:2} and target opponent discards a card; or {authority:6}'),
  'pact-searcher-sheldon': pairHero('Pact Searcher Sheldon', 1, 'blob', 'trade_federation'),
  'pact-manager-scott': pairHero('Pact Manager Scott', 3, 'blob', 'trade_federation',
    [chooseOne(
      { label: '{combat:3} Scrap a card in the trade row', then: [combat(3), scrapTradeRow(1)] },
      { label: '{authority:6}', then: [authority(6)] },
    )],
    'Choose one: {combat:3} and scrap a card in the trade row; or {authority:6}'),
}
