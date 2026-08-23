/**
 * Отчёт о том, что правки видно на живом столе.
 *
 * Отдельно от verify-ui.mjs и audit-lab.mjs, потому что отвечает на третий
 * вопрос. Тот следит, чтобы игра не сломалась; аудит проходит по каждой кнопке
 * пульта; этот берёт конкретные разобранные жалобы и показывает по каждой, что
 * именно стало иначе — с замером и снимком того самого момента.
 *
 * Каждая проверка сама решает, прошла ли она: `ok` считается из состояния
 * страницы, а не из того, что снимок получился. Скриншот здесь — доказательство
 * для человека, а не критерий.
 *
 * Отчёт пишется в reports/ui.html и остаётся ЛОКАЛЬНЫМ: на снимках
 * иллюстрации карт, а на них у нас нет лицензии — тот же порядок, что и у
 * аудита полигона.
 *
 *   node scripts/ui-report.mjs [http://localhost:3000]
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const OUT = join(ROOT, 'reports')
const SHOTS = join(OUT, 'ui')

await mkdir(SHOTS, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sections = []
let shotN = 0
const errs = []

/** Один раздел отчёта: жалоба, что сделано, и чем это подтверждается. */
function section(title, complaint, fix) {
  const s = { title, complaint, fix, steps: [] }
  sections.push(s)
  return s
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--no-sandbox'],
})
const page = await browser.newPage()
page.on('pageerror', (e) => errs.push(`${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })

async function shot(label, caption) {
  const file = `${String(++shotN).padStart(2, '0')}-${label}.png`
  await page.screenshot({ path: join(SHOTS, file) })
  return { file, caption }
}

/** Шаг раздела: что проверяли, что вышло, прошло ли, и снимок. */
async function step(s, { what, detail, ok, label, caption }) {
  const image = label ? await shot(label, caption) : null
  s.steps.push({ what, detail, ok, image })
}

const clickText = (sel, text) => page.evaluate((s, t) => {
  const el = [...document.querySelectorAll(s)].find((x) => x.textContent.includes(t))
  if (!el) return false
  el.click()
  return true
}, sel, text)

const lab = async () => {
  await page.goto(`${BASE}/lab`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('.lab')
  await sleep(1400)
}

const place = async (slot, query) => {
  await clickText('.lab__row .btn', slot)
  await page.click('.lab__search', { clickCount: 3 })
  await page.type('.lab__search', query)
  await sleep(420)
  await page.evaluate(() => document.querySelector('.lab__card')?.click())
  await sleep(460)
}

/** Ряд своих баз: имя и есть ли у карты свойство, ждущее нажатия. */
const baseRow = () => page.evaluate(() =>
  [...document.querySelectorAll('.play__bases > *')]
    .sort((a, z) => a.offsetTop - z.offsetTop)
    .map((z) => {
      const name = z.querySelector('.card__name')?.textContent?.trim() ?? '?'
      const live = [...z.querySelectorAll('.actions .btn')]
        .some((x) => !/Утиль/i.test(x.textContent))
      return `${name}${live ? ' ●' : ''}`
    }))

const fire = async (re) => {
  const ok = await page.evaluate((src) => {
    const zone = [...document.querySelectorAll('.play__bases > *')]
      .find((z) => new RegExp(src, 'i').test(z.querySelector('.card__name')?.textContent ?? ''))
    const btn = [...(zone?.querySelectorAll('.actions .btn') ?? [])]
      .find((x) => !/Утиль|Союз/i.test(x.textContent))
    if (!btn) return false
    btn.click()
    return true
  }, re)
  await sleep(850)
  return ok
}

await page.setViewport({ width: 1600, height: 1000 })

// ── 1. Порядок карт в игре ───────────────────────────────────────────────
{
  const s = section(
    'Порядок карт в зоне игры',
    'После применения свойства карта уезжала в случайное место, а ряд '
    + 'переставлялся под рукой. Потом — возвращался обратно.',
    'Карты со свойством стоят слева. Отработавшая уезжает ЗА последнюю ещё '
    + 'активную и больше не двигается; когда активных не осталось, ехать '
    + 'некуда — карта стоит где стояла. Порядок считается от ряда, который уже '
    + 'на столе, а не от порядка разыгрывания.',
  )
  await lab()
  await place('Мне в игру', 'Центральный офис')
  await place('Мне в игру', 'Космическая станция')
  await place('Мне в игру', 'Колесо слизней')
  const start = await baseRow()
  await step(s, {
    what: 'Три базы выложены, у каждой есть свойство',
    detail: start.join('  │  '),
    ok: start.every((x) => x.endsWith('●')),
    label: 'order-start',
    caption: 'Все три ждут нажатия',
  })

  await fire('космическ')
  const mid = await baseRow()
  await step(s, {
    what: 'Нажата СРЕДНЯЯ — уезжает за последнюю активную',
    detail: mid.join('  │  '),
    ok: mid[2]?.startsWith('Космическая') === true && !mid[2].endsWith('●'),
    label: 'order-mid',
    caption: '«Космическая станция» ушла в конец',
  })

  await fire('центральн')
  const third = await baseRow()
  await step(s, {
    what: 'Нажата ПЕРВАЯ — встаёт сразу за оставшейся активной, а не в самый конец',
    detail: third.join('  │  '),
    ok: third[0]?.endsWith('●') === true && third[1]?.startsWith('Центральный') === true,
    label: 'order-third',
    caption: '«Центральный офис» — второй, перед уже отработавшей картой',
  })

  const before = await baseRow()
  await fire('колесо')
  const after = await baseRow()
  await step(s, {
    what: 'Нажата ПОСЛЕДНЯЯ активная — двигаться некуда',
    detail: `было: ${before.join(' │ ')}\nстало: ${after.join(' │ ')}`,
    ok: JSON.stringify(before.map((x) => x.replace(' ●', ''))) === JSON.stringify(after),
    label: 'order-last',
    caption: 'Порядок не изменился ни на одну карту',
  })
}

// ── 2. Переезд вместо прыжка ─────────────────────────────────────────────
{
  const s = section(
    'Перестановка — переездом, а не прыжком',
    'Карта меняла место мгновенно, под той самой рукой, которая по ней '
    + 'кликнула. Ещё она успевала уехать и вернуться, а весь ряд дёргался от '
    + 'покупки и от наведения мыши.',
    'Карта переползает на новое место за 260 мс. Позиции меряются по раскладке '
    + 'и ВНУТРИ ряда: сдвиг всей полосы и прокрутка больше не считаются '
    + 'перестановкой, а замер посреди анимации не принимается за новое место.',
  )
  await lab()
  await page.evaluateOnNewDocument(() => {
    window.__glides = []
    const real = Element.prototype.animate
    Element.prototype.animate = function (frames, opts) {
      const first = Array.isArray(frames) ? frames[0] : null
      const tf = first && typeof first === 'object' ? first.transform : null
      if (typeof tf === 'string' && tf.startsWith('translate(')) {
        window.__glides.push({
          name: this.querySelector?.('.card__name')?.textContent?.trim() ?? '?',
          from: tf,
        })
      }
      return real.call(this, frames, opts)
    }
  })
  await lab()
  await place('Мне в игру', 'Центральный офис')
  await place('Мне в игру', 'Космическая станция')
  await page.evaluate(() => { window.__glides = [] })

  await page.evaluate(() => {
    const zone = [...document.querySelectorAll('.play__bases > *')]
      .find((z) => /центральн/i.test(z.querySelector('.card__name')?.textContent ?? ''))
    const btn = [...(zone?.querySelectorAll('.actions .btn') ?? [])]
      .find((x) => !/Утиль|Союз/i.test(x.textContent))
    btn?.click()
  })
  await sleep(110)
  const moving = await shot('glide-mid', 'Кадр посреди переезда: карта между старым и новым местом')
  const glides = (await page.evaluate(() => window.__glides)).filter((g) => g.name !== '?')
  await sleep(800)
  s.steps.push({
    what: 'Свойство применено — карты меняются местами переездом',
    detail: glides.map((g) => `${g.name}: ${g.from}`).join('\n') || 'переездов не запущено',
    ok: glides.length === 2,
    image: moving,
  })

  // Сдвиг всей полосы: не перестановка.
  await page.evaluate(() => { window.__glides = [] })
  await clickText('.tabs--lab .tab', 'Стол')
  await clickText('.lab__row .btn', '+5 торговли')
  await sleep(900)
  const idle = (await page.evaluate(() => window.__glides)).filter((g) => g.name !== '?')
  await step(s, {
    what: 'Полоса стола сместилась целиком (в счётчике появилась торговля)',
    detail: `переездов запущено: ${idle.length}`,
    ok: idle.length === 0,
  })

  // Наведение и прокрутка ряда.
  await page.evaluate(() => { window.__glides = [] })
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(240 + i * 90, 320 + (i % 3) * 40)
    await sleep(70)
  }
  await page.evaluate(() => {
    const row = document.querySelector('.band--market .row')
    if (row) row.scrollLeft = 140
  })
  await sleep(500)
  const hover = (await page.evaluate(() => window.__glides)).filter((g) => g.name !== '?')
  await step(s, {
    what: 'Мышь ходит по столу, торговый ряд прокручен',
    detail: `переездов запущено: ${hover.length}`,
    ok: hover.length === 0,
  })
}

// ── 3. Окно выбора: кнопка и подписи ─────────────────────────────────────
{
  const s = section(
    'Полноэкранный вопрос',
    'Кнопку «Свернуть» нельзя было нажать мышью: она стояла ссылкой под '
    + 'увеличенной картой, и карта перекрывала её собой. А цели выбора — свои и '
    + 'чужие базы — ничем не отличались друг от друга.',
    'Кнопка стоит в ряду ответов, справа от «Подтвердить». Подписаны только '
    + 'чужие карты: подпись значит ровно «это не ваше».',
  )
  await lab()
  await place('Сопернику', 'Боевая станция')
  await place('Мне в игру', 'Торговый пост')
  await place('Мне в игру', 'Челнок Федерации')
  await place('Мне в игру', 'Командный корабль')
  await clickText('.band--board .btn', 'Все союзы')
  await sleep(1500)

  const sheet = await page.evaluate(() => {
    const c = document.querySelector('.choice')
    if (!c) return null
    const fold = c.querySelector('.choice__fold')
    const r = fold?.getBoundingClientRect()
    const at = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null
    return {
      buttons: [...c.querySelectorAll('.actions .btn')].map((b) => b.textContent.trim()),
      hitsFold: !!fold && (at === fold || fold.contains(at)),
      picks: [...c.querySelectorAll('.choice__pick')].map((x) => ({
        name: x.querySelector('.card__name')?.textContent?.trim(),
        owner: x.querySelector('.choice__owner')?.textContent ?? '—',
      })),
    }
  })
  await step(s, {
    what: '«Свернуть» — последняя в ряду ответов, и под курсором лежит именно она',
    detail: `кнопки: ${sheet?.buttons.join(' · ')}\nпопадание мышью: ${sheet?.hitsFold ? 'да' : 'нет'}`,
    ok: sheet?.hitsFold === true && sheet.buttons.at(-1) === 'Свернуть',
    label: 'choice-open',
    caption: 'Цели выбора: чужая база подписана, свои — без подписи',
  })
  await step(s, {
    what: 'Подписаны только чужие карты',
    detail: (sheet?.picks ?? []).map((c) => `${c.name}: ${c.owner}`).join('\n'),
    ok: (sheet?.picks ?? []).filter((c) => c.owner !== '—').length === 1,
  })

  const box = await page.evaluate(() => {
    const f = document.querySelector('.choice__fold')
    if (!f) return null
    const r = f.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (box) await page.mouse.click(box.x, box.y)
  await sleep(450)
  const folded = await page.evaluate(() => ({
    choice: !!document.querySelector('.choice'),
    bar: !!document.querySelector('.choicebar'),
    marketVisible: (() => {
      const row = document.querySelector('.band--market')
      if (!row) return false
      const r = row.getBoundingClientRect()
      const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return !!mid && !mid.closest('.choice')
    })(),
  }))
  await step(s, {
    what: 'Настоящий клик мышью сворачивает вопрос — стол виден, вопрос ждёт в углу',
    detail: `окно закрыто: ${!folded.choice}\nкнопка возврата: ${folded.bar}\nторговый ряд виден: ${folded.marketVisible}`,
    ok: !folded.choice && folded.bar && folded.marketVisible,
    label: 'choice-folded',
    caption: 'Стол открыт, «Вернуться к выбору» — в правом нижнем углу',
  })
}

// ── 4. Своя база под обязательным «уничтожьте базу» ──────────────────────
{
  const s = section(
    'Обязательное «уничтожьте базу» и своя база',
    'Союз «Командного корабля» уничтожает базу обязательно, а своя база — '
    + 'законная цель. Когда у соперника баз не было, движок сносил свою МОЛЧА, '
    + 'посреди очереди «все союзы».',
    'Правило не изменилось — база всё равно будет уничтожена. Но вырожденный '
    + 'выбор больше не решается сам, если все цели свои: очередь свойств '
    + 'останавливается и показывает, чем игрок платит.',
  )
  await lab()
  await place('Мне в игру', 'Торговый пост')
  await place('Мне в игру', 'Челнок Федерации')
  await place('Мне в игру', 'Командный корабль')
  await clickText('.band--board .btn', 'Все союзы')
  await sleep(1500)
  const solo = await page.evaluate(() => {
    const c = document.querySelector('.choice')
    return {
      title: c?.querySelector('.choice__title')?.textContent ?? null,
      picks: [...(c?.querySelectorAll('.choice__pick') ?? [])].length,
      stillOnTable: [...document.querySelectorAll('.play__bases .card__name')]
        .some((e) => /торгов/i.test(e.textContent ?? '')),
    }
  })
  await step(s, {
    what: 'Единственная цель — своя база: игру останавливает вопрос, база ещё на столе',
    detail: `вопрос: ${solo.title}\nцелей: ${solo.picks}\nбаза на столе: ${solo.stillOnTable}`,
    ok: solo.title !== null && solo.picks === 1 && solo.stillOnTable,
    label: 'destroy-own',
    caption: 'Своя база предъявлена как цель, а не снесена молча',
  })
}

// ── 5. Утилизация: карта распыляется ─────────────────────────────────────
{
  const s = section(
    'Анимация утилизации',
    'Карта исчезала мгновенно: анимация искала её в разметке уже после того, '
    + 'как React убрал узел со стола.',
    'Растворяется слепок прошлого кадра — на том самом месте, где карта стояла, '
    + 'и без инлайновой анимации, которую стол успел на неё повесить.',
  )
  await lab()
  await place('Мне в игру', 'Исследователь')
  await sleep(2200) // иллюстрации успевают загрузиться, иначе призрак пустой
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.actions .btn')].find((b) => /Утиль/i.test(b.textContent))
    btn?.click()
  })
  // Кадр берётся на середине растворения: раньше карта ещё целая, позже — уже
  // прозрачная, и на снимке не видно ни того ни другого.
  await sleep(330)
  const ghost = await page.evaluate(() => {
    const g = document.querySelector('.fx-ghost')
    if (!g) return null
    const r = g.getBoundingClientRect()
    return {
      anim: g.style.animation,
      size: `${Math.round(r.width)}×${Math.round(r.height)}`,
      art: !!g.querySelector('.card__art.is-loaded'),
      live: [...document.querySelectorAll('[data-iid]')].filter((e) => e.style.animation.includes('fx-')).length,
    }
  })
  const img = await shot('scrap-ghost', 'Карта растворяется на своём месте, искры летят поверх')
  await sleep(800)
  const gone = await page.evaluate(() => document.querySelectorAll('.fx-ghost').length)
  s.steps.push({
    what: 'Утиль: слепок карты растворяется и убирается за собой',
    detail: `анимация: ${ghost?.anim}\nразмер слепка: ${ghost?.size}\nиллюстрация на месте: ${ghost?.art}\n`
      + `живых узлов с анимацией: ${ghost?.live} (их и не может быть — карты уже нет)\n`
      + `слоёв после анимации: ${gone}`,
    ok: !!ghost && ghost.anim.includes('fx-dissolve') && gone === 0,
    image: img,
  })
}

// ── 6. Приключения: фора уровня сложности ────────────────────────────────
{
  const s = section(
    'Приключения: уровень сложности',
    'На «новичке» босс отвечал уже на первый ход, хотя игроку положено три '
    + 'хода подряд. Пропуск был написан только для боссов-скриптов, а «Бросить '
    + 'вызов Империи» — колодный.',
    'Фора работает для всех боссов, пропущенный ход по-настоящему пуст (босс '
    + 'не добирает руку) и назван в журнале своим именем.',
  )
  await page.goto(`${BASE}/play?mode=challenge&boss=defy-the-empire&level=beginner`, { waitUntil: 'networkidle2' })
  await page.waitForSelector('.band--hand', { timeout: 20000 })
  await sleep(1400)
  await page.evaluate(() => document.querySelector('.logtab')?.click())
  await sleep(400)

  for (let i = 0; i < 40; i++) {
    const what = await page.evaluate(() => {
      const sheet = document.querySelector('.choice')
      if (sheet) {
        const card = sheet.querySelector('.card')
        const ok = [...sheet.querySelectorAll('.btn')].find((b) => !b.disabled)
        if (card && !sheet.querySelector('.is-selected')) { card.click(); return 'pick' }
        if (ok) { ok.click(); return 'confirm' }
        return 'stuck'
      }
      const end = [...document.querySelectorAll('.btn')].find((x) => x.textContent.includes('Завершить ход'))
      if (end && !end.disabled) { end.click(); return 'end' }
      return 'wait'
    })
    await sleep(what === 'wait' ? 1200 : 600)
    const turns = await page.evaluate(() =>
      [...document.querySelectorAll('.log__line')].map((l) => l.innerText.replace(/\s+/g, ' '))
        .filter((t) => /Ход \d/.test(t)))
    if (turns.length >= 6) break
  }
  const turns = await page.evaluate(() =>
    [...document.querySelectorAll('.log__line')].map((l) => l.innerText.replace(/\s+/g, ' '))
      .filter((t) => /Ход \d/.test(t)).reverse())
  await step(s, {
    what: 'Новичок: три хода игрока подряд, босс пропускает свои',
    detail: turns.slice(0, 6).join('\n'),
    ok: turns.filter((t) => /пропускает/.test(t)).length >= 2,
    label: 'challenge-log',
    caption: 'Журнал: «Ход 2: Бот пропускает», «Ход 4: Бот пропускает»',
  })
}

// ── 7. Профиль ───────────────────────────────────────────────────────────
{
  const s = section(
    'Профиль игрока',
    'Своей статистики не было вовсе.',
    'Браузер заводит себе случайный идентификатор, сервер держит по файлу на '
    + 'игрока. Партии с ботом присылает клиент, онлайн-партии сервер пишет сам '
    + 'с доски, которой владеет.',
  )
  const id = '11111111-2222-4333-8444-555555555555'
  const cards = ['blob-wheel', 'battle-pod', 'ram', 'cutter', 'federation-shuttle', 'trade-bot',
    'imperial-fighter', 'survey-ship', 'explorer']
  for (let i = 0; i < 7; i++) {
    await fetch(`${BASE}/api/profile/${id}/matches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Капитан',
        result: {
          mode: ['bot', 'campaign', 'challenge', 'hotseat'][i % 4],
          won: i % 3 !== 0, turns: 12 + i, authority: 40 + i, foeAuthority: 0,
          durationMs: 800_000 + i * 60_000,
          opponent: ['Бот (обычный)', 'Безумие машин', 'Бросить вызов Империи', 'Игрок 2'][i % 4],
          cards: cards.slice(0, 4 + (i % 5)), at: 1,
        },
      }),
    })
  }
  await page.goto(BASE, { waitUntil: 'networkidle2' })
  await page.evaluate((pid) => localStorage.setItem('sr:player', JSON.stringify({ id: pid, name: 'Капитан' })), id)
  await page.goto(BASE, { waitUntil: 'networkidle2' })
  await sleep(1200)
  const card = await page.evaluate(() => {
    const el = document.querySelector('.profile')
    return el ? el.innerText.replace(/\n+/g, ' · ') : null
  })
  await step(s, {
    what: 'Карточка в меню: счёт над выбором режима',
    detail: card ?? 'карточки нет',
    // innerText отдаёт текст уже в верхнем регистре: заголовки плиток набраны
    // капителью через text-transform.
    ok: !!card && /партий/i.test(card),
    label: 'profile-menu',
    caption: 'Профиль в главном меню',
  })

  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle2' })
  await sleep(1200)
  const full = await page.evaluate(() => ({
    tables: document.querySelectorAll('.tbl').length,
    tiles: document.querySelectorAll('.stat').length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }))
  await step(s, {
    what: 'Полная статистика: счётчики, режимы, фракции, карты, история',
    detail: `плиток: ${full.tiles}, таблиц: ${full.tables}, страница шире экрана: ${full.overflow}`,
    ok: full.tiles >= 10 && full.tables >= 3 && !full.overflow,
    label: 'profile-full',
    caption: 'Страница /profile целиком',
  })
}

