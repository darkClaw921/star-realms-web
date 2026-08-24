/**
 * Снимки интерфейса для README.
 *
 * Иллюстрации карт при съёмке ЗАБЛОКИРОВАНЫ, и это не мелочь: рисунки
 * принадлежат Wise Wizard Games, лежат в gitignored-папке и не должны попадать
 * ни в репозиторий, ни в опубликованную страницу. Карта без картинки получает
 * процедурное оформление по своей фракции — то же самое видит любой, кто не
 * запускал `npm run fetch-cards`, так что снимок остаётся честным интерфейсом,
 * а не постановкой.
 *
 * Запуск: node scripts/screenshots.mjs [baseUrl]
 */
import { mkdir, rm, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import sharp from 'sharp'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', '..', '..', 'docs', 'screenshots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Настройки на время съёмки: полный набор наборов, чтобы стол был живым. */
const SETTINGS = {
  sets: ['core', 'frontiers', 'colony-wars', 'crisis-heroes', 'crisis-events',
    'high-alert-tech', 'gambits', 'missions'],
  gambits: 3,
  missions: 3,
  cardScale: 1,
  sound: false,
}

/**
 * Снимок в webp.
 *
 * Кадр снимается в двойном разрешении ради чёткости текста, а лежит в
 * репозитории пожатым: тот же кадр в png весит под два мегабайта, и четыре
 * таких на README — это лишние восемь.
 */
async function shoot(page, name) {
  const png = await page.screenshot()
  const file = `${name}.webp`
  const out = await sharp(png).webp({ quality: 80 }).toBuffer()
  await sharp(out).toFile(join(OUT, file))
  console.log(`  ${file} — ${Math.round(out.length / 1024)} КБ`)
}

/** Нажать кнопку по видимому тексту. */
async function click(page, re, timeout = 6000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const ok = await page.evaluate((src) => {
      const rx = new RegExp(src, 'i')
      const el = [...document.querySelectorAll('button')]
        .find((b) => rx.test(b.textContent ?? '') && !b.disabled)
      if (!el) return false
      el.click()
      return true
    }, re.source)
    if (ok) return true
    await sleep(150)
  }
  return false
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--no-sandbox'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
// Заблокированные иллюстрации сами превращаются в ошибки загрузки — это наша
// собственная блокировка, а не поломка страницы.
page.on('console', (m) => {
  if (m.type() !== 'error') return
  if (/ERR_FAILED|Failed to load resource/.test(m.text())) return
  errors.push(m.text())
})

// Ни один байт издательской иллюстрации до страницы не доходит.
await page.setRequestInterception(true)
let blocked = 0
page.on('request', (r) => {
  if (/\/cards\/art\//.test(r.url())) { blocked += 1; return void r.abort() }
  void r.continue()
})

await mkdir(OUT, { recursive: true })
// Старые кадры убираются: пропущенный снимок иначе останется от прошлого прогона
// и будет выдавать себя за свежий.
for (const f of await readdir(OUT).catch(() => [])) await rm(join(OUT, f))
// Стол выше обычного окна: при 900 в кадр не попадал нижний HUD с рукой.
await page.setViewport({ width: 1440, height: 1150, deviceScaleFactor: 2 })
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate((s) => localStorage.setItem('sr:settings', JSON.stringify(s)), SETTINGS)
// Настройки читаются при монтировании, поэтому страницу надо перечитать —
// иначе снимок покажет базовый набор вместо выбранных.
await page.reload({ waitUntil: 'networkidle2' })

console.log('снимки:')

// 1. Главная: режимы и профиль.
await page.goto(BASE, { waitUntil: 'networkidle2' })
await sleep(1200)
await shoot(page, 'menu')

// 2. Стол против бота — после нескольких ходов, чтобы в игре были карты.
await page.goto(`${BASE}/play?mode=bot&difficulty=normal`, { waitUntil: 'networkidle2' })
await sleep(1500)
/** Купить всё, что по карману: без покупок стол так и останется стартовым. */
const buyAll = async () => {
  for (let i = 0; i < 4; i++) {
    const bought = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.band--market .card-slot button')]
        .find((b) => !b.disabled && b.className.includes('is-playable'))
      if (!btn) return false
      btn.click()
      return true
    })
    await sleep(700)
    if (!bought) break
  }
}

