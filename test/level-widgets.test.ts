import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type {
  BatteryWidget,
  LampWidget,
  Layout,
  TankWidget,
  TrendWidget,
  Widget
} from '../webapp/src/schema'
import { bindsOf, siblingBinds } from '../webapp/src/widgetBinds'

const APP = readFileSync(
  fileURLToPath(new URL('../webapp/src/App.tsx', import.meta.url)),
  'utf8'
)
const KINDS = ['tank', 'battery', 'lamp', 'trend'] as const

const tank: TankWidget = {
  type: 'tank',
  id: 't',
  x: 0,
  y: 0,
  w: 120,
  h: 240,
  bind: 'tanks.freshWater.0.currentLevel',
  style: 'segments',
  capacity_bind: 'tanks.freshWater.0.capacity'
}
const battery: BatteryWidget = {
  type: 'battery',
  id: 'b',
  x: 0,
  y: 0,
  w: 280,
  h: 200,
  bind: 'electrical.batteries.house.capacity.stateOfCharge',
  voltage_bind: 'electrical.batteries.house.voltage',
  time_bind: 'electrical.batteries.house.capacity.timeRemaining'
}
const lamp: LampWidget = {
  type: 'lamp',
  id: 'l',
  x: 0,
  y: 0,
  w: 120,
  h: 120,
  bind: 'notifications.bilge.high'
}
const trend: TrendWidget = {
  type: 'trend',
  id: 'd',
  x: 0,
  y: 0,
  w: 320,
  h: 220,
  bind: 'environment.wind.directionTrue',
  bind2: 'environment.wind.speedTrue',
  window_s: 1800,
  invert: false,
  limit: 3,
  display2: { unit: 'kn', scale: 1.94384, decimals: 1 }
}

describe('level widget kinds', () => {
  it.each(KINDS)('%s has a default and is offered by the palette', (k) => {
    expect(APP).toContain(`case '${k}':`)
    const fallback = APP.slice(
      APP.indexOf('const availableKinds'),
      APP.indexOf('return Object.keys(hello.widgets)')
    )
    expect(fallback).toContain(`'${k}'`)
    const filter = APP.slice(APP.indexOf('return Object.keys(hello.widgets)'))
    expect(filter).toContain(`k === '${k}'`)
  })

  it('round-trips through JSON', () => {
    const layout: Layout = {
      schema: 1,
      name: 'levels',
      screens: [{ id: 's', title: 'S', widgets: [tank, battery, lamp, trend] }]
    }
    const back = JSON.parse(JSON.stringify(layout)) as Layout
    expect(back.screens[0]?.widgets).toEqual([tank, battery, lamp, trend])
  })
})

describe('bindsOf', () => {
  it('lists the second paths of the level widgets', () => {
    expect(bindsOf(tank)).toEqual([
      'tanks.freshWater.0.currentLevel',
      'tanks.freshWater.0.capacity'
    ])
    expect(bindsOf(battery)).toEqual([
      'electrical.batteries.house.capacity.stateOfCharge',
      'electrical.batteries.house.voltage',
      'electrical.batteries.house.capacity.timeRemaining'
    ])
    expect(bindsOf(trend)).toEqual([
      'environment.wind.directionTrue',
      'environment.wind.speedTrue'
    ])
  })

  it('takes no value path for a notification lamp', () => {
    expect(bindsOf(lamp)).toEqual([])
    const valueLamp: Widget = {
      ...lamp,
      bind: 'electrical.switches.bank.1.1.state'
    }
    expect(bindsOf(valueLamp)).toEqual(['electrical.switches.bank.1.1.state'])
  })
})

describe('siblingBinds', () => {
  const known = new Set([
    'tanks.fuel.0.capacity',
    'electrical.batteries.house.voltage',
    'electrical.batteries.house.current'
  ])

  it("fills a tank's capacity the server has", () => {
    const t: TankWidget = { ...tank, capacity_bind: undefined }
    expect(siblingBinds(t, 'tanks.fuel.0.currentLevel', known)).toEqual({
      capacity_bind: 'tanks.fuel.0.capacity'
    })
    expect(siblingBinds(t, 'tanks.fuel.1.currentLevel', known)).toEqual({})
  })

  it("fills a battery's empty side paths, only known ones", () => {
    const b: BatteryWidget = {
      ...battery,
      voltage_bind: undefined,
      current_bind: undefined,
      time_bind: undefined
    }
    expect(
      siblingBinds(
        b,
        'electrical.batteries.house.capacity.stateOfCharge',
        known
      )
    ).toEqual({
      voltage_bind: 'electrical.batteries.house.voltage',
      current_bind: 'electrical.batteries.house.current'
    })
  })

  it('keeps paths already set', () => {
    expect(
      siblingBinds(
        battery,
        'electrical.batteries.house.capacity.stateOfCharge',
        known
      )
    ).toEqual({ current_bind: 'electrical.batteries.house.current' })
  })

  it('leaves other kinds alone', () => {
    expect(siblingBinds(trend, 'tanks.fuel.0.currentLevel', known)).toEqual({})
  })
})

describe('siblingBinds on a new main bind', () => {
  const known = new Set([
    'electrical.batteries.start.voltage',
    'electrical.batteries.house.voltage'
  ])
  const filled: BatteryWidget = {
    ...battery,
    voltage_bind: 'electrical.batteries.house.voltage',
    current_bind: undefined,
    time_bind: 'electrical.batteries.house.capacity.timeRemaining'
  }

  it('moves the paths it filled to the new battery', () => {
    const side = siblingBinds(
      filled,
      'electrical.batteries.start.capacity.stateOfCharge',
      known
    )
    expect(side).toHaveProperty(
      'voltage_bind',
      'electrical.batteries.start.voltage'
    )
    expect(side).toHaveProperty('time_bind', undefined)
    expect(side).not.toHaveProperty('current_bind')
  })

  it('keeps a path picked by hand', () => {
    const own: BatteryWidget = {
      ...filled,
      voltage_bind: 'electrical.chargers.main.voltage'
    }
    expect(
      siblingBinds(
        own,
        'electrical.batteries.start.capacity.stateOfCharge',
        known
      )
    ).not.toHaveProperty('voltage_bind')
  })
})
