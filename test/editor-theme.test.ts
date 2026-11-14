import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { editorThemeAttr, parseEditorTheme } from '../webapp/src/editorTheme'
import { KIND_INFO, kindMatches } from '../webapp/src/widgetIcons'

describe('editor theme', () => {
  it('falls back to auto for anything it does not know', () => {
    expect(parseEditorTheme('night')).toBe('night')
    expect(parseEditorTheme('dark')).toBe('dark')
    expect(parseEditorTheme('sepia')).toBe('auto')
    expect(parseEditorTheme(null)).toBe('auto')
  })

  it('leaves the attribute off on auto so the system setting decides', () => {
    expect(editorThemeAttr('auto')).toBeUndefined()
    expect(editorThemeAttr('day')).toBe('day')
  })

  it('defines every token in each theme block', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../webapp/src/app.css', import.meta.url)),
      'utf8'
    )
    const block = (sel: string): string => {
      const i = css.indexOf(sel)
      expect(i).toBeGreaterThanOrEqual(0)
      return css.slice(i, css.indexOf('}', i))
    }
    const tokens = (b: string): string[] =>
      [...b.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1] ?? '').sort()
    const base = tokens(block(':root {')).filter((t) => t !== '--touch')
    for (const sel of [
      ":root[data-editor-theme='dark']",
      ":root[data-editor-theme='night']",
      ':root:not([data-editor-theme])'
    ]) {
      expect(tokens(block(sel))).toEqual(base)
    }
  })

  it('gives auto on a dark system the same colors as dark', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../webapp/src/app.css', import.meta.url)),
      'utf8'
    )
    const decls = (sel: string): string[] => {
      const i = css.indexOf(sel)
      expect(i).toBeGreaterThanOrEqual(0)
      return [
        ...css.slice(i, css.indexOf('}', i)).matchAll(/--[a-z0-9-]+:[^;]+;/g)
      ]
        .map((m) => m[0].replace(/\s+/g, ' '))
        .sort()
    }
    expect(decls(':root:not([data-editor-theme])')).toEqual(
      decls(":root[data-editor-theme='dark']")
    )
  })
})

describe('widget library', () => {
  it('finds a kind by name, JSON type or keyword', () => {
    expect(kindMatches('toggle', 'switch')).toBe(true)
    expect(kindMatches('toggle', 'TOGGLE')).toBe(true)
    expect(kindMatches('bargroup', 'tanks')).toBe(true)
    expect(kindMatches('arc', 'tanks')).toBe(false)
    expect(kindMatches('arc', '  ')).toBe(true)
    expect(kindMatches('label', 'text caption')).toBe(false)
  })

  it('names every kind', () => {
    for (const info of Object.values(KIND_INFO)) {
      expect(info.name.length).toBeGreaterThan(0)
    }
  })
})
