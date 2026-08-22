/**
 * Аудит полигона.
 *
 * Отдельно от verify-ui.mjs, потому что отвечает на другой вопрос. Тот следит,
 * чтобы игра не сломалась; этот проходит по КАЖДОЙ кнопке пульта и по каждому
 * эффекту и предъявляет доказательство: было — стало, частицы, звуки, снимок
 * экрана в момент вспышки.
 *
 * Замер идёт ДО скриншота: снимок страницы занимает сотни миллисекунд, за
 * которые короткая анимация успевает закончиться, и порядок «снял, потом
 * померил» показывает пустой стол на исправном эффекте.
 *
 * Звуки считаются по двум узлам сразу: осцилляторы и буферы шума. Добор и
 * утиль сделаны только на шуме, и счётчик одних осцилляторов объявил бы их
 * немыми.
 *
 * Отчёт пишется в reports/audit.html и остаётся ЛОКАЛЬНЫМ: на снимках
 * иллюстрации карт, а на них у нас нет лицензии.
 *
 *   node scripts/audit-lab.mjs [http://localhost:3000]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const OUT = join(ROOT, 'reports')
const SHOTS = join(OUT, 'audit')

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
})
const p = await browser.newPage()
await p.setViewport({ width: 1700, height: 1000, deviceScaleFactor: 1 })
const errs = []
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
// Звук проверяется счётчиком запущенных узлов: ушей у проверки нет, а вот
// «сколько раз стол попытался прозвучать» — величина точная.
await p.evaluateOnNewDocument(() => {
  window.__osc = 0; window.__buf = 0
  const o = OscillatorNode.prototype.start
  OscillatorNode.prototype.start = function (...a) { window.__osc++; return o.apply(this, a) }
  const s = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (...a) { window.__buf++; return s.apply(this, a) }
})
const rows = []
const rec = (name, ok, detail) => {
  rows.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}
await mkdir(SHOTS, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))

await p.goto(`${BASE}/lab`, { waitUntil: 'networkidle2' })
await p.waitForSelector('.lab')
await sleep(1200)

const st = () => p.evaluate(() => {
  const s = window.__lab.info.state
  const me = s.players.p1, foe = s.players.p2
  return {
    hand: me.hand.length, inPlay: me.inPlay.length, discard: me.discard.length,
    deck: me.deck.length, scrap: s.scrapHeap.length, row: s.tradeRow.filter(Boolean).length,
    trade: me.trade, combat: me.combat, auth: me.authority,
    foeAuth: foe.authority, foeInPlay: foe.inPlay.length,
    ally: me.allyUnlocked.join(','), deckTop: me.deck[0]?.def ?? '',
    handDefs: me.hand.map(c => c.def).join(','), turn: s.turn,
  }
})
const tab = async (name) => { await p.evaluate((n) => {
  [...document.querySelectorAll('.tabs--lab .tab')].find(x => x.textContent.includes(n))?.click()
}, name); await sleep(150) }
const clickBtn = async (sel, text) => p.evaluate((s, t) => {
  const el = [...document.querySelectorAll(s)].find(x => x.textContent.includes(t))
  if (!el) return false
  el.click(); return true
}, sel, text)

// ── 1. КАРТЫ: каждый слот ────────────────────────────────────────────────
await tab('Карты')
const slots = [
  ['В руку', 'hand'], ['Мне в игру', 'inPlay'], ['Сопернику', 'foeInPlay'],
  ['В ряд', 'row'], ['В сброс', 'discard'], ['На верх колоды', 'deck'], ['В утиль', 'scrap'],
]
for (const [label, field] of slots) {
  const before = await st()
  await clickBtn('.lab__row .btn', label)
  await p.evaluate(() => { document.querySelector('.lab__search').value = '' })
  await p.click('.lab__search', { clickCount: 3 })
  await p.type('.lab__search', 'Колесо')
  await sleep(250)
  const clicked = await p.evaluate(() => { const c = document.querySelector('.lab__card'); if (!c) return false; c.click(); return true })
  await sleep(350)
  const after = await st()
  if (field === 'row') {
    const inRow = await p.evaluate(() =>
      window.__lab.info.state.tradeRow.some((c) => c && c.def === 'blob-wheel'))
    rec('карты → В ряд', clicked && inRow, `«Колесо слизней» в ряду: ${inRow}, слотов занято ${after.row}`)
  } else {
    rec(`карты → ${label}`, clicked && after[field] === before[field] + 1,
      `${field}: ${before[field]}→${after[field]}`)
  }
}

// ── 2. СТОЛ ──────────────────────────────────────────────────────────────
await tab('Стол')
for (const [label, field, delta] of [
  ['+1 торговля', 'trade', 1], ['+5 торговли', 'trade', 5],
  ['+1 бой', 'combat', 1], ['+5 боя', 'combat', 5],
  ['Мне +10', 'auth', 10], ['Мне −10', 'auth', -10],
  ['Сопернику +10', 'foeAuth', 10], ['Сопернику −10', 'foeAuth', -10],
]) {
  const before = await st()
  const ok = await clickBtn('.lab__row .btn', label)
  await sleep(220)
  const after = await st()
  rec(`стол → ${label}`, ok && after[field] === before[field] + delta, `${field}: ${before[field]}→${after[field]}`)
}
{
  const before = await st()
  await clickBtn('.lab__row .btn', 'Обнулить пулы'); await sleep(220)
  const a = await st()
  rec('стол → Обнулить пулы', a.trade === 0 && a.combat === 0, `торг ${before.trade}→${a.trade}, бой ${before.combat}→${a.combat}`)
}
{
  const before = await st()
  await clickBtn('.lab__row .btn', 'Сбросить руку и добрать'); await sleep(300)
  const a = await st()
  rec('стол → Сбросить руку и добрать 5', a.hand === Math.min(5, before.hand + before.deck) && a.discard >= before.discard,
    `рука ${before.hand}→${a.hand}, сброс ${before.discard}→${a.discard}, колода ${before.deck}→${a.deck}`)
}
{
  // Кнопку жмут подряд, и колода конечна: без перетасовки сброса она
  // вычерпывалась досуха и пересдача навсегда переставала работать.
  const start = await st()
  const total = start.hand + start.deck + start.discard
  let stuck = ''
  for (let i = 0; i < 10; i++) {
    await clickBtn('.lab__row .btn', 'Сбросить руку и добрать')
    await sleep(160)
    const a = await st()
    if (a.hand !== Math.min(5, total) || a.hand + a.deck + a.discard !== total) {
      stuck = `нажатие ${i + 1}: рука ${a.hand}, всего ${a.hand + a.deck + a.discard} из ${total}`
      break
    }
  }
  const now = await st()
  rec('пересдача выдерживает десять нажатий подряд', stuck === '',
    stuck || `рука ${now.hand}, колода ${now.deck}, сброс ${now.discard}, всего ${total}`)
}
{
  const before = await st()
  await clickBtn('.lab__row .btn', 'Убрать мои карты'); await sleep(300)
  const a = await st()
  rec('стол → Убрать мои карты', a.inPlay === 0 && a.discard === before.discard + before.inPlay,
    `в игре ${before.inPlay}→${a.inPlay}, сброс ${before.discard}→${a.discard}`)
}
{
  await clickBtn('.lab__row .btn', 'Убрать карты соперника'); await sleep(300)
  const a = await st()
  rec('стол → Убрать карты соперника', a.foeInPlay === 0, `у соперника: ${a.foeInPlay}`)
}
{
  await clickBtn('.lab__row .btn', 'Очистить торговый ряд'); await sleep(300)
  const a = await st()
  rec('стол → Очистить торговый ряд', a.row === 0, `в ряду: ${a.row}`)
}

// ── 3. ЭФФЕКТЫ ───────────────────────────────────────────────────────────
// Подготовка: карта себе в игру, база сопернику, карта в ряд.
await tab('Карты')
const place = async (slot, query) => {
  await clickBtn('.lab__row .btn', slot)
  await p.click('.lab__search', { clickCount: 3 })
  await p.type('.lab__search', query)
  await sleep(250)
  await p.evaluate(() => document.querySelector('.lab__card')?.click())
  await sleep(300)
}
await place('Мне в игру', 'Колесо')
await place('Сопернику', 'Боевая станция')
await place('В ряд', 'Грузовоз')
await tab('Эффекты')
const fxNames = ['Розыгрыш карты','Свойство базы','Союз сработал','Покупка','Добор','Урон по мне',
  'Урон по сопернику','База уничтожена','Утилизация','Прирост боя','Прирост авторитета','Конец хода','Победа']
for (const name of fxNames) {
  await p.evaluate(() => {
    document.querySelector('.fx-canvas')?.setAttribute('data-live', '0')
    window.__oscBefore = window.__osc
  })
  const ok = await clickBtn('.lab__grid .btn', name)
  await sleep(260)
  const r = await p.evaluate(() => ({
    live: Number(document.querySelector('.fx-canvas')?.dataset.live ?? 0),
    osc: window.__osc - window.__oscBefore,
    lit: [...document.querySelectorAll('[data-iid]')].filter(e => e.style.animation.includes('fx-')).length,
    pop: document.querySelectorAll('.fx-pop').length,
    flash: document.querySelectorAll('.fx-flash').length,
    said: document.querySelector('.log__line b')?.textContent ?? '',
  }))
  rec(`эффект → ${name}`, ok && (r.live > 0 || r.osc > 0 || r.lit > 0 || r.pop > 0),
    `частиц ${r.live}, звуков ${r.osc}, анимаций ${r.lit}, чисел ${r.pop}, вспышек ${r.flash}`)
}

// ── 4. СИТУАЦИИ ──────────────────────────────────────────────────────────
const cases = ['Аутпост прикрывает','Союз слизней','Копия Иглы','Пустая колода',
  'Ловушка Станции переработки','Топдек при покупке','Богатый ход','Развязка']
for (const name of cases) {
  await p.reload({ waitUntil: 'networkidle2' })
  await p.waitForSelector('.lab'); await sleep(900)
  await tab('Ситуации')
  const before = await st()
  const ok = await clickBtn('.lab__case', name)
  await sleep(450)
  const a = await st()
  rec(`ситуация → ${name}`, ok && JSON.stringify(a) !== JSON.stringify(before),
    `рука ${before.hand}→${a.hand}, в игре ${before.inPlay}→${a.inPlay}, у соперника ${before.foeInPlay}→${a.foeInPlay}, `
    + `колода ${before.deck}→${a.deck}, торг ${before.trade}→${a.trade}, бой ${before.combat}→${a.combat}, `
    + `авт соперника ${before.foeAuth}→${a.foeAuth}, союзы «${a.ally}»`)
}

// ── 5. НОВАЯ РАЗДАЧА ─────────────────────────────────────────────────────
{
  await p.reload({ waitUntil: 'networkidle2' }); await p.waitForSelector('.lab'); await sleep(800)
  const before = await p.evaluate(() => window.__lab.info.state.tradeRow.map(c => c?.def ?? '').join(','))
  await p.evaluate(() => document.querySelector('.lab__deal')?.click())
  await sleep(1000)
  const after = await p.evaluate(() => window.__lab.info.state.tradeRow.map(c => c?.def ?? '').join(','))
  rec('новая раздача', before !== after, `${before.slice(0, 40)} → ${after.slice(0, 40)}`)
}
// ── 6. СВОРАЧИВАНИЕ ──────────────────────────────────────────────────────
{
  await p.evaluate(() => [...document.querySelectorAll('.lab__head .btn')].find(b => b.textContent.includes('Свернуть'))?.click())
  await sleep(300)
  const collapsed = await p.evaluate(() => ({
    panel: !!document.querySelector('.lab'), tab: !!document.querySelector('.lab__tab'),
    shifted: getComputedStyle(document.querySelector('.table')).paddingRight,
  }))
  rec('пульт сворачивается', !collapsed.panel && collapsed.tab, `панель ${collapsed.panel}, корешок ${collapsed.tab}, отступ ${collapsed.shifted}`)
  await p.evaluate(() => document.querySelector('.lab__tab')?.click())
  await sleep(300)
  rec('пульт разворачивается', await p.evaluate(() => !!document.querySelector('.lab')))
}

await p.goto(`${BASE}/lab`, { waitUntil: 'networkidle2' })
await p.waitForSelector('.lab'); await sleep(1000)

const st2 = () => p.evaluate(() => {
  const s = window.__lab.info.state, me = s.players.p1, foe = s.players.p2
  return { hand: me.hand.length, inPlay: me.inPlay.length, discard: me.discard.length,
    trade: me.trade, combat: me.combat, foeAuth: foe.authority, foeInPlay: foe.inPlay.length,
    ally: me.allyUnlocked.join(','), phase: s.phase }
})
const mark2 = () => p.evaluate(() => {
  document.querySelector('.fx-canvas')?.setAttribute('data-live', '0')
  window.__o0 = window.__osc; window.__b0 = window.__buf
  document.querySelectorAll('.fx-pop, .fx-flash').forEach(e => e.remove())
})
const felt2 = () => p.evaluate(() => ({
  live: Number(document.querySelector('.fx-canvas')?.dataset.live ?? 0),
  snd: (window.__osc - window.__o0) + (window.__buf - window.__b0),
  anim: [...document.querySelectorAll('[data-iid], .hud, .rail__cell')].filter(e => e.style.animation.includes('fx-')).length,
  pop: document.querySelectorAll('.fx-pop').length,
  flash: document.querySelectorAll('.fx-flash').length,
}))
const tab2 = async n => { await p.evaluate(t => [...document.querySelectorAll('.tabs--lab .tab')].find(x => x.textContent.includes(t))?.click(), n); await sleep(150) }
const btn2 = async (sel, t) => p.evaluate((s, x) => { const e = [...document.querySelectorAll(s)].find(q => q.textContent.includes(x)); if (!e) return false; e.click(); return true }, sel, t)
const place2 = async (slot, q) => {
  await tab2('Карты'); await btn2('.lab__row .btn', slot)
  await p.click('.lab__search', { clickCount: 3 }); await p.type('.lab__search', q); await sleep(250)
  const ok = await p.evaluate(() => { const c = document.querySelector('.lab__card'); if (!c) return false; c.click(); return true })
  await sleep(300); return ok
}
const shot = (name) => p.screenshot({ path: join(SHOTS, `audit-${name}.png`) })

// 1. розыгрыш карты настоящим кликом
{
  await mark2()
  await p.click('.band--hand .card.is-playable')
  await sleep(140)
  const f = await felt2(), s = await st2()
  await shot('01-play')
  rec('розыгрыш карты (клик по руке)', f.live > 0 && f.snd > 0 && f.anim > 0 && s.inPlay > 0,
    `частиц ${f.live}, звуков ${f.snd}, анимаций ${f.anim}, в игре ${s.inPlay}`)
}
// 2. союз: две карты Слизней с руки
{
  const p1 = await place2('В руку', 'Боевой слизень')
  const p2 = await place2('В руку', 'Истребитель слизней')
  rec('пульт: две карты Слизней в руку', p1 && p2, `${p1} / ${p2}`)
  await tab2('Карты')
  await mark2()
  await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.band--hand .card.is-playable')]
    cards[cards.length - 1]?.click()
  })
  await sleep(400)
  await mark2()
  await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.band--hand .card.is-playable')]
    cards[cards.length - 1]?.click()
  })
  await sleep(140)
  const f = await felt2(), s = await st2()
  await shot('02-ally')
  rec('союз открылся при второй карте фракции', s.ally.includes('blob') && f.live > 0 && f.snd > 0,
    `союзы «${s.ally}», частиц ${f.live}, звуков ${f.snd}`)
}
// 3. покупка настоящим кликом
{
  await tab2('Стол'); await btn2('.lab__row .btn', '+5 торговли'); await btn2('.lab__row .btn', '+5 торговли')
  await sleep(250)
  const before = await st2()
  await mark2()
  const bought = await p.evaluate(() => { const c = document.querySelector('.band--market .card.is-playable'); if (!c) return false; c.click(); return true })
  await sleep(140)
  const f = await felt2(), s = await st2()
  await shot('03-buy')
  rec('покупка карты из ряда', bought && s.discard === before.discard + 1 && f.live > 0 && f.snd > 0,
    `сброс ${before.discard}→${s.discard}, частиц ${f.live}, звуков ${f.snd}`)
}
// 4. свойство базы кнопкой
{
  await place2('Мне в игру', 'Оборонный центр')
  const ok = await p.evaluate(() => { const b = document.querySelector('.band--board .actions .btn'); if (!b) return false; return true })
  await mark2()
  await p.evaluate(() => document.querySelector('.band--board .actions .btn')?.click())
  await sleep(140)
  const f = await felt2()
  await shot('04-ability')
  rec('свойство базы кнопкой «Применить»', ok && f.live > 0 && f.snd > 0 && f.anim > 0,
    `частиц ${f.live}, звуков ${f.snd}, анимаций ${f.anim}`)
  // закрыть окно выбора, если открылось
  await p.evaluate(() => document.querySelector('.branch')?.click())
  await sleep(300)
}
// 5. взрыв базы соперника настоящей атакой
{
  await place2('Сопернику', 'Боевая станция')
  await tab2('Стол'); for (let i = 0; i < 3; i++) await btn2('.lab__row .btn', '+5 боя')
  await sleep(300)
  const before = await st2()
  await mark2()
  const hit = await p.evaluate(() => { const c = document.querySelector('.band:first-of-type .card.is-playable'); if (!c) return false; c.click(); return true })
  await sleep(150)
  const f = await felt2(), s = await st2()
  await shot('05-base-boom')
  rec('база соперника уничтожена атакой', hit && s.foeInPlay === before.foeInPlay - 1 && f.live > 0 && f.snd > 0,
    `у соперника ${before.foeInPlay}→${s.foeInPlay}, частиц ${f.live}, звуков ${f.snd}`)
}
// 6. урон по игроку настоящей атакой
{
  const before = await st2()
  await mark2()
  const atk = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Атака на')); if (!b) return false; b.click(); return true })
  await sleep(150)
  const f = await felt2(), s = await st2()
  await shot('06-damage')
  rec('атака по сопернику', atk && s.foeAuth < before.foeAuth && f.live > 0 && f.snd > 0 && f.pop > 0,
    `авторитет ${before.foeAuth}→${s.foeAuth}, частиц ${f.live}, звуков ${f.snd}, чисел ${f.pop}`)
}
// 7. конец хода и ход бота
{
  await mark2()
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.includes('Завершить ход'))?.click())
  await sleep(300)
  const f1 = await felt2()
  rec('конец хода звучит', f1.snd > 0, `звуков ${f1.snd}`)
  await mark2(); await sleep(2600)
  const f2 = await felt2()
  rec('ход бота даёт эффекты', f2.snd > 0 || f2.live > 0, `частиц ${f2.live}, звуков ${f2.snd}`)
  await shot('07-bot')
}
// 8. победа
{
  // Ждём своего хода: пока думает бот, ни одно действие недоступно.
  for (let i = 0; i < 40; i++) {
    const mine = await p.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Завершить ход'))
      return !!b && !b.disabled
    })
    if (mine) break
    await sleep(300)
  }
  await tab2('Ситуации')
  await btn2('.lab__case', 'Развязка')
  await sleep(400)
  // Бот успевает выставить базу, а база закрывает игрока от атаки: без
  // расчистки шаг проверял бы не победу, а правило про аутпост.
  await tab2('Стол')
  await btn2('.lab__row .btn', 'Убрать карты соперника'); await sleep(250)
  await btn2('.lab__row .btn', '+5 боя'); await sleep(250)
  // Дожидаемся своего хода: пока думает бот, атаковать нельзя, и шаг
  // проверял бы расторопность скрипта, а не победу.
  for (let i = 0; i < 30; i++) {
    const ready = await p.evaluate(() =>
      [...document.querySelectorAll('button')].some((x) => x.textContent.includes('Атака на')))
    if (ready) break
    await sleep(300)
  }
  await mark2()
  const atk = await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Атака на')); if (!b) return false; b.click(); return true })
  await sleep(320)
  const f = await felt2(), s = await st2()
  await shot('08-victory')
  rec('победа: залп и конец партии', atk && s.phase === 'gameOver' && f.live > 0 && f.snd > 0,
    `фаза ${s.phase}, частиц ${f.live}, звуков ${f.snd}`)
}

// ── 7. союзы пакетом ────────────────────────────────────────────────────────
// Точный случай из жизни: три одинаковые карты, один союз нажат руками,
// остальные должны добиться кнопкой.
{
  await p.reload({ waitUntil: 'networkidle2' })
  await p.waitForSelector('.lab')
  await sleep(900)
  for (let i = 0; i < 3; i++) await place2('Мне в игру', 'Ракетный бот')
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('.lab__head .btn')]
      .find((x) => (x.textContent ?? '').includes('Свернуть'))
    ;(b instanceof HTMLElement ? b : null)?.click()
  })
  await sleep(400)
  const allyUsed = () => p.evaluate(() =>
    window.__lab.info.state.players.p1.inPlay.filter((c) => c.used.ally).length)
  const manual = await p.evaluate(() => {
    for (const slot of document.querySelectorAll('.band--board .row--fan > *')) {
      const btn = [...slot.querySelectorAll('.actions .btn')]
        .find((x) => (x.textContent ?? '').includes('Союз'))
      if (btn instanceof HTMLElement) { btn.click(); return true }
    }
    return false
  })
  await sleep(600)
  const afterManual = await allyUsed()
  const pressedAlly = await p.evaluate(() => {
    const b = [...document.querySelectorAll('.band--board .zone__head .btn')]
      .find((x) => (x.textContent ?? '').includes('Все союзы'))
    if (!(b instanceof HTMLElement)) return false
    b.click()
    return true
  })
  await sleep(1800)
  const afterBatch = await allyUsed()
  rec('«Все союзы» добивает то, что не нажато руками',
    manual && pressedAlly && afterManual === 1 && afterBatch === 3,
    `союзов применено: вручную ${afterManual}, после кнопки ${afterBatch} из 3`)
  await shot('09-allies')
}

const shotsList = [
  ['01-play', 'Розыгрыш карты кликом по руке: карта поднимается в зону игры, вверх идут искры её фракции.'],
  ['02-ally', 'Вторая карта Слизней с руки открыла союз: контуры обеих светятся цветом фракции.'],
  ['03-buy', 'Покупка из торгового ряда: на месте купленной карты золотые осколки и кольцо.'],
  ['04-ability', 'Свойство базы кнопкой «Применить»: карта отзывается свечением и кольцом.'],
  ['05-base-boom', 'База соперника уничтожена настоящей атакой: кольцо, осколки с гравитацией и дым.'],
  ['06-damage', 'Атака по игроку: HUD соперника трясёт, над ним всплывает потерянный авторитет.'],
  ['07-bot', 'Ход бота: его карты звучат и вспыхивают так же, как свои.'],
  ['08-victory', 'Победа: залпы по экрану и конец партии.'],
  ['09-allies', 'Три одинаковые карты: один союз нажат руками, два добиты кнопкой «Все союзы».'],
]
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const passed = rows.filter((r) => r.ok).length
const html = `<!doctype html><html lang="ru"><meta charset="utf-8">
<title>Аудит полигона</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#07090d; color:#eef2f7; font:15px/1.5 system-ui, sans-serif; }
  .wrap { max-width:1200px; margin:0 auto; padding:40px 20px 80px; }
  h1 { font-size:34px; margin:0 0 6px; }
  .sub { color:#98a3b6; margin:0 0 28px; }
  table { width:100%; border-collapse:collapse; margin-bottom:36px; }
  th, td { text-align:left; padding:7px 10px; border-bottom:1px solid #262d3d; font-size:14px; }
  th { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#5d6779; font-weight:500; }
  td.v { font-family:ui-monospace, monospace; font-size:12px; color:#98a3b6; }
  .ok { color:#5fd08a; font-family:ui-monospace, monospace; }
  .no { color:#ff7a6b; font-family:ui-monospace, monospace; }
  figure { margin:0 0 28px; }
  img { width:100%; border:1px solid #262d3d; border-radius:8px; display:block; }
  figcaption { color:#98a3b6; font-size:13px; padding-top:8px; }
  .note { color:#5d6779; font-size:13px; }
</style>
<div class="wrap">
<h1>Аудит полигона</h1>
<p class="sub">${passed} из ${rows.length} проверок пройдено. Каждая строка — нажатие кнопки и замер: было → стало, частицы, звуки.</p>
<table><thead><tr><th></th><th>Проверка</th><th>Замер</th></tr></thead><tbody>
${rows.map((r) => `<tr><td class="${r.ok ? 'ok' : 'no'}">${r.ok ? 'OK' : '✗'}</td><td>${esc(r.name)}</td><td class="v">${esc(r.detail ?? '')}</td></tr>`).join('\n')}
</tbody></table>
<h2>Снимки в момент вспышки</h2>
${shotsList.map(([f, cap]) => `<figure><img src="audit/audit-${f}.png" alt=""><figcaption>${esc(cap)}</figcaption></figure>`).join('\n')}
<p class="note">Локальный отчёт. На снимках иллюстрации карт — © Wise Wizard Games; страница не публикуется и в репозиторий не попадает.</p>
</div>`
await writeFile(join(OUT, 'audit.html'), html)
console.log(`\nОШИБКИ КОНСОЛИ: ${errs.length ? errs.join('\n') : 'нет'}`)
console.log(`ИТОГ: ${passed}/${rows.length} — отчёт: ${join(OUT, 'audit.html')}`)
await browser.close()