// ── 8. Очередь свойств ───────────────────────────────────────────────────
{
  const s = section(
    'Очередь «все союзы»',
    'Свойства применялись в порядке, в каком движок перечисляет законные '
    + 'действия, — то есть по порядку разыгрывания. Отработавшие карты уезжали '
    + 'вправо прямо под очередью, и ряд переставлялся на каждом шаге.',
    'Очередь идёт по видимому ряду, с правого края. Отработавшая карта и так '
    + 'крайняя справа, поэтому двигаться ей некуда — стол стоит смирно до конца '
    + 'очереди.',
  )
  await lab()
  for (const name of ['Челнок Федерации', 'Катер', 'Грузовоз', 'Флагман']) {
    await place('Мне в игру', name)
  }
  const before = await page.evaluate(() =>
    [...document.querySelectorAll('.play__ships > *')]
      .filter((z) => z.querySelector('.card__name'))
      .sort((a, z) => a.offsetLeft - z.offsetLeft)
      .map((z) => z.querySelector('.card__name').textContent.trim()))
  await page.evaluate(() => document.querySelector('.logtab')?.click())
  await sleep(300)
  await page.evaluate(() => { window.__mark = document.querySelectorAll('.log__line').length })
  await clickText('.band--board .btn', 'Все союзы')
  await sleep(3000)
  const order = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.log__line')].map((l) => l.innerText.replace(/\s+/g, ' '))
    return lines.slice(0, lines.length - window.__mark).reverse()
      .filter((t) => /союзное свойство/i.test(t))
      .map((t) => t.replace(/^.*«(.+)».*$/, '$1'))
  })
  const after = await page.evaluate(() =>
    [...document.querySelectorAll('.play__ships > *')]
      .filter((z) => z.querySelector('.card__name'))
      .sort((a, z) => a.offsetLeft - z.offsetLeft)
      .map((z) => z.querySelector('.card__name').textContent.trim()))
  await step(s, {
    what: 'Одно нажатие «Все союзы» — свойства срабатывают с правого края',
    detail: `ряд слева направо: ${before.join(' │ ')}\n`
      + `очередь сработала: ${order.join(' → ')}\n`
      + `ряд после: ${after.join(' │ ')}`,
    ok: JSON.stringify(order) === JSON.stringify([...before].reverse())
      && JSON.stringify(before) === JSON.stringify(after),
    label: 'auto-order',
    caption: 'Все четыре союза применены, ряд остался в прежнем порядке',
  })
}

