import type { Widget, WidgetKind } from './schema'

/** Every SK path a widget binds. Top-level for most kinds; the
 *  sub-bars inside a bargroup each contribute their own path. */
export function bindsOf(w: Widget): string[] {
  const out: string[] = []
  if ('bind' in w && w.bind) out.push(w.bind)
  if (w.type === 'bargroup') {
    for (const b of w.bars) if (b.bind) out.push(b.bind)
  }
  return out
}

/** Kinds that drive the panel itself and never take a SignalK bind. */
export const PANEL_LOCAL_KINDS = new Set<WidgetKind>([
  'voice',
  'speaker',
  'mic',
  'volume',
  'stream'
])

/** Kinds that own a fixed family of SignalK paths instead of a `bind`. */
export const SAIL_KINDS = new Set<WidgetKind>([
  'wind',
  'compass',
  'heel',
  'performance',
  'rudder'
])

/** One path a sailing widget reads. `bind` is what the designer
 *  subscribes to (a field of an object value is written as an extended
 *  bind, navigation.attitude.roll); `key` is the name the panel and the
 *  WASM preview know it by (navigation.attitude#roll). */
export interface FixedSource {
  bind: string
  key: string
  /** Units of a field, which the server's path list cannot give. */
  units?: string
}

const plain = (p: string): FixedSource => ({ bind: p, key: p })

/** The paths a sailing widget reads with its options, as the firmware's
 *  sail_widgets.cpp picks them. Empty for every other kind. */
export function fixedSourcesOf(w: Widget): FixedSource[] {
  switch (w.type) {
    case 'wind': {
      const trueWind = w.true_wind ?? true
      const target = w.target_angle ?? false
      const out = [
        plain('environment.wind.angleApparent'),
        plain('environment.wind.speedApparent')
      ]
      if (trueWind || target) out.push(plain('environment.wind.angleTrueWater'))
      if (trueWind) out.push(plain('environment.wind.speedTrue'))
      if (target) out.push(plain('performance.targetAngle'))
      return out
    }
    case 'compass': {
      const mag = w.heading_ref !== 'true'
      const markers = w.markers ?? ['cog', 'waypoint']
      const out = [
        plain(mag ? 'navigation.headingMagnetic' : 'navigation.headingTrue')
      ]
      if (markers.includes('cog'))
        out.push(
          plain(
            mag
              ? 'navigation.courseOverGroundMagnetic'
              : 'navigation.courseOverGroundTrue'
          )
        )
      if (markers.includes('waypoint'))
        out.push(
          plain(
            mag
              ? 'navigation.course.calcValues.bearingMagnetic'
              : 'navigation.course.calcValues.bearingTrue'
          )
        )
      if (markers.includes('wind'))
        out.push(
          plain(
            mag
              ? 'environment.wind.directionMagnetic'
              : 'environment.wind.directionTrue'
          )
        )
      return out
    }
    case 'heel':
      return ['roll', 'pitch'].map((f) => ({
        bind: `navigation.attitude.${f}`,
        key: `navigation.attitude#${f}`,
        units: 'rad'
      }))
    case 'performance':
      return [
        plain('navigation.speedThroughWater'),
        plain('performance.polarSpeed'),
        plain('performance.velocityMadeGood')
      ]
    case 'rudder':
      return [plain('steering.rudderAngle')]
    default:
      return []
  }
}
