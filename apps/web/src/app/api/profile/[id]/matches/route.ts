import { matchResultSchema } from '@sr/protocol'
import type { CardDefId } from '@sr/engine'
import type { MatchResult } from '@/profile/types'
import { cleanName, recordMatch, validId } from '@/server/profiles'

/**
 * Запись сыгранной партии.
 *
 * Сюда приходят только те режимы, где движок крутился в браузере: против бота,
 * за одним устройством, кампания и испытания. Онлайн-партию сервер записывает
 * сам, увидев её конец на своём столе, — принимать её исход с клиента значило
 * бы верить проигравшему на слово.
 *
 * Момент завершения ставит сервер: клиентские часы могут отставать на годы, а
 * история партий сортируется по времени.
 */
export const dynamic = 'force-dynamic'

export async function POST(
  req: Request, ctx: RouteContext<'/api/profile/[id]/matches'>,
): Promise<Response> {
  const { id } = await ctx.params
  if (!validId(id)) return Response.json({ error: 'bad id' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'bad body' }, { status: 400 })
  }

  const envelope = body as { result?: unknown; name?: unknown } | null
  const parsed = matchResultSchema.safeParse(envelope?.result)
  if (!parsed.success) return Response.json({ error: 'bad result' }, { status: 400 })

  const result: MatchResult = {
    ...parsed.data,
    cards: parsed.data.cards as CardDefId[],
    at: Date.now(),
  }
  return Response.json(await recordMatch(id, cleanName(envelope?.name), result))
}
