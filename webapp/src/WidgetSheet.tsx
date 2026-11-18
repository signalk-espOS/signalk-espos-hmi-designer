import React, { useRef } from 'react'
import { colorForZoneState, isNestedBind, type MetaZone } from './api'
import { NumberField } from './NumberField'
import { PathPicker } from './PathPicker'
import type { PathInfo } from './pathSearch'
import type { FontSizeOption, Widget, WidgetKind } from './schema'
import { UI_ICONS } from './uiIcons'
import { bindsOf, PANEL_LOCAL_KINDS } from './widgetBinds'
import { KIND_INFO } from './widgetIcons'

export type SheetTab = 'data' | 'display' | 'colors' | 'layout'

const TABS: ReadonlyArray<{ id: SheetTab; label: string }> = [
  { id: 'data', label: 'Data' },
  { id: 'display', label: 'Display' },
  { id: 'colors', label: 'Colors' },
  { id: 'layout', label: 'Position' }
]

/** Whether a kind has anything for the Data tab; the sheet opens there
 *  when it does. */
export function kindHasData(kind: WidgetKind): boolean {
  return !PANEL_LOCAL_KINDS.has(kind) || kind === 'stream'
}

/** A typed position or size as whole device pixels inside the panel. */
function clampPx(n: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(n), min), Math.max(min, max))
}

/** Everything about one widget, in one sheet: docked at the right on a
 *  wide screen, rising from the bottom on a narrow one (app.css). */
