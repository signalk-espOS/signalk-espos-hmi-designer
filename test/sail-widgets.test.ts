import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Widget } from '../webapp/src/schema'
import { fixedSourcesOf, SAIL_KINDS } from '../webapp/src/widgetBinds'

const APP = readFileSync(
  fileURLToPath(new URL('../webapp/src/App.tsx', import.meta.url)),
  'utf8'
)

const KINDS = ['wind', 'compass', 'heel', 'performance', 'rudder'] as const

const widget = (w: Partial<Widget> & { type: Widget['type'] }): Widget =>
  ({ id: 'w', x: 0, y: 0, w: 300, h: 300, ...w }) as Widget

const binds = (w: Widget): string[] => fixedSourcesOf(w).map((s) => s.bind)

describe('sailing widget kinds', () => {
  it.each(KINDS)('%s is in every palette list', (kind) => {
    expect(SAIL_KINDS.has(kind)).toBe(true)
    expect(APP).toContain(`case '${kind}':`)
    const fallback = APP.slice(
      APP.indexOf('const availableKinds'),
      APP.indexOf('return Object.keys(hello.widgets)')
    )
    expect(fallback).toContain(`'${kind}'`)
    const filter = APP.slice(APP.indexOf('return Object.keys(hello.widgets)'))
    expect(filter).toContain(`k === '${kind}'`)
  })

  it('has no paths for an ordinary widget', () => {
    expect(fixedSourcesOf(widget({ type: 'value', bind: 'a.b' }))).toEqual([])
  })
})

describe('fixedSourcesOf', () => {
  it('reads apparent and true wind by default', () => {
    expect(binds(widget({ type: 'wind' }))).toEqual([
      'environment.wind.angleApparent',
      'environment.wind.speedApparent',
      'environment.wind.angleTrueWater',
      'environment.wind.speedTrue'
    ])
  })

  it('keeps the true wind angle for the target dot without true wind', () => {
    expect(
      binds(widget({ type: 'wind', true_wind: false, target_angle: true }))
    ).toEqual([
      'environment.wind.angleApparent',
      'environment.wind.speedApparent',
      'environment.wind.angleTrueWater',
      'performance.targetAngle'
    ])
  })

  it('follows the compass heading reference and markers', () => {
    expect(binds(widget({ type: 'compass' }))).toEqual([
      'navigation.headingMagnetic',
      'navigation.courseOverGroundMagnetic',
      'navigation.course.calcValues.bearingMagnetic'
    ])
    expect(
      binds(widget({ type: 'compass', heading_ref: 'true', markers: ['wind'] }))
    ).toEqual(['navigation.headingTrue', 'environment.wind.directionTrue'])
  })

  it('names attitude fields with the panel key and an extended bind', () => {
    expect(fixedSourcesOf(widget({ type: 'heel' }))).toEqual([
      {
        bind: 'navigation.attitude.roll',
        key: 'navigation.attitude#roll',
        units: 'rad'
      },
      {
        bind: 'navigation.attitude.pitch',
        key: 'navigation.attitude#pitch',
        units: 'rad'
      }
    ])
  })

  it('reads polar speed and rudder angle', () => {
    expect(binds(widget({ type: 'performance' }))).toEqual([
      'navigation.speedThroughWater',
      'performance.polarSpeed',
      'performance.velocityMadeGood'
    ])
    expect(binds(widget({ type: 'rudder' }))).toEqual(['steering.rudderAngle'])
  })
})
