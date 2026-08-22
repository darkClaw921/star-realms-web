import type { PendingChoiceView } from '@sr/engine'

/**
 * Строки интерфейса.
 *
 * Термины — из официальных правил русского издания: очки торговли / боя /
 * влияния, торговый ряд, торговая колода, личная колода, стопка сброса, утиль,
 * аванпост, первичное / союзное / утилизационное свойство.
 */
export const UI = {
  // меню
  eyebrow: 'Базовый набор · торговая колода из 80 карт',
  titleTop: 'Звёздные',
  titleBottom: 'империи',
  lede: 'Полный базовый набор. Все союзные свойства, утилизация и правила ' +
    'аванпостов проверяет движок, а не игроки.',
  modeBot: 'Игра против бота',
  modeBotDesc: 'Один человек против эвристического соперника. Работает целиком в этом браузере.',
  modeHotseat: 'За одним экраном',
  modeHotseatDesc: 'Двое игроков по очереди. Между ходами руки скрыты.',
  modeOnline: 'Игра по сети',
  modeOnlineDesc: 'Два устройства, один авторитетный сервер. Поделитесь кодом комнаты.',
  legal: 'Иллюстрации карт — © Wise Wizard Games, они загружаются из локальной папки ' +
    'для личного использования. Удалите public/cards/art — игра продолжит работать, ' +
    'карты получат процедурное оформление.',

  // сеть
  onlineEyebrow: 'Два устройства · авторитетный сервер',
  onlineTitleTop: 'Игра',
  onlineTitleBottom: 'по сети',
  onlineLede: 'Полная копия партии хранится только на сервере. Рука соперника и обе ' +
    'колоды в ваш браузер не попадают.',
  createMatch: 'Создать партию',
  createMatchDesc: 'Вы получите код комнаты, которым можно поделиться. Вы ходите первым.',
  joinMatch: 'Войти по коду',
  joinMatchDesc: 'Введите код из пяти символов.',
  roomCodeLabel: 'Код комнаты',
  join: 'Войти',
  connecting: 'Подключаемся…',
  serverHint: 'Обоим игрокам нужен этот запущенный сервер.',
  back: 'Назад',
  waitingOpponent: 'Ждём соперника — код комнаты',

  // стол
  dealing: 'Раздаём…',
  loading: 'Загрузка…',
  nothingInPlay: 'Ничего не разыграно',
  tradeRow: 'Торговый ряд',
  inTradeDeck: (n: number): string => `в торговой колоде: ${n}`,
  explorersLeft: (n: number): string => `осталось: ${n}`,
  inPlay: 'В игре',
  log: 'Журнал',
  handEmpty: 'Рука пуста',

  // кампания
  modeCampaign: 'Кампания',
  modeCampaignDesc: 'Двенадцать вылетов с особыми условиями: свои колоды, свой набор карт и цели помимо обычной победы.',
  campaignEyebrow: 'Три кампании · двенадцать вылетов',
  campaignTitleTop: 'Боевые',
  campaignTitleBottom: 'вылеты',
  campaignLede: 'Каждый вылет — партия против бота с изменёнными начальными условиями. ' +
    'Правила проверяет тот же движок, что и обычную игру; меняется расстановка, ' +
    'набор карт и то, что считается победой.',
  campaignReset: 'Сбросить прогресс',
  missionStart: 'В бой',
  missionReplay: 'Ещё раз',
  missionBeaten: 'Пройден',
  missionLocked: 'Откроется после предыдущего вылета.',
  missionFailed: 'Вылет провален',
  missionComplete: 'Вылет пройден',
  objectiveLabel: 'Задача',
  toCampaign: 'К вылетам',

  // наборы карт
  setsName: 'Наборы карт',
  setsHint: 'Влияет только на НОВЫЕ партии: менять состав торговой колоды посреди игры — ' +
    'значит менять правила на ходу. Последний включённый набор выключить нельзя.',
  setName: {
    core: 'Базовый набор',
    frontiers: 'Frontiers',
    'colony-wars': 'Colony Wars',
    'crisis-bases': 'Crisis: Базы и линкоры',
    'crisis-fleets': 'Crisis: Флоты и крепости',
    'crisis-heroes': 'Crisis: Герои',
    'crisis-events': 'Crisis: События',
    'united-assault': 'United: Штурм',
    'united-command': 'United: Командование',
    'united-heroes': 'United: Герои',
    'high-alert-first-strike': 'High Alert: Первый удар',
    'high-alert-tech': 'High Alert: Технологии',
    'high-alert-requisition': 'High Alert: Реквизиция',
    'high-alert-invasion': 'High Alert: Вторжение',
    'high-alert-heroes': 'High Alert: Герои',
    'stellar-allies': 'Stellar Allies',
    'promo-1': 'Промо-набор 1',
    'promo-year-2': 'Промо-набор второго года',
    'frontiers-promos': 'Frontiers: промо с Kickstarter',
    gambits: 'Гамбиты',
    'cosmic-gambits': 'Cosmic Gambit',
    missions: 'United: Миссии',
    'command-decks': 'Командные колоды',
  } as Record<string, string>,
  cardsInDeck: (n: number): string => `${n} карт в колоде`,

  // отложенные карты («Терпение вознаграждено»)
  setAside: 'Отложено',
  setAsideTitle: (name: string): string =>
    `«${name}» отложена — её можно купить до конца партии`,

  // гамбиты и миссии
  gambitFaceDown: 'Гамбит (закрыт)',
  gambitRevealed: 'Гамбит раскрыт',
  revealGambit: (name: string): string => `Раскрыть гамбит «${name}»`,
  missionOpen: 'Миссия',
  claimMission: (name: string): string => `Выполнить миссию «${name}»`,
  missionPending: (name: string): string => `«${name}» — задача ещё не выполнена`,
  missionsDone: (done: number, total: number): string => `Миссий выполнено: ${done} из ${total}`,
  variantName: 'Сценарий',
  variantHint: 'Сценарий меняет одно правило на всю партию — для обоих игроков. ' +
    'Все двадцать карт набора «Scenarios» реализованы; текст каждой снят со ' +
    'скана карты у издателя.',
  variantRu: {
    '': 'Без сценария',
    'total-war': 'Тотальная война — раз в ход: 1 торговли → 3 боя',
    'maximum-warp': 'Максимальный варп — в начале хода доберите карту',
    'emergency-repairs': 'Срочный ремонт — раз в ход: 1 торговли → замешать сброс в колоду',
    'ruthless-efficiency': 'Безжалостная эффективность — 1 торговли: утилизировать карту с руки',
    'rushed-defenses': 'Спешная оборона — базы сразу в игру, уничтоженные в утиль',
    'recruiting-drive': 'Набор рекрутов — корабли на верх колоды, базы на 1 дешевле',
    'entrenched-loyalties': 'Укоренившаяся верность — своя фракция на 1 дешевле',
    'commitment-to-the-cause': 'Верность делу — стартовые корабли дают на 1 больше',
    'frontier-expedition': 'Пограничная экспедиция — два разведчика заменены исследователями',
    'frantic-preparations': 'Лихорадочные сборы — из колоды убраны разведчик и штурмовик',
    'flare-mining': 'Добыча на вспышках — раз в ход: 1 торговли → добрать и сбросить карту',
    'buyers-market': 'Рынок покупателя — на самых дорогих картах ряда копятся скидки',
    'rapid-construction': 'Быстрая стройка — первая покупка за ход ложится на верх колоды',
    'border-skirmish': 'Пограничная стычка — каждый начинает на 20 авторитета меньше',
    'prolonged-conflict': 'Затяжной конфликт — каждый начинает на 30 авторитета больше',
    'warpgate-nexus': 'Узел варп-врат — в торговом ряду две лишние карты',
    'fleeting-opportunities': 'Мимолётные возможности — в начале хода дальняя карта ряда утилизируется',
    'ready-reserves': 'Готовые резервы — рука не сбрасывается, но за каждую оставленную карту добираете на одну меньше',
    'early-recruitment': 'Ранний набор — каждому по две карты стоимостью 1, по одной на фракцию',
    'picking-sides': 'Выбор стороны — то же самое, но карты стоимостью 2',
  } as Record<string, string>,
  commandDeckName: 'Командная колода',
  commandDeckNone: 'Без командной колоды',
  commandDeckHint: 'Заменяет вашу стартовую колоду: свои десять карт, свой размер руки ' +
    'и свой стартовый авторитет, два гамбита в начале и один восьмистоимостный корабль ' +
    'в торговую колоду. Соперник играет обычной колодой.',
  commandDeckRu: {
    '': 'Без командной колоды',
    alliance: 'Альянс — директор флота Нанди',
    alignment: 'Согласие — божественный адмирал Ле',
    coalition: 'Коалиция — верховный директор Валкен',
    pact: 'Пакт — оверлорд Ньюберг',
    union: 'Союз — адмирал улья Маккриди',
    unity: 'Единство — биолорд Уолш',
    'lost-fleet': 'Потерянный флот — верховный адмирал Йохум',
  } as Record<string, string>,
  gambitsName: 'Гамбиты',
  gambitsHint: 'Сколько гамбитов раздать каждому игроку в начале партии. ' +
    'Нужен включённый набор с гамбитами.',
  missionsName: 'Миссии',
  missionsHint: 'Сколько миссий раздать каждому игроку. Выполнив все свои миссии, ' +
    'вы побеждаете — это второе условие победы. Нужен включённый набор «United: Миссии».',

  // приключения Frontiers
  modeChallenges: 'Приключения',
  modeChallengesDesc: 'Восемь боссов из набора Frontiers, у каждого своя механика. Соло, четыре уровня сложности.',
  challengesEyebrow: 'Восемь боссов · соло',
  challengesTitleTop: 'Приключения',
  challengesTitleBottom: 'Frontiers',
  challengesLede: 'Соло-приключения из набора Star Realms: Frontiers. Расстановка, ' +
    'порядок хода босса, его алгоритм выбора целей и уровни сложности взяты из ' +
    'официальной книги правил.',
  challengesSource: 'Правила взяты из книги правил Star Realms: Frontiers (стр. 21–40) ' +
    'и с самих карт-приключений — лицевых сторон (таблицы фракционных способностей) ' +
    'и оборотных (особые правила). Приключения играются на торговой колоде Frontiers, ' +
    'как и задумано набором. Единственное отличие от коробки — игра одиночная: ' +
    'числа «за каждого игрока» взяты для одного, а правила для нескольких не реализованы.',
  difficultyLabel: 'Сложность',
  bossAuthority: 'Авторитет босса',
  yourAuthority: 'Ваш авторитет',
  tentaclesInstead: 'нет — щупальца',
  ourReconstruction: 'Отличие от коробки:',
  mulliganRow: 'Сменить торговый ряд',
  mulliganHint: 'Один раз за приключение',
  attackTentacle: 'Атаковать щупальце',
  tentacles: 'Щупальца',
  assimilation: 'Ассимиляция',
  facedown: 'Поглощено карт',
  challengeWon: 'Босс повержен',
  challengeLost: 'Приключение провалено',
  toChallenges: 'К приключениям',

  // просмотр карты
  previewHint: 'Двигайте мышью, чтобы наклонить карту',
  previewClose: 'Закрыть',
  playAllShips: 'Разыграть все корабли',
  endTurn: 'Завершить ход',
  quit: 'Выйти',
  attackFor: (n: number): string => `Атака на ${n}`,
  destroyFor: (n: number): string => `Уничтожить · ${n}`,
  buyFor: (name: string, n: number): string => `Купить «${name}» за ${n}`,
  costs: (name: string, n: number): string => `«${name}» — стоит ${n}`,
  destroyTitle: (name: string, n: number): string => `Уничтожить «${name}» (${n} очк. боя)`,
  explorerTitle: 'Исследователь — всегда доступен за 2 очка торговли',
  botThinking: 'Бот думает…',

  // свойства карт (кнопки под разыгранной картой)
  slotPrimary: 'Применить',
  slotDoubleAlly: 'Двойной союз',
  slotAlly: 'Союзное',
  slotAlly2: 'Союзное 2',
  slotAlly3: 'Союзное 3',
  slotAlly4: 'Союзное 4',
  slotSplinter: 'Сплинтер',
  slotScrap: 'Утиль',

  // передача устройства
  passEyebrow: 'Передайте устройство',
  passHint: 'Карты скрыты, пока не начнётся ваш ход.',
  ready: 'Я готов',

  // конец партии
  gameOver: 'Партия окончена',
  wins: (name: string): string => `${name} побеждает`,
  toMenu: 'В меню',

  // HUD
  authority: 'Влияние',
  trade: 'Торговля',
  combat: 'Бой',
  allyPips: 'Союзные свойства, открытые в этот ход',
  deckDiscard: (deck: number, discard: number): string => `Колода ${deck} · Сброс ${discard}`,
  handDeckDiscard: (hand: number, deck: number, discard: number): string =>
    `Рука ${hand} · Колода ${deck} · Сброс ${discard}`,
  outpostShield: 'Защита аванпоста',
  // ── Командное прохождение ──────────────────────────────────────────────
  eliminated: 'выбыл',
  allies: 'Команда',
  giveTradeHint: 'Передать всю торговлю союзнику',
  giveCombatHint: 'Передать весь бой союзнику',
  teamWins: 'Команда побеждает',
  bossWins: 'Босс побеждает',
  coopHydra: 'Гидра: общий счёт влияния и общий ход',
  coopPooled: 'Общий ход, влияние у каждого своё',
  coopIndividual: 'Ходы по очереди; босс отвечает тому, чей ход закончился',
  waitingForPlayers: (n: number): string =>
    n === 1 ? 'Ждём ещё одного игрока' : `Ждём ещё ${n} игроков`,
  coopTitle: 'Командное приключение',
  gatherTeam: 'Собрать команду',
  soloHint: 'Одиночное прохождение — играется прямо здесь',
  capAt: (n: number): string => `на этом вызове максимум ${n}`,
  coopSub: 'Соберите команду и пройдите вызов Frontiers вместе.',
  players: 'Игроков',
  teamMode: 'Правила команды',
  shareCode: 'Код стола',
  seatOf: (i: number): string => `Место ${i}`,

  // окно выбора
  waitingForOther: 'Ждём соперника',
  chooseExactly: (n: number): string => `Выберите ровно ${n}`,
  chooseRange: (a: number, b: number): string => `Выберите от ${a} до ${b}`,
  yes: 'Да',
  no: 'Нет',
  confirm: 'Подтвердить',
  skip: 'Пропустить',
  explorer: 'Исследователь',

  // имена мест
  you: 'Вы',
  bot: 'Бот',
  opponent: 'Соперник',
  playerOne: 'Игрок 1',
  playerTwo: 'Игрок 2',

  // настройки
  settings: 'Настройки',
  settingsSaved: 'Сохраняются в этом браузере',
  // ── вкладки панели настроек ────────────────────────────────────────────
  tabView: 'Отображение',
  tabSets: 'Наборы карт',
  tabRules: 'Правила партии',
  dealName: 'Раздача',
  lastSetLocked: 'Последний включённый набор выключить нельзя — колода останется пустой',
  setsOn: (on: number, all: number): string => `включено ${on} из ${all}`,
  setSizeCards: (n: number): string => `${n} карт`,
  setSizeGambits: (n: number): string => `${n} гамбитов`,
  setSizeMissions: (n: number): string => `${n} миссий`,
  setSizeDecks: (n: number): string => `${n} колод`,
  askedBy: 'Свойство карты',
  setHoldHint: 'Удержите набор, чтобы рассмотреть все его карты',
  setGalleryHint: 'Удержите карту, чтобы увеличить',
  setGalleryCount: (n: number): string => `${n} уникальных карт`,
  setGalleryCopies: (n: number): string => `×${n}`,
  setGalleryEmpty: 'В этом наборе нет карт, которые можно показать',
  galleryRole: {
    trade_deck: 'Торговая колода',
    starter: 'Стартовые',
    explorer: 'Исследователи',
    gambit: 'Гамбиты',
    mission: 'Миссии',
    token: 'Жетоны',
    command: 'Командные колоды',
    commander: 'Командиры',
  } as Record<string, string>,
  cardSize: 'Размер карт',
  cardSizeHint: 'Масштабирует карту целиком: иллюстрацию, текст и значки. ' +
    'Накладывается поверх размера, подобранного под ширину экрана.',
  textSize: 'Размер текста на картах',
  textSizeHint: 'Дополнительно увеличивает только текст свойств — если хочется ' +
    'компактные карты, но читаемые описания.',
  preview: 'Предпросмотр',
  done: 'Готово',
  resetSettings: 'Сбросить',
  openSettings: 'Настройки',

  rejected: (msg: string): string => `Отклонено: ${msg}`,
  botError: (msg: string): string => `Ошибка бота: ${msg}`,
} as const