for (let i = 0; i < 5; i++) {
  await click(page, /разыграть все корабли/)
  await sleep(700)
  await buyAll()
  await click(page, /завершить ход/)
  // Ход бота вместе с его вспышками.
  await sleep(2600)
}
await click(page, /разыграть все корабли/)
await sleep(900)
await buyAll()
await sleep(600)

/** Событие вскрывается само и ждёт нажатия — снимем его и уберём со стола. */
const catchEvent = async (file) => {
  const shown = await page.evaluate(() => !!document.querySelector('.eventflash'))
  if (!shown) return false
  if (file) await shoot(page, file)
  await click(page, /понятно/)
  await sleep(500)
  return true
}

/**
 * Вопрос во весь экран — тоже снимок, и на него надо ответить, чтобы идти
 * дальше. Сначала выбирается вариант: при «выберите ровно 1» кнопка
 * подтверждения не работает, пока ничего не выбрано.
 */
const catchChoice = async (file) => {
  const shown = await page.evaluate(() => !!document.querySelector('.choice__panel'))
  if (!shown) return false
  if (file) await shoot(page, file)
  await page.evaluate(() => {
    const opt = document.querySelector('.choice__panel .branch')
      ?? document.querySelector('.choice__panel .card-slot button')
    opt?.click()
  })
  await sleep(400)
  if (!(await click(page, /подтвердить/, 1500))) await click(page, /пропустить/, 1200)
  await sleep(700)
  return true
}

// Сначала снимаем то, что перекрывает стол, потом — сам стол.
await catchEvent('event')
await catchChoice('choice')
for (let i = 0; i < 8; i++) {
  if (!(await catchEvent(null)) && !(await catchChoice(null))) break
}
// Снимок делается на СВОЁМ ходу и с разыгранной рукой: кадр, пойманный посреди
// хода бота, показывает пустую зону и погашенные кнопки.
await page.waitForFunction(() => [...document.querySelectorAll('button')]
  .some((b) => /завершить ход/i.test(b.textContent ?? '') && !b.disabled),
{ timeout: 20000 }).catch(() => {})
await click(page, /разыграть все корабли/, 2500)
await sleep(900)
await catchEvent(null)
await catchChoice(null)
await sleep(600)
const clear = await page.evaluate(() =>
  !document.querySelector('.eventflash') && !document.querySelector('.choice__panel'))
if (!clear) console.log('  (стол всё ещё чем-то накрыт — снимок может быть не тем)')
await shoot(page, 'table')

// 3. Боковая вкладка: гамбиты лежат всю партию и открываются наведением.
await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.plate__tab')]
    .find((b) => /гамбит/i.test(b.textContent ?? ''))
  tab?.click()
})
await sleep(600)
const plateOpen = await page.evaluate(() => {
  const fly = document.querySelector('.plate__flyout')
  return !!fly && getComputedStyle(fly).visibility === 'visible'
})
if (plateOpen) await shoot(page, 'rail')
else console.log('  (вкладка не открылась — rail.png пропущен)')

// 4. Приключения: боссы и уровни сложности.
await page.goto(`${BASE}/challenges`, { waitUntil: 'networkidle2' })
await sleep(1200)
await shoot(page, 'challenges')

// 5. Настройки: панель поверх стола.
await page.goto(`${BASE}/play?mode=bot&difficulty=normal`, { waitUntil: 'networkidle2' })
await sleep(1500)
await page.evaluate(() => {
  const gear = [...document.querySelectorAll('button')]
    .find((b) => (b.getAttribute('title') ?? b.getAttribute('aria-label') ?? '').match(/настрой/i))
  gear?.click()
})
await sleep(800)
const settingsOpen = await page.evaluate(() => !!document.querySelector('.sheet--settings'))
if (settingsOpen) await shoot(page, 'settings')
else console.log('  (панель настроек не открылась — settings.png пропущен)')

console.log(`заблокировано запросов к иллюстрациям: ${blocked}`)
console.log('ошибки консоли:', errors.length ? errors.slice(0, 5) : 'нет')
await browser.close()
