import { describe, it, expect } from 'vitest'
import { fitTabs } from '../webapp/src/fitTabs'

const opts = { add: 40, more: 60, gap: 2, active: 0 }

describe('fitTabs', () => {
  it('shows every tab when they fit', () => {
    expect(fitTabs([100, 100, 100], 400, opts)).toEqual({
      shown: [0, 1, 2],
      overflow: false
    })
  })

  it('keeps the leading tabs that fit beside the more menu', () => {
    // budget = 400 - 40 - 60 - 2 = 298: two tabs of 102 fit, a third not.
    expect(fitTabs([100, 100, 100, 100], 400, opts)).toEqual({
      shown: [0, 1],
      overflow: true
    })
  })

  it('always shows the active tab, in place of the last that fit', () => {
    expect(
      fitTabs([100, 100, 100, 100, 100], 400, { ...opts, active: 4 })
    ).toEqual({ shown: [0, 4], overflow: true })
  })

  it('shows the active tab alone when nothing else fits', () => {
    expect(fitTabs([300, 300], 200, { ...opts, active: 1 })).toEqual({
      shown: [1],
      overflow: true
    })
  })

  it('copes with no screens', () => {
    expect(fitTabs([], 100, { ...opts, active: -1 })).toEqual({
      shown: [],
      overflow: false
    })
  })
})
