import { describe, it, expect } from 'vitest'
import { effectiveVoice, type Layout } from '../webapp/src/schema'

const layout = (
  types: string[],
  voice?: Layout['voice']
): Pick<Layout, 'voice' | 'screens'> => ({
  ...(voice ? { voice } : {}),
  screens: [
    {
      id: 'main',
      title: 'Main',
      widgets: types.map(
        (type, i) =>
          ({ id: `w${i}`, type }) as Layout['screens'][0]['widgets'][0]
      )
    }
  ]
})

describe('effectiveVoice', () => {
  it('is off for a layout without the object or a mic widget', () => {
    expect(effectiveVoice(layout(['label', 'toggle']))).toEqual({
      enabled: false,
      wake: true
    })
  })

  it('is on when the layout has a talk button or a mic switch', () => {
    expect(effectiveVoice(layout(['voice'])).enabled).toBe(true)
    expect(effectiveVoice(layout(['mic'])).enabled).toBe(true)
    expect(effectiveVoice(layout(['mute_mic'])).enabled).toBe(true)
  })

  it('does not count the speaker or volume as needing the mic', () => {
    expect(effectiveVoice(layout(['speaker', 'volume'])).enabled).toBe(false)
  })

  it('follows an explicit setting over the widgets', () => {
    expect(effectiveVoice(layout(['voice'], { enabled: false }))).toEqual({
      enabled: false,
      wake: true
    })
    expect(effectiveVoice(layout([], { enabled: true, wake: false }))).toEqual({
      enabled: true,
      wake: false
    })
  })

  it('derives enabled when only the wake word is set', () => {
    expect(effectiveVoice(layout(['mic'], { wake: false }))).toEqual({
      enabled: true,
      wake: false
    })
  })
})
