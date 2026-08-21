import type { CardDefId, Faction, PlayerId } from './ids'

/**
 * ARENA SCENARIOS.
 *
 * A Scenario changes one rule for the whole game: "shuffle the Scenario cards,
 * flip one over, and that's the rule affecting both players for this game."
 *
 * SOURCES, and this one needs stating plainly. The publisher's Card Gallery
 * spreadsheet carries NO text for the twenty Scenario cards, and there are no
 * card scans of them -- only cropped artwork. Two things fill part of the gap:
 *
 *   - the publisher's own Arena Tips articles, which quote each week's scenario
 *     rule verbatim. Ten scenarios come from there, word for word.
 *   - three more -- Buyer's Market, Flare Mining and Rapid Construction -- whose
 *     rule is quoted in secondary write-ups of the same Arena weeks. They are
 *     marked `secondhand` so the distinction is not lost.
 *
 * The remaining six -- Border Skirmish, Early Recruitment, Fleeting
 * Opportunities, Picking Sides, Prolonged Conflict and Ready Reserves -- are
 * DELIBERATELY ABSENT. Their names appear in the Card Gallery and in Arena
 * schedules; their rules appear nowhere reachable. The publisher's whole
 * 337-post archive, its static pages, the community wiki and BoardGameGeek were
 * searched for them. Inventing six setup rules and calling them Star Realms
 * would be a fabrication, not an implementation, so they go in when a source
 * for them does.
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

export const VARIANTS: readonly VariantId[] = [
  'total-war', 'maximum-warp', 'emergency-repairs', 'ruthless-efficiency',
  'rushed-defenses', 'recruiting-drive', 'entrenched-loyalties',
  'commitment-to-the-cause', 'frontier-expedition', 'frantic-preparations',
  'flare-mining', 'buyers-market', 'rapid-construction',
]

/**
 * Scenarios whose wording comes from a secondary write-up rather than from the
 * publisher's own article. The rule is specific and consistent across sources,
 * but the provenance is weaker, and the UI says so.
 */
export const SECONDHAND: readonly VariantId[] = [
  'flare-mining', 'buyers-market', 'rapid-construction',
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
  'flare-mining': 'sc-flare-mining' as CardDefId,
}
