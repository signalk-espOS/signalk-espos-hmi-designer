import React, { useEffect, useRef } from 'react'

/** A panel hanging off a toolbar button. Closes on Escape and on a
 *  press anywhere outside it or its anchor, so a tap on the canvas
 *  never has to be tapped twice. */
export function Popover(props: {
  open: boolean
  onClose: () => void
  /** The button that toggles it; a press there is left to its onClick. */
  anchorRef: React.RefObject<HTMLElement | null>
  align?: 'left' | 'right'
  className?: string
  label: string
  children: React.ReactNode
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null)
  const { open, anchorRef } = props
  // Read through a ref: the parent passes a new arrow on every render,
  // and the listeners should not be swapped each time.
  const onCloseRef = useRef(props.onClose)
  onCloseRef.current = props.onClose
  useEffect(() => {
    const onClose = (): void => onCloseRef.current()
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node | null
      if (!t) return
      if (ref.current?.contains(t)) return
      if (anchorRef.current?.contains(t)) return
      // A dialog opened from the popover (a confirmation) is not outside.
      if ((t as Element).closest?.('dialog, .modal-backdrop')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, anchorRef])
  if (!open) return null
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={props.label}
      className={`popover ${props.align === 'right' ? 'right' : 'left'} ${props.className ?? ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      {props.children}
    </div>
  )
}
