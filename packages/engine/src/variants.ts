import type { CardDefId, Faction, PlayerId } from './ids'

/**
 * ARENA SCENARIOS.
 *
 * A Scenario changes one rule for the whole game: "shuffle the Scenario cards,
 * flip one over, and that's the rule affecting both players for this game."
 *
 * SOURCE. All twenty are here, and every one is transcribed from the
 * publisher's own scan of the card.
 *
 * Finding them took two false starts worth recording, because both are easy to
 * repeat. The Card Gallery spreadsheet carries no text for these cards at all,
 * so the obvious source is empty. And a search of the media library for
 * "Scenario" or for the set's own `SRSCN_` prefix returns only cropped artwork
 * -- the card faces are filed under plain hyphenated names ("Border-Skirmish")
 * in the December 2017 upload, matching neither pattern. The pack's rules card
 * is the thread that leads there: it is filed the same way.
 *
 * Two of the twenty, Early Recruitment and Picking Sides, are printed
 * two-player only. This engine is two-player, so they are always legal here.
 */
export type VariantId =
  | 'total-war'
  | 'maximum-warp'
  | 'emergency-repairs'
  | 'ruthless-efficiency'
  | 'rushed-defenses'
  | 'recruiting-drive'
  | 'entrenched-loyalties'
  | 'commitment-to-the-cause'
  | 'frontier-expedition'
  | 'frantic-preparations'
  | 'flare-mining'
  | 'buyers-market'
  | 'rapid-construction'
  | 'border-skirmish'
  | 'prolonged-conflict'
  | 'warpgate-nexus'
  | 'fleeting-opportunities'
  | 'ready-reserves'
  | 'early-recruitment'
  | 'picking-sides'

export const VARIANTS: readonly VariantId[] = [
  'total-war', 'maximum-warp', 'emergency-repairs', 'ruthless-efficiency',
  'rushed-defenses', 'recruiting-drive', 'entrenched-loyalties',
  'commitment-to-the-cause', 'frontier-expedition', 'frantic-preparations',
  'flare-mining', 'buyers-market', 'rapid-construction',
  'border-skirmish', 'prolonged-conflict', 'warpgate-nexus',
  'fleeting-opportunities', 'ready-reserves', 'early-recruitment', 'picking-sides',
]

/**
 * Authority each player starts with, relative to the standard fifty.
 * Border Skirmish takes twenty away; Prolonged Conflict hands thirty over.
 */
export const VARIANT_AUTHORITY: Partial<Record<VariantId, number>> = {
  'border-skirmish': -20,
  'prolonged-conflict': 30,
}

/**
 * Early Recruitment and Picking Sides both hand out one card of each faction,
 * differing only in what those cards cost.
 */
export const VARIANT_RECRUIT_COST: Partial<Record<VariantId, number>> = {
  'early-recruitment': 1,
  'picking-sides': 2,
}

/**
 * The scenario in force, plus whatever it rolled at setup.
 *
 * Public: both players have to be able to see what they are playing under, and
 * Entrenched Loyalties' assigned factions are announced at the start of the
 * game rather than discovered.
 */
export interface VariantState {
  readonly id: VariantId
  /** Entrenched Loyalties: the faction each player buys a point cheaper. */
  readonly faction?: Partial<Record<PlayerId, Faction>>
}

/**
 * The card each player gets in front of them for a scenario with an activated
 * ability. Reusing the revealed-gambit zone rather than inventing a fifth place
 * for a card to live: it is already a card beside the board with a once-per-turn
 * ability, which is exactly what these are.
 */
export const VARIANT_CARD: Partial<Record<VariantId, CardDefId>> = {
  'total-war': 'sc-total-war' as CardDefId,
  'maximum-warp': 'sc-maximum-warp' as CardDefId,
  'emergency-repairs': 'sc-emergency-repairs' as CardDefId,
  'ruthless-efficiency': 'sc-ruthless-efficiency' as CardDefId,
  'flare-mining': 'sc-flare-mining' as CardDefId,
}
