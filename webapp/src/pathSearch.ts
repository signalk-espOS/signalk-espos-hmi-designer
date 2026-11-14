/** One SignalK path of this vessel, as the self tree showed it when the
 *  designer loaded it. Description and units come from the leaf's meta;
 *  the value is a snapshot, not live. */
export interface PathInfo {
  path: string
  description?: string
  units?: string
  value?: unknown
}

/** Walks GET /signalk/v1/api/vessels/self into one entry per leaf, sorted
 *  by path. A leaf is an object with `value` (or `values`) and
 *  `timestamp`; its internals are not paths. */
export function collectPathInfo(tree: unknown): PathInfo[] {
  const out: PathInfo[] = []
  const walk = (prefix: string, node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const obj = node as Record<string, unknown>
    if (('value' in obj || 'values' in obj) && 'timestamp' in obj) {
      if (!prefix) return
      const info: PathInfo = { path: prefix }
      const meta = obj.meta
      if (typeof meta === 'object' && meta !== null) {
        const m = meta as Record<string, unknown>
        if (typeof m.description === 'string' && m.description)
          info.description = m.description
        if (typeof m.units === 'string' && m.units) info.units = m.units
      }
      if ('value' in obj) info.value = obj.value
      out.push(info)
      return
    }
    for (const [k, v] of Object.entries(obj)) {
      walk(prefix ? `${prefix}.${k}` : k, v)
    }
  }
  walk('', tree)
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return out
}

/** The first path segment, which SignalK uses as the subject area
 *  (electrical, tanks, navigation, ...). */
export function pathGroup(path: string): string {
  const dot = path.indexOf('.')
  return dot < 0 ? path : path.slice(0, dot)
}

/** Subject areas present in `infos`, most populated first. */
export function pathGroups(infos: readonly PathInfo[]): string[] {
  const counts = new Map<string, number>()
  for (const i of infos) {
    const g = pathGroup(i.path)
    counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([g]) => g)
}

/** Entries matching every whitespace-separated word of `query` in their
 *  path or description, case-insensitive, optionally limited to one
 *  subject area. A path that starts with the query ranks first. */
export function searchPaths(
  infos: readonly PathInfo[],
  query: string,
  group?: string
): PathInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const q = query.trim().toLowerCase()
  const hits = infos.filter((i) => {
    if (group && pathGroup(i.path) !== group) return false
    if (words.length === 0) return true
    const hay = `${i.path} ${i.description ?? ''}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
  if (!q) return hits
  const starts = hits.filter((i) => i.path.toLowerCase().startsWith(q))
  const rest = hits.filter((i) => !i.path.toLowerCase().startsWith(q))
  return [...starts, ...rest]
}

/** A short reading of a raw SignalK value for the picker: numbers keep
 *  at most three decimals, objects and long strings are elided. */
export function formatPathValue(value: unknown, units?: string): string {
  if (value === undefined) return ''
  if (value === null) return '–'
  const unit = units ? ` ${units}` : ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value)
    const rounded = Math.round(value * 1000) / 1000
    return `${rounded}${unit}`
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') {
    return value.length > 24 ? `${value.slice(0, 23)}…` : value
  }
  return '{…}'
}
