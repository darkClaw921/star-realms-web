/**
 * Ни одной английской строки в окне выбора.
 *
 * Ветки выбора («Выберите одно») движок хранит по-английски: он оперирует
 * идентификаторами, а не языком, и переводит их слой интерфейса. Значит любая
 * новая карта с CHOOSE_ONE или MAY молча приносит на экран английский текст —
 * ровно до тех пор, пока кто-нибудь его там не заметит.
 *
 * Проверка обходит реестр карт, собирает все метки веток и требует перевод для
 * каждой, где есть слова. Метка из одних токенов («{trade:2}») переводу не
 * подлежит: её рисует CardText значками.
 *
 * Запускается первым шагом `npm run verify`.
 */
import { CARDS } from '@sr/engine'
import type { Effect } from '@sr/engine'
import { BRANCH_RU } from '../src/i18n/cards.ru'

/** Метки, которые собирает reduce.ts, а не карта: их в реестре не найти. */
const FROM_ENGINE = ['Into your hand', 'On top of your deck']

/** Слова, а не значки: строка без единой буквы переводу не подлежит. */
function hasWords(label: string): boolean {
  return /[a-z]{2}/i.test(label.replace(/\{[^}]*\}/g, ''))
}

function labelsIn(effects: readonly Effect[], out: Set<string>): void {
  for (const e of effects) {
    if (e.k === 'CHOOSE_ONE') {
      for (const b of e.branches) {
        out.add(b.label)
        labelsIn(b.then, out)
      }
    } else if (e.k === 'MAY') {
      out.add(e.label)
      labelsIn(e.then, out)
    } else {
      // Все прочие эффекты, у которых есть вложенные: SEQ, IF, PER и так далее.
      for (const v of Object.values(e as Record<string, unknown>)) {
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null
          && 'k' in (v[0] as object)) {
          labelsIn(v as readonly Effect[], out)
        }
      }
    }
  }
}

const labels = new Set<string>(FROM_ENGINE)
for (const def of CARDS.values()) {
  for (const slot of [
    def.primary, def.ally, def.ally2, def.ally3, def.ally4,
    def.doubleAlly, def.scrap, def.splinter, def.onReveal ?? [],
  ]) {
    if (slot) labelsIn(slot, labels)
  }
}

const missing = [...labels].filter((l) => hasWords(l) && !BRANCH_RU[l]).sort()

if (missing.length > 0) {
  console.error(`Без перевода: ${missing.length} меток веток выбора.`)
  console.error('Допишите их в apps/web/src/i18n/cards.ru.ts → BRANCH_RU:\n')
  for (const l of missing) console.error(`  '${l}':\n    '',`)
  process.exit(1)
}

const words = [...labels].filter(hasWords).length
console.log(`i18n: все ${words} меток веток выбора переведены`)
