import React from 'react'

/** Line icons for the editor chrome, stroked in the text color. */
const icon = (children: React.ReactNode): React.ReactNode => (
  <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
)

export const UI_ICONS = {
  menu: icon(<path d="M4 7h16M4 12h16M4 17h16" />),
  rail: icon(
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9 5v14" />
    </>
  ),
  push: icon(<path d="M12 19V5M6 11l6-6 6 6" />),
  close: icon(<path d="M6 6l12 12M18 6 6 18" />),
  plus: icon(<path d="M12 5v14M5 12h14" />),
  edit: icon(<path d="M4 20h4L19 9l-4-4L4 16v4Z" />),
  copy: icon(
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  trash: icon(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />),
  search: icon(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  save: icon(<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />),
  open: icon(<path d="M3 7h6l2 2h10v10H3z" />),
  download: icon(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />),
  upload: icon(<path d="M12 15V4M7 9l5-5 5 5M5 20h14" />),
  bell: icon(<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20h4" />),
  palette: icon(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </>
  ),
  display: icon(
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
  mic: icon(
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
    </>
  ),
  grip: icon(
    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
  ),
  chevron: icon(<path d="m7 10 5 5 5-5" />)
} as const
