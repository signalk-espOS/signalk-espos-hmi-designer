import { describe, expect, it } from 'vitest'
import {
  collectPathInfo,
  formatPathValue,
  pathGroups,
  searchPaths
} from '../webapp/src/pathSearch'

const leaf = (value: unknown, meta?: Record<string, unknown>) => ({
  value,
  timestamp: '2026-11-14T17:00:00Z',
  ...(meta ? { meta } : {})
})

const tree = {
  uuid: 'urn:mrn:signalk:uuid:x',
  name: 'Boat',
  electrical: {
    batteries: {
      house: {
        voltage: leaf(13.2, { description: 'House bank voltage', units: 'V' }),
        current: leaf(-4.1, { units: 'A' })
      }
    }
  },
  tanks: {
    fuel: { 0: { currentLevel: leaf(0.5, { description: 'Diesel' }) } }
  },
  navigation: {
    position: leaf({ latitude: 1, longitude: 2 }),
    gnss: { satellitesInView: { values: {}, timestamp: 't' } }
  }
}

describe('collectPathInfo', () => {
  it('lists every leaf with its meta, sorted, and skips the vessel ids', () => {
    const infos = collectPathInfo(tree)
    expect(infos.map((i) => i.path)).toEqual([
      'electrical.batteries.house.current',
      'electrical.batteries.house.voltage',
      'navigation.gnss.satellitesInView',
      'navigation.position',
      'tanks.fuel.0.currentLevel'
    ])
    expect(infos[1]).toEqual({
      path: 'electrical.batteries.house.voltage',
      description: 'House bank voltage',
      units: 'V',
      value: 13.2
    })
  })
})

describe('searchPaths', () => {
  const infos = collectPathInfo(tree)

  it('matches every word against path and description', () => {
    expect(searchPaths(infos, 'house volt').map((i) => i.path)).toEqual([
      'electrical.batteries.house.voltage'
    ])
    expect(searchPaths(infos, 'diesel').map((i) => i.path)).toEqual([
      'tanks.fuel.0.currentLevel'
    ])
  })

  it('ranks paths that start with the query first', () => {
    const hits = searchPaths(
      [{ path: 'a.tanks' }, { path: 'tanks.fuel' }],
      'tanks'
    )
    expect(hits.map((i) => i.path)).toEqual(['tanks.fuel', 'a.tanks'])
  })

  it('limits to one subject area', () => {
    expect(searchPaths(infos, '', 'tanks')).toHaveLength(1)
    expect(pathGroups(infos)).toEqual(['electrical', 'navigation', 'tanks'])
  })
})

describe('formatPathValue', () => {
  it('keeps short readings', () => {
    expect(formatPathValue(13.21456, 'V')).toBe('13.215 V')
    expect(formatPathValue(true)).toBe('true')
    expect(formatPathValue({ a: 1 })).toBe('{…}')
    expect(formatPathValue(undefined)).toBe('')
    expect(formatPathValue(null)).toBe('–')
  })
})
