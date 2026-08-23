import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MatchResult, Profile } from '@/profile/types'
import { emptyProfile, normalise, record } from '@/profile/tally'

/**
 * Профили на диске.
 *
 * Один файл на игрока рядом с журналами матчей. Базы здесь нет и не нужно:
 * записей столько же, сколько сыгранных партий, а читается профиль ровно
 * своим владельцем.
 *
 * Две вещи, на которых всё держится:
 *
 *   - Идентификатор приходит из браузера, то есть от кого угодно, а из него
 *     складывается путь. Поэтому он не «очищается», а проверяется по строгой
 *     форме, и всё, что в неё не укладывается, отвергается целиком.
 *   - Запись атомарная и по одному хозяину за раз. Две партии, кончившиеся
 *     одновременно (а в онлайне это ровно то, что происходит: одно событие
 *     закрывает партию сразу двоим), иначе перетёрли бы друг друга — обе
 *     прочитали бы один и тот же файл и записали каждая своё.
 */

const DIR = process.env.SR_PROFILE_DIR
  ?? join(process.env.SR_DATA_DIR ?? join(process.cwd(), '..', '..', 'data'), 'profiles')

/** Ровно та форма, которую выдаёт crypto.randomUUID(). */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function validId(id: string): boolean {
  return ID.test(id)
}

/** Длинное имя ломает вёрстку, пустое — не имя. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, 24)
}

/** Очередь на игрока: сериализует чтение-запись одного и того же файла. */
const queues = new Map<string, Promise<unknown>>()

function serial<T>(id: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(id) ?? Promise.resolve()
  const next = prev.then(job, job)
  // Хвост очереди не должен ронять процесс необработанным отказом: ошибку
  // получит вызвавший, а очередь просто идёт дальше.
  queues.set(id, next.catch(() => undefined))
  return next
}

function file(id: string): string {
  return join(DIR, `${id}.json`)
}

async function load(id: string, now: number): Promise<Profile> {
  try {
    const raw: unknown = JSON.parse(await readFile(file(id), 'utf8'))
    if (!raw || typeof raw !== 'object') return emptyProfile(id, '', now)
    return normalise(raw as Partial<Profile>, id, now)
  } catch {
    // Нет файла — нет и партий: новый игрок и битый файл одинаково означают
    // «начинаем с нуля», и падать здесь незачем.
    return emptyProfile(id, '', now)
  }
}

async function save(p: Profile): Promise<void> {
  await mkdir(DIR, { recursive: true })
  // Через временный файл: оборванная на середине запись оставила бы игрока с
  // обрезанным JSON, то есть без всей истории.
  const tmp = `${file(p.id)}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(p), 'utf8')
  await rename(tmp, file(p.id))
}

export async function readProfile(id: string): Promise<Profile> {
  return serial(id, () => load(id, Date.now()))
}

/** Переименование — единственное, что игрок правит в профиле руками. */
export async function renameProfile(id: string, name: string): Promise<Profile> {
  return serial(id, async () => {
    const now = Date.now()
    const p = await load(id, now)
    const next: Profile = { ...p, name, updatedAt: now }
    await save(next)
    return next
  })
}

/**
 * Записать партию.
 *
 * Имя приходит вместе с итогом: игрок мог переименоваться на другом устройстве
 * или вообще ни разу не открывать профиль, и отдельный запрос ради подписи был
 * бы лишним. Пустое имя ничего не затирает.
 */
export async function recordMatch(
  id: string, name: string, result: MatchResult,
): Promise<Profile> {
  return serial(id, async () => {
    const p = await load(id, result.at)
    const next = record(name ? { ...p, name } : p, result)
    await save(next)
    return next
  })
}
