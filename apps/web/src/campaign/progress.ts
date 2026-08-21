'use client'

import { CAMPAIGNS, type CampaignId, type Mission } from '@sr/engine'

/**
 * Which missions have been beaten.
 *
 * Local to the browser on purpose: campaign progress is not a game rule, it
 * never crosses the wire, and the engine must not learn about it -- a scenario
 * has to produce the same game whether it is your first attempt or your tenth.
 */
const KEY = 'sr:campaign'

export type Progress = Readonly<Record<string, true>>

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, true> = {}
    for (const k of Object.keys(parsed as object)) out[k] = true
    return out
  } catch {
    // Private window, disabled site data, corrupt value -- all mean "no progress".
    return {}
  }
}

export function markBeaten(id: string): Progress {
  const next = { ...loadProgress(), [id]: true as const }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* не критично */ }
  return next
}

export function resetProgress(): void {
  try { localStorage.removeItem(KEY) } catch { /* не критично */ }
}

/**
 * A mission is open if it is the first of its campaign or the one before it has
 * been beaten. Campaigns themselves are all open from the start: gating them
 * behind each other would hide two thirds of the content behind a difficulty
 * wall, and they are meant to be picked by taste.
 */
export function isUnlocked(m: Mission, p: Progress): boolean {
  if (m.index === 1) return true
  const c = CAMPAIGNS.find((x) => x.id === m.campaign)
  const prev = c?.missions[m.index - 2]
  return prev ? p[prev.id] === true : true
}

export function campaignDone(id: CampaignId, p: Progress): number {
  const c = CAMPAIGNS.find((x) => x.id === id)
  if (!c) return 0
  return c.missions.filter((m) => p[m.id]).length
}
