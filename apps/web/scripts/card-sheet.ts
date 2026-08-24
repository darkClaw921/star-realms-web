/**
 * Лист карт: все форматы и типы на одной странице, с настоящими иллюстрациями.
 *
 * Собирается не вручную, а из живой игры: скрипт раскладывает карты на столе,
 * забирает ИХ СОБСТВЕННУЮ разметку и подшивает к ней настоящий globals.css.
 * Копия разметки быстро разошлась бы с оригиналом, и лист показывал бы не то,
 * что видит игрок, — а весь смысл листа в том, чтобы судить по нему о столе.
 *
 * Страница остаётся локальной и лежит в reports/, который в .gitignore:
 * иллюстрации карт принадлежат Wise Wizard Games и репозиторий не покидают.
 *
 * Запуск: npx tsx scripts/card-sheet.ts [baseUrl]
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { CARDS, cardDef, type CardDefId } from '@sr/engine'
import { cardRu } from '../src/i18n/cards.ru'
import { ART_MANIFEST } from '../src/cards/artManifest.gen'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..')
const ROOT = join(WEB, '..', '..')
const OUT = join(ROOT, 'reports')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Group {
  readonly title: string
  readonly note: string
  readonly cards: readonly string[]
  /** Ширина карты в этой группе. Не задана — обычная. */
  readonly width?: number
}

/**
 * Что показывать.
 *
 * Подобрано по тому, что ломает плашку: самый длинный текст, самая светлая
 * иллюстрация, обе ориентации и все шесть типов. Карта без ability-текста
 * (Разведчик) здесь тоже нужна — на ней видно, как выглядит плашка, когда ей
 * почти нечего накрывать.
 */
const GROUPS: readonly Group[] = [
  {
    title: 'Два формата',
    note: 'Корабль печатается стоя, база и аванпост — поперёк. Технологии High Alert '
      + 'тоже поперёк: ориентация всюду следует напечатанной карте.',
    cards: ['battlecruiser', 'space-station', 'defense-center', 'laser'],
  },
  {
    title: 'Все типы',
    note: 'Корабль, база, аванпост, герой, событие, технология. У героя и события '
      + 'нет цены — их не покупают в обычном смысле.',
    cards: ['cutter', 'barter-world', 'central-office', 'ram-pilot', 'galactic-summit', 'stealth'],
  },
  {
    title: 'Светлые иллюстрации',
    note: 'Худший случай для читаемости: под текстом снег и небо, а не тёмный космос. '
      + 'Размытие само по себе контраста не даёт — его держит подложка.',
    cards: ['laser', 'guidance', 'trade-bot', 'imperial-frigate'],
  },
  {
    title: 'Много текста и мало текста',
    note: 'Плашка растёт от текста вверх. Слева — самые многословные карты набора, '
      + 'справа — стартовые, где накрывать почти нечего.',
    cards: ['battlecruiser', 'blob-destroyer', 'scout', 'viper', 'explorer'],
  },
  {
    title: 'Не из торговой колоды',
    note: 'Гамбит, миссия, командир: цены у них нет, а плашка та же самая.',
    cards: ['smuggling-run', 'armada', 'high-admiral-jochum'],
  },
  {
    title: 'Мелкий размер',
    note: 'Карта в 96 пикселей: на этой ширине текст свойств уже сворачивается в значки, '
      + 'и размытию остаётся куда меньше места.',
    cards: ['battlecruiser', 'space-station', 'laser', 'ram-pilot'],
    width: 96,
  },
  {
    title: 'Крупный размер',
    note: 'Карта в 300 пикселей — примерно так её видно на увеличении.',
    cards: ['blob-destroyer', 'central-office', 'stealth'],
    width: 300,
  },
]

/** У каких карт есть иллюстрация — иначе лист покажет пустую рамку. */
const withArt = new Set(Object.keys(ART_MANIFEST))

