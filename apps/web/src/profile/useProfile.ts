'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchProfile, readIdentity, renameProfile, saveIdentityName } from './identity'
import type { Profile } from './types'

/**
 * Профиль для экрана.
 *
 * Читается он на клиенте, а не на сервере при рендере, по простой причине:
 * идентификатор лежит в localStorage, а серверный рендер о нём не знает.
 * Поэтому меню сначала показывает пустое место под карточку, а не чужой профиль
 * и не мигание.
 *
 * Состояния три, и различать их обязательно: «ещё грузим», «сервер не ответил»
 * и «профиль есть, но партий в нём нет». Схлопнуть последние два — значит
 * сказать новичку, что он всё проиграл.
 */
export type ProfileState =
  | { status: 'loading' }
  /** Хранилище браузера закрыто: личности нет и завести её негде. */
  | { status: 'anonymous' }
  | { status: 'offline'; name: string }
  | { status: 'ready'; profile: Profile }

export function useProfile(): {
  state: ProfileState
  rename: (name: string) => Promise<void>
  reload: () => void
} {
  const [state, setState] = useState<ProfileState>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const me = readIdentity()
    if (!me) { setState({ status: 'anonymous' }); return }
    let live = true
    void fetchProfile(me.id).then((p) => {
      if (!live) return
      // Имя из браузера главнее серверного, пока сервер молчит: игрок только
      // что мог его сменить с другого устройства, но подпись под пустым
      // экраном лучше своя, чем никакая.
      setState(p ? { status: 'ready', profile: p } : { status: 'offline', name: me.name })
    })
    return () => { live = false }
  }, [nonce])

  const rename = useCallback(async (name: string) => {
    const me = saveIdentityName(name)
    if (!me) return
    const p = await renameProfile(me.id, name)
    if (p) setState({ status: 'ready', profile: p })
    else setState({ status: 'offline', name })
  }, [])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return { state, rename, reload }
}
