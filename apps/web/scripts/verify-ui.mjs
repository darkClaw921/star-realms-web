/**
 * End-to-end verification against the running stack.
 *
 * Drives a real Chrome through every mode, captures screenshots, records console
 * errors, and -- the part that matters most -- inspects the actual WebSocket
 * frames in online mode to prove the server never ships the opponent's hand, a
 * deck, or the RNG seed to a client.
 *
 * Usage: node scripts/verify-ui.mjs [baseUrl]
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const OUT = join(ROOT, 'reports')
const SHOTS = join(OUT, 'shots')

const results = []
const consoleErrors = []
let shotN = 0

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function shot(page, label, caption) {
  const file = `${String(++shotN).padStart(2, '0')}-${label}.png`
  await page.screenshot({ path: join(SHOTS, file) })
  return { file, caption }
}

function watchConsole(page, who) {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${who}] ${m.text()}`)
  })
  page.on('pageerror', (e) => consoleErrors.push(`[${who}] ${e.message}`))
}

/** Click a button by its visible text. */
async function clickText(page, text, timeout = 8000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    // Click inside the page and return a primitive: no JSHandle crosses the CDP
    // boundary, so nothing can leak and stall the session.
    const clicked = await page.evaluate((t) => {
      const el = [...document.querySelectorAll('button')].find(
        (e) => (e.textContent ?? '').trim().toLowerCase().includes(t.toLowerCase()) && !e.disabled)
      if (el) { el.click(); return true }
      return false
    }, text).catch(() => false)
    if (clicked) return true
    await sleep(150)
  }
  return false
}

async function textOf(page, selector) {
  return page.$eval(selector, (e) => e.textContent?.trim() ?? '').catch(() => '')
}

/** Настройки разложены по вкладкам; проверка обязана открыть нужную сама. */
async function openTab(page, name) {
  await page.evaluate((n) => {
    const t = [...document.querySelectorAll('.tab')].find((x) => (x.textContent ?? '').trim() === n)
    t?.click()
  }, name)
  await sleep(350)
}

const shots = []