async function main(): Promise<void> {
  const wanted = [...new Set(GROUPS.flatMap((g) => g.cards))]
  const missing = wanted.filter((id) => !CARDS.has(id as CardDefId))
  if (missing.length > 0) throw new Error(`нет таких карт: ${missing.join(', ')}`)
  const artless = wanted.filter((id) => !withArt.has(id))
  if (artless.length > 0) console.warn(`без иллюстрации: ${artless.join(', ')}`)

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, args: ['--no-sandbox'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.setItem('sr:settings', JSON.stringify({ sets: ['core'] })))
  await page.goto(`${BASE}/lab`, { waitUntil: 'networkidle2' })
  await page.waitForFunction('window.__lab !== undefined', { timeout: 20000 })
  await sleep(800)

  // Разметку берём из руки: она рисует сколько угодно карт подряд и не
  // раскладывает их веером, как зона игры.
  const markup = new Map<string, string>()
  for (let i = 0; i < wanted.length; i += 6) {
    const batch = wanted.slice(i, i + 6)
    await page.evaluate((defs) => {
      const lab = (window as unknown as { __lab: {
        patch: (r: (s: Record<string, never>) => void) => void
        constructor: { iid: () => string }
      } }).__lab
      lab.patch((s: Record<string, never>) => {
        const st = s as unknown as { players: Record<string, { hand: unknown[] } | undefined> }
        const p1 = st.players.p1
        if (p1) p1.hand = defs.map((def) => ({ iid: lab.constructor.iid(), def }))
      })
    }, batch)
    await sleep(500)
    // Иллюстрации проявляются по событию загрузки — без ожидания в лист уедет
    // карта с погашенной картинкой.
    await page.waitForFunction(
      'Array.from(document.querySelectorAll(".band--hand img")).every((i) => i.complete)',
      { timeout: 15000 },
    ).catch(() => {})
    const seen = await page.evaluate(() => document.querySelectorAll('.band--hand .card-slot').length)
    console.log(`  партия ${batch.join(', ')} → слотов на экране: ${seen}`)
    const got = await page.evaluate(() => Object.fromEntries(
      // data-def стоит на самом слоте, а не на карте внутри него.
      [...document.querySelectorAll<HTMLElement>('.band--hand .card-slot')]
        .map((slot) => [slot.dataset.def ?? '', slot.outerHTML]),
    ))
    for (const [def, html] of Object.entries(got)) if (def) markup.set(def, html)
  }
  // Значки ресурсов рисуются <use href="#i-trade"> из общего спрайта, а он
  // живёт в разметке приложения. Без него лист показал бы текст с дырами на
  // месте каждой монеты.
  const sprite = await page.evaluate(() => {
    const sym = document.querySelector('symbol[id^="i-"]')
    return sym?.closest('svg')?.outerHTML ?? ''
  })
  const broken = await page.evaluate(() => [...document.querySelectorAll('img')]
    .filter((i) => !i.complete || i.naturalWidth === 0)
    .map((i) => i.getAttribute('src')))
  if (broken.length > 0) console.warn(`иллюстрации не загрузились: ${broken.join(', ')}`)
  await browser.close()

  const css = await readFile(join(WEB, 'src', 'app', 'globals.css'), 'utf8')
  const artDir = join(WEB, 'public', 'cards', 'art')

  /** Разметка карты, очищенная от игрового состояния. */
  const clean = (html: string): string => html
    .replace(/ is-playable| is-dimmed| is-selected| is-holding/g, '')
    .replace(/data-iid="[^"]*"/g, '')
    .replace(/src="\/cards\/art\//g, `src="file://${artDir}/`)
    .replace(/ (onclick|title)="[^"]*"/g, '')
    // На листе всё видно сразу: отложенная загрузка оставляла нижние группы
    // с пустыми рамками, пока до них не долистают.
    .replace(/ loading="lazy"/g, '')

  const card = (id: string): string => {
    const def = cardDef(id as CardDefId)
    const name = cardRu(id as CardDefId)?.name ?? def.name
    const html = markup.get(id)
    return `<figure class="cs__item">
      ${html ? clean(html) : `<div class="cs__missing">нет разметки: ${id}</div>`}
      <figcaption>${name}<span>${kindOf(def)}</span></figcaption>
    </figure>`
  }

  const body = GROUPS.map((g) => `
    <section class="cs__group"${g.width ? ` style="--card-w:${g.width}px"` : ''}>
      <h2>${g.title}</h2>
      <p>${g.note}</p>
      <div class="cs__row">${g.cards.map(card).join('')}</div>
    </section>`).join('')

  const page_ = PAGE
    .replace('/*GAME_CSS*/', css)
    .replace('<!--SPRITE-->', sprite)
    .replace('<!--BODY-->', body)

  await mkdir(OUT, { recursive: true })
  const file = join(OUT, 'card-sheet.html')
  await writeFile(file, page_, 'utf8')
  console.log(`готово: ${file}`)
  console.log(`карт на листе: ${markup.size} из ${wanted.length}`)
}

const TYPE_RU: Record<string, string> = {
  ship: 'корабль', base: 'база', outpost: 'аванпост',
  hero: 'герой', event: 'событие', tech: 'технология',
}

const ROLE_RU: Record<string, string> = {
  gambit: 'гамбит', mission: 'миссия', commander: 'командир',
  starter: 'стартовая', explorer: 'исследователь', command: 'командная колода',
}

/**
 * Чем карта называется в подписи.
 *
 * Роль важнее типа там, где она есть: гамбит, миссия и командир напечатаны как
 * корабли, и подпись «корабль» под командиром сбивала бы с толку сильнее, чем
 * помогала.
 */
function kindOf(def: ReturnType<typeof cardDef>): string {
  return ROLE_RU[def.role] ?? TYPE_RU[def.type] ?? def.type
}

const PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Лист карт — размытие плашки</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fira+Sans+Condensed:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>
/*GAME_CSS*/
</style>
<style>
  body { padding: 0; margin: 0; }
  /* Размытие плашки в игре выключено, но примерить его лист по-прежнему умеет:
   * правило живёт здесь, а ползунок правит переменную. Ноль — то, что стоит в
   * игре сейчас. */
  :root { --card-plate-blur: 0px; }
  .card__text { backdrop-filter: blur(var(--card-plate-blur)) saturate(0.85); }
  .cs { max-width: 1500px; margin: 0 auto; padding: 24px 20px 80px; }
  .cs__head { margin-bottom: 18px; }
  .cs__head h1 { font-family: var(--font-display); font-size: 26px; margin: 0 0 6px; }
  .cs__head p { margin: 0; color: var(--ink-dim); max-width: 70ch; }
  .panel {
    position: sticky; top: 0; z-index: 5;
    display: flex; flex-wrap: wrap; gap: 18px; align-items: center;
    padding: 12px 14px; margin: 0 0 22px;
    border: 1px solid var(--rule); border-radius: var(--r-md);
    background: color-mix(in srgb, var(--panel) 92%, transparent);
    backdrop-filter: blur(8px);
  }
  .panel label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-dim); }
  .panel output { font-family: var(--font-mono); color: var(--ink); min-width: 3.5em; }
  .panel input[type=range] { width: 190px; }
  .cs__group { margin: 0 0 34px; }
  .cs__group h2 { font-family: var(--font-display); font-size: 17px; letter-spacing: .04em; margin: 0 0 4px; }
  .cs__group p { margin: 0 0 14px; color: var(--ink-faint); max-width: 78ch; font-size: 13px; }
  .cs__row { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
  .cs__item { margin: 0; display: grid; gap: 6px; justify-items: start; }
  .cs__item figcaption {
    font-size: 12px; color: var(--ink-dim);
    display: flex; gap: 8px; align-items: baseline;
  }
  .cs__item figcaption span { color: var(--ink-faint); font-size: 11px; text-transform: uppercase; letter-spacing: .1em; }
  .cs__missing { color: var(--combat); font-size: 12px; }
  /* Наглядно: половина листа без размытия, чтобы было с чем сравнивать. */
  .is-flat .card__text {
    backdrop-filter: none; -webkit-backdrop-filter: none;
    background: linear-gradient(to bottom,
      rgba(4,6,10,.5) 0%, rgba(4,6,10,.9) 30%, rgba(4,6,10,.95) 100%);
  }
</style>
</head>
<body>
<!--SPRITE-->
<div class="sky" aria-hidden="true">
  <div class="sky__deep"><i class="galaxy galaxy--a"></i><i class="galaxy galaxy--b"></i></div>
  <div class="sky__veil"></div>
</div>
<div class="cs">
  <header class="cs__head">
    <h1>Лист карт: размытие плашки</h1>
    <p>Разметка карт взята из живой игры, стили — настоящий globals.css. Ползунки меняют
      те же переменные, что читает игра, поэтому подобранное здесь значение можно
      перенести в неё как есть.</p>
  </header>

  <div class="panel">
    <label>Размытие
      <input id="blur" type="range" min="0" max="36" step="1" value="0">
      <output id="blurOut">0px</output>
    </label>
    <label>Подложка
      <input id="tint" type="range" min="0" max="1" step="0.02" value="0.36">
      <output id="tintOut">0.36</output>
    </label>
    <label>Ширина карты
      <input id="w" type="range" min="90" max="320" step="2" value="170">
      <output id="wOut">170px</output>
    </label>
    <label><input id="flat" type="checkbox"> Как было раньше (без размытия)</label>
    <button id="reset" type="button" class="btn btn--sm">Значения игры</button>
  </div>

  <!--BODY-->
</div>
<script>
  const root = document.documentElement
  const bind = (id, out, apply) => {
    const el = document.getElementById(id)
    const o = document.getElementById(out)
    const run = () => { o.textContent = apply(el.value); }
    el.addEventListener('input', run)
    run()
  }
  bind('blur', 'blurOut', (v) => { root.style.setProperty('--card-plate-blur', v + 'px'); return v + 'px' })
  bind('tint', 'tintOut', (v) => { root.style.setProperty('--card-plate-tint', v); return v })
  bind('w', 'wOut', (v) => { root.style.setProperty('--card-w-base', v + 'px'); return v + 'px' })
  document.getElementById('flat').addEventListener('change', (e) => {
    document.body.classList.toggle('is-flat', e.target.checked)
  })
  document.getElementById('reset').addEventListener('click', () => {
    for (const [id, val] of [['blur', '0'], ['tint', '0.36'], ['w', '170']]) {
      const el = document.getElementById(id)
      el.value = val
      el.dispatchEvent(new Event('input'))
    }
    document.getElementById('flat').checked = false
    document.body.classList.remove('is-flat')
  })
</script>
</body>
</html>
`

main().catch((e) => { console.error(e); process.exit(1) })
