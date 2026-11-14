import React from 'react'
import type { WidgetKind } from './schema'

/** Library entry for a widget kind: the name people know it by, a line
 *  icon (stroke only, colored by the button's text) and extra words the
 *  library search should match. */
export interface KindInfo {
  name: string
  icon: React.ReactNode
  keywords: string
}

const svg = (children: React.ReactNode): React.ReactNode => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
)

export const KIND_INFO: Record<WidgetKind, KindInfo> = {
  label: {
    name: 'Label',
    icon: svg(<path d="M5 7h14M5 12h10M5 17h7" />),
    keywords: 'text caption description'
  },
  value: {
    name: 'Value',
    icon: svg(
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M8 13h5M8 10h8" />
      </>
    ),
    keywords: 'number readout big'
  },
  toggle: {
    name: 'Switch',
    icon: svg(
      <>
        <rect x="3" y="8" width="18" height="8" rx="4" />
        <circle cx="16" cy="12" r="2.5" />
      </>
    ),
    keywords: 'toggle relay on off'
  },
  arc: {
    name: 'Gauge',
    icon: svg(
      <>
        <path d="M4 17a8 8 0 1 1 16 0" />
        <path d="M12 17l4-5" />
      </>
    ),
    keywords: 'arc dial round'
  },
  bar: {
    name: 'Bar',
    icon: svg(
      <>
        <rect x="3" y="9" width="18" height="6" rx="3" />
        <path d="M6 12h7" />
      </>
    ),
    keywords: 'level progress'
  },
  bargroup: {
    name: 'Bar group',
    icon: svg(<path d="M6 19V9M12 19V5M18 19v-7" />),
    keywords: 'tanks batteries bars'
  },
  button: {
    name: 'Button',
    icon: svg(
      <>
        <rect x="4" y="7" width="16" height="10" rx="3" />
        <path d="M9 12h6" />
      </>
    ),
    keywords: 'press put action'
  },
  notifications: {
    name: 'Alarms',
    icon: svg(
      <>
        <path d="M12 4l9 15H3z" />
        <path d="M12 10v4M12 17v.5" />
      </>
    ),
    keywords: 'notifications list alerts'
  },
  anchor: {
    name: 'Anchor',
    icon: svg(
      <>
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v13M5 13a7 7 0 0 0 14 0M9 10h6" />
      </>
    ),
    keywords: 'anchor watch radius'
  },
  anchor_track: {
    name: 'Anchor track',
    icon: svg(
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M9 14c1-3 3-4 6-3" />
        <circle cx="15" cy="11" r="1" />
      </>
    ),
    keywords: 'anchor swing track'
  },
  voice: {
    name: 'Voice',
    icon: svg(<path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h-2" />),
    keywords: 'wake word assistant'
  },
  speaker: {
    name: 'Speaker',
    icon: svg(
      <>
        <path d="M4 10v4h4l5 4V6L8 10z" />
        <path d="M16 9a4 4 0 0 1 0 6" />
      </>
    ),
    keywords: 'mute sound audio'
  },
  mic: {
    name: 'Microphone',
    icon: svg(
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
      </>
    ),
    keywords: 'mic mute'
  },
  volume: {
    name: 'Volume',
    icon: svg(
      <>
        <path d="M4 10v4h4l5 4V6L8 10z" />
        <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
      </>
    ),
    keywords: 'loudness audio'
  },
  stream: {
    name: 'Stream',
    icon: svg(
      <>
        <rect x="3" y="5" width="18" height="12" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
    keywords: 'video dashboard browser mirror'
  },
  slider: {
    name: 'Slider',
    icon: svg(
      <>
        <path d="M4 12h16" />
        <circle cx="9" cy="12" r="3" />
      </>
    ),
    keywords: 'brightness dimmer setpoint'
  }
}

/** Whether a library search matches a kind: its name, its JSON type or one
 *  of its keywords. */
export function kindMatches(kind: WidgetKind, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const info = KIND_INFO[kind]
  return (
    kind.toLowerCase().includes(q) ||
    info.name.toLowerCase().includes(q) ||
    info.keywords.split(' ').some((k) => k.startsWith(q))
  )
}
