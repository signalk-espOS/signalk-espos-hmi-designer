import { describe, it, expect } from 'vitest'
import {
  effectiveLevels,
  minStateFor,
  withLevel
} from '../webapp/src/notificationLevels'

describe('effectiveLevels', () => {
  it('derives every state from min_state when levels is absent', () => {
    const l = effectiveLevels({ enabled: true, min_state: 'warn' })
    expect(l.alert).toEqual({ show: false, sound: 'off', repeat_s: 0 })
    expect(l.warn).toEqual({ show: true, sound: 'source', repeat_s: 0 })
    expect(l.emergency).toEqual({ show: true, sound: 'source', repeat_s: 0 })
  })

  it('defaults to alarm without a config, as the firmware does', () => {
    const l = effectiveLevels(undefined)
    expect(l.warn.show).toBe(false)
    expect(l.alarm.show).toBe(true)
  })

  it('lets levels override a state and keeps the rest', () => {
    const l = effectiveLevels({
      enabled: true,
      min_state: 'alarm',
      levels: { warn: { show: true, sound: 'always' }, alarm: { repeat_s: 10 } }
    })
    expect(l.warn).toEqual({ show: true, sound: 'always', repeat_s: 0 })
    expect(l.alarm).toEqual({ show: true, sound: 'source', repeat_s: 10 })
    expect(l.alert.show).toBe(false)
  })
})

describe('minStateFor', () => {
  it('is the lowest shown state', () => {
    const l = effectiveLevels({
      enabled: true,
      min_state: 'emergency',
      levels: { warn: { show: true } }
    })
    expect(minStateFor(l)).toBe('warn')
  })

  it('falls back to emergency when nothing is shown', () => {
    const l = effectiveLevels({
      enabled: true,
      min_state: 'alarm',
      levels: { alarm: { show: false }, emergency: { show: false } }
    })
    expect(minStateFor(l)).toBe('emergency')
  })
})

describe('withLevel', () => {
  it('writes all four levels and a matching min_state', () => {
    const c = withLevel({ enabled: true, min_state: 'alarm' }, 'warn', {
      show: true
    })
    expect(c.min_state).toBe('warn')
    expect(Object.keys(c.levels ?? {})).toEqual([
      'alert',
      'warn',
      'alarm',
      'emergency'
    ])
    expect(c.levels?.warn).toEqual({ show: true, sound: 'off', repeat_s: 0 })
    expect(c.ack_method).toBe('modal')
  })

  it('keeps enabled', () => {
    const c = withLevel({ enabled: false, min_state: 'alarm' }, 'alarm', {
      repeat_s: 30
    })
    expect(c.enabled).toBe(false)
    expect(c.levels?.alarm?.repeat_s).toBe(30)
  })
})