export function WidgetSheet(props: {
  selected: Widget
  tab: SheetTab
  onTab: (t: SheetTab) => void
  infos: readonly PathInfo[]
  infoByPath: ReadonlyMap<string, PathInfo>
  displayW: number
  /** The choices of the font size list, from the device's /hello. */
  fontSizes: readonly FontSizeOption[]
  /** Height of a page: the display minus the status and tab strips. */
  pageH: number
  recent: readonly string[]
  knownPathSet: ReadonlySet<string>
  liveValue: (bind: string) => string | undefined
  zonesOf: (bind: string) => readonly MetaZone[] | undefined
  updateWidget: (id: string, patch: Partial<Widget>) => void
  applyBind: (id: string, path: string) => void
  applyBarBind: (id: string, i: number, bind: string) => void
  onDuplicate: () => void
  onDelete: () => void
  onClose: () => void
}): React.JSX.Element {
  const {
    selected,
    tab,
    infos,
    infoByPath,
    displayW,
    pageH,
    recent,
    knownPathSet,
    liveValue,
    updateWidget,
    applyBind,
    applyBarBind
  } = props
  // Editor-only row keys for bargroup bars: an index key would hand an
  // open path search to the next bar when one is removed.
  const barIds = useRef<number[]>([])
  const nextBarId = useRef(0)
  const barCount = selected.type === 'bargroup' ? selected.bars.length : 0
  while (barIds.current.length < barCount)
    barIds.current.push(nextBarId.current++)
  barIds.current.length = barCount
  const info = KIND_INFO[selected.type]
  const bind = 'bind' in selected ? (selected.bind ?? '') : ''
  const zones = bind ? props.zonesOf(bind) : undefined
  return (
    <section
      className="sheet"
      aria-label={`${info?.name ?? selected.type} settings`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="sheet-grab" aria-hidden="true" />
      <div className="sheet-head">
        <span className="sheet-icon">{info?.icon}</span>
        <div className="sheet-title">
          <strong>
            {('label' in selected && selected.label) || selected.id}
          </strong>
          <span>{info?.name ?? selected.type}</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close"
          title="Close"
          onClick={props.onClose}
        >
          {UI_ICONS.close}
        </button>
      </div>
      <div className="sheet-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            type="button"
            role="tab"
            key={t.id}
            aria-selected={tab === t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => props.onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="sheet-body props" role="tabpanel">
        {tab === 'data' && (
          <>
            {!kindHasData(selected.type) && (
              <p className="muted">
                This widget drives the panel itself and reads no Signal K data.
              </p>
            )}
            {/* The voice widgets are panel-local: the device ignores a
                bind on them, so offering the field would only invite a
                path that silently does nothing. */}
            {selected.type !== 'stream' &&
              !PANEL_LOCAL_KINDS.has(selected.type) &&
              selected.type !== 'bargroup' && (
                <div className="field">
                  <span className="field-label">Signal K path</span>
                  <PathPicker
                    value={bind}
                    infos={infos}
                    infoByPath={infoByPath}
                    recent={recent}
                    liveValue={liveValue(bind)}
                    onChange={(p) => applyBind(selected.id, p)}
                  />
                </div>
              )}
            {selected.type === 'slider' && selected.bind === '@brightness' && (
              <p className="muted">
                panel backlight, 5 to 100 %: the same setting as the brightness
                slider under the panel connection. min, max and display are
                ignored.
              </p>
            )}
            {/* Covers bargroup sub-bar binds too, which have their own
                  inputs further down. */}
            {(() => {
              const nested = bindsOf(selected).filter((b) =>
                isNestedBind(b, knownPathSet)
              )
              return nested.length > 0 ? (
                <p className="muted">
                  {nested.join(', ')}: reaches into an object value, shown in
                  the preview only. The panel cannot resolve it, and Push will
                  refuse the layout.
                </p>
              ) : null
            })()}
            {selected.type === 'label' && (
              <label>
                show description
                <input
                  type="checkbox"
                  checked={Boolean(selected.show_description)}
                  onChange={(e) =>
                    updateWidget(selected.id, {
                      show_description: e.target.checked || undefined
                    })
                  }
                />
              </label>
            )}
            {selected.type === 'bargroup' && (
              <>
                <fieldset className="bands">
                  <legend>bars</legend>
                  {selected.bars.map((b, i) => (
                    <div className="bar-card" key={barIds.current[i] ?? i}>
                      <input
                        value={b.label}
                        title="label"
                        onChange={(e) => {
                          const next = [...selected.bars]
                          next[i] = { ...b, label: e.target.value }
                          updateWidget(selected.id, { bars: next })
                        }}
                      />
                      <PathPicker
                        value={b.bind}
                        label={`path of bar ${i + 1}`}
                        placeholder="choose a path"
                        infos={infos}
                        infoByPath={infoByPath}
                        recent={recent}
                        liveValue={liveValue(b.bind)}
                        onChange={(p) => applyBarBind(selected.id, i, p)}
                      />
                      <NumberField
                        value={b.min}
                        title="min (negatives + decimals allowed)"
                        onChange={(n) => {
                          const next = [...selected.bars]
                          next[i] = { ...b, min: n }
                          updateWidget(selected.id, { bars: next })
                        }}
                      />
                      <NumberField
                        value={b.max}
                        title="max (negatives + decimals allowed)"
                        onChange={(n) => {
                          const next = [...selected.bars]
                          next[i] = { ...b, max: n }
                          updateWidget(selected.id, { bars: next })
                        }}
                      />
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          const next = selected.bars.filter((_, j) => j !== i)
                          // Keep at least one bar; refuse to drop the last.
                          if (next.length === 0) return
                          barIds.current.splice(i, 1)
                          updateWidget(selected.id, { bars: next })
                        }}
                        title="Remove bar"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="ghost"
                    onClick={(e) => {
                      const next = [
                        ...selected.bars,
                        { label: '', bind: '', min: 0, max: 100 }
                      ]
                      updateWidget(selected.id, { bars: next })
                      // Bring the freshly-added row into view —
                      // without this the inspector's overflow-y
                      // hides the new bar at the bottom and the
                      // click feels like a no-op.
                      requestAnimationFrame(() => {
                        const btn = e.currentTarget as HTMLButtonElement | null
                        btn?.scrollIntoView({
                          block: 'nearest',
                          behavior: 'smooth'
                        })
                      })
                    }}
                  >
                    + add bar
                  </button>
                </fieldset>
              </>
            )}
            {selected.type === 'notifications' && (
              <>
                <label>
                  max rows
                  <input
                    type="number"
                    min={1}
                    value={selected.max_rows ?? 8}
                    onChange={(e) =>
                      updateWidget(selected.id, {
                        max_rows: Math.max(1, Number(e.target.value))
                      })
                    }
                  />
                </label>
                <label>
                  row height
                  <input
                    type="number"
                    min={16}
                    value={selected.row_height ?? 28}
                    onChange={(e) =>
                      updateWidget(selected.id, {
                        row_height: Math.max(16, Number(e.target.value))
                      })
                    }
                  />
                </label>
                <label>
                  row color field
                  <input
                    value={selected.row_color_field ?? ''}
                    placeholder="state"
                    onChange={(e) =>
                      updateWidget(selected.id, {
                        row_color_field: e.target.value || undefined
                      })
                    }
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={selected.include_cleared === true}
                    onChange={(e) =>
                      updateWidget(selected.id, {
                        include_cleared: e.target.checked || undefined
                      })
                    }
                  />
                  include cleared (normal / nominal)
                </label>
                <fieldset className="bands">
                  <legend>columns</legend>
                  {selected.columns.map((c, i) => (
                    <div className="band-row" key={i}>
                      <input
                        value={c.label}
                        title="header"
                        onChange={(e) => {
                          const next = [...selected.columns]
                          next[i] = { ...c, label: e.target.value }
                          updateWidget(selected.id, { columns: next })
                        }}
                      />
                      <input
                        value={c.field}
                        title="field (dotted path)"
                        placeholder="path"
                        onChange={(e) => {
                          const next = [...selected.columns]
                          next[i] = { ...c, field: e.target.value }
                          updateWidget(selected.id, { columns: next })
                        }}
                      />
                      <input
                        type="number"
                        value={c.width ?? 100}
                        title="width px"
                        onChange={(e) => {
                          const next = [...selected.columns]
                          next[i] = { ...c, width: Number(e.target.value) }
                          updateWidget(selected.id, { columns: next })
                        }}
                      />
                      <input
                        value={c.format ?? ''}
                        title="format"
                        placeholder="%s"
                        onChange={(e) => {
                          const next = [...selected.columns]
                          next[i] = {
                            ...c,
                            format: e.target.value || undefined
                          }
                          updateWidget(selected.id, { columns: next })
                        }}
                      />
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          const next = selected.columns.filter(
                            (_, j) => j !== i
                          )
                          if (next.length === 0) return
                          updateWidget(selected.id, { columns: next })
                        }}
                        title="Remove column"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      const next = [
                        ...selected.columns,
                        { label: '', field: '', width: 100 }
                      ]
                      updateWidget(selected.id, { columns: next })
                    }}
                  >
                    + add column
                  </button>
                </fieldset>
              </>
            )}
            {selected.type === 'button' && (
              <>
                <label>
                  press value
                  <input
                    value={
                      selected.press_value === null
                        ? 'null'
                        : String(selected.press_value ?? '')
                    }
                    placeholder='value, or "null" to raise anchor'
                    onChange={(e) => {
                      const t = e.target.value
                      const n = Number(t)
                      const v: boolean | number | string | null =
                        t === 'null'
                          ? null
                          : t === 'true'
                            ? true
                            : t === 'false'
                              ? false
                              : !isNaN(n) && t !== ''
                                ? n
                                : t
                      updateWidget(selected.id, { press_value: v })
                    }}
                  />
                </label>
                <label>
                  release value
                  <input
                    value={
                      selected.release_value === undefined
                        ? ''
                        : selected.release_value === null
                          ? 'null'
                          : String(selected.release_value)
                    }
                    placeholder="(no release PUT)"
                    onChange={(e) => {
                      const t = e.target.value
                      if (t === '') {
                        updateWidget(selected.id, {
                          release_value: undefined
                        })
                        return
                      }
                      const n = Number(t)
                      const v: boolean | number | string | null =
                        t === 'null'
                          ? null
                          : t === 'true'
                            ? true
                            : t === 'false'
                              ? false
                              : !isNaN(n)
                                ? n
                                : t
                      updateWidget(selected.id, { release_value: v })
                    }}
                  />
                </label>
                <label>
                  hold ms
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={selected.hold_ms ?? 0}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      updateWidget(selected.id, {
                        hold_ms: n > 0 ? n : undefined
                      })
                    }}
                  />
                </label>
                <div className="muted small">
                  With release_value set, this is a momentary button (PUT on
                  press, PUT on release). Without, it's a one-shot action.
                  hold_ms requires sustained press before any PUT fires — safety
                  latch for STOP, etc.
                </div>
              </>
            )}
            {selected.type === 'stream' && (
              <>
                <label>
                  host
                  <input
                    type="text"
                    value={selected.host ?? ''}
                    placeholder="(SignalK server)"
                    onChange={(e) =>
                      updateWidget(selected.id, {
                        host: e.target.value || undefined
                      })
                    }
                  />
                </label>
                <label>
                  port
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={selected.port ?? 5004}
                    onChange={(e) => {
                      // max= only marks the input invalid; enforce the
                      // range here so an out-of-range or fractional port
                      // never reaches the serialized layout.
                      const n = Number(e.target.value)
                      if (!Number.isInteger(n) || n < 1 || n > 65535) return
                      updateWidget(selected.id, {
                        port: n !== 5004 ? n : undefined
                      })
                    }}
                  />
                </label>
                <label>
                  forward touches
                  <input
                    type="checkbox"
                    checked={selected.touch ?? true}
                    onChange={(e) =>
                      updateWidget(selected.id, {
                        touch: e.target.checked ? undefined : false
                      })
                    }
                  />
                </label>
                <label>
                  touch port
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={selected.touch_port ?? 5005}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!Number.isInteger(n) || n < 1 || n > 65535) return
                      updateWidget(selected.id, {
                        touch_port: n !== 5005 ? n : undefined
                      })
                    }}
                  />
                </label>
                <div className="muted small">
                  Live MJPEG remote view captured on the SignalK box
                  (signalk-esp32-stream); taps on the panel drive the captured
                  page. Streams only while its screen is visible. Empty host
                  follows the panel's SignalK server. Renders on the panel only
                  — the preview shows a placeholder.
                </div>
              </>
            )}
          </>
        )}
        {tab === 'display' && (
          <>
            {/* stream carries no label at all — the device's /hello field
                  list doesn't advertise it, the firmware rejects it, and
                  StreamWidget keeps it type-invalid. The !== check (not the
                  Set) is what narrows the union for TypeScript. */}
            {selected.type !== 'stream' && (
              <label>
                label
                <input
                  value={selected.label ?? ''}
                  onChange={(e) =>
                    updateWidget(selected.id, { label: e.target.value })
                  }
                />
              </label>
            )}
            {(selected.type === 'arc' ||
              selected.type === 'bar' ||
              selected.type === 'slider') && (
              <>
                <label>
                  min
                  <NumberField
                    value={selected.min}
                    onChange={(n) => updateWidget(selected.id, { min: n })}
                  />
                </label>
                <label>
                  max
                  <NumberField
                    value={selected.max}
                    onChange={(n) => updateWidget(selected.id, { max: n })}
                  />
                </label>
              </>
            )}
            {selected.type === 'bar' && (
              <label>
                vertical
                <input
                  type="checkbox"
                  checked={Boolean(selected.vertical)}
                  onChange={(e) =>
                    updateWidget(selected.id, {
                      vertical: e.target.checked || undefined
                    })
                  }
                />
              </label>
            )}
            {selected.type === 'arc' && (
              <>
                <label>
                  ticks
                  <input
                    type="number"
                    min={0}
                    value={selected.ticks ?? 0}
                    onChange={(e) =>
                      updateWidget(selected.id, {
                        ticks: Number(e.target.value) || undefined
                      })
                    }
                  />
                </label>
                <label>
                  tick labels
                  <input
                    type="checkbox"
                    checked={Boolean(selected.tick_labels)}
                    onChange={(e) =>
                      updateWidget(selected.id, {
                        tick_labels: e.target.checked || undefined
                      })
                    }
                  />
                </label>
              </>
            )}
            {(selected.type === 'label' ||
              selected.type === 'value' ||
              selected.type === 'arc' ||
              selected.type === 'bar' ||
              selected.type === 'slider') && (
              <>
                <label>
                  unit
                  <input
                    value={selected.display?.unit ?? ''}
                    onChange={(e) =>
                      updateWidget(selected.id, {
                        display: {
                          ...(selected.display ?? {}),
                          unit: e.target.value
                        }
                      })
                    }
                  />
                </label>
                <label>
                  scale
                  <NumberField
                    value={selected.display?.scale ?? 1}
                    onChange={(n) =>
                      updateWidget(selected.id, {
                        display: { ...(selected.display ?? {}), scale: n }
                      })
                    }
                  />
                </label>
                <label>
                  offset
                  <NumberField
                    value={selected.display?.offset ?? 0}
                    onChange={(n) =>
                      updateWidget(selected.id, {
                        display: { ...(selected.display ?? {}), offset: n }
                      })
                    }
                  />
                </label>
                <label>
                  decimals
                  <input
                    type="number"
                    value={selected.display?.decimals ?? 1}
                    onChange={(e) =>
                      updateWidget(selected.id, {
                        display: {
                          ...(selected.display ?? {}),
                          decimals: Number(e.target.value)
                        }
                      })
                    }
                  />
                </label>
              </>
            )}
            {/* Font size — applies to widgets whose primary text
                  is configurable (label, value, toggle caption).
                  Stand-alone so it works even for toggle, which
                  has no unit/scale/offset/decimals block above. */}
            {(selected.type === 'label' ||
              selected.type === 'value' ||
              selected.type === 'toggle') && (
              <label>
                font size
                <select
                  value={selected.display?.font_size ?? 0}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    updateWidget(selected.id, {
                      display: {
                        ...(selected.display ?? {}),
                        font_size: v > 0 ? v : undefined
                      }
                    })
                  }}
                  title="LVGL renders fixed bitmap fonts; firmware snaps to the closest compiled size at or below this value."
                >
                  <option value={0}>auto (default)</option>
                  {props.fontSizes.map((o) => (
                    <option key={o.px} value={o.px}>
                      {o.px} px{o.digits ? ' (numbers)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selected.type !== 'label' &&
              selected.type !== 'value' &&
              selected.type !== 'arc' &&
              selected.type !== 'bar' &&
              selected.type !== 'slider' &&
              selected.type !== 'toggle' &&
              selected.type !== 'stream' && (
                <p className="muted small">
                  Nothing else to set for this widget here.
                </p>
              )}
          </>
        )}
        {tab === 'colors' && (
          <>
            {zones && zones.length > 0 && (
              <div className="field">
                <span className="field-label">Zones from the server</span>
                <ul className="zones">
                  {zones.map((z, i) => (
                    <li key={i}>
                      <i style={{ background: colorForZoneState(z.state) }} />
                      <span>{z.state}</span>
                      <span className="muted">
                        {z.lower} – {z.upper}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {selected.type === 'arc' && (
              <fieldset className="bands">
                <legend>bands</legend>
                {(selected.bands ?? []).map((b, i) => (
                  <div className="band-row" key={i}>
                    <NumberField
                      value={b.from}
                      title="from"
                      onChange={(n) => {
                        const next = [...(selected.bands ?? [])]
                        next[i] = { ...b, from: n }
                        updateWidget(selected.id, { bands: next })
                      }}
                    />
                    <NumberField
                      value={b.to}
                      title="to"
                      onChange={(n) => {
                        const next = [...(selected.bands ?? [])]
                        next[i] = { ...b, to: n }
                        updateWidget(selected.id, { bands: next })
                      }}
                    />
                    <input
                      type="color"
                      value={b.color}
                      onChange={(e) => {
                        const next = [...(selected.bands ?? [])]
                        next[i] = { ...b, color: e.target.value }
                        updateWidget(selected.id, { bands: next })
                      }}
                    />
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        const next = (selected.bands ?? []).filter(
                          (_, j) => j !== i
                        )
                        updateWidget(selected.id, {
                          bands: next.length ? next : undefined
                        })
                      }}
                      title="Remove band"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    const cur = selected.bands ?? []
                    // Suggest a band spanning the upper third of
                    // the range — useful "warn zone" default.
                    const span = selected.max - selected.min
                    const next = [
                      ...cur,
                      {
                        from: selected.min + span * 0.7,
                        to: selected.max,
                        color: '#d29922'
                      }
                    ]
                    updateWidget(selected.id, { bands: next })
                  }}
                >
                  + add band
                </button>
              </fieldset>
            )}
            <label>
              bg color
              <input
                type="color"
                value={selected.bg_color ?? '#161b22'}
                onChange={(e) =>
                  updateWidget(selected.id, { bg_color: e.target.value })
                }
              />
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  updateWidget(selected.id, { bg_color: undefined })
                }
                title="Clear bg color override (use theme default)"
              >
                clear
              </button>
            </label>
            <label>
              fg color
              <input
                type="color"
                value={selected.fg_color ?? '#e6edf3'}
                onChange={(e) =>
                  updateWidget(selected.id, { fg_color: e.target.value })
                }
              />
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  updateWidget(selected.id, { fg_color: undefined })
                }
                title="Clear fg color override (use theme default)"
              >
                clear
              </button>
            </label>
            <div className="muted small">
              Zone state colors always win when the bound path has a matching
              zone — these are fallbacks.
            </div>
          </>
        )}
        {tab === 'layout' && (
          <>
            <div className="grid-2">
              <label>
                x
                <NumberField
                  value={selected.x}
                  min={0}
                  onChange={(n) =>
                    updateWidget(selected.id, {
                      x: clampPx(n, 0, displayW - selected.w)
                    })
                  }
                />
              </label>
              <label>
                y
                <NumberField
                  value={selected.y}
                  min={0}
                  onChange={(n) =>
                    updateWidget(selected.id, {
                      y: clampPx(n, 0, pageH - selected.h)
                    })
                  }
                />
              </label>
              <label>
                width
                <NumberField
                  value={selected.w}
                  min={1}
                  onChange={(n) =>
                    updateWidget(selected.id, {
                      w: clampPx(n, 1, displayW - selected.x)
                    })
                  }
                />
              </label>
              <label>
                height
                <NumberField
                  value={selected.h}
                  min={1}
                  onChange={(n) =>
                    updateWidget(selected.id, {
                      h: clampPx(n, 1, pageH - selected.y)
                    })
                  }
                />
              </label>
            </div>
            <p className="muted small">Device pixels.</p>
            <label>
              id
              <input value={selected.id} readOnly />
            </label>
          </>
        )}
      </div>
      <div className="sheet-foot">
        <button type="button" onClick={props.onDuplicate}>
          {UI_ICONS.copy}
          duplicate
        </button>
        <button type="button" className="danger" onClick={props.onDelete}>
          {UI_ICONS.trash}
          delete
        </button>
      </div>
    </section>
  )
}