/**
 * Заголовок окна выбора выводится из вида запроса, а не из строки движка.
 *
 * Движок остаётся свободным от локали: он присылает `prompt`, `min` и `max`, а
 * язык — целиком забота интерфейса.
 */
export function promptTitle(c: PendingChoiceView, sourceName: string | null): string {
  const n = c.max
  switch (c.prompt) {
    case 'DISCARD':
      return n === 1 ? 'Сбросьте карту' : `Сбросьте ${n} карты`
    // ── Frontiers ──────────────────────────────────────────────────────────
    case 'SCRAP_ROW_FOR_COMBAT':
      return 'Утилизируйте карту из торгового ряда — получите очки боя, равные её стоимости'
    case 'SCRAP_FOR_COMBAT':
      return 'Утилизируйте карту — получите очки боя, равные её стоимости'
    case 'TOPDECK_BASE':
      return 'Положите базу из стопки сброса на верх своей колоды'
    case 'DISCARD_FOR_COMBAT':
      return 'Сбросьте сколько хотите карт — по 2 очка боя за каждую'
    case 'SCRAP_ZONES':
      return c.min === 0
        ? 'Можете утилизировать карту с руки или из стопки сброса'
        : 'Утилизируйте карту с руки или из стопки сброса'
    case 'SCRAP_TRADE_ROW':
      return c.min === 0
        ? 'Можете утилизировать карту из торгового ряда'
        : 'Утилизируйте карту из торгового ряда'
    case 'DESTROY_BASE':
      return c.min === 0 ? 'Можете уничтожить выбранную базу' : 'Уничтожьте выбранную базу'
    case 'CHOOSE_BRANCH':
      return 'Выберите одно'
    case 'ACQUIRE_FREE':
      return 'Получите карту бесплатно'
    case 'COPY_SHIP':
      return 'Скопируйте корабль, разыгранный в этот ход'
    case 'DISCARD_THEN_DRAW':
      return `Сбросьте до ${n} карт, затем доберите столько же`
    case 'SCRAP_THEN_DRAW':
      return `Утилизируйте до ${n} карт, затем доберите по одной за каждую`
    case 'REDIRECT_ACQUIRED':
      // Формулировка не называет направление: их может быть два сразу — на верх
      // колоды и в руку, — и выбирает игрок.
      return sourceName
        ? `Куда отправить «${sourceName}»?`
        : 'Куда отправить купленную карту?'
    case 'MAY':
      return 'Применить свойство?'
    // ── Colony Wars ────────────────────────────────────────────────────────
    case 'COPY_BASE':
      return 'Скопируйте любую базу в игре'
    // ── Crisis ─────────────────────────────────────────────────────────────
    case 'RETURN_BASE_TO_HAND':
      return c.min === 0
        ? 'Можете вернуть выбранную базу в руку её владельца'
        : 'Верните выбранную базу в руку её владельца'
    case 'DISCARD_OR_LOSE':
      return `Сбросьте до ${n} карт — за каждую недостающую потеряете авторитет`
    case 'DESTROY_OWN_BASE_OR_LOSE':
      return 'Уничтожьте свою базу или потеряйте авторитет'
    case 'TOPDECK_FROM_HAND':
      return `Верните ${n} карты на верх колоды — порядок выбора и будет порядком в колоде`
    // ── High Alert ─────────────────────────────────────────────────────────
    case 'CHOOSE_FACTION':
      return 'Выберите фракцию'
    case 'SCRY':
      return 'Одну карту — в сброс, другая останется на верху колоды'
    // ── Stellar Allies ─────────────────────────────────────────────────────
    case 'COPY_USED_ALLY':
      return 'Скопируйте союзное свойство, уже применённое в этот ход'
    // ── Frontiers: промо с Kickstarter ─────────────────────────────────────
    case 'DISCARD_TO_HAND':
      return 'Возьмите карту из стопки сброса в руку'
    case 'STEAL_FROM_DISCARD':
      return 'Переложите карту из стопки сброса соперника в свою'
    case 'SET_ASIDE_FROM_ROW':
      return 'Отложите карту из торгового ряда — её можно будет купить до конца партии'
    // ── Гамбиты и миссии ───────────────────────────────────────────────────
    case 'BUY_FROM_SCRAP_HEAP':
      return 'Заплатите стоимость карты из утиля и возьмите её в руку'
    case 'REVEAL_SPLIT':
      return 'Разложите открытые карты: в руку, в сброс и на верх колоды'
    // ── Командные колоды ───────────────────────────────────────────────────
    case 'SCRAP_THEN_GAIN':
      return `Утилизируйте до ${n} карт — награда зависит от их числа`
    case 'DISCARD_FOR_TRADE_OR_COMBAT':
      return `Сбросьте до ${n} карт — по 2 очка торговли или боя за каждую`
  }
}
