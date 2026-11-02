import { describe, it, expect } from 'vitest'
import { resizeWasmDisplay, type DisplaySize } from '../webapp/src/wasmResize'

describe('resizeWasmDisplay', () => {
  it('resizes to a device of another size and remembers it', () => {
    const calls: Array<[number, number]> = []
    const mod = {
      _jlp_resize: (w: number, h: number): number => {
        calls.push([w, h])
        return 0
      }
    }
    const size: DisplaySize = { w: 1024, h: 600 }
    expect(resizeWasmDisplay(mod, size, 320, 240)).toBeNull()
    expect(calls).toEqual([[320, 240]])
    expect(size).toEqual({ w: 320, h: 240 })
  })

  it('does nothing when the size is unchanged', () => {
    const calls: Array<[number, number]> = []
    const mod = {
      _jlp_resize: (w: number, h: number): number => {
        calls.push([w, h])
        return 0
      }
    }
    expect(resizeWasmDisplay(mod, { w: 320, h: 240 }, 320, 240)).toBeNull()
    expect(calls).toEqual([])
  })

  it('reports a bundle without jlp_resize only when the size changes', () => {
    const size: DisplaySize = { w: 1024, h: 600 }
    expect(resizeWasmDisplay({}, size, 1024, 600)).toBeNull()
    expect(resizeWasmDisplay({}, size, 320, 240)).toMatch(/no jlp_resize/)
    expect(size).toEqual({ w: 1024, h: 600 })
  })

  it('keeps the old size when the resize fails', () => {
    const size: DisplaySize = { w: 1024, h: 600 }
    const mod = { _jlp_resize: (): number => -1 }
    expect(resizeWasmDisplay(mod, size, 320, 240)).toMatch(/failed: -1/)
    expect(size).toEqual({ w: 1024, h: 600 })
  })
})
