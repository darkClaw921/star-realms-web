import type { CardDefId, CardIid, ChoiceId, PlayerId, Zone } from './ids'

export type PromptKind =
  | 'DISCARD'
  | 'SCRAP_ZONES'
  | 'SCRAP_TRADE_ROW'
  | 'DESTROY_BASE'
  | 'CHOOSE_BRANCH'
  | 'MAY'
  | 'ACQUIRE_FREE'
  | 'COPY_SHIP'
  | 'DISCARD_THEN_DRAW'
  | 'SCRAP_THEN_DRAW'
  | 'REDIRECT_ACQUIRED'
  // ── Frontiers ─────────────────────────────────────────────────────────────
  | 'SCRAP_ROW_FOR_COMBAT'
  | 'SCRAP_FOR_COMBAT'
  | 'TOPDECK_BASE'
  | 'DISCARD_FOR_COMBAT'
  // ── Colony Wars ───────────────────────────────────────────────────────────
  | 'COPY_BASE'
  // ── Crisis ────────────────────────────────────────────────────────────────
  | 'RETURN_BASE_TO_HAND'
  | 'DISCARD_OR_LOSE'
  | 'DESTROY_OWN_BASE_OR_LOSE'
  | 'TOPDECK_FROM_HAND'
  // ── High Alert ────────────────────────────────────────────────────────────
  | 'CHOOSE_FACTION'
  | 'SCRY'
  // ── Stellar Allies ────────────────────────────────────────────────────────
  | 'COPY_USED_ALLY'
  // ── Frontiers Kickstarter promos ──────────────────────────────────────────
  | 'DISCARD_TO_HAND'
  | 'STEAL_FROM_DISCARD'
  | 'SET_ASIDE_FROM_ROW'
  // ── Gambits and Missions ──────────────────────────────────────────────────
  | 'BUY_FROM_SCRAP_HEAP'
  | 'REVEAL_SPLIT'
  | 'DISCARD_FOR_TRADE_OR_COMBAT'

export type ChoiceOption =
  /** `owner` is null for shared zones (the trade row), which belong to nobody. */
  | { o: 'CARD'; iid: CardIid; def: CardDefId; zone: Zone; owner: PlayerId | null }
  | { o: 'BRANCH'; index: number; label: string }
  | { o: 'EXPLORER' }
  | { o: 'CONFIRM' }

/**
 * A point where resolution cannot continue until someone chooses.
 *
 * `options` is ENUMERATED rather than stored as a predicate: the server validates
 * by set membership, the client renders exactly the legal set, it serializes, and
 * -- crucially -- it can be redacted per viewer. A forced-discard choice's options
 * literally contain the opponent's hand, so broadcasting them to both players is
 * the single most common hand leak in this architecture. See view.ts.
 *
 * Optionality is encoded as `min === 0`, not as a DECLINE pseudo-option: declining
 * is selecting zero options. One rule, no special case in any handler.
 */
export interface PendingChoice {
  readonly id: ChoiceId
  /** WHO answers. May be the non-active player. */
  readonly actor: PlayerId
  readonly prompt: PromptKind
  /** The card that caused this, for UI highlighting. */
  readonly source: CardIid | null
  readonly label: string
  readonly min: number
  readonly max: number
  readonly options: readonly ChoiceOption[]
}

export function sameOption(a: ChoiceOption, b: ChoiceOption): boolean {
  if (a.o !== b.o) return false
  switch (a.o) {
    case 'CARD': return a.iid === (b as Extract<ChoiceOption, { o: 'CARD' }>).iid
    case 'BRANCH': return a.index === (b as Extract<ChoiceOption, { o: 'BRANCH' }>).index
    case 'EXPLORER': return true
    case 'CONFIRM': return true
  }
}
