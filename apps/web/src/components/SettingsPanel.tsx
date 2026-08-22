'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ALL_SETS, asDefId, CARDS, COMMAND_DECKS, tradeDeckComposition, VARIANTS, type SetId,
} from '@sr/engine'
import { UI } from '@/i18n/ui'
import { DEFAULTS, LIMITS, useSettings, type Settings } from '@/settings/useSettings'
import { Card } from './Card'
import { SetGallery } from './SetGallery'
import { useHold } from './useHold'

/** Карты для живого предпросмотра: короткая, средняя и самая многословная в наборе. */
const PREVIEW = [asDefId('scout'), asDefId('cutter'), asDefId('battlecruiser')]

type Tab = 'view' | 'sets' | 'rules'

const TABS: readonly { id: Tab; name: string }[] = [
  { id: 'view', name: UI.tabView },
  { id: 'sets', name: UI.tabSets },
  { id: 'rules', name: UI.tabRules },
]

/**
 * «Название — описание» в одну строку.
 *
 * Переводы сценариев и командных колод хранятся одной строкой, потому что в
 * журнале и подсказках они и нужны целиком. Плитке нужны две части, и делить
 * здесь честнее, чем держать два словаря, которые разъедутся.
 */
function splitLabel(s: string): { name: string; desc: string } {
  const at = s.indexOf(' — ')
  if (at < 0) return { name: s, desc: '' }
  return { name: s.slice(0, at), desc: s.slice(at + 3) }
}

/**
 * Плитка выбора: чекбокс или радиокнопка.
 *
 * Настоящий `input` остаётся в разметке и остаётся фокусируемым — он просто
 * не виден. Так плитка получает клавиатуру, чтение с экрана и группировку
 * радиокнопок бесплатно, а рисуется своим значком.
 */
function Opt({
  type, group, name, desc, badge, checked, disabled, title, onSelect, onHold,
}: {
  type: 'checkbox' | 'radio'
  group?: string
  name: string
  desc?: string | undefined
  badge?: string | undefined
  checked: boolean
  disabled?: boolean | undefined
  title?: string | undefined
  onSelect: () => void
  /** Удержание на плитке. Тот же жест, что увеличивает карту на столе. */
  onHold?: (() => void) | undefined
}): React.JSX.Element {
  const noop = useCallback(() => {}, [])
  const hold = useHold(onHold ?? noop)
  return (
    <label
      className={`opt${checked ? ' is-on' : ''}${disabled ? ' is-locked' : ''}${
        onHold && hold.holding ? ' is-holding' : ''}`}
      title={title ?? undefined}
      {...(onHold ? hold.handlers : {})}
    >
      <input
        type={type}
        {...(group ? { name: group } : {})}
        checked={checked}
        disabled={disabled ?? false}
        onChange={onSelect}
      />
      <span className="opt__mark" aria-hidden="true" />
      <span className="opt__body">
        <span className="opt__name">{name}</span>
        {desc ? <span className="opt__desc">{desc}</span> : null}
      </span>
      {badge ? <span className="opt__badge">{badge}</span> : null}
    </label>
  )
}

function Slider({
  name, hint, value, limits, format, onChange,
}: {
  name: string
  hint: string
  value: number
  limits: { min: number; max: number; step: number }
  format: (v: number) => string
  onChange: (v: number) => void
}): React.JSX.Element {
  const id = `set-${name}`
  return (
    <div className="field">
      <div className="setting__head">
        <label className="setting__name" htmlFor={id}>{name}</label>
        <span className="setting__value">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <p className="setting__hint">{hint}</p>
    </div>
  )
}

function Group({
  title, note, children,
}: {
  /** Absent where the tab's own label already says it, and repeating it would
   *  only push the choices further down. */
  title?: string | undefined
  note?: string | undefined
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="group">
      {title ? <h3 className="group__title">{title}</h3> : null}
      {note ? <p className="group__note">{note}</p> : null}
      {children}
    </section>
  )
}

/**
 * Что каждый набор кладёт на стол.
 *
 * Четыре набора не добавляют в торговую колоду ничего — гамбиты, миссии и
 * командные колоды раздаются из своих стопок. Показать у них «0 карт» значит
 * соврать: набор не пустой, он просто про другое.
 */
function sizeOf(id: SetId): string {
  const trade = tradeDeckComposition(undefined, [id]).length
  if (trade > 0) return UI.setSizeCards(trade)
  if (id === 'command-decks') return UI.setSizeDecks(COMMAND_DECKS.length)
  let gambit = 0
  let mission = 0
  for (const def of CARDS.values()) {
    if (def.set !== id) continue
    if (def.role === 'gambit') gambit += def.copies
    if (def.role === 'mission') mission += def.copies
  }
  if (gambit > 0) return UI.setSizeGambits(gambit)
  if (mission > 0) return UI.setSizeMissions(mission)
  return ''
}

