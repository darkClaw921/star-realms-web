# Star Realms — web

The Star Realms base set, playable in a browser: hot-seat, a heuristic bot, and
online play against another device.

```bash
npm install
npm run fetch-cards     # optional — downloads card art into a local, gitignored folder
npm run dev             # http://localhost:3000
```

`npm run dev` starts a custom Node server that serves the Next.js app and the
Socket.IO endpoint on one port.

## Layout

```
packages/engine/     the rules. pure: no react, no dom, no node, no socket
packages/protocol/   wire schemas (zod) + ENGINE_VERSION
apps/web/            UI, custom server, match registry, bot
```

The engine is written once and reused by all three modes. Hot-seat and the bot run
it in the browser; online runs it on the server. The UI is identical in all three
because each mode hands back the same redacted snapshot.

### Four functions carry the design

```ts
reduce(state, cmd)                  // apply one command
settle(state)                       // run to the next required input
enumerateLegalActions(view, seat)   // defined over the VIEW, not the state
redact(state, seat)                 // project into a distinct PlayerView type
```

`PlayerView` is built field by field rather than copied-and-stripped, so it has no
`rng` and no deck array: a secret added to `GameState` tomorrow cannot reach a
client by accident. Exactly two functions produce bytes for a client — `redact`
and `redactEvent`.

`enumerateLegalActions` takes the view, and the server calls it as
`enumerateLegalActions(redact(state, seat), seat)`. That makes it structurally
impossible for a legal move to depend on hidden information — which is also true
at a physical table. The same generator drives the UI, server validation, the bot
and the fuzz tests.

### Engine purity is enforced, not hoped for

ESLint bans `Date`, `Math.random`, `crypto`, `fetch`, `console`, the DOM and any
outward import inside `packages/engine`, and dependency-cruiser asserts the
structural property in CI. One impure call would make hot-seat, the bot and
online silently diverge, and replays would stop reproducing.

## Commands

```bash
npm test          # engine suite: fuzzed full games, leak properties, rules conformance
npm run lint      # includes the engine purity rules
npm run depcruise # asserts the engine imports nothing outward
npm run build     # next build + esbuild bundle of the custom server
npm run report    # drives a real browser through every mode, writes reports/index.html
```

## Язык

Интерфейс, тексты карт и журнал партии — на русском. Терминология взята из
официальных правил русского издания «Звёздные империи» (Hobby World): очки
торговли / боя / влияния, торговый ряд, торговая колода, личная колода, стопка
сброса, утиль, аванпост, первичное / союзное / утилизационное свойство,
разведчик, штурмовик, исследователь.

Названия карт — наш перевод, кроме подтверждённых правилами («Техномир»,
«Разведчик», «Штурмовик», «Исследователь»): публичного списка названий русского
издания найти не удалось, поэтому они могут расходиться с коробочными. На
механику это не влияет — движок оперирует идентификаторами, а не текстом.

Локализация живёт в `apps/web/src/i18n/`. Движок свободен от языка: он присылает
вид запроса и границы выбора (`prompt`, `min`, `max`), а формулировку целиком
строит интерфейс, поэтому добавление второго языка не затрагивает правила.

Дисплейный шрифт — Fira Sans Condensed, а не IBM Plex Sans Condensed: у второго
в Google Fonts есть только `cyrillic-ext`, без базовой кириллицы, и названия карт
падали бы на системный шрифт.

## Настройки отображения

Кнопка с шестерёнкой на столе открывает панель: размер карт и отдельно размер
текста на них. Значения сохраняются в `localStorage` этого браузера.

Хранятся **множители**, а не абсолютные пиксели. Ширина карты собирается как
`calc(var(--card-w-base) * var(--card-scale))`: база остаётся адаптивной
(медиазапросы уменьшают её на узких экранах), а выбор игрока накладывается
поверх. Абсолютное значение, выставленное на десктопе, приехало бы на телефон
как есть.

Сохранённый масштаб применяется инлайн-скриптом в `layout.tsx` до первой
отрисовки — иначе карты успевают появиться в размере по умолчанию и на глазах
перескакивают. Из-за этого на `<html>` стоит `suppressHydrationWarning`.

Всё внутри карты задано в `cqi`, поэтому масштабируется целиком, а уровни
плотности (проза → иконочная сводка → миниатюра) остаются привязанными к
фактической ширине: увеличив карты на телефоне, игрок автоматически получает
полный текст.

## Card data

Composition verified card by card against the publisher's own Card Gallery
spreadsheet: 46 distinct trade-deck cards, 80 copies, exactly 20 per faction.
Four points where popular fan sources disagree with the publisher are corrected in
`packages/engine/src/cards/registry.ts` — see the comment at the top of that file.

## Artwork licence

Star Realms art, card names and trade dress are © Wise Wizard Games, and there is
no fan-content licence. `npm run fetch-cards` downloads the images to
`apps/web/public/cards/art/`, which is gitignored: they are for local personal use
and must not be committed, deployed publicly, packaged or redistributed.

The game is fully playable without them. A missing image is simply an absent key
in the generated manifest, and the card falls back to a procedural treatment keyed
to its faction. Card statistics and game mechanics are facts rather than
copyrightable expression, so the engine and its data are unencumbered.