async function main() {
  await mkdir(SHOTS, { recursive: true })
  // A throwaway profile: launching the same Chrome binary against the user's
  // live profile makes the launcher hang waiting for a devtools endpoint.
  const profile = await mkdtemp(join(tmpdir(), 'sr-verify-'))
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: profile,
    defaultViewport: { width: 1600, height: 1000 },
    protocolTimeout: 45_000,
    args: [
      '--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    ],
  })

  try {
    // ── 1. menu ───────────────────────────────────────────────────────────
    const page = await browser.newPage()
    watchConsole(page, 'menu')
    await page.goto(BASE, { waitUntil: 'networkidle2' })
    await sleep(700)
    shots.push(await shot(page, 'menu', 'Экран входа. Три режима; оговорка о лицензии на иллюстрации стоит на виду, а не спрятана.'))
    record('главный экран отрисован', (await textOf(page, '.menu__title')).length > 0)

    // Небо. Проверяется не «красиво ли», а единственное место, где оно молча
    // исчезает: без stacking context у <body> слой с z-index:-1 уезжает под
    // непрозрачный фон самого body, и звёзд просто нет.
    const sky = await page.evaluate(() => {
      const layer = (el, pseudo) => getComputedStyle(el, pseudo ?? null).backgroundImage
      return {
        isolated: getComputedStyle(document.body).isolation,
        far: (layer(document.body, '::before').match(/radial-gradient/g) ?? []).length,
        near: (layer(document.body, '::after').match(/radial-gradient/g) ?? []).length,
        arm: (layer(document.querySelector('.sky')).match(/gradient/g) ?? []).length,
      }
    })
    record('за столом нарисован космос',
      sky.isolated === 'isolate' && sky.far >= 8 && sky.near >= 8 && sky.arm >= 4,
      `isolation: ${sky.isolated}, звёзд: ${sky.far}+${sky.near}, рукав и виньетка: ${sky.arm}`)

    // ── 2. vs the bot ─────────────────────────────────────────────────────
    await page.goto(`${BASE}/play?mode=bot&difficulty=normal`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('.table', { timeout: 10000 })
    await sleep(1400)
    shots.push(await shot(page, 'bot-opening', 'Стартовая позиция против бота. Первый игрок получает три карты, а не пять — единственная асимметрия подготовки в правилах.'))

    const handCount = await page.$$eval('.band:last-of-type .card', (els) => els.length)
    record('первый игрок получает 3 карты', handCount === 3, `на руке: ${handCount}`)

    // Короткий клик обязан по-прежнему делать ход. Подавление клика после
    // удержания легко расширить на все клики сразу и не заметить этого.
    {
      const inPlayBefore = await page.$$eval('.band--board .card', (els) => els.length)
      await page.click('.band:last-of-type .card')
      await sleep(500)
      const inPlayAfter = await page.$$eval('.band--board .card', (els) => els.length)
      const handAfter = await page.$$eval('.band:last-of-type .card', (els) => els.length)
      record('короткий клик разыгрывает карту',
        inPlayAfter === inPlayBefore + 1 && handAfter === handCount - 1,
        `в игре ${inPlayBefore}→${inPlayAfter}, на руке ${handCount}→${handAfter}`)
    }

    // Play a few turns and let the bot answer.
    let turns = 0
    for (let i = 0; i < 14; i++) {
      if (await page.$('.choice')) {
        // Resolve whatever prompt is open, cheaply.
        if (!(await clickText(page, 'Подтвердить', 800))) {
          if (!(await clickText(page, 'Пропустить', 800))) {
            await page.evaluate(() => { document.querySelector('.branch')?.click() })
          }
        }
        await sleep(400)
        continue
      }
      await clickText(page, 'Разыграть все', 900)
      await sleep(350)
      if (await clickText(page, 'Атака на', 600)) await sleep(300)
      if (await clickText(page, 'Завершить ход', 1200)) { turns++; await sleep(1800) }
    }
    shots.push(await shot(page, 'bot-midgame', 'Середина партии. Базы остаются в игре между ходами, значки фракций загораются при открытии союзных свойств, журнал проговаривает каждое срабатывание.'))
    record('ходы против бота проходят', turns >= 3, `сыграно ходов: ${turns}`)

    const logLines = await page.$$eval('.log__line', (els) => els.length)
    record('журнал партии заполняется', logLines > 8, `строк: ${logLines}`)

    // Журнал — тоже канал утечки: если он называет добранные карты, соперник
    // читает чужую руку прямо с экрана.
    const namedDraws = await page.$$eval('.log__line', (els) =>
      els.map((e) => e.textContent ?? '').filter((s) => /добирает\s*«/.test(s)))
    record('журнал не называет добранные карты', namedDraws.length === 0,
      namedDraws[0] ?? `проверено строк: ${logLines}`)

    // ── 2b. настройки отображения ─────────────────────────────────────────
    // Базы шире кораблей (.card-slot--base), поэтому «первый попавшийся слот»
    // меняет тип между раздачами. Меряем только корабль.
    const cardW = () => page.evaluate(() =>
      document.querySelector('.card-slot:not(.card-slot--base)')?.getBoundingClientRect().width ?? 0)
    const scaleVar = () => page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--card-scale').trim())
    const widthBefore = await cardW()
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => x.getAttribute('aria-label') === 'Настройки')
      b?.click()
    })
    await sleep(500)
    // Три вкладки: как стол выглядит, из чего собрана колода, как раздаётся
    // партия. На вкладке отображения два ползунка -- размер карты и текста.
    const tabs = await page.$$eval('.tab', (els) => els.map((e) => (e.textContent ?? '').trim()))
    const sliders = await page.$$eval('input[type=range]', (els) => els.length)
    record('панель настроек открывается',
      tabs.length === 3 && sliders === 2, `вкладки: ${tabs.join(' · ')}, ползунков: ${sliders}`)
    shots.push(await shot(page, 'settings', 'Настройки, вкладка отображения. Предпросмотр показывает настоящие карты, включая самую многословную в наборе, — на ней и видно, когда текст перестаёт помещаться.'))

    // Вкладка «Правила партии» держит свои два ползунка -- гамбиты и миссии.
    await openTab(page, 'Правила партии')
    const rulesSliders = await page.$$eval('input[type=range]', (els) => els.length)
    const optionTiles = await page.$$eval('.opt', (els) => els.length)
    // 20 сценариев и 7 командных колод, у каждой группы своя плитка «без».
    record('вкладки переключаются',
      rulesSliders === 2 && optionTiles === 21 + 8,
      `ползунков: ${rulesSliders}, плиток: ${optionTiles}`)
    shots.push(await shot(page, 'settings-rules',
      'Вкладка правил партии. Двадцать сценариев и семь командных колод — плитками, ' +
      'а не строкой флажков: у каждого варианта есть название и предложение правил, ' +
      'и подряд они читались как сплошной текст.'))

    // Лист настроек не должен менять высоту при переключении вкладок: он
    // прижат к низу экрана, и вкладка, которая уезжает из-под курсора, --
    // ровно то, на что жаловались. Голова, вкладки и подвал стоят, скроллит
    // только тело между ними.
    const frame = () => page.evaluate(() => {
      const r = (sel) => {
        const b = document.querySelector(sel)?.getBoundingClientRect()
        return b ? `${Math.round(b.top)}/${Math.round(b.height)}` : '?'
      }
      return { sheet: r('.sheet--settings'), tabs: r('.tabs'), foot: r('.sheet__foot') }
    })
    const frames = []
    for (const name of ['Отображение', 'Наборы карт', 'Правила партии', 'Отображение']) {
      await openTab(page, name)
      frames.push(await frame())
    }
    const stable = frames.every((f) => JSON.stringify(f) === JSON.stringify(frames[0]))
    record('вкладки не сдвигают панель', stable,
      frames.map((f) => `${f.sheet} ${f.tabs} ${f.foot}`).join(' | '))

    await page.evaluate(() => {
      const r = document.querySelector('input[type=range]')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(r, '1.45')
      r.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await sleep(450)
    const widthAfter = await cardW()
    record('размер карт меняется ползунком', widthAfter > widthBefore * 1.3,
      `${Math.round(widthBefore)} → ${Math.round(widthAfter)} px`)

    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Готово')
      b?.click()
    })
    await sleep(250)
    await page.reload({ waitUntil: 'networkidle2' })
    await page.waitForSelector('.card-slot', { timeout: 10000 })
    await sleep(800)
    const widthPersisted = await cardW()
    const scalePersisted = await scaleVar()
    record('настройка переживает перезагрузку',
      scalePersisted === '1.45' && Math.abs(widthPersisted - widthAfter) < 3,
      `масштаб ${scalePersisted}, ${Math.round(widthPersisted)} px`)

    // Крайний случай: увеличенные карты на узком экране не должны рвать страницу —
    // ряды прокручиваются внутри себя, а не растягивают документ.
    const narrow = await browser.newPage()
    watchConsole(narrow, 'mobile-scaled')
    await narrow.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true })
    await narrow.evaluateOnNewDocument(() => {
      try { localStorage.setItem('sr:settings', JSON.stringify({ cardScale: 1.6, textScale: 1.4 })) } catch { /* */ }
    })
    await narrow.goto(`${BASE}/play?mode=bot`, { waitUntil: 'networkidle2' })
    await narrow.waitForSelector('.table', { timeout: 10000 })
    await sleep(1000)
    const narrowOverflow = await narrow.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    record('максимальный масштаб на телефоне не рвёт страницу', narrowOverflow <= 1, `${narrowOverflow}px`)
    await narrow.close()

    // Возвращаем значения по умолчанию, чтобы остальные снимки были эталонными.
    await page.evaluate(() => { try { localStorage.removeItem('sr:settings') } catch { /* */ } })

    // ── 3a. просмотр карты по удержанию ───────────────────────────────────
    // Проверяется за одним экраном, а не против бота: там между ходами ничего
    // не происходит само, поэтому изменение торгового ряда можно приписать
    // именно нашему жесту, а не покупке соперника.
    await page.goto(`${BASE}/play?mode=hotseat`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('.band--market .card', { timeout: 10000 })
    await sleep(900)
    {
      const slotLabel = () => page.$eval('.band--market .card-slot .card',
        (el) => el.getAttribute('aria-label') ?? '')
      const cardBefore = await slotLabel()

      const box = await page.$eval('.band--market .card-slot .card', (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })
      await page.mouse.move(box.x, box.y)
      await page.mouse.down()
      await sleep(900)
      await page.mouse.up()
      await sleep(250)

      const opened = await page.$$eval('.preview', (els) => els.length)
      record('удержание открывает большую карту', opened === 1, `окон: ${opened}`)

      // Наклон: курсор в противоположные углы, угол поворота меняет знак.
      await page.mouse.move(60, 60)
      await sleep(120)
      const tiltA = await page.$eval('.preview__card', (el) => el.style.getPropertyValue('--ry'))
      await page.mouse.move(1500, 900)
      await sleep(120)
      const tiltB = await page.$eval('.preview__card', (el) => el.style.getPropertyValue('--ry'))
      const a = parseFloat(tiltA), b = parseFloat(tiltB)
      record('карта наклоняется от курсора',
        Number.isFinite(a) && Number.isFinite(b) && a < 0 && b > 0, `${tiltA} → ${tiltB}`)

      shots.push(await shot(page, 'card-preview', 'Карта, открытая удержанием. Поверхность наклоняется от курсора; композиция та же, что на столе, просто крупнее.'))

      await page.keyboard.press('Escape')
      await sleep(250)
      const closed = await page.$$eval('.preview', (els) => els.length)
      record('Esc закрывает просмотр', closed === 0, `окон: ${closed}`)

      const cardAfter = await slotLabel()
      record('удержание не покупает карту', cardAfter === cardBefore,
        cardAfter === cardBefore ? 'слот не изменился' : `${cardBefore} → ${cardAfter}`)
    }

    // ── 2b2. наборы карт ──────────────────────────────────────────────────
    {
      await page.goto(`${BASE}/play?mode=bot&difficulty=normal`, { waitUntil: 'networkidle2' })
      await page.waitForSelector('.table', { timeout: 10000 })
      await sleep(900)
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')]
          .find((x) => x.getAttribute('aria-label') === 'Настройки')
        b?.click()
      })
      await sleep(500)
      await openTab(page, 'Наборы карт')

      const deckSize = () => page.evaluate(() => {
        const el = [...document.querySelectorAll('.setting__value')]
          .find((x) => /карт в колоде/.test(x.textContent ?? ''))
        return Number((el?.textContent ?? '').match(/(\d+)/)?.[1] ?? 0)
      })
      const before = await deckSize()
      // Каждый набор добавляет ровно столько карт, сколько в нём напечатано,
      // поэтому размер колоды прямо считает, что именно доехало до раздачи.
      // Список обязан совпадать с ALL_SETS по порядку -- если добавлен набор,
      // а строка сюда не дописана, проверка падает, а не молчит.
      const SETS = [
        ['Базовый набор', 80],
        ['Frontiers', 80],
        ['Colony Wars', 80],
        ['Crisis: Базы и линкоры', 12],
        ['Crisis: Флоты и крепости', 12],
        ['Crisis: Герои', 12],
        ['Crisis: События', 12],
        ['United: Штурм', 12],
        ['United: Командование', 12],
        ['United: Герои', 12],
        ['High Alert: Первый удар', 22],
        ['High Alert: Технологии', 12],
        ['High Alert: Реквизиция', 12],
        ['High Alert: Вторжение', 12],
        ['High Alert: Герои', 12],
        ['Stellar Allies', 12],
        ['Промо-набор 1', 15],
        ['Промо-набор второго года', 9],
        ['Frontiers: промо с Kickstarter', 40],
        // Gambits and Missions are dealt from their own piles, so they add
        // nothing to the trade deck -- which is exactly what this asserts.
        ['Гамбиты', 0],
        ['Cosmic Gambit', 0],
        ['United: Миссии', 0],
        // Command decks contribute nothing to a shared trade deck either: a
        // megaship joins it only when its commander is actually playing.
        ['Командные колоды', 0],
      ]

      // Имя читается из своего элемента, а не из всей плитки: рядом с ним
      // стоит размер набора, и он бы попал в сравнение.
      const labels = await page.$$eval('.sets:not(.sets--decks) .opt__name', (els) =>
        els.map((e) => (e.textContent ?? '').trim()))
      record('все наборы карт перечислены',
        labels.length === SETS.length && SETS.every(([n], i) => labels[i] === n),
        labels.join(' · '))
      record('партия начинается с базового набора', before === 80, `колода ${before}`)

      // Последний включённый набор выключить нельзя -- иначе колода пуста.
      const coreLocked = await page.$eval('.sets:not(.sets--decks) .opt input', (e) => e.disabled)
      record('последний набор выключить нельзя', coreLocked === true, `заблокирован: ${coreLocked}`)

      let expected = 80
      let ok = true
      const seen = []
      for (let i = 1; i < SETS.length; i++) {
        await page.evaluate((n) => {
          const boxes = [...document.querySelectorAll('.sets:not(.sets--decks) .opt input')]
          if (boxes[n] && !boxes[n].checked) boxes[n].click()
        }, i)
        await sleep(300)
        expected += SETS[i][1]
        const got = await deckSize()
        seen.push(`${SETS[i][0]}=${got}`)
        if (got !== expected) ok = false
      }
      record('каждый набор добавляет напечатанное число карт', ok, seen.join(' · '))
      shots.push(await shot(page, 'sets', 'Наборы карт в настройках. Каждый набор включается отдельно; состав читается только при раздаче новой партии.'))

      // Вернуть всё, кроме Frontiers: следующая проверка ждёт две колоды.
      await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('.sets:not(.sets--decks) .opt input')]
        boxes.forEach((b, i) => { if (i > 1 && b.checked) b.click() })
      })
      await sleep(400)

      // Настройка обязана дойти до новой партии, а не только до панели.
      await page.goto(`${BASE}/play?mode=bot&difficulty=normal`, { waitUntil: 'networkidle2' })
      await page.waitForSelector('.band--market .card', { timeout: 10000 })
      await sleep(900)
      const deckText = await textOf(page, '.band--market .zone__head')
      const inDeck = Number((deckText.match(/(\d+)/) ?? [])[1] ?? 0)
      record('новая партия раздаётся из обоих наборов', inDeck > 120, `в колоде: ${inDeck}`)

      // И выключение возвращает базовую колоду.
      await page.evaluate(() => {
        try {
          const raw = JSON.parse(localStorage.getItem('sr:settings') ?? '{}')
          localStorage.setItem('sr:settings', JSON.stringify({ ...raw, sets: ['core'] }))
        } catch { /* */ }
      })
      await page.goto(`${BASE}/play?mode=bot&difficulty=normal`, { waitUntil: 'networkidle2' })
      await page.waitForSelector('.band--market .card', { timeout: 10000 })
      await sleep(900)
      const backText = await textOf(page, '.band--market .zone__head')
      const backDeck = Number((backText.match(/(\d+)/) ?? [])[1] ?? 0)
      record('выключение возвращает базовый набор', backDeck < 80, `в колоде: ${backDeck}`)
    }

    // ── 2b3. набор целиком по удержанию ───────────────────────────────────
    {
      await page.goto(`${BASE}/play?mode=bot&difficulty=normal`, { waitUntil: 'networkidle2' })
      await page.waitForSelector('.table', { timeout: 10000 })
      await sleep(900)
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')]
          .find((x) => x.getAttribute('aria-label') === 'Настройки')
        b?.click()
      })
      await sleep(500)
      await openTab(page, 'Наборы карт')

      const tile = await page.$eval('.sets:not(.sets--decks) .opt', (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })
      await page.mouse.move(tile.x, tile.y)
      await page.mouse.down()
      await sleep(900)
      await page.mouse.up()
      await sleep(400)

      const cards = await page.$$eval('.sheet--gallery .card', (els) => els.length)
      const title = await textOf(page, '.sheet--gallery .sheet__title')
      // Базовый набор -- 46 уникальных карт торговой колоды плюс разведчик,
      // гадюка и исследователь.
      record('удержание открывает набор целиком', cards === 49 && title === 'Базовый набор',
        `${title}: карт ${cards}`)

      shots.push(await shot(page, 'set-gallery',
        'Набор, открытый удержанием на его плитке в настройках. Все карты набора ' +
        'разложены по ролям; удержание работает и здесь — на самой карте.'))

      await page.keyboard.press('Escape')
      await sleep(300)
      const closed = await page.$$eval('.sheet--gallery', (els) => els.length)
      record('Esc закрывает набор', closed === 0, `окон: ${closed}`)

      // Тот же жест не должен заодно включить набор. Берётся второй,
      // выключенный: у первого флажок и так заблокирован, и он бы промолчал.
      const second = () => page.$eval('.sets:not(.sets--decks) .opt:nth-of-type(2) input',
        (e) => e.checked)
      const wasOn = await second()
      const tile2 = await page.$eval('.sets:not(.sets--decks) .opt:nth-of-type(2)', (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })
      await page.mouse.move(tile2.x, tile2.y)
      await page.mouse.down()
      await sleep(900)
      await page.mouse.up()
      await sleep(400)
      const nowOn = await second()
      const title2 = await textOf(page, '.sheet--gallery .sheet__title')
      record('удержание не переключает набор',
        nowOn === wasOn && title2 === 'Frontiers', `${wasOn} → ${nowOn}, окно: ${title2}`)
      await page.keyboard.press('Escape')
      await sleep(250)
    }

    // ── 2b-bis. гамбиты и миссии ──────────────────────────────────────────
    {
      // Раздаются из собственных стопок, поэтому включаются числом, а не
      // переключателем набора: «сколько раздать каждому».
      await page.evaluate(() => {
        try {
          const raw = JSON.parse(localStorage.getItem('sr:settings') ?? '{}')
          localStorage.setItem('sr:settings', JSON.stringify({
            ...raw, sets: ['core', 'gambits', 'cosmic-gambits', 'missions'],
            gambits: 2, missions: 3,
          }))
        } catch { /* */ }
      })
      await page.goto(`${BASE}/play?mode=bot&difficulty=normal`, { waitUntil: 'networkidle2' })
      await page.waitForSelector('.plate__tab', { timeout: 10000 })
      await sleep(900)

      // Гамбиты и миссии убраны в левую полосу и раскрываются наведением;
      // проверке хватает щелчка, который закрепляет плашку открытой.
      const plateLabels = await page.$$eval('.plate__tab',
        (els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()))
      record('гамбиты и миссии убраны в боковые плашки',
        plateLabels.length === 2 && /Гамбиты\s*2/.test(plateLabels[0] ?? '')
          && /Миссии\s*3/.test(plateLabels[1] ?? ''),
        plateLabels.join(' · '))
      // Плашка с легальным ходом внутри обязана его показывать: иначе ход,
      // спрятанный за наведением, спрятан насовсем.
      const dots = await page.$$eval('.plate__dot', (els) => els.length)
      record('плашка отмечает доступный ход', dots >= 1, `точек: ${dots}`)
      // Открыта всегда одна плашка, поэтому каждую считаем отдельно.
      const openPlate = async (i) => {
        await page.evaluate((n) => {
          const tabs = [...document.querySelectorAll('.plate__tab')]
          if (tabs[n]?.getAttribute('aria-expanded') !== 'true') tabs[n]?.click()
        }, i)
        await sleep(350)
        return page.$$eval('.plate__cards .zone .eyebrow',
          (els) => els.map((e) => (e.textContent ?? '').trim()))
      }
      const gambitCount = (await openPlate(0)).filter((t) => t === 'Гамбит (закрыт)').length
      const missionCount = (await openPlate(1)).filter((t) => t === 'Миссия').length
      record('открыта всегда одна плашка',
        (await page.$$eval('.plate.is-pinned', (els) => els.length)) === 1,
        'закреплена одна')
      await openPlate(0)
      record('гамбиты и миссии раздаются на стол',
        gambitCount === 2 && missionCount === 3,
        `гамбитов ${gambitCount}, миссий ${missionCount}`)

      // Раскрытие гамбита -- обычное действие своего хода, поэтому сначала
      // дожидаемся, пока ход действительно наш и карта стала кликабельной:
      // клик по неактивной карте прошёл бы молча и проверка врала бы.
      await page.waitForFunction(
        () => [...document.querySelectorAll('.plate__cards .zone')].some(
          (z) => (z.querySelector('.eyebrow')?.textContent ?? '').includes('закрыт')
            && z.querySelector('.card.is-playable')),
        { timeout: 10000 },
      )
      const revealed = await page.evaluate(() => {
        const zones = [...document.querySelectorAll('.plate__cards .zone')]
        const z = zones.find((x) => (x.querySelector('.eyebrow')?.textContent ?? '').includes('закрыт')
          && x.querySelector('.card.is-playable'))
        if (!z) return false
        z.querySelector('.card')?.click()
        return true
      })
      await sleep(700)
      const after = await page.$$eval('.plate__cards .zone .eyebrow',
        (els) => els.map((e) => (e.textContent ?? '').trim()))
      record('гамбит раскрывается кликом',
        revealed && after.filter((t) => t === 'Гамбит (закрыт)').length === 1,
        `было 2, стало ${after.filter((t) => t === 'Гамбит (закрыт)').length}`)
      shots.push(await shot(page, 'gambits',
        'Гамбиты и миссии убраны в плашки у левого края и раскрываются наведением: ' +
        'к ним обращаются дважды за партию, а места они занимали как торговый ряд. ' +
        'Точка на плашке горит, когда внутри есть ход, — иначе ход, спрятанный ' +
        'за наведением, спрятан насовсем.'))

      await page.evaluate(() => {
        try {
          const raw = JSON.parse(localStorage.getItem('sr:settings') ?? '{}')
          localStorage.setItem('sr:settings', JSON.stringify({
            ...raw, sets: ['core'], gambits: 0, missions: 0,
          }))
        } catch { /* */ }
      })
    }

    // ── 2b-quater. сценарий ───────────────────────────────────────────────
    {
      // Сценарий меняет одно правило на всю партию, для обоих игроков.
      await page.evaluate(() => {
        try {
          const raw = JSON.parse(localStorage.getItem('sr:settings') ?? '{}')
          localStorage.setItem('sr:settings', JSON.stringify({
            ...raw, sets: ['core'], variant: 'frantic-preparations',
          }))
        } catch { /* */ }
      })
      await page.goto(`${BASE}/play?mode=bot&difficulty=normal`, { waitUntil: 'networkidle2' })
      await page.waitForSelector('.band--hand .card', { timeout: 10000 })
      await sleep(900)
      // «Лихорадочные сборы»: из колоды убраны разведчик и штурмовик, значит
      // на руке три карты, а в колоде пять вместо семи.
      const deckText = await page.evaluate(() =>
        (document.querySelector('.band--hand')?.textContent ?? ''))
      record('сценарий доезжает до раздачи', /Колода 5/.test(deckText),
        deckText.replace(/\s+/g, ' ').slice(0, 80))
      shots.push(await shot(page, 'variant',
        'Сценарий «Лихорадочные сборы»: перед партией из колоды каждого игрока ' +
        'убраны разведчик и штурмовик. Реализованы те десять сценариев, точный ' +
        'текст которых опубликован издателем.'))

      await page.evaluate(() => {
        try {
          const raw = JSON.parse(localStorage.getItem('sr:settings') ?? '{}')
          localStorage.setItem('sr:settings', JSON.stringify({ ...raw, variant: '' }))
        } catch { /* */ }
      })
    }

    // ── 2b-ter. командная колода ──────────────────────────────────────────
    {
      // Заменяет стартовую колоду целиком: свои карты, свой авторитет, свой
      // размер руки и два гамбита с самого начала.
      await page.evaluate(() => {
        try {
          const raw = JSON.parse(localStorage.getItem('sr:settings') ?? '{}')
          localStorage.setItem('sr:settings', JSON.stringify({
            ...raw, sets: ['core', 'command-decks'], commandDeck: 'lost-fleet',
            gambits: 0, missions: 0,
          }))
        } catch { /* */ }
      })
      await page.goto(`${BASE}/play?mode=bot&difficulty=normal`, { waitUntil: 'networkidle2' })
      await page.waitForSelector('.band--hand .card', { timeout: 10000 })
      await sleep(900)

      const hand = await page.$$eval('.band--hand .card__name', (els) =>
        els.map((e) => (e.textContent ?? '').trim()))
      const authority = await page.evaluate(() =>
        (document.querySelector('.band--hand')?.textContent ?? '').trim())
      record('командная колода заменяет стартовую',
        hand.length === 5 && hand.every((n) => /осколок/i.test(n)),
        hand.join(' · '))
      record('стартовый авторитет командира применён',
        /72/.test(authority), authority.slice(0, 90))
      shots.push(await shot(page, 'command-deck',
        'Командная колода «Потерянный флот». Стартовая колода заменена осколками, ' +
        'авторитет и размер руки взяты у легендарного командира, два его гамбита ' +
        'лежат закрытыми, а восьмистоимостный «Потерянный дредноут» замешан в ' +
        'общую торговую колоду.'))

      await page.evaluate(() => {
        try {
          const raw = JSON.parse(localStorage.getItem('sr:settings') ?? '{}')
          localStorage.setItem('sr:settings', JSON.stringify({
            ...raw, sets: ['core'], commandDeck: '',
          }))
        } catch { /* */ }
      })
    }

    // ── 2c. кампания ──────────────────────────────────────────────────────
    await page.goto(`${BASE}/campaign`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('.camp', { timeout: 10000 })
    await sleep(600)
    {
      const camps = await page.$$eval('.camp', (e) => e.length)
      const missions = await page.$$eval('.mission', (e) => e.length)
      const locked = await page.$$eval('.mission.is-locked', (e) => e.length)
      record('кампании перечислены', camps === 3 && missions === 12,
        `кампаний ${camps}, вылетов ${missions}`)
      // Открыт только первый вылет каждой кампании: 12 - 3 = 9 закрыто.
      record('вылеты открываются по порядку', locked === 9, `закрыто: ${locked}`)
      shots.push(await shot(page, 'campaign', 'Выбор вылета. Три кампании по четыре задания; каждое следующее открывается после предыдущего.'))

      // Прогресс -- это состояние браузера, а не правило игры, поэтому
      // проверяется ровно так, как его пишет игра.
      await page.evaluate(() => {
        try { localStorage.setItem('sr:campaign', JSON.stringify({ 'frontier-1': true })) } catch { /* */ }
      })
      await page.reload({ waitUntil: 'networkidle2' })
      await page.waitForSelector('.camp', { timeout: 10000 })
      await sleep(500)
      const lockedAfter = await page.$$eval('.mission.is-locked', (e) => e.length)
      const beaten = await page.$$eval('.mission.is-beaten', (e) => e.length)
      record('пройденный вылет открывает следующий',
        lockedAfter === 8 && beaten === 1, `закрыто ${lockedAfter}, пройдено ${beaten}`)
      await page.evaluate(() => {
        try { localStorage.removeItem('sr:campaign') } catch { /* */ }
      })
    }

    // Сама миссия: изменённая расстановка должна доехать до стола.
    await page.goto(`${BASE}/play?mode=campaign&mission=hive-2`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('.table', { timeout: 10000 })
    await sleep(1200)
    {
      const objective = await textOf(page, '.objective')
      // Не привязываемся к числу ходов: оно -- предмет балансировки.
      record('задача вылета показана на столе',
        /Пережить\s+\d+/.test(objective) && /ход\s+1\s+из\s+\d+/.test(objective),
        objective.replace(/\s+/g, ' ').trim())

      const myBases = await page.$$eval('.band--board .card', (e) => e.length)
      record('стартовая база вылета стоит в игре', myBases === 1, `баз: ${myBases}`)

      // «Оборонный центр» -- {authority:3} ИЛИ {combat:2}. Единственная карта,
      // которая в этом прогоне гарантированно стоит в игре и задаёт вопрос с
      // ветками, поэтому окно выбора проверяется именно на ней.
      await page.evaluate(() => {
        // Свойство базы активируется кнопкой под картой, а не кликом по ней.
        const b = document.querySelector('.band--board .actions .btn')
        b?.click()
      })
      await sleep(500)
      const asked = await page.evaluate(() => {
        const el = document.querySelector('.choice')
        if (!el) return null
        return {
          title: el.querySelector('.choice__title')?.textContent?.trim() ?? '',
          hint: el.querySelector('.choice__hint')?.textContent?.trim() ?? '',
          card: el.querySelectorAll('.choice__stage .card').length,
          // Панель под картой своей плашки не имеет: фон только у кнопок.
          panels: el.querySelectorAll('.sheet').length,
          branches: [...el.querySelectorAll('.branch')]
            .map((e) => (e.textContent ?? '').trim()),
        }
      })
      record('окно выбора показывает карту, которая спросила',
        asked !== null && asked.card === 1 && asked.panels === 0
        && asked.hint.includes('Оборонный центр'),
        asked ? `${asked.title} · ${asked.hint}, карт: ${asked.card}` : 'окно не открылось')

      // Ветки движок хранит по-английски. Латиница в кнопке выбора значит, что
      // метку забыли перевести; полный список стережёт scripts/check-i18n.ts,
      // а это -- та же проверка, но на живом экране.
      const english = (asked?.branches ?? []).filter((t) => /[A-Za-z]{2}/.test(t))
      record('в вариантах выбора нет английского',
        asked !== null && asked.branches.length === 2 && english.length === 0,
        (asked?.branches ?? []).join(' | ') || 'веток нет')

      shots.push(await shot(page, 'choice',
        'Окно выбора. Над вариантами стоит сама карта, которая задала вопрос: ' +
        '«Выберите одно» ничего не говорит о том, какая из баз на столе сработала.'))

      // Вернуть стол в исходное состояние: ниже проверяется торговая колода.
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('.branch')][0]
        b?.click()
      })
      await sleep(400)

      // Пул миссии -- две фракции из четырёх, поэтому колода заведомо меньше
      // полных 80 карт минус пятёрка ряда.
      const deckText = await textOf(page, '.band--market .zone__head')
      const n = Number((deckText.match(/(\d+)/) ?? [])[1] ?? 0)
      record('торговая колода ограничена пулом вылета', n > 20 && n < 60, `в колоде: ${n}`)

      shots.push(await shot(page, 'mission', 'Вылет «Держать линию». Полоса задачи ведёт счёт ходам, оборонный центр выдан на старте, торговая колода собрана только из двух фракций.'))
    }

    // ── 2d. приключения Frontiers ─────────────────────────────────────────
    await page.goto(`${BASE}/challenges`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('.boss', { timeout: 10000 })
    await sleep(600)
    {
      const bosses = await page.$$eval('.boss', (e) => e.length)
      record('восемь боссов перечислены', bosses === 8, `боссов: ${bosses}`)
      // Реконструированные части обязаны быть помечены: это не косметика, а
      // граница между правилами издателя и нашими.
      const marked = await page.$$eval('.boss__ours', (e) => e.length)
      record('наши реконструкции помечены', marked >= 6, `помечено: ${marked}`)
      shots.push(await shot(page, 'challenges', 'Приключения Frontiers. У каждого босса своя механика; всё, что восстановлено нами, а не взято из книги правил, помечено отдельно.'))
    }

    // Каждый скриптовый босс должен реально ходить: у каждого свой счётчик.
    for (const [boss, probe] of [
      ['nemesis-beast', '.bossbar'],
      ['dimensional-horror', '.tentacle'],
      ['automatons', '.bossbar'],
      ['pirates-of-the-dark-star', '.bossbar'],
    ]) {
      await page.goto(`${BASE}/play?mode=challenge&boss=${boss}&level=veteran`, { waitUntil: 'networkidle2' })
      await page.waitForSelector('.table', { timeout: 10000 })
      await sleep(900)
      // Свой HUD -- последний на странице. У Ужаса авторитет показан как «∞»,
      // поэтому читать надо именно свой, а не «первый попавшийся».
      const myAuthority = () => page.evaluate(() => {
        const huds = [...document.querySelectorAll('.hud')]
        const mine = huds[huds.length - 1]
        // Именно ячейка авторитета: соседние ячейки торговли и боя иначе
        // склеиваются с ней в одно число.
        const cell = mine?.querySelector('.rail__cell')
        return Number((cell?.textContent ?? '').match(/(\d+)/)?.[1] ?? -1)
      })
      const authorityBefore = await myAuthority()
      for (let i = 0; i < 3; i++) {
        await clickText(page, 'Разыграть все', 700)
        // Промпт может требовать НЕСКОЛЬКО карт («сбросьте две»), поэтому
        // выбираем, пока кнопка подтверждения не станет активной, а не ровно
        // одну карту.
        for (let k = 0; k < 6; k++) {
          if (!(await page.$('.choice__cards .card'))) break
          const done = await page.evaluate(() => {
            const btn = [...document.querySelectorAll('.choice button')]
              .find((b) => /подтвердить|пропустить/i.test(b.textContent ?? ''))
            if (btn && !btn.disabled) { btn.click(); return true }
            // Именно из вариантов: карта, которая ЗАДАЛА вопрос, стоит в той
            // же сцене и кликом не выбирается.
            const card = [...document.querySelectorAll('.choice__cards .card')]
              .find((c) => !c.disabled && !c.className.includes('is-selected'))
            card?.click()
            return false
          })
          await sleep(220)
          if (done) break
        }
        await clickText(page, 'Завершить ход', 900)
        await sleep(800)
      }
      const hasProbe = (await page.$$(probe)).length > 0
      const authorityAfter = await myAuthority()
      // След от хода босса -- это либо урон, либо выложенные им карты.
      // Автоматоны бьют только тем, что дают разыгранные ими карты, поэтому
      // три торговых карты подряд действительно могут не нанести урона; но
      // карты на столе появиться обязаны.
      const bossCards = await page.$$eval('.band:first-of-type .card', (e) => e.length)
      const acted = authorityAfter < authorityBefore || bossCards > 0
      record(`босс «${boss}» ведёт свой ход`, hasProbe && acted,
        `панель: ${hasProbe}, авторитет ${authorityBefore} → ${authorityAfter}, ` +
        `карт у босса: ${bossCards}`)
      if (boss === 'dimensional-horror') {
        shots.push(await shot(page, 'boss-horror', 'Межпространственный ужас: авторитета у него нет, вместо этого четыре щупальца, каждое со своей обороной.'))
      }
      // Полосы не должны наезжать друг на друга: у стола теперь до шести полос.
      const overlap = await page.evaluate(() => {
        // Модалки и подсказки лежат поверх стола намеренно -- считаем только
        // полосы, участвующие в потоке.
        const bands = [...document.querySelectorAll('.table > *')]
          .filter((el) => getComputedStyle(el).position !== 'fixed')
        for (let i = 1; i < bands.length; i++) {
          const a = bands[i - 1].getBoundingClientRect()
          const b = bands[i].getBoundingClientRect()
          if (b.top < a.bottom - 1) return `${i}`
        }
        return ''
      })
      record(`полосы стола не наезжают («${boss}»)`, overlap === '', overlap ? `полоса ${overlap}` : 'ок')
    }

    // ── 3. hot-seat pass screen ───────────────────────────────────────────
    await page.goto(`${BASE}/play?mode=hotseat`, { waitUntil: 'networkidle2' })
    await page.waitForSelector('.table', { timeout: 10000 })
    await sleep(600)
    await clickText(page, 'Завершить ход', 3000)
    await sleep(700)
    const passVisible = (await textOf(page, '.menu__title')).length > 0
    if (passVisible) {
      shots.push(await shot(page, 'hotseat-pass', 'Передача устройства. Стол скрыт, пока входящий игрок не подтвердит готовность, — чужую руку увидеть нельзя.'))
    }
    record('за одним экраном стол скрыт между ходами', passVisible)

    // ── 4. online, two clients, with the wire under inspection ────────────
    try {
    const a = await browser.newPage()
    const b = await browser.newPage()
    watchConsole(a, 'online-A'); watchConsole(b, 'online-B')

    const framesB = []
    const cdp = await b.createCDPSession()
    await cdp.send('Network.enable')
    cdp.on('Network.webSocketFrameReceived', (e) => {
      if (e.response?.payloadData) framesB.push(e.response.payloadData)
    })

    await a.goto(`${BASE}/online`, { waitUntil: 'networkidle2' })
    await clickText(a, 'Создать партию', 6000)
    await a.waitForSelector('.table', { timeout: 12000 })
    await sleep(900)
    const code = await a.$eval('.banner b', (e) => e.textContent?.trim() ?? '').catch(() => '')
    record('код комнаты выдан', /^[A-Z2-9]{5}$/.test(code), code || 'нет')
    shots.push(await shot(a, 'online-waiting', `Партия создана. Код комнаты (${code || '—'}) — одноразовый пропуск на вход, а не токен доступа.`))

    await b.goto(`${BASE}/online`, { waitUntil: 'networkidle2' })
    await b.type('input[aria-label="Код комнаты"]', code)
    await clickText(b, 'Войти', 6000)
    await b.waitForSelector('.table', { timeout: 12000 })
    await sleep(1200)
    shots.push(await shot(b, 'online-joined', 'Второе место, вход по коду. Движок работает на сервере; в этот браузер приходит только отредактированный вид.'))

    // Make a move as A so B receives a real update frame.
    await clickText(a, 'Разыграть все', 4000)
    await sleep(900)
    await clickText(a, 'Завершить ход', 4000)
    await sleep(1500)
    shots.push(await shot(b, 'online-b-turn', 'Ход переходит ко второму игроку. Рука соперника показана только счётчиком — сами карты по сети не передавались.'))

    // THE LEAK TEST: inspect what actually arrived at B.
    //
    // Socket.IO frames are `<engine.io digit><socket.io digit>["event",{...}]`,
    // e.g. `42["update",{...}]` for an emit and `43[...]` for an ack payload.
    // Parsing from the first `{` yields a trailing `]` and fails, so strip the
    // numeric prefix and parse the array.
    const updates = []
    for (const f of framesB) {
      const payload = f.replace(/^\d+/, '')
      if (!payload.startsWith('[')) continue
      let arr
      try { arr = JSON.parse(payload) } catch { continue }
      for (const item of arr) {
        if (item && typeof item === 'object' && 'state' in item) updates.push(item)
        // create/join acks nest the first snapshot under `update`
        if (item && typeof item === 'object' && item.update?.state) updates.push(item.update)
      }
    }
    const gotFrames = updates.length > 0
    record('сервер прислал обновления состояния', gotFrames, `кадров: ${updates.length}`)

    const findKey = (o, key, path = '$') => {
      if (o === null || typeof o !== 'object') return []
      if (Array.isArray(o)) return o.flatMap((v, i) => findKey(v, key, `${path}[${i}]`))
      return Object.entries(o).flatMap(([k, v]) =>
        (k === key ? [`${path}.${k}`] : []).concat(findKey(v, key, `${path}.${k}`)))
    }
    let rngHits = [], oppHandHits = [], deckHits = [], optionLeaks = 0
    for (const u of updates) {
      rngHits.push(...findKey(u.state, 'rng'))
      if (u.state?.opponent && 'hand' in u.state.opponent) oppHandHits.push('opponent.hand')
      if (u.state?.opponent && 'deck' in u.state.opponent) deckHits.push('opponent.deck')
      if (u.state?.me && 'deck' in u.state.me) deckHits.push('me.deck')
      const pc = u.state?.pendingChoice
      if (pc && pc.actor !== u.state.viewer && pc.options !== null) optionLeaks++
    }
    // Each leak check requires real traffic, so none of them can pass vacuously
    // on an empty capture -- a silent pass here would be worse than a failure.
    record('состояние ГСЧ по сети не уходит', gotFrames && rngHits.length === 0,
      gotFrames ? rngHits.join(', ') : 'кадров не перехвачено')
    record('рука соперника по сети не уходит', gotFrames && oppHandHits.length === 0,
      gotFrames ? oppHandHits.join(', ') : 'кадров не перехвачено')
    record('содержимое колод по сети не уходит', gotFrames && deckHits.length === 0,
      gotFrames ? deckHits.join(', ') : 'кадров не перехвачено')
    record('варианты выбора не уходят тому, кто не отвечает', gotFrames && optionLeaks === 0,
      gotFrames ? `утечек: ${optionLeaks}` : 'кадров не перехвачено')
    record('рука соперника приходит только счётчиком',
      gotFrames && updates.every((u) => typeof u.state?.opponent?.handCount === 'number'),
      gotFrames ? `handCount есть во всех кадрах: ${updates.length}` : 'кадров не перехвачено')

    const sample = updates[updates.length - 1]
    if (sample) {
      await writeFile(join(OUT, 'wire-sample.json'), JSON.stringify(sample, null, 2))
    }

    } catch (e) {
      record('сетевой режим отработал', false, String(e).slice(0, 160))
    }

    // ── 4b. co-op: a real table of two against a Challenge boss ───────────
    //
    // The point of this block is that the rulebook's team rules are visible in
    // the running game and not just in the tests: one shared score, both
    // players able to act at the same time, and resources moving between them.
    try {
      const ca = await browser.newPage()
      const cb = await browser.newPage()
      await ca.setViewport({ width: 1440, height: 900 })
      await cb.setViewport({ width: 1440, height: 900 })
      watchConsole(ca, 'coop-A'); watchConsole(cb, 'coop-B')

      const framesCoop = []
      const cdpC = await cb.createCDPSession()
      await cdpC.send('Network.enable')
      cdpC.on('Network.webSocketFrameReceived', (e) => {
        if (e.response?.payloadData) framesCoop.push(e.response.payloadData)
      })

      await ca.goto(`${BASE}/challenges`, { waitUntil: 'networkidle2' })
      // Two players turns the solo button into a team one.
      await ca.evaluate(() => {
        const group = [...document.querySelectorAll('[role="group"]')]
          .find((g) => (g.textContent || '').includes('Игроков'))
        for (const b of group?.querySelectorAll('button') ?? []) {
          if (b.textContent.trim() === '2') { b.click(); return }
        }
      })
      await sleep(400)
      shots.push(await shot(ca, 'coop-pick',
        'Выбор вызова на двоих. Под каждым боссом написано, по каким правилам команды он играется: у шести из восьми это «Гидра» — общий счёт влияния и общий ход.'))

      await clickText(ca, 'Собрать команду', 6000)
      await ca.waitForSelector('.mode', { timeout: 8000 })
      await clickText(ca, 'Собрать команду', 6000)
      await ca.waitForSelector('.table', { timeout: 15000 })
      await sleep(1000)
      const coopCode = await ca.$eval('.banner b', (e) => e.textContent?.trim() ?? '').catch(() => '')
      record('командный стол ждёт игроков', /^[A-Z2-9]{5}$/.test(coopCode), coopCode || 'нет кода')
      shots.push(await shot(ca, 'coop-waiting',
        `Стол собран, второе место свободно. Код (${coopCode || '—'}) действует, пока не займут все места, — в отличие от дуэли, где он одноразовый.`))

      await cb.goto(`${BASE}/online`, { waitUntil: 'networkidle2' })
      await cb.type('input[aria-label="Код комнаты"]', coopCode)
      await clickText(cb, 'Войти', 6000)
      await cb.waitForSelector('.table', { timeout: 15000 })
      await sleep(1500)

      const readTable = (page) => page.evaluate(() => ({
        allies: [...document.querySelectorAll('.ally')].map((e) => e.innerText.replace(/\n+/g, ' · ')),
        boss: document.querySelector('.hud')?.innerText.replace(/\n+/g, ' · ') ?? '',
        mine: document.querySelector('.hud--self, .table .hud:last-of-type')?.innerText ?? '',
        canEnd: [...document.querySelectorAll('button')]
          .some((e) => e.textContent.includes('Завершить ход') && !e.disabled),
        authority: [...document.querySelectorAll('.rail__cell')].map((e) => e.textContent.trim()),
      }))
      const ta = await readTable(ca)
      const tb = await readTable(cb)

      // "The Boss starts the game with 30 Authority per player" -- Automatons,
      // at two players, is 60. The team's own score is 60 x 2 = 120.
      record('авторитет босса вырос по числу игроков', /\b60\b/.test(ta.boss), ta.boss.slice(0, 60))
      record('у команды один общий счёт влияния',
        ta.allies.some((a) => a.includes('120')) && tb.allies.some((a) => a.includes('120')),
        `A: ${ta.allies[0] ?? '—'}`)
      // "Teams alternate taking turns ... with all teammates sharing their
      // Main, Discard, and Draw Phases."
      record('оба игрока ходят одновременно', ta.canEnd && tb.canEnd,
        `A: ${ta.canEnd}, B: ${tb.canEnd}`)
      record('в полосе команды виден союзник', ta.allies.length === 1 && tb.allies.length === 1,
        `A: ${ta.allies.length}, B: ${tb.allies.length}`)
      shots.push(await shot(ca, 'coop-table',
        'Стол на двоих против Автоматонов. Внизу полоса команды: счёт союзника, его рука в счётчиках и кнопки передачи ресурсов. Влияние 120 — общий счёт Гидры, а не по 120 у каждого.'))

      // Transfer: play a ship for trade, then hand it to the teammate.
      await clickText(ca, 'Разыграть все', 5000)
      await sleep(900)
      const gave = await ca.evaluate(() => {
        const b = [...document.querySelectorAll('.ally__give button')][0]
        if (!b) return null
        const label = b.textContent.trim()
        b.click()
        return label
      })
      await sleep(1200)
      const afterB = await readTable(cb)
      record('ресурсы передаются союзнику', gave !== null,
        gave ? `передано: ${gave}` : 'кнопка передачи не появилась')
      shots.push(await shot(ca, 'coop-transfer',
        'Передача пула. Правило Гидры разрешает отдавать союзнику сколько угодно торговли и боя сколько угодно раз за ход — так команда складывается на дорогую карту или на большую базу.'))
      record('союзник видит полученное', afterB.allies.length === 1, afterB.allies[0] ?? '—')

      // The leak test again, at a bigger table: a teammate is not an exception.
      const coopUpdates = []
      for (const f of framesCoop) {
        const payload = f.replace(/^\d+/, '')
        if (!payload.startsWith('[')) continue
        let arr
        try { arr = JSON.parse(payload) } catch { continue }
        for (const item of arr) {
          if (item && typeof item === 'object' && 'state' in item) coopUpdates.push(item)
          if (item && typeof item === 'object' && item.update?.state) coopUpdates.push(item.update)
        }
      }
      const allyHandLeak = coopUpdates.some((u) =>
        (u.state?.allies ?? []).some((a) => a.view && 'hand' in a.view))
      record('рука союзника по сети не уходит',
        coopUpdates.length > 0 && !allyHandLeak,
        coopUpdates.length ? `кадров: ${coopUpdates.length}` : 'кадров не перехвачено')
    } catch (e) {
      record('командный режим отработал', false, String(e).slice(0, 200))
    }

    // ── 5. mobile portrait ────────────────────────────────────────────────
    const m = await browser.newPage()
    watchConsole(m, 'mobile')
    await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    await m.goto(`${BASE}/play?mode=bot&difficulty=normal`, { waitUntil: 'networkidle2' })
    await m.waitForSelector('.table', { timeout: 10000 })
    await sleep(1400)
    shots.push(await shot(m, 'mobile', 'Мобильный портрет, 390px. Полосы сжимаются, ряды прокручиваются с привязкой — карты не ужимаются ниже читаемости.'))
    const overflow = await m.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    record('на мобильном нет горизонтального переполнения', overflow <= 1, `${overflow}px`)

    record('ошибок в консоли нет', consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(' | '))
  } finally {
    await browser.close()
  }

  await writeFile(join(OUT, 'results.json'), JSON.stringify({ results, consoleErrors, shots }, null, 2))
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`)
  if (consoleErrors.length) console.log(`ошибки консоли:\n  ${consoleErrors.join('\n  ')}`)
  process.exitCode = failed.length > 0 ? 1 : 0
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
