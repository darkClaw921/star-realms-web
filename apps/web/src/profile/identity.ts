import type { PlayerRef } from '@sr/protocol'
import type { MatchResult, Profile } from './types'

/**
 * Кто ты за этим браузером.
 *
 * Логина нет, поэтому опознание держится на случайном идентификаторе, который
 * браузер заводит себе сам при первом заходе и хранит рядом с настройками.
 * Сервер по нему только находит файл со статистикой — ни доступа к чужим
 * партиям, ни возможности сыграть за другого он не даёт: место за столом
 * выдаётся сокету, а не тому, что написано в запросе.
 *
 * Заблокированное хранилище (приватный режим) не должно ломать игру, поэтому
 * при неудаче игрок остаётся безымянным гостем: партии просто не считаются.
 */

const KEY = 'sr:player'

export interface Identity {
  readonly id: string
  readonly name: string
}

function make(): Identity {
  return { id: crypto.randomUUID(), name: '' }
}

/** Прочитать личность, заведя её при первом обращении. null — писать некуда. */
export function readIdentity(): Identity | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      const id = (parsed as Identity | null)?.id
      const name = (parsed as Identity | null)?.name
      if (typeof id === 'string' && id.length > 0) {
        return { id, name: typeof name === 'string' ? name : '' }
      }
    }
    const fresh = make()
    localStorage.setItem(KEY, JSON.stringify(fresh))
    return fresh
  } catch {
    return null
  }
}

/** Имя хранится и локально: подпись нужна раньше, чем ответ сервера. */
export function saveIdentityName(name: string): Identity | null {
  const me = readIdentity()
  if (!me) return null
  const next: Identity = { id: me.id, name }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    return next
  }
  return next
}

/** Чем игрок представляется столу при создании и входе в комнату. */
export function playerRef(): PlayerRef | undefined {
  const me = readIdentity()
  if (!me) return undefined
  return me.name ? { id: me.id, name: me.name } : { id: me.id }
}

export async function fetchProfile(id: string): Promise<Profile | null> {
  try {
    const res = await fetch(`/api/profile/${id}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as Profile
  } catch {
    return null
  }
}

export async function renameProfile(id: string, name: string): Promise<Profile | null> {
  try {
    const res = await fetch(`/api/profile/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) return null
    return (await res.json()) as Profile
  } catch {
    return null
  }
}

/**
 * Отправить итог локальной партии.
 *
 * Молча и без ожидания: игрок в этот момент смотрит на экран победы, и
 * недоступный сервер не повод показывать ему ошибку. Потерянная партия — потеря
 * одной строчки в статистике, а не сбой игры.
 */
export async function reportMatch(result: MatchResult): Promise<void> {
  const me = readIdentity()
  if (!me) return
  try {
    await fetch(`/api/profile/${me.id}/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result, name: me.name }),
      keepalive: true,
    })
  } catch {
    // см. выше
  }
}
