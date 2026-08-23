import { cleanName, readProfile, renameProfile, validId } from '@/server/profiles'

/**
 * Профиль игрока.
 *
 * GET отдаёт свод, PATCH меняет подпись. Ни того ни другого нельзя кэшировать:
 * страница профиля обязана показывать партию, доигранную секунду назад.
 *
 * Проверки прав здесь нет и быть не может: идентификатор и есть весь ключ.
 * Кто его знает — тот и владелец, ровно как со ссылкой на документ. Для
 * счётчика побед в игре без аккаунтов это честный размен, но именно поэтому в
 * профиле не лежит ничего, кроме статистики.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request, ctx: RouteContext<'/api/profile/[id]'>,
): Promise<Response> {
  const { id } = await ctx.params
  if (!validId(id)) return Response.json({ error: 'bad id' }, { status: 400 })
  return Response.json(await readProfile(id))
}

export async function PATCH(
  req: Request, ctx: RouteContext<'/api/profile/[id]'>,
): Promise<Response> {
  const { id } = await ctx.params
  if (!validId(id)) return Response.json({ error: 'bad id' }, { status: 400 })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'bad body' }, { status: 400 })
  }
  const name = cleanName((body as { name?: unknown } | null)?.name)
  if (!name) return Response.json({ error: 'bad name' }, { status: 400 })
  return Response.json(await renameProfile(id, name))
}