/**
 * Настройки.
 *
 * Разложены по трём вкладкам, потому что это три разных решения: как стол
 * выглядит, из чего собрана торговая колода и по каким правилам раздаётся
 * партия. Первое действует немедленно, два других — только со следующей
 * партии, и вкладка честно об этом предупреждает.
 *
 * Предпросмотр показывает настоящие карты, а не образец текста: «Линейный
 * крейсер» — самая многословная карта набора, и именно на ней видно, когда
 * текст перестаёт помещаться.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { settings, set, reset } = useSettings()
  const [tab, setTab] = useState<Tab>('view')
  const [gallery, setGallery] = useState<SetId | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const pct = (v: number): string => `${Math.round(v * 100)}%`
  const isDefault = (Object.keys(DEFAULTS) as (keyof Settings)[])
    .every((k) => (k === 'sets'
      ? settings.sets.join() === DEFAULTS.sets.join()
      : settings[k] === DEFAULTS[k]))

  const toggleSet = (id: SetId): void => {
    const on = settings.sets.includes(id)
    const next = on ? settings.sets.filter((s) => s !== id) : [...settings.sets, id]
    // Никогда не остаёмся без карт: последний включённый набор выключить нельзя.
    if (next.length === 0) return
    set('sets', ALL_SETS.filter((s) => next.includes(s)))
  }
  const deckSize = tradeDeckComposition(undefined, settings.sets).length
  // 23 набора, и размер каждого не меняется — считать их на каждый клик незачем.
  const sizes = useMemo(() => new Map(ALL_SETS.map((id) => [id, sizeOf(id)])), [])

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="sheet sheet--settings"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={UI.settings}
      >
        <div className="sheet__head">
          <span className="sheet__title">{UI.settings}</span>
          <span className="sheet__hint">{UI.settingsSaved}</span>
        </div>

        <div className="tabs" role="tablist" aria-label={UI.settings}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              className={`tab${tab === t.id ? ' is-on' : ''}`}
              onClick={() => {
                setTab(t.id)
                // Лист не меняет высоту, но вторая вкладка длиннее первой:
                // без этого она открывалась бы посередине.
                if (body.current) body.current.scrollTop = 0
              }}
            >
              {t.name}
            </button>
          ))}
        </div>

        <div
          className="settings"
          ref={body}
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
        >
          {tab === 'view' && (
            <>
              <Slider
                name={UI.cardSize}
                hint={UI.cardSizeHint}
                value={settings.cardScale}
                limits={LIMITS.cardScale}
                format={pct}
                onChange={(v) => set('cardScale', v)}
              />
              <Slider
                name={UI.textSize}
                hint={UI.textSizeHint}
                value={settings.textScale}
                limits={LIMITS.textScale}
                format={pct}
                onChange={(v) => set('textScale', v)}
              />
              <Group title={UI.preview} note={UI.previewHint}>
                <div className="settings__preview">
                  {PREVIEW.map((def) => <Card key={def} def={def} />)}
                </div>
              </Group>
            </>
          )}

          {tab === 'sets' && (
            <Group note={UI.setsHint}>
              <div className="group__meter">
                <span className="setting__value">{UI.cardsInDeck(deckSize)}</span>
                <span className="setting__hint" style={{ margin: 0 }}>
                  {UI.setsOn(settings.sets.length, ALL_SETS.length)} · {UI.setHoldHint}
                </span>
              </div>
              <div className="opt-grid sets">
                {ALL_SETS.map((id) => {
                  const on = settings.sets.includes(id)
                  const last = on && settings.sets.length === 1
                  return (
                    <Opt
                      key={id}
                      type="checkbox"
                      name={UI.setName[id] ?? id}
                      badge={sizes.get(id) ?? ''}
                      checked={on}
                      disabled={last}
                      title={last ? UI.lastSetLocked : UI.setHoldHint}
                      onSelect={() => toggleSet(id)}
                      onHold={() => setGallery(id)}
                    />
                  )
                })}
              </div>
            </Group>
          )}

          {tab === 'rules' && (
            <>
              <Group title={UI.variantName} note={UI.variantHint}>
                <div className="opt-grid opt-grid--wide sets sets--decks">
                  {['', ...VARIANTS].map((id) => {
                    const { name, desc } = splitLabel(UI.variantRu[id] ?? id)
                    return (
                      <Opt
                        key={id}
                        type="radio"
                        group="variant"
                        name={name}
                        desc={desc}
                        checked={settings.variant === id}
                        onSelect={() => set('variant', id)}
                      />
                    )
                  })}
                </div>
              </Group>

              {/* Радиогруппа, а не переключатели наборов: командная колода одна,
                * и она заменяет вашу стартовую, а не добавляется к общему пулу. */}
              <Group title={UI.commandDeckName} note={UI.commandDeckHint}>
                <div className="opt-grid opt-grid--wide sets sets--decks">
                  {[{ id: '', name: UI.commandDeckNone }, ...COMMAND_DECKS].map((c) => {
                    const { name, desc } = splitLabel(UI.commandDeckRu[c.id] ?? c.name)
                    return (
                      <Opt
                        key={c.id}
                        type="radio"
                        group="command-deck"
                        name={name}
                        desc={desc}
                        checked={settings.commandDeck === c.id}
                        onSelect={() => set('commandDeck', c.id)}
                      />
                    )
                  })}
                </div>
              </Group>

              {/* Раздаются при подготовке, поэтому, как и наборы, действуют
                * только со СЛЕДУЮЩЕЙ партии. */}
              <Group title={UI.dealName}>
                <div className="fields">
                  <Slider
                    name={UI.gambitsName}
                    hint={UI.gambitsHint}
                    value={settings.gambits}
                    limits={LIMITS.gambits}
                    format={(v) => String(v)}
                    onChange={(v) => set('gambits', v)}
                  />
                  <Slider
                    name={UI.missionsName}
                    hint={UI.missionsHint}
                    value={settings.missions}
                    limits={LIMITS.missions}
                    format={(v) => String(v)}
                    onChange={(v) => set('missions', v)}
                  />
                </div>
              </Group>
            </>
          )}
        </div>

        <div className="sheet__foot">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {UI.done}
          </button>
          <button type="button" className="btn btn--ghost" disabled={isDefault} onClick={reset}>
            {UI.resetSettings}
          </button>
        </div>
      </div>

      {gallery ? <SetGallery set={gallery} onClose={() => setGallery(null)} /> : null}
    </div>
  )
}
