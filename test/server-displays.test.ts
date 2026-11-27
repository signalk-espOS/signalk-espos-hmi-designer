import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  HMI_DISPLAYS,
  fetchDevices,
  fetchServerDisplays,
  scanNotes,
  isServerAccessEntry,
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

  const answer = (
    status: number,
    body = JSON.stringify({ displays: [] })
  ): void => {
    vi.stubGlobal('location', { origin })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(body, { status })))
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

  it('reports an answer that is no display list', async () => {
    for (const body of ['<html>', '{}', '{"displays":{}}']) {
      answer(200, body)
      await expect(fetchServerDisplays()).rejects.toThrow('no display list')
    }
    answer(200)
    await expect(fetchServerDisplays()).resolves.toEqual([])
  })
})

describe('fetchDevices', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes on the servers a scan could not read', async () => {
    const failed = ['http://boat2.local:3000']
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ devices: [], failed: [...failed, 7] }))
        )
      )
    )
    await expect(fetchDevices()).resolves.toEqual({
      devices: [],
      limited: [],
      failed
    })
  })
})

describe('scanNotes', () => {
  it('names servers short of admin and servers that did not answer', () => {
    expect(
      scanNotes(
        {
          devices: [],
          limited: ['http://a.local:3000'],
          failed: ['http://b.local:3000', 'http://c.local']
        },
        false
      )
    ).toEqual([
      'a.local:3000 let the HMI Designer in without admin rights: give it ' +
        'admin under Security → Devices there',
      'no display list from b.local:3000, c.local'
    ])
  })

  it('keeps quiet about silent servers when the scan found targets', () => {
    expect(
      scanNotes({ devices: [], limited: [], failed: ['http://b.local'] }, true)
    ).toEqual([])
  })
})

describe('isServerAccessEntry', () => {
  it('tells the access entry from a display', () => {
    expect(isServerAccessEntry(`http://b.local:3000${HMI_DISPLAYS}`)).toBe(true)
    expect(isServerAccessEntry(`http://b.local:3000${HMI_DISPLAYS}/helm`)).toBe(
      false
    )
    expect(isServerAccessEntry('http://espos-1a2b.local')).toBe(false)
  })
})
