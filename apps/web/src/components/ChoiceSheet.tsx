'use client'

import { useEffect, useState } from 'react'
import {
  cardDef, type Action, type ChoiceOption, type PendingChoiceView, type PlayerId,
} from '@sr/engine'
import { BRANCH_RU, cardName, FACTION_RU } from '@/i18n/cards.ru'
import { promptTitle, UI } from '@/i18n/ui'
import type { SeatNames } from '@/match/log'
import { Card } from './Card'
import { CardText } from './cardText'

/**
 * The blocking prompt.
 *
 * Optionality is `min === 0`, so "you may" needs no special case: Skip is simply
 * confirming an empty selection. Multi-select is min/max on one choice rather
 * than a sequence of single choices, which is what the printed cards actually say
 * ("scrap UP TO two cards").
 */
/**
 * Ветка выбора по-русски.
 *
 * Часть веток движок отдаёт как готовый текст со значками, часть — как
 * идентификатор фракции (High Alert, «Маскировка»). Второй случай нельзя
 * переводить в движке: он оперирует идентификаторами, а не языком.
 */
function branchLabel(label: string): string {
  return FACTION_RU[label as keyof typeof FACTION_RU] ?? BRANCH_RU[label] ?? label
}

/**
 * Убрать вопрос с глаз.
 *
 * Ссылкой, а не кнопкой рядом с «Подтвердить»: свернуть — не ответ, и ставить
 * это действие в один ряд с ответами значит предлагать его как третий вариант
 * ответа.
 */
function FoldButton({ onFold }: { onFold: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="btn btn--ghost choice__fold"
      onClick={onFold}
      title={UI.foldPromptHint}
    >
      {UI.foldPrompt}
    </button>
  )
}

