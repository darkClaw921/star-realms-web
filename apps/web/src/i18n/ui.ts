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
  slotAlly: 'Союзное',
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
  settings: 'Настройки отображения',
  settingsSaved: 'Сохраняются в этом браузере',
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
      return 'Получите корабль бесплатно'
    case 'COPY_SHIP':
      return 'Скопируйте корабль, разыгранный в этот ход'
    case 'DISCARD_THEN_DRAW':
      return `Сбросьте до ${n} карт, затем доберите столько же`
    case 'SCRAP_THEN_DRAW':
      return `Утилизируйте до ${n} карт, затем доберите по одной за каждую`
    case 'TOPDECK_ACQUIRED':
      return sourceName
        ? `Положить «${sourceName}» на верх колоды?`
        : 'Положить купленный корабль на верх колоды?'
    case 'MAY':
      return 'Применить свойство?'
  }
}
