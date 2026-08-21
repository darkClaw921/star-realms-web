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
      if (await page.$('.overlay')) {
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
    const sliders = await page.$$eval('input[type=range]', (els) => els.length)
    record('панель настроек открывается', sliders === 2, `ползунков: ${sliders}`)
    shots.push(await shot(page, 'settings', 'Настройки отображения. Предпросмотр показывает настоящие карты, включая самую многословную в наборе, — на ней и видно, когда текст перестаёт помещаться.'))

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
      ]

      const labels = await page.$$eval('.sets .switch', (els) =>
        els.map((e) => (e.textContent ?? '').trim()))
      record('все наборы карт перечислены',
        labels.length === SETS.length && SETS.every(([n], i) => labels[i] === n),
        labels.join(' · '))
      record('партия начинается с базового набора', before === 80, `колода ${before}`)

      // Последний включённый набор выключить нельзя -- иначе колода пуста.
      const coreLocked = await page.$eval('.sets .switch input', (e) => e.disabled)
      record('последний набор выключить нельзя', coreLocked === true, `заблокирован: ${coreLocked}`)

      let expected = 80
      let ok = true
      const seen = []
      for (let i = 1; i < SETS.length; i++) {
        await page.evaluate((n) => {
          const boxes = [...document.querySelectorAll('.sets .switch input')]
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
        const boxes = [...document.querySelectorAll('.sets .switch input')]
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
          if (!(await page.$('.overlay .card'))) break
          const done = await page.evaluate(() => {
            const btn = [...document.querySelectorAll('.overlay button')]
              .find((b) => /подтвердить|пропустить/i.test(b.textContent ?? ''))
            if (btn && !btn.disabled) { btn.click(); return true }
            const card = [...document.querySelectorAll('.overlay .card')]
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