export function ChoiceSheet({
  choice, onResolve, viewer, seatNames,
}: {
  choice: PendingChoiceView
  onResolve: (a: Action) => void
  /** Чьими глазами смотрим: от этого зависит, чья карта «ваша». */
  viewer: PlayerId
  seatNames: SeatNames
}): React.JSX.Element | null {
  const [picked, setPicked] = useState<ChoiceOption[]>([])
  /**
   * Вопрос свёрнут, стол виден.
   *
   * Сбрасывается вместе с выбором: свернули один вопрос — следующий всё равно
   * приходит открытым, иначе игрок пропустил бы его и не понял, чего игра ждёт.
   */
  const [folded, setFolded] = useState(false)

  useEffect(() => { setPicked([]); setFolded(false) }, [choice.id])

  // Esc складывает и раскладывает вопрос: то же движение, что и кнопкой, но
  // без прицеливания мышью посреди хода.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setFolded((f) => !f)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  if (folded) {
    return (
      <button
        type="button"
        className="choicebar"
        onClick={() => setFolded(false)}
        title={promptTitle(choice, null)}
      >
        <span className="choicebar__dot" aria-hidden="true" />
        {UI.unfoldPrompt}
      </button>
    )
  }

  if (!choice.options) {
    return (
      <div className="overlay">
        <div className="sheet">
          <div className="sheet__head">
            <span className="sheet__title">{UI.waitingForOther}</span>
            <span className="sheet__hint">{promptTitle(choice, null)}</span>
          </div>
          <FoldButton onFold={() => setFolded(true)} />
        </div>
      </div>
    )
  }

  const opts = choice.options
  // Кто задал вопрос. «Выберите одно» само по себе не говорит, чьё это
  // свойство: на столе может стоять пять баз, и любая из них могла сработать.
  const source = choice.sourceDef
  const branches = opts.filter((o) => o.o === 'BRANCH')
  // TOPDECK_ACQUIRED names the card in its title; it arrives as the only option.
  const firstCard = opts.find((o) => o.o === 'CARD')
  const title = promptTitle(
    choice,
    firstCard && firstCard.o === 'CARD' ? cardName(firstCard.def, cardDef(firstCard.def).name) : null,
  )
  /**
   * Улучшение показывается на самой карте, как только её выбрали.
   *
   * Иначе выбор слепой: игрок жмёт на карту и видит ровно то же самое, а
   * решает он именно «во что она превратится». Выбранная карта рисуется уже
   * улучшенной — с поднятым числом и печатью нового уровня.
   */
  const previewsUpgrade = choice.prompt === 'UPGRADE_CARD'

  const confirmOnly = opts.length === 1 && opts[0]?.o === 'CONFIRM'
  const resolve = (selected: ChoiceOption[]): void =>
    onResolve({ t: 'RESOLVE_CHOICE', choiceId: choice.id, selected })

  const same = (a: ChoiceOption, b: ChoiceOption): boolean =>
    a.o === b.o && (a.o !== 'CARD' || a.iid === (b as typeof a).iid) &&
    (a.o !== 'BRANCH' || a.index === (b as typeof a).index)

  const toggle = (o: ChoiceOption): void => {
    setPicked((cur) => {
      const has = cur.some((x) => same(x, o))
      if (has) return cur.filter((x) => !same(x, o))
      if (cur.length >= choice.max) return choice.max === 1 ? [o] : cur
      return [...cur, o]
    })
  }

  const isBase = source ? cardDef(source).type !== 'ship' : false

  return (
    // Сцена, а не плашка: карта, которая спросила, стоит по центру ровно так
    // же, как увеличенная карта при удержании, а варианты выстроены под ней.
    // Панель под картой своего фона не имеет -- фон есть только у кнопок,
    // иначе вокруг карты появляется вторая рамка, и она читается как ещё один
    // предмет на столе.
    <div className={`choice${source ? '' : ' choice--bare'}`}>
      {source && (
        <div className="choice__stage">
          <div className={`choice__slot${isBase ? ' choice__slot--base' : ''}`}>
            <Card def={source} />
          </div>
        </div>
      )}

      <div className="choice__panel">
        <div className="choice__head">
          <span className="choice__title">{title}</span>
          <span className="choice__hint">
            {source ? `${cardName(source, cardDef(source).name)} · ` : ''}
            {choice.min === choice.max
              ? UI.chooseExactly(choice.max)
              : UI.chooseRange(choice.min, choice.max)}
          </span>
        </div>

        {branches.length > 0 && (
          <div className="branches">
            {branches.map((b) => (
              <button
                key={b.o === 'BRANCH' ? b.index : 0}
                type="button"
                className="branch"
                onClick={() => resolve([b])}
              >
                <span className="branch__index">
                  {b.o === 'BRANCH' ? String(b.index + 1).padStart(2, '0') : ''}
                </span>
                <span>
                  {b.o === 'BRANCH' && <CardText src={branchLabel(b.label)} />}
                </span>
              </button>
            ))}
            <div className="actions actions--centre">
              <FoldButton onFold={() => setFolded(true)} />
            </div>
          </div>
        )}

        {confirmOnly && (
          <div className="actions actions--centre">
            <button type="button" className="btn btn--primary" onClick={() => resolve(opts as ChoiceOption[])}>
              {UI.yes}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => resolve([])}>
              {UI.no}
            </button>
            <FoldButton onFold={() => setFolded(true)} />
          </div>
        )}

        {!confirmOnly && branches.length === 0 && (
          <>
            <div className="row row--scroll choice__cards">
              {opts.map((o) => {
                if (o.o !== 'CARD') {
                  return (
                    <button
                      key="explorer"
                      type="button"
                      className="btn"
                      onClick={() => toggle(o)}
                    >
                      {UI.explorer}
                    </button>
                  )
                }
                // Подписывается только чужая карта. Своя в подписи не
                // нуждается — а вот чужая среди своих (или наоборот) без неё
                // неотличима, и «уничтожьте базу» предлагал их вперемешку.
                const owner = o.owner === null || o.owner === viewer
                  ? null
                  : (seatNames[o.owner] ?? UI.opponent)
                const chosen = picked.some((x) => same(x, o))
                const shown = previewsUpgrade && chosen ? (o.up ?? 0) + 1 : o.up
                return (
                  <div
                    key={o.iid}
                    className={`choice__pick${previewsUpgrade && chosen ? ' is-upgrading' : ''}`}
                  >
                    <Card
                      def={o.def}
                      up={shown}
                      selected={chosen}
                      playable
                      onClick={() => toggle(o)}
                      title={cardName(o.def, cardDef(o.def).name)}
                    />
                    {previewsUpgrade && (
                      <span className="choice__preview">
                        {chosen ? UI.upgradeAfter((o.up ?? 0) + 1) : UI.upgradeBefore(o.up ?? 0)}
                      </span>
                    )}
                    {owner && <span className="choice__owner">{owner}</span>}
                  </div>
                )
              })}
            </div>
            <div className="actions actions--centre">
              <button
                type="button"
                className="btn btn--primary"
                disabled={picked.length < choice.min}
                onClick={() => resolve(picked)}
              >
                {UI.confirm}{picked.length > 0 ? ` (${picked.length})` : ''}
              </button>
              {choice.min === 0 && (
                <button type="button" className="btn btn--ghost" onClick={() => resolve([])}>
                  {UI.skip}
                </button>
              )}
              <FoldButton onFold={() => setFolded(true)} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
