import { actorOf, enumerateLegalActions, redact, type CardIid, type GameEvent, type GameState } from '@sr/engine'
import { LocalMatchClient, type LocalOptions } from './LocalMatchClient'
import type { LogLine } from './types'

/**
 * Стол-полигон.
 *
 * Обычный локальный клиент плюс режиссёрский пульт: состояние можно править
 * напрямую, а поток событий — вбрасывать руками. Всё остальное — розыгрыш,
 * покупка, атака, окна выбора, бот — работает ровно так же, как в партии,
 * потому что это тот же движок и тот же клиент.
 *
 * Прямая правка живёт ЗДЕСЬ, а не в движке: reduce() обязан оставаться
 * единственным способом менять состояние в настоящей игре, иначе сохранённая
 * партия перестанет воспроизводиться, а «а у меня работало» станет
 * неотличимо от бага в правилах.
 */
export class LabMatchClient extends LocalMatchClient {
  constructor(opts: LocalOptions) { super(opts) }

  /**
   * Правка состояния в обход правил.
   *
   * structuredClone, а не immer: состояние — обычный JSON (это проверяется
   * свойством в движке), и лишняя зависимость в интерфейсном слое не нужна.
   */
  patch(recipe: (d: GameState) => void): void {
    const next = structuredClone(this.state) as GameState
    recipe(next)
    this.state = next
    this.events = []
    this.tick += 1
    this.emit()
  }

  /** Событие в поток, ничего не меняя: показать эффект на настоящем столе. */
  fire(events: readonly GameEvent[]): void {
    this.events = events
    this.tick += 1
    this.emit()
  }

  /** Строка в журнал: пульт проговаривает, что сделал. */
  say(text: string): void {
    // Поток событий обнуляется вместе со строкой: иначе следующий tick
    // повторил бы прошлую вспышку, и «эффект сработал дважды» выглядело бы
    // как баг слоя эффектов, а не пульта.
    this.events = []
    this.log = [...this.log, { id: this.tick * 1000 + this.log.length, player: null, text, emphasis: true }]
      .slice(-400) as LogLine[]
    this.tick += 1
    this.emit()
  }

  /** Кто сейчас ходит и что ему разрешено — пульту это нужно для подсказок. */
  get info(): { actor: string; legal: number; state: GameState } {
    const actor = actorOf(this.state)
    const view = redact(this.state, actor)
    return { actor, legal: enumerateLegalActions(view, actor).length, state: this.state }
  }

  /** Новый экземпляр карты. Идентификаторы случайны, как и в раздаче. */
  static iid(): CardIid {
    const b = new Uint8Array(6)
    crypto.getRandomValues(b)
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('') as CardIid
  }
}
