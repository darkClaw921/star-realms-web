'use client'

import { ALL_SETS, asDefId, tradeDeckComposition, type SetId } from '@sr/engine'
import { UI } from '@/i18n/ui'
import { DEFAULTS, LIMITS, useSettings, type Settings } from '@/settings/useSettings'
import { Card } from './Card'

/** Карты для живого предпросмотра: короткая, средняя и самая многословная в наборе. */
const PREVIEW = [asDefId('scout'), asDefId('cutter'), asDefId('battlecruiser')]

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
    <div>
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

/**
 * Настройки отображения.
 *
 * Предпросмотр показывает настоящие карты, а не образец текста: «Линейный
 * крейсер» — самая многословная карта набора, и именно на ней видно, когда
 * текст перестаёт помещаться.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { settings, set, reset } = useSettings()
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

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={UI.settings}
      >
        <div className="sheet__head">
          <span className="sheet__title">{UI.settings}</span>
          <span className="sheet__hint">{UI.settingsSaved}</span>
        </div>

        <div className="settings">
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

          <div>
            <div className="setting__head">
              <span className="setting__name">{UI.setsName}</span>
              <span className="setting__value">{UI.cardsInDeck(deckSize)}</span>
            </div>
            <div className="sets">
              {ALL_SETS.map((id) => {
                const on = settings.sets.includes(id)
                const last = on && settings.sets.length === 1
                return (
                  <label key={id} className={`switch${last ? ' is-locked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={last}
                      onChange={() => toggleSet(id)}
                    />
                    <span className="track" />
                    <span>{UI.setName[id]}</span>
                  </label>
                )
              })}
            </div>
            <p className="setting__hint">{UI.setsHint}</p>
          </div>

          <div>
            <div className="setting__head">
              <span className="setting__name">{UI.preview}</span>
            </div>
            <div className="settings__preview">
              {PREVIEW.map((def) => <Card key={def} def={def} />)}
            </div>
          </div>
        </div>

        <div className="actions" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {UI.done}
          </button>
          <button type="button" className="btn btn--ghost" disabled={isDefault} onClick={reset}>
            {UI.resetSettings}
          </button>
        </div>
      </div>
    </div>
  )
}
