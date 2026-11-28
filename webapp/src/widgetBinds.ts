import type { Widget, WidgetKind } from './schema'

/** Every SK path a widget binds. Top-level for most kinds; the
 *  sub-bars inside a bargroup each contribute their own path, and the
 *  level widgets their second paths. A lamp on notifications.* binds no
 *  value path. */
export function bindsOf(w: Widget): string[] {
  const out: string[] = []
  if ('bind' in w && w.bind) {
    if (!(w.type === 'lamp' && w.bind.startsWith('notifications.')))
      out.push(w.bind)
  }
  if (w.type === 'bargroup') {
    for (const b of w.bars) if (b.bind) out.push(b.bind)
  }
  if (w.type === 'tank' && w.capacity_bind) out.push(w.capacity_bind)
  if (w.type === 'battery') {
    for (const b of [w.voltage_bind, w.current_bind, w.time_bind])
      if (b) out.push(b)
  }
  if (w.type === 'trend' && w.bind2) out.push(w.bind2)
  return out
}

export type SideBindField =
  'capacity_bind' | 'voltage_bind' | 'current_bind' | 'time_bind'

/** The side paths that go with a level widget's main bind. */
function derivedSides(
  kind: WidgetKind,
  bind: string
): Partial<Record<SideBindField, string>> {
  if (kind === 'tank') {
    const m = /^(tanks\.[^.]+\.[^.]+)\.currentLevel$/.exec(bind)
    return m ? { capacity_bind: `${m[1]}.capacity` } : {}
  }
  if (kind === 'battery') {
    const m = /^(electrical\.batteries\.[^.]+)\.capacity\.stateOfCharge$/.exec(
      bind
    )
    return m
      ? {
          voltage_bind: `${m[1]}.voltage`,
          current_bind: `${m[1]}.current`,
          time_bind: `${m[1]}.capacity.timeRemaining`
        }
      : {}
  }
  return {}
}

/** The paths that usually sit beside a level widget's main bind, filled
 *  in when it is chosen: a tank's capacity, a battery's voltage, current
 *  and time remaining. Only paths the server has. A field still empty is
 *  filled; one that was filled from the previous main bind follows the
 *  new one, and is cleared when the new one has no such path. A path
 *  picked by hand stays. */
export function siblingBinds(
  w: Widget,
  bind: string,
  known: ReadonlySet<string>
): Partial<Record<SideBindField, string | undefined>> {
  const out: Partial<Record<SideBindField, string | undefined>> = {}
  if (w.type !== 'tank' && w.type !== 'battery') return out
  const before = 'bind' in w ? derivedSides(w.type, w.bind) : {}
  const after = derivedSides(w.type, bind)
  const fields = new Set([
    ...Object.keys(before),
    ...Object.keys(after)
  ]) as Set<SideBindField>
  const rec = w as Partial<Record<SideBindField, string>>
  for (const f of fields) {
    const cur = rec[f]
    const followed = cur !== undefined && cur === before[f] && w.bind !== bind
    if (cur && !followed) continue
    const p = after[f]
    const next = p && known.has(p) ? p : undefined
    if (next !== cur) out[f] = next
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
