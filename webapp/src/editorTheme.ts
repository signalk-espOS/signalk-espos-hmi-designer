/** The editor's own look, separate from the panel theme a layout picks:
 *  'auto' follows the system's light or dark setting. */
export type EditorTheme = 'auto' | 'day' | 'dark' | 'night'

export const EDITOR_THEMES: { id: EditorTheme; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'day', label: 'Day' },
  { id: 'dark', label: 'Dark' },
  { id: 'night', label: 'Night' }
]

export const EDITOR_THEME_KEY = 'hmi-designer.editorTheme'

export function parseEditorTheme(v: string | null | undefined): EditorTheme {
  return v === 'day' || v === 'dark' || v === 'night' ? v : 'auto'
}

/** The data-editor-theme value for the root element; undefined leaves the
 *  CSS to follow prefers-color-scheme. */
export function editorThemeAttr(t: EditorTheme): string | undefined {
  return t === 'auto' ? undefined : t
}

// localStorage throws in private mode or with site data blocked; the
// editor then just starts on auto each time.
export function loadEditorTheme(): EditorTheme {
  try {
    return parseEditorTheme(window.localStorage.getItem(EDITOR_THEME_KEY))
  } catch {
    return 'auto'
  }
}

export function saveEditorTheme(t: EditorTheme): void {
  try {
    window.localStorage.setItem(EDITOR_THEME_KEY, t)
  } catch {
    // see loadEditorTheme
  }
}

export function applyEditorTheme(t: EditorTheme): void {
  const attr = editorThemeAttr(t)
  if (attr) document.documentElement.dataset.editorTheme = attr
  else delete document.documentElement.dataset.editorTheme
}
