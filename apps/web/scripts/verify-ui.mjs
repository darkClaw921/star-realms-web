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
