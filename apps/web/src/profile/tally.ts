import { FACTIONS, cardDef, type CardDefId, type Faction } from '@sr/engine'
import {
  PLAY_MODES, RECENT_LIMIT,
  type FactionTally, type MatchResult, type Profile, type PlayMode, type Tally,
} from './types'

/**
 * Свод статистики.
 *
 * Модуль чистый и ничего не знает ни про файлы, ни про сеть: профиль входит,
 * профиль выходит. Так его одинаково зовут и сервер, когда сам видит конец
 * онлайн-партии, и обработчик запроса, когда итог приносит клиент.
 *
 * Хранятся СУММЫ, а не средние: среднее из среднего не собирается, а сумма
 * ходов плюс число партий дают и то и другое в любой момент.
 */

function emptyTally(): Tally {
  return {
    games: 0, wins: 0, losses: 0, turns: 0, durationMs: 0,
    fastestWin: null, longest: 0, streak: 0, bestStreak: 0, worstStreak: 0,
  }
}

function emptyFactions(): Record<Faction, FactionTally> {
  const out = {} as Record<Faction, FactionTally>
  for (const f of FACTIONS) out[f] = { cards: 0, leading: 0, leadingWins: 0 }
  return out
}

export function emptyProfile(id: string, name: string, now: number): Profile {
  const modes = {} as Record<PlayMode, Tally>
  for (const m of PLAY_MODES) modes[m] = emptyTally()
  return {
    id, name, createdAt: now, updatedAt: now,
    modes, factions: emptyFactions(), cards: {}, recent: [],
  }
}

/**
 * Достроить профиль, прочитанный с диска.
 *
 * Файл мог быть записан прошлой версией — с другим набором режимов или без
 * фракции, добавленной позже. Разбирать его схемой и отвергать целиком значило
 * бы терять всю историю игрока из-за одного нового поля, поэтому недостающее
 * просто дозаполняется пустыми счётчиками.
 */
export function normalise(raw: Partial<Profile>, id: string, now: number): Profile {
  const base = emptyProfile(id, typeof raw.name === 'string' ? raw.name : '', now)
  const modes = base.modes
  for (const m of PLAY_MODES) modes[m] = { ...modes[m], ...(raw.modes?.[m] ?? {}) }
  const factions = base.factions
  for (const f of FACTIONS) factions[f] = { ...factions[f], ...(raw.factions?.[f] ?? {}) }
  return {
    ...base,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    modes,
    factions,
    cards: raw.cards ?? {},
    recent: Array.isArray(raw.recent) ? raw.recent.slice(0, RECENT_LIMIT) : [],
  }
}

/** Фракция, которой в колоде оказалось больше всего. Ничьи не считаются. */
export function leadingFaction(cards: readonly CardDefId[]): Faction | null {
  const count = new Map<Faction, number>()
  for (const def of cards) {
    const f = factionOf(def)
    // Нейтральные карты берут все и всегда — они ничего не говорят о том, чем
    // игрок играл, и в подсчёт «любимой фракции» не идут.
    if (!f || f === 'unaligned') continue
    count.set(f, (count.get(f) ?? 0) + 1)
  }
  let best: Faction | null = null
  let top = 0
  let tied = false
  for (const [f, n] of count) {
    if (n > top) { best = f; top = n; tied = false } else if (n === top) tied = true
  }
  return tied ? null : best
}

/** Карта из чужого набора не должна ронять свод. */
function factionOf(def: CardDefId): Faction | null {
  try {
    return cardDef(def).faction
  } catch {
    return null
  }
}

function bump(t: Tally, r: MatchResult): Tally {
  const streak = r.won ? Math.max(1, t.streak + 1) : Math.min(-1, t.streak - 1)
  return {
    games: t.games + 1,
    wins: t.wins + (r.won ? 1 : 0),
    losses: t.losses + (r.won ? 0 : 1),
    turns: t.turns + r.turns,
    durationMs: t.durationMs + r.durationMs,
    fastestWin: r.won && (t.fastestWin === null || r.turns < t.fastestWin)
      ? r.turns
      : t.fastestWin,
    longest: Math.max(t.longest, r.turns),
    streak,
    bestStreak: Math.max(t.bestStreak, streak),
    worstStreak: Math.min(t.worstStreak, streak),
  }
}

/** Записать партию в профиль. Возвращается новый профиль, старый не трогается. */
export function record(p: Profile, r: MatchResult): Profile {
  const modes = { ...p.modes, [r.mode]: bump(p.modes[r.mode] ?? emptyTally(), r) }

  const factions = { ...p.factions }
  for (const def of r.cards) {
    const f = factionOf(def)
    if (!f) continue
    factions[f] = { ...factions[f], cards: factions[f].cards + 1 }
  }
  const lead = leadingFaction(r.cards)
  if (lead) {
    factions[lead] = {
      ...factions[lead],
      leading: factions[lead].leading + 1,
      leadingWins: factions[lead].leadingWins + (r.won ? 1 : 0),
    }
  }

  const cards = { ...p.cards }
  // Считается КАРТА, а не экземпляр: две «Боевые капсулы» в колоде — это два
  // раза выбранная карта, и складывать их в одну означало бы потерять разницу
  // между «взял однажды» и «строил на ней колоду».
  for (const def of r.cards) {
    const c = cards[def] ?? { taken: 0, wins: 0 }
    cards[def] = { taken: c.taken + 1, wins: c.wins + (r.won ? 1 : 0) }
  }

  return {
    ...p,
    updatedAt: r.at,
    modes,
    factions,
    cards,
    recent: [r, ...p.recent].slice(0, RECENT_LIMIT),
  }
}
