import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  HMI_DISPLAYS,
  fetchServerDisplays,
  isServerDisplay,
  matchDevice,
  normalizeDeviceUrl,
  otherPanelUrl,
  serverDisplayTargets
} from '../webapp/src/api'

const origin = 'http://boat.local'

describe('serverDisplayTargets', () => {
  it('turns the display list into targets on this server', () => {
    expect(
      serverDisplayTargets(
        { displays: [{ id: 'helm', name: 'Helm' }, { id: 'salon' }] },
        origin
      )
    ).toEqual([
      {
        url: `${origin}${HMI_DISPLAYS}/helm`,
        name: 'Helm (browser display)',
        txt: {}
      },
      {
        url: `${origin}${HMI_DISPLAYS}/salon`,
        name: 'salon (browser display)',
        txt: {}
      }
    ])
  })

  it('ignores an unexpected answer', () => {
    expect(serverDisplayTargets(null, origin)).toEqual([])
    expect(serverDisplayTargets({ displays: [{ name: 'x' }] }, origin)).toEqual(
      []
    )
  })
})

describe('isServerDisplay', () => {
  it('knows a browser display on this server', () => {
    expect(isServerDisplay(`${origin}${HMI_DISPLAYS}/helm`, origin)).toBe(true)
  })

  it('leaves panels and other servers to the proxy', () => {
    expect(isServerDisplay('http://cockpit.local', origin)).toBe(false)
    expect(
      isServerDisplay(`http://other.local${HMI_DISPLAYS}/helm`, origin)
    ).toBe(false)
    expect(isServerDisplay(`${origin}${HMI_DISPLAYS}/helm`, undefined)).toBe(
      false
    )
  })
})

describe('browser displays in the picker', () => {
  it('tells two displays of one server apart', () => {
    const helm = { url: `${origin}${HMI_DISPLAYS}/helm`, name: 'h', txt: {} }
    const salon = { url: `${origin}${HMI_DISPLAYS}/salon`, name: 's', txt: {} }
    expect(normalizeDeviceUrl(`${salon.url}/`)).toBe(salon.url)
    expect(matchDevice([helm, salon], salon.url)).toBe(salon)
  })

  it('keeps a panel url as it was', () => {
    expect(normalizeDeviceUrl('http://Cockpit.local/')).toBe(
      'http://cockpit.local'
    )
  })

  it('never offers the old layout port for a display path', () => {
    expect(otherPanelUrl(`${origin}${HMI_DISPLAYS}/helm`)).toBeUndefined()
    expect(otherPanelUrl('http://cockpit.local')).toBe(
      'http://cockpit.local:8081'
    )
  })
})

describe('fetchServerDisplays', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const answer = (status: number): void => {
    vi.stubGlobal('location', { origin })
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ displays: [] }), { status })
        )
      )
    )
  }

  it('finds nothing where the plugin is absent or closed to this user', async () => {
    for (const status of [401, 403, 404]) {
      answer(status)
      await expect(fetchServerDisplays()).resolves.toEqual([])
    }
  })

  it('reports a server error instead of finding nothing', async () => {
    answer(500)
    await expect(fetchServerDisplays()).rejects.toThrow('500')
  })
})