// ── 9. Текст в своих границах ────────────────────────────────────────────
{
  const s = section(
    'Текст не вылезает за свои места',
    'Длинные русские слова разрывали блоки: «Межпространственный ужас» уезжал '
    + 'за карточку, подписи плиток статистики распирали сетку и делали страницу '
    + 'шире экрана, названия карт на столе обрезались.',
    'Переносы по слогам (страница объявлена как lang="ru"), колонки не уже '
    + 'своего содержимого, таблицы прокручиваются обёрткой.',
  )
  const scan = () => page.evaluate(() => {
    const bad = []
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || el.getClientRects().length === 0) continue
      if (!/auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
        bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} +${el.scrollWidth - el.clientWidth}px`)
      }
    }
    return {
      bad: [...new Set(bad)].slice(0, 6),
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })

  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(`${BASE}/challenges`, { waitUntil: 'networkidle2' })
  await sleep(1000)
  const wide = await scan()
  await step(s, {
    what: 'Карточки приключений на 1440px',
    detail: `переполнений: ${wide.bad.length ? wide.bad.join(', ') : 'нет'}; страница шире экрана на ${wide.page}px`,
    ok: wide.bad.length === 0 && wide.page <= 0,
    label: 'overflow-challenges',
    caption: '«Межпространствен-ный ужас» переносится внутри карточки',
  })

  await page.setViewport({ width: 390, height: 844 })
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle2' })
  await sleep(1200)
  const narrow = await scan()
  await step(s, {
    what: 'Статистика на телефоне (390px)',
    detail: `переполнений: ${narrow.bad.length ? narrow.bad.join(', ') : 'нет'}; страница шире экрана на ${narrow.page}px`,
    ok: narrow.bad.length === 0 && narrow.page <= 0,
    label: 'overflow-profile',
    caption: 'Плитки переносятся, таблицы прокручиваются сами',
  })
  await page.setViewport({ width: 1600, height: 1000 })
}

// ── отчёт ────────────────────────────────────────────────────────────────
const all = sections.flatMap((s) => s.steps)
const passed = all.filter((x) => x.ok).length

const esc = (t) => String(t ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

const html = `<!doctype html><html lang="ru"><meta charset="utf-8">
<title>Проверка правок на живом столе</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#07090d; color:#eef2f7;
         font:15px/1.6 'IBM Plex Sans', system-ui, sans-serif; }
  .wrap { max-width:1100px; margin:0 auto; padding:44px 20px 90px; }
  h1 { font-size:34px; margin:0 0 4px; letter-spacing:-0.01em; }
  .sub { color:#98a3b6; margin:0 0 8px; }
  .tally { font:600 14px/1 'IBM Plex Mono', monospace; color:#5fd08a; margin:0 0 34px; }
  .tally.bad { color:#f4593c; }
  section { border:1px solid #262d3d; border-radius:12px; background:#0d1016;
            padding:22px 24px; margin-bottom:22px; }
  h2 { font-size:19px; margin:0 0 12px; }
  .was, .now { font-size:14px; margin:0 0 6px; padding-left:14px; border-left:2px solid #38425a; }
  .was { color:#98a3b6; }
  .now { color:#eef2f7; border-left-color:#5fd08a; margin-bottom:18px; }
  .step { border-top:1px solid #1b2130; padding:16px 0 4px; }
  .step:first-of-type { border-top:0; }
  .what { font-weight:600; display:flex; gap:9px; align-items:baseline; }
  .mark { font:700 12px/1 'IBM Plex Mono', monospace; padding:3px 6px; border-radius:4px; }
  .ok  { background:#12301f; color:#5fd08a; }
  .no  { background:#331512; color:#f4593c; }
  pre { font:13px/1.5 'IBM Plex Mono', ui-monospace, monospace; color:#98a3b6;
        background:#07090d; border:1px solid #1b2130; border-radius:8px;
        padding:10px 12px; margin:10px 0; white-space:pre-wrap; }
  figure { margin:14px 0 0; }
  img { width:100%; border:1px solid #262d3d; border-radius:8px; display:block; }
  figcaption { color:#5d6779; font-size:12.5px; margin-top:6px; }
  .foot { color:#5d6779; font-size:12.5px; margin-top:40px; line-height:1.7; }
</style>
<div class="wrap">
<h1>Правки на живом столе</h1>
<p class="sub">Каждая жалоба — раздел: что было, что стало и чем это подтверждается.
Снимки сделаны в настоящем браузере, замеры сняты со страницы.</p>
<p class="tally${passed === all.length ? '' : ' bad'}">${passed} / ${all.length} проверок прошло</p>
${sections.map((s) => `<section>
  <h2>${esc(s.title)}</h2>
  <p class="was"><b>Было:</b> ${esc(s.complaint)}</p>
  <p class="now"><b>Стало:</b> ${esc(s.fix)}</p>
  ${s.steps.map((x) => `<div class="step">
    <div class="what"><span class="mark ${x.ok ? 'ok' : 'no'}">${x.ok ? 'OK' : 'НЕТ'}</span>${esc(x.what)}</div>
    ${x.detail ? `<pre>${esc(x.detail)}</pre>` : ''}
    ${x.image ? `<figure><img src="ui/${x.image.file}" alt="${esc(x.image.caption)}">
      <figcaption>${esc(x.image.caption)}</figcaption></figure>` : ''}
  </div>`).join('')}
</section>`).join('')}
<p class="foot">
  Ошибки консоли за прогон: ${errs.length ? esc([...new Set(errs)].slice(0, 5).join(' · ')) : 'нет'}.<br>
  Отчёт локальный: на снимках иллюстрации карт — © Wise Wizard Games, лицензии на них у нас нет,
  поэтому каталог reports/ не коммитится и никуда не выкладывается.
</p>
</div>`

await writeFile(join(OUT, 'ui.html'), html)
console.log(`\nИТОГ: ${passed}/${all.length} — отчёт: ${join(OUT, 'ui.html')}`)
if (errs.length) console.log('ошибки консоли:', [...new Set(errs)].slice(0, 5).join('\n'))
await browser.close()
