import React, { useMemo, useState } from 'react'
import {
  formatPathValue,
  pathGroups,
  searchPaths,
  type PathInfo
} from './pathSearch'
import { UI_ICONS } from './uiIcons'

// Enough rows to scroll through; more only slows typing on a tablet.
const MAX_ROWS = 80

/** A bind field: shows the bound path and its live value, and opens a
 *  search over the vessel's paths (by path or description). Free text
 *  stays possible for binds the server does not publish yet, nested
 *  binds and the panel's own `@` binds. */
export function PathPicker(props: {
  value: string
  onChange: (path: string) => void
  infos: readonly PathInfo[]
  infoByPath: ReadonlyMap<string, PathInfo>
  /** Binds used elsewhere in the layout, offered first. */
  recent: readonly string[]
  liveValue?: string
  placeholder?: string
  label?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<string | 'recent' | ''>('')
  const byPath = props.infoByPath
  // Searched only while open: a bargroup mounts one picker per bar.
  const groups = useMemo(
    () => (open ? pathGroups(props.infos) : []),
    [open, props.infos]
  )
  const results = useMemo(() => {
    if (!open) return []
    if (group === 'recent') {
      const recent = props.recent.map(
        (p) => byPath.get(p) ?? ({ path: p } as PathInfo)
      )
      return searchPaths(recent, query)
    }
    return searchPaths(props.infos, query, group || undefined)
  }, [open, props.infos, props.recent, byPath, query, group])
  const info = byPath.get(props.value)
  const typed = query.trim()

  const pick = (p: string): void => {
    props.onChange(p)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="path-picker">
      <button
        type="button"
        className="path-current"
        aria-expanded={open}
        aria-label={props.label ?? 'Signal K path'}
        onClick={() => setOpen((o) => !o)}
      >
        {UI_ICONS.search}
        <span className={`path ${props.value ? '' : 'empty'}`}>
          {props.value || props.placeholder || 'choose a path'}
        </span>
        {props.liveValue !== undefined && props.liveValue !== '' && (
          <span className="live">{props.liveValue}</span>
        )}
      </button>
      {!open && info?.description && (
        <div className="path-desc">{info.description}</div>
      )}
      {open && (
        <div className="path-search">
          <input
            type="search"
            autoFocus
            value={query}
            placeholder="Search path or description"
            aria-label="Search Signal K paths"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                // Nothing typed: Enter must not bind the first path listed.
                if (!typed) return
                const first = results[0]
                pick(first ? first.path : typed)
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setOpen(false)
              }
            }}
          />
          <div className="chips" role="group" aria-label="Filter by area">
            <button
              type="button"
              className={group === '' ? 'on' : ''}
              onClick={() => setGroup('')}
            >
              all
            </button>
            {props.recent.length > 0 && (
              <button
                type="button"
                className={group === 'recent' ? 'on' : ''}
                onClick={() => setGroup('recent')}
              >
                in this layout
              </button>
            )}
            {groups.map((g) => (
              <button
                type="button"
                key={g}
                className={group === g ? 'on' : ''}
                onClick={() => setGroup(group === g ? '' : g)}
              >
                {g}
              </button>
            ))}
          </div>
          <ul className="path-results">
            {results.slice(0, MAX_ROWS).map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  className={r.path === props.value ? 'on' : ''}
                  onClick={() => pick(r.path)}
                >
                  <span className="path">{r.path}</span>
                  {r.description && (
                    <span className="desc">{r.description}</span>
                  )}
                  <span className="val">
                    {formatPathValue(r.value, r.units)}
                  </span>
                </button>
              </li>
            ))}
            {results.length > MAX_ROWS && (
              <li className="muted more">
                {results.length - MAX_ROWS} more, type to narrow down
              </li>
            )}
            {results.length === 0 && props.infos.length === 0 && (
              <li className="muted more">
                No paths from the Signal K server. Open the designer through the
                server to search them, or type a path.
              </li>
            )}
            {results.length === 0 && props.infos.length > 0 && (
              <li className="muted more">No path matches.</li>
            )}
          </ul>
          <div className="path-actions">
            {typed && !byPath.has(typed) && (
              <button type="button" onClick={() => pick(typed)}>
                use “{typed}”
              </button>
            )}
            {props.value && (
              <button type="button" className="ghost" onClick={() => pick('')}>
                remove bind
              </button>
            )}
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setOpen(false)
                setQuery('')
              }}
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
