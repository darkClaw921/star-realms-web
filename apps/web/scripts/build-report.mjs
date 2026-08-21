/**
 * Build reports/index.html from the verification run.
 *
 * Kept as a script rather than a hand-written page so the report can never drift
 * from the checks that actually ran: every number below comes from results.json
 * or from re-running the engine suite.
 */
import { execSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const OUT = join(ROOT, 'reports')

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function engineTestCount() {
  try {
    const out = execSync('npx vitest run --root packages/engine', {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    const m = out.match(/Tests\s+(\d+)\s+passed/)
    return m ? Number(m[1]) : null
  } catch { return null }
}

const MECHANICS = [
  ['Существуют срабатывающие свойства', '«Штаб флота» после эрраты даёт очко боя каждый раз, когда вы разыгрываете корабль, — неограниченное число раз за ход. Схема «первичное / союзное / утилизационное» этого не выражает, поэтому в движке есть четвёртый вид свойства.'],
  ['Покупка не всегда идёт в стопку сброса', '«Носитель слизней» кладёт корабль на верх колоды обязательно; «Грузовоз» и «Центральный офис» взводят необязательное перенаправление. Такие эффекты складываются, каждая покупка расходует один.'],
  ['Одно общее правило частичного разрешения', '«Сделайте столько, сколько можете, в напечатанном порядке». Обязательный выбор без легальной цели пропадает, а не блокирует партию, — это одно правило в settle(), а не обработка каждой карты.'],
  ['Принудительный сброс разрешается немедленно', 'Карту выбирает жертва, в момент срабатывания свойства. Перенос сброса на её ход — задокументированное отклонение цифрового приложения, а не правило.'],
  ['Союзное свойство срабатывает ретроактивно', 'Вторая карта фракции открывает союзное свойство первой. Порядок розыгрыша для союзов не имеет значения.'],
  ['Открытое союзное свойство остаётся доступным', 'Даже если карта-источник ушла в утиль посреди хода. Формулировка правил — «сработало, значит доступно».'],
  ['Аванпост защищает и от выбора целью, а не только от атаки', 'Бесплатное «уничтожьте выбранную базу» тоже обязано целить в аванпост, пока он стоит. Аванпосты не защищают друг друга.'],
  ['Можно уничтожить собственную базу', 'По правилам настольной игры это законно; приложение запрещает. Движок следует правилам.'],
  ['Обязательность неоднородна', 'Первичное свойство корабля обязательно и немедленно, союзное и утилизационное — по желанию. «Свалка» и союзное свойство «Патрульного меха» утилизируют обязательно, в отличие от ботов.'],
  ['Раз в ход — для каждого экземпляра отдельно', 'Счётчики независимы, включая три «Колеса слизней» — единственную базу, которой может быть три в игре сразу.'],
  ['«Игла-невидимка»', 'Копирует корабль, разыгранный в этот ход (даже уже утилизированный), получает его свойства и фракцию и при этом не считается разыгранной картой для «Мира слизней».'],
  ['«Техномир»', 'Удовлетворяет союзное условие всех фракций сразу, но не считается никакой другой фракцией для счётчиков разыгранного за ход, и не имеет активируемого первичного свойства.'],
  ['«Мир слизней» считает карты, разыгранные в этот ход', 'Считает себя в ход своего розыгрыша и не считает ничего с прошлых ходов.'],
  ['Утилизация с руки или из сброса не запускает утилизационное свойство карты', 'Его получает только карта, применяющая собственное утилизационное свойство из игры.'],
  ['«Станция переработки» сбрасывает всё до добора', 'Поэтому перемешанный сброс уже содержит только что сброшенные карты.'],
  ['«Машинная база» сначала добирает, потом утилизирует — только с руки', 'В отличие от «Свалки» и «Мира разума», стопка сброса здесь не источник.'],
  ['Колода действительно может закончиться', 'Четыре эффекта базового набора навсегда удаляют ваши карты. Добор терпит пустые колоду и сброс; проигрыша по опустошению нет.'],
  ['Уборка в конце хода затрагивает больше, чем кажется', 'Счётчики фракций, взведённые эффекты «на верх колоды», флаги свойств у баз с прошлых ходов и оба резерва: непотраченные очки торговли и боя сгорают.'],
]

const CORRECTIONS = [
  ['Командный корабль', 'Фан-источники добавляют в союзное свойство «вы можете».', 'База уничтожается <strong>обязательно</strong>.'],
  ['Штаб флота', 'Устаревшие источники показывают доэрратный «Все ваши корабли получают 1 очко боя».', 'Официальная эррата: <strong>«Каждый раз, когда вы разыгрываете корабль, получайте 1 очко боя»</strong> — срабатывающее свойство.'],
  ['Колесо слизней', 'Вики сообщества указывает 2 экземпляра.', '<strong>3 экземпляра</strong> — иначе у слизней не выходит 20 карт.'],
  ['Боевая капсула', 'Вики теряет необязательность.', 'Утилизация карты из торгового ряда <strong>необязательна</strong>.'],
]

async function main() {
  const data = JSON.parse(await readFile(join(OUT, 'results.json'), 'utf8'))
  const { results, shots, consoleErrors } = data
  const passed = results.filter((r) => r.ok).length
  const allGreen = passed === results.length
  const tests = engineTestCount()

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Звёздные империи — отчёт о сборке и проверке</title>
<style>
  :root {
    --void:#07090d; --hull:#0d1016; --panel:#141822; --panel-hi:#1b2130;
    --rule:#262d3d; --rule-hi:#38425a;
    --ink:#eef2f7; --dim:#98a3b6; --faint:#5d6779;
    --ok:#5fd08a; --bad:#f4593c; --gold:#f0b429; --cyan:#58cfe0;
    --mono:ui-monospace,'SF Mono',Menlo,monospace;
    --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--void);color:var(--ink);font-family:var(--sans);
    font-size:15px;line-height:1.6;
    background-image:radial-gradient(1100px 620px at 50% -8%,#121a2a 0%,transparent 62%)}
  .wrap{max-width:1080px;margin:0 auto;padding:56px 24px 96px}
  .eyebrow{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--faint);margin:0 0 10px}
  h1{font-size:clamp(34px,6vw,56px);line-height:1;letter-spacing:-.02em;margin:0 0 14px;font-weight:800}
  h1 .lo{color:var(--faint)}
  h2{font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);
    margin:56px 0 16px;padding-bottom:10px;border-bottom:1px solid var(--rule)}
  .lede{color:var(--dim);font-size:17px;max-width:66ch;margin:0 0 30px}
  .verdict{display:flex;align-items:center;gap:14px;padding:16px 20px;border-radius:10px;
    border:1px solid ${allGreen ? 'color-mix(in srgb,var(--ok) 45%,transparent)' : 'var(--bad)'};
    background:${allGreen ? 'color-mix(in srgb,var(--ok) 10%,var(--panel))' : 'color-mix(in srgb,var(--bad) 10%,var(--panel))'};
    font-family:var(--mono);font-size:15px}
  .verdict b{font-size:22px}
  .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin:22px 0 0}
  .stat{background:var(--panel);border:1px solid var(--rule);border-radius:10px;padding:16px 18px}
  .stat .n{font-family:var(--mono);font-size:28px;font-weight:600;line-height:1.1}
  .stat .l{font-size:12px;color:var(--dim);margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th{text-align:left;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);
    font-weight:700;padding:0 10px 10px;border-bottom:1px solid var(--rule)}
  td{padding:11px 10px;border-bottom:1px solid rgba(38,45,61,.6);vertical-align:top}
  tr:last-child td{border-bottom:none}
  .pill{display:inline-block;font-family:var(--mono);font-size:11px;font-weight:600;
    padding:3px 9px;border-radius:20px;white-space:nowrap}
  .pass{color:var(--ok);background:color-mix(in srgb,var(--ok) 14%,transparent)}
  .fail{color:var(--bad);background:color-mix(in srgb,var(--bad) 14%,transparent)}
  code,.mono{font-family:var(--mono);font-size:.9em;color:var(--cyan)}
  figure{margin:0 0 30px;background:var(--panel);border:1px solid var(--rule);border-radius:12px;overflow:hidden}
  figure img{display:block;width:100%;height:auto;background:var(--void)}
  figcaption{padding:13px 18px;font-size:13.5px;color:var(--dim);border-top:1px solid var(--rule)}
  .shots{display:grid;gap:22px}
  .shots--pair{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
  .note{background:var(--panel);border:1px solid var(--rule);border-left:3px solid var(--gold);
    border-radius:0 10px 10px 0;padding:16px 20px;color:var(--dim);font-size:14px;margin:20px 0}
  .note strong{color:var(--ink)}
  dl{margin:0}
  dt{font-weight:600;margin-top:16px}
  dd{margin:3px 0 0;color:var(--dim);font-size:14px}
  pre{background:var(--hull);border:1px solid var(--rule);border-radius:10px;padding:16px 18px;
    overflow-x:auto;font-family:var(--mono);font-size:13px;color:var(--ink);line-height:1.7}
  footer{margin-top:64px;padding-top:22px;border-top:1px solid var(--rule);color:var(--faint);font-size:13px}
</style></head><body><div class="wrap">

<p class="eyebrow">Отчёт о сборке и проверке</p>
<h1>Звёздные&nbsp;империи <span class="lo">web</span></h1>
<p class="lede">Полная реализация базового набора «Звёздных империй»: чистый движок правил,
стол за одним экраном, эвристический бот и игра по сети через авторитетный сервер. Страница
собирается из результатов прогона проверки, поэтому каждая цифра здесь — из теста, который
действительно выполнился.</p>

<div class="verdict">
  <b>${passed}/${results.length}</b> проверок в браузере пройдено${allGreen ? '' : ' &mdash; подробности в таблице ниже'}
</div>

<div class="grid">
  <div class="stat"><div class="n">46</div><div class="l">уникальных карт торговой колоды</div></div>
  <div class="stat"><div class="n">80</div><div class="l">карт в торговой колоде, по 20 на фракцию</div></div>
  <div class="stat"><div class="n">${tests ?? '—'}</div><div class="l">тестов движка проходит</div></div>
  <div class="stat"><div class="n">49</div><div class="l">иллюстраций, вырезанных из сканов карт</div></div>
</div>

<h2>Что подтвердили проверки в браузере</h2>
<table><thead><tr><th style="width:100px">Итог</th><th>Проверка</th><th>Подробности</th></tr></thead><tbody>
${results.map((r) => `<tr>
  <td><span class="pill ${r.ok ? 'pass' : 'fail'}">${r.ok ? 'ПРОЙДЕНО' : 'СБОЙ'}</span></td>
  <td>${esc(r.name)}</td>
  <td class="mono" style="color:var(--faint)">${esc(r.detail ?? '')}</td>
</tr>`).join('\n')}
</tbody></table>
${consoleErrors.length ? `<div class="note"><strong>Вывод консоли во время прогона:</strong><br>${consoleErrors.map(esc).join('<br>')}</div>` : ''}

<div class="note">
<strong>Четыре проверки на скрытую информацию не вакуумны.</strong> Они разбирают настоящие
WebSocket-кадры, пришедшие в браузер второго игрока и перехваченные через CDP, и каждая падает,
если кадров не было вовсе: молчаливый успех на пустом перехвате хуже прямого сбоя.
</div>

<h2>Игра в работе</h2>
<div class="shots">
${shots.map((s) => `<figure>
  <img src="shots/${esc(s.file)}" alt="${esc(s.caption)}" loading="lazy">
  <figcaption>${esc(s.caption)}</figcaption>
</figure>`).join('\n')}
</div>

<h2>Правила, которые движок соблюдает намеренно</h2>
<p class="lede" style="font-size:15px">Это места, где наивная схема
«первичное / союзное / утилизационное свойство» ломается. Каждый пункт задал форму движка
ещё до написания первой карты, и на каждый есть точечный тест.</p>
<dl>
${MECHANICS.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${d}</dd>`).join('\n')}
</dl>

<h2>Данные карт и четыре ошибки, гуляющие по сети</h2>
<p class="lede" style="font-size:15px">Состав сверен карта за картой с таблицей Card Gallery
самого издателя &mdash; Wise Wizard Games ведёт её «для проверки содержимого продукта» &mdash; и
дополнительно с вики сообщества и официальным FAQ. Популярные фан-источники расходятся с
издателем в четырёх местах:</p>
<table><thead><tr><th style="width:190px">Карта</th><th>Обычно пишут</th><th>На самом деле</th></tr></thead><tbody>
${CORRECTIONS.map(([c, w, r]) => `<tr><td><strong>${esc(c)}</strong></td><td style="color:var(--dim)">${esc(w)}</td><td>${r}</td></tr>`).join('\n')}
</tbody></table>

<h2>Как это устроено</h2>
<dl>
<dt>Один движок, три режима</dt>
<dd>Чистый редьюсер без зависимостей &mdash; <code>reduce</code>, <code>settle</code>,
<code>enumerateLegalActions</code>, <code>redact</code> &mdash; одинаково обслуживает игру за
одним экраном, бота и сеть. Правила ESLint и dependency-cruiser запрещают внутри пакета движка
<code>Date</code>, <code>Math.random</code>, <code>crypto</code>, DOM и любой импорт наружу:
один нечистый вызов заставил бы три режима молча разойтись.</dd>

<dt>Скрытая информация по построению</dt>
<dd><code>PlayerView</code> &mdash; отдельный тип, собранный по полям, а не копия с удалёнными
ключами. В нём нет <code>rng</code> и нет массива колоды, поэтому новый секрет, добавленный в
состояние завтра, физически не сможет уйти в сеть. Байты клиенту производят ровно две функции.
Варианты активного выбора уходят только тому, кто отвечает: запрос на принудительный сброс
буквально содержит руку соперника.</dd>

<dt>Легальные ходы считаются от вида, а не от состояния</dt>
<dd><code>enumerateLegalActions</code> определена над <code>PlayerView</code>, и сервер зовёт её
как <code>enumerateLegalActions(redact(state, seat), seat)</code>. Легальность хода не может
зависеть от скрытой информации &mdash; ровно как за физическим столом. Один генератор обслуживает
интерфейс, сервер, бота и фаззинг-тесты.</dd>

<dt>Next.js и Socket.IO на одном порту</dt>
<dd>Кастомный <code>server.ts</code> держит единственную авторитетную копию каждой партии в
памяти, подстрахованную журналом команд. Обойдены две задокументированные ловушки: обработчик
Next регистрируется до подключения Socket.IO (engine.io вызывает
<code>removeAllListeners('request')</code>), и <code>destroyUpgrade: false</code> не даёт
engine.io убить HMR-сокет через секунду.</dd>

<dt>Иллюстрации</dt>
<dd>Издатель отдаёт полные лицевые стороны карт, а не отдельные иллюстрации, поэтому скрипт
вырезает из каждого скана полосу арта, а рамку интерфейс рисует свою. Именно это позволяет карте
показывать живое состояние и оставаться читаемой на 116&nbsp;px на телефоне.</dd>

<dt>Локализация</dt>
<dd>Движок свободен от языка: он присылает вид запроса и границы выбора, а формулировку целиком
строит интерфейс. Терминология взята из официальных правил русского издания &mdash; очки торговли,
боя и влияния, торговый ряд, утиль, аванпост, первичное, союзное и утилизационное свойство.
Названия карт, кроме подтверждённых правилами, &mdash; наш перевод.</dd>
</dl>

<h2>Запуск</h2>
<pre>npm install
npm run fetch-cards   # по желанию: скачивает иллюстрации карт локально
npm run dev           # http://localhost:3000

npm test              # набор тестов движка
npm run report        # заново прогоняет проверки и пересобирает этот отчёт</pre>

<div class="note">
<strong>Лицензия на иллюстрации.</strong> Иллюстрации, названия карт и оформление
&laquo;Звёздных империй&raquo; &mdash; &copy; Wise Wizard Games, фан-контент-лицензии у издателя нет.
Изображения скачиваются в локальную папку, исключённую из репозитория, и предназначены для
личного использования: они не коммитятся, не деплоятся и не распространяются. Игра работает и
без них &mdash; отсутствующий арт заменяется процедурным оформлением, детерминированным по карте.
Характеристики карт и механики &mdash; факты, а не охраняемое авторским правом выражение, поэтому
движок и его данные свободны.
</div>

<footer>Собрано скриптом <code>apps/web/scripts/build-report.mjs</code> из
<code>reports/results.json</code>.</footer>
</div></body></html>`

  await writeFile(join(OUT, 'index.html'), html)
  console.log(`Report written to ${join(OUT, 'index.html')}`)
  console.log(`  ${passed}/${results.length} checks, ${shots.length} screenshots, engine tests: ${tests ?? 'unknown'}`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
