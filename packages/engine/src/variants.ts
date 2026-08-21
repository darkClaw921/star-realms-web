import type { CardDefId, Faction, PlayerId } from './ids'

/**
 * ARENA SCENARIOS.
 *
 * A Scenario changes one rule for the whole game: "shuffle the Scenario cards,
 * flip one over, and that's the rule affecting both players for this game."
 *
 * SOURCES, and this one needs stating plainly. The publisher's Card Gallery
 * spreadsheet carries NO text for the twenty Scenario cards, and there are no
 * card scans of them -- only cropped artwork. What the publisher does have is
 * its own Arena Tips articles, which quote each week's scenario rule verbatim.
 * The ten scenarios below are the ones whose exact wording appears there.
 *
 * The other ten -- Border Skirmish, Buyer's Market, Early Recruitment, Flare
 * Mining, Fleeting Opportunities, Picking Sides, Prolonged Conflict, Rapid
 * Construction, Ready Reserves and Warpgate Nexus -- are DELIBERATELY ABSENT.
 * Their names are printed in the Card Gallery and nowhere else; inventing ten
 * setup rules and calling them Star Realms would be a fabrication, not an
 * implementation. They go in when a source for them does.
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

export const VARIANTS: readonly VariantId[] = [
  'total-war', 'maximum-warp', 'emergency-repairs', 'ruthless-efficiency',
  'rushed-defenses', 'recruiting-drive', 'entrenched-loyalties',
  'commitment-to-the-cause', 'frontier-expedition', 'frantic-preparations',
]

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
  readonly faction?: Record<PlayerId, Faction>
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
}
