import React, { useEffect, useRef, useState } from 'react'

/** Free-typing number input.
 *
 *  type="number" silently rejects partial input like "-" or "1."
 *  in many browsers — the field clears, you can't type a negative
 *  without a spinner click, etc. Wrapping the value as text and
 *  parsing-on-commit lets the user type freely (negatives, decimals,
 *  scientific notation), only writing back to state when the input
 *  parses cleanly. */
export function NumberField(props: {
  value: number
  onChange: (v: number) => void
  title?: string
  className?: string
  style?: React.CSSProperties
  min?: number
}): React.JSX.Element {
  const [draft, setDraft] = useState<string>(String(props.value))
  // Track which canonical value the current draft corresponds to so
  // we can detect external changes (paste, load layout) without
  // stepping on the user's in-progress edits. When onChange commits
  // a parsed value, we remember it here; the next render where
  // props.value matches the lastCommittedRef means "we caused this,
  // leave draft alone." When props.value doesn't match, it's an
  // external write and we resync.
  const lastCommitted = useRef<number>(props.value)
  useEffect(() => {
    if (props.value === lastCommitted.current) return
    lastCommitted.current = props.value
    setDraft(String(props.value))
  }, [props.value])
  return (
    <input
      type="text"
      inputMode="decimal"
      className={props.className}
      style={props.style}
      title={props.title}
      value={draft}
      onChange={(e) => {
        const txt = e.target.value
        setDraft(txt)
        const n = Number(txt)
        if (txt === '' || !Number.isFinite(n)) return
        if (props.min !== undefined && n < props.min) return
        lastCommitted.current = n
        props.onChange(n)
      }}
      // The parent may clamp a value back to the one it already had, which
      // changes no prop: show what was kept once the field is left.
      onBlur={() => {
        lastCommitted.current = props.value
        setDraft(String(props.value))
      }}
    />
  )
}
