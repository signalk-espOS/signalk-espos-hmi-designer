// API helpers. All device traffic goes through the plugin's
// /device-proxy so the browser doesn't see cross-origin requests.

import { collectPathInfo, type PathInfo } from './pathSearch'
import {
  isHelloResponse,
  SCHEMA_VERSION,
  type HelloResponse,
  type Layout
} from './schema'

const PLUGIN_BASE = '/plugins/signalk-hmi-designer'

interface ProxyRequest {
  url: string
  method?: 'GET' | 'POST' | 'PUT'
  body?: unknown
}

/**
 * What a panel's 401 means here: it has an API key, and the designer sends
 * one only through signalk-espos-manager, which holds the key.
 */
export const NEEDS_KEY_MESSAGE =
  'the panel has an API key and refused this request: run ' +
  "signalk-espos-manager on this server with the panel's key (its fleet " +
  'key, or one set for this panel) and the designer uses it automatically'

/**
 * A 401 the panel sent, as opposed to one from the Signal K server about
 * the designer's own login: espOS names it in the body.
 */
function panelRefused(status: number, body: string): boolean {
  if (status !== 401) return false
  try {
    return (JSON.parse(body) as { error?: unknown }).error === 'unauthorized'
  } catch {
    return false
  }
}

/** Where signalk-espos-hmi lists its browser displays on this server. */
export const HMI_DISPLAYS = '/plugins/signalk-espos-hmi/displays'

function currentOrigin(): string | undefined {
  return typeof location === 'undefined' ? undefined : location.origin
}

/**
 * The scan's entry for a server that has not let the designer in yet:
 * the display list itself rather than a display.
 */
export function isServerAccessEntry(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/$/, '') === HMI_DISPLAYS
  } catch {
    return false
  }
}

/**
 * Connect to a server access entry: the plugin asks that server for
 * access if it has none there yet. Answers with what the user does next.
 */
export async function checkServerAccess(url: string): Promise<string> {
  await deviceProxy<unknown>({ url, method: 'GET' })
  let host = url
  try {
    host = new URL(url).host
  } catch {
    /* keep it as given */
  }
  return `${host} lets the HMI Designer in: search again to list its displays`
}

/** A browser display of signalk-espos-hmi, on any server. */
export function isBrowserDisplay(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith(`${HMI_DISPLAYS}/`)
  } catch {
    return false
  }
}

/**
 * A browser display of signalk-espos-hmi on the server the designer runs
 * on. It is reached directly rather than through /device-proxy: pushing a
 * layout there needs the user's own admin login, which the proxy, a
 * request from the server to itself, does not carry.
 */
export function isServerDisplay(
  url: string,
  origin: string | undefined = currentOrigin()
): boolean {
  if (origin === undefined) return false
  try {
    const u = new URL(url)
    return u.origin === origin && u.pathname.startsWith(`${HMI_DISPLAYS}/`)
  } catch {
    return false
  }
}

async function serverDisplayRequest<T>(req: ProxyRequest): Promise<T> {
  const method = req.method ?? 'GET'
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  }
  if (req.body !== undefined) {
    init.headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
    init.body = JSON.stringify(req.body)
  }
  const r = await fetch(req.url, init)
  const text = await r.text()
  if (r.status === 401 || r.status === 403) {
    throw new Error(
      `the server refused this (${r.status}): sign in to Signal K as an ` +
        'admin to push to a browser display'
    )
  }
  if (!r.ok) {
    let msg = text
    try {
      const parsed = JSON.parse(text) as { error?: unknown; err?: unknown }
      if (typeof parsed.error === 'string') msg = parsed.error
      else if (typeof parsed.err === 'string') msg = parsed.err
    } catch {
      /* not JSON */
    }
    throw new Error(`browser display ${r.status}: ${msg}`)
  }
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

async function deviceProxy<T>(req: ProxyRequest): Promise<T> {
  if (isServerDisplay(req.url)) return serverDisplayRequest<T>(req)
  const r = await fetch(`${PLUGIN_BASE}/device-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  })
  const text = await r.text()
  if (panelRefused(r.status, text)) throw new Error(NEEDS_KEY_MESSAGE)
  if (!r.ok) {
    let msg = text
    try {
      const parsed = JSON.parse(text) as { error?: unknown }
      if (typeof parsed.error === 'string') msg = parsed.error
    } catch {
      /* not JSON */
    }
    throw new Error(`device proxy ${r.status}: ${msg}`)
  }
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

/**
 * The port of the layout API's own server, which panels ran before they
 * served it from their web server on port 80.
 */
const LEGACY_LAYOUT_PORT = '8081'

/**
 * The other address a panel can have, for a `url` that did not answer: the
 * web server port for the old layout API port (current firmware), the old
 * port for a URL without one (firmware before the move). Undefined for any
 * other port, which the user chose.
 */
export function otherPanelUrl(url: string): string | undefined {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  // A path is a browser display on a server, not a panel's layout API.
  if (u.pathname !== '/') return undefined
  if (u.port === LEGACY_LAYOUT_PORT) u.port = ''
  else if (u.port === '') u.port = LEGACY_LAYOUT_PORT
  else return undefined
  return u.toString().replace(/\/$/, '')
}

/** The proxy gave up waiting: the panel is down, and so is the other port. */
function timedOut(e: unknown): boolean {
  return e instanceof Error && /\babort/i.test(e.message)
}

/** The proxy reached nothing, as opposed to a panel that answered. */
function unreachable(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith('device proxy 502')
}

/**
 * /hello from `url`, or, when that does not answer, from the same panel's
 * other port (otherPanelUrl): panels moved the layout API from :8081 to
 * port 80. `url` in the result is the one that answered. When both fail,
 * the error of a panel that answered wins over one that is not there.
 */
export async function connectPanel(
  url: string
): Promise<{ hello: HelloResponse; url: string }> {
  try {
    return { hello: await fetchHello(url), url }
  } catch (first) {
    const other = otherPanelUrl(url)
    if (other === undefined || timedOut(first)) throw first
    try {
      return { hello: await fetchHello(other), url: other }
    } catch (second) {
      throw unreachable(first) && !unreachable(second) ? second : first
    }
  }
}

/** Capability fetch from a target device. */
export async function fetchHello(deviceUrl: string): Promise<HelloResponse> {
  const v = await deviceProxy<unknown>({
    url: `${deviceUrl.replace(/\/$/, '')}/hello`,
    method: 'GET'
  })
  if (!isHelloResponse(v)) {
    throw new Error('device returned a /hello with unexpected shape')
  }
  return v
}

export interface PushResult {
  ok: boolean
  err?: string
  name?: string
  screens?: number
  widgets?: number
}

/**
 * Fetch the device's current framebuffer as a Blob via the plugin
 * device-proxy. Returns the BMP as a blob the caller can drop into
 * URL.createObjectURL for use in <img src=...>.
 */
export async function fetchScreenshot(deviceUrl: string): Promise<Blob> {
  if (isBrowserDisplay(deviceUrl)) {
    throw new Error('a browser display has no screenshot')
  }
  const r = await fetch(`${PLUGIN_BASE}/device-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `${deviceUrl.replace(/\/$/, '')}/screenshot`,
      method: 'GET'
    })
  })
  if (!r.ok) {
    if (panelRefused(r.status, await r.clone().text())) {
      throw new Error(NEEDS_KEY_MESSAGE)
    }
    let msg = `screenshot HTTP ${r.status}`
    try {
      const j = (await r.json()) as { error?: unknown }
      if (typeof j.error === 'string') msg = j.error
    } catch {
      /* not JSON */
    }
    throw new Error(msg)
  }
  return r.blob()
}

/** Push a layout to a target device. */
export async function pushLayout(
  deviceUrl: string,
  layout: Layout
): Promise<PushResult> {
  if (layout.schema !== SCHEMA_VERSION) {
    throw new Error(`schema must be ${SCHEMA_VERSION}`)
  }
  const v = await deviceProxy<unknown>({
    url: `${deviceUrl.replace(/\/$/, '')}/layout`,
    method: 'POST',
    body: layout
  })
  if (typeof v !== 'object' || v === null) {
    throw new Error('device returned unexpected push result shape')
  }
  return v as PushResult
}

/**
 * Read the last-saved layout from the plugin's data dir. Returns null
 * if nothing has been saved yet (HTTP 404).
 */
export async function loadSavedLayout(): Promise<Layout | null> {
  const r = await fetch(`${PLUGIN_BASE}/layout`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`load layout: HTTP ${r.status}`)
  return (await r.json()) as Layout
}

/** Persist a layout to the plugin's data dir (atomic write). */
export async function saveLayout(layout: Layout): Promise<void> {
  const r = await fetch(`${PLUGIN_BASE}/layout`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout)
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`save layout: HTTP ${r.status} ${t}`)
  }
}

/**
 * Every SignalK path currently published on this server, with its
 * description, units and the value it had when fetched, by walking
 * GET /signalk/v1/api/vessels/self. Sorted by path.
 */
export async function fetchSelfPathInfo(): Promise<PathInfo[]> {
  const r = await fetch('/signalk/v1/api/vessels/self')
  if (!r.ok) throw new Error(`signalk self: ${r.status}`)
  return collectPathInfo((await r.json()) as unknown)
}

/**
 * SK path metadata as returned by
 *   GET /signalk/v1/api/vessels/self/<dot.path>/meta
 *
 * `displayUnits` is what the SK server delivers after merging user
 * unit preferences. `formula` is a simple JS-ish expression in `value`,
 * e.g. "value - 273.15" or "value * 1.94384". We only auto-resolve the
 * common shapes; unrecognised formulas fall back to identity.
 */
export type ZoneState =
  'nominal' | 'normal' | 'alert' | 'warn' | 'alarm' | 'emergency'

export interface MetaZone {
  lower: number
  upper: number
  state: ZoneState
  message?: string
}

export interface PathMeta {
  description?: string
  units?: string
  zones?: MetaZone[]
  displayUnits?: {
    category?: string
    targetUnit?: string
    formula?: string
    inverseFormula?: string
    symbol?: string
    displayFormat?: string
  }
}

/** Hex color for a zone state.
 *
 *  Maritime-helm escalation palette: green safe → yellow notice → orange
 *  act-soon → red act-now → purple critical/system-down. Bumps every SK
 *  state one severity step warmer than the SK spec defaults so a glance
 *  at the helm reads like a traffic light. Matches firmware
 *  `color_for_state` in [src/jlp/zone_registry.cpp].
 */
export function colorForZoneState(s: ZoneState): string {
  switch (s) {
    case 'nominal':
    case 'normal':
      return '#3fb950' // green
    case 'alert':
      return '#d29922' // yellow
    case 'warn':
      return '#db6d28' // orange
    case 'alarm':
      return '#f85149' // red
    case 'emergency':
      return '#a371f7' // purple
  }
}

/** Find the zone matching a display-space value; null if none.
 *
 * SK convention is half-open [lower, upper). That makes a "point
 * zone" where lower === upper (commonly authored for bool/int state
 * paths like a switch position — alert at 0, nominal at 1) match
 * nothing. Treat that case as equality on the point instead.
 */
export function matchZone(
  zones: MetaZone[] | undefined,
  displayValue: number
): MetaZone | null {
  if (!zones) return null
  for (const z of zones) {
    if (z.lower === z.upper) {
      if (displayValue === z.lower) return z
    } else if (displayValue >= z.lower && displayValue < z.upper) {
      return z
    }
  }
  return null
}

export interface DisplayDefaults {
  unit: string
  scale: number
  offset: number
  decimals: number
}

export type SkValue = number | string | boolean | null

/**
 * Split a widget bind that reaches past a SignalK leaf into a field of
 * that leaf's object value. `navigation.position` is a leaf whose value
 * is `{latitude, longitude}`; the bind `navigation.position.latitude`
 * resolves to `skPath: 'navigation.position'` (what to subscribe to and
 * fetch meta for) and `fieldPath: ['latitude']` (what to read from each
 * delta's value, see `getNestedField`). The segments address the value
 * itself, not the REST envelope around it, so `.value.` is never part
 * of a bind.
 *
 * Matches against the longest known SK path that is a dot-segment
 * prefix of `bind` (never a substring split mid-segment). Falls back
 * to treating the whole bind as a literal SK path, with no extra
 * field, when it is an exact known path, when `knownPaths` is empty
 * (not loaded yet), or when nothing matches, which reproduces the
 * pre-existing behaviour for ordinary binds.
 *
 * Pass a `Set` when resolving many binds against the same path list,
 * so it is built once rather than per bind.
 */
export function resolveBindPath(
  bind: string,
  knownPaths: readonly string[] | ReadonlySet<string>
): { skPath: string; fieldPath: string[] } {
  if (!bind) return { skPath: bind, fieldPath: [] }
  const known = knownPaths instanceof Set ? knownPaths : new Set(knownPaths)
  if (known.has(bind)) return { skPath: bind, fieldPath: [] }
  const segments = bind.split('.')
  for (let i = segments.length - 1; i > 0; i--) {
    const prefix = segments.slice(0, i).join('.')
    if (known.has(prefix)) {
      return { skPath: prefix, fieldPath: segments.slice(i) }
    }
  }
  return { skPath: bind, fieldPath: [] }
}

/** True when `bind` reaches into an object value rather than naming a
 *  SignalK leaf. The designer resolves such a bind client-side; the
 *  panel firmware subscribes to binds literally and cannot. */
export function isNestedBind(
  bind: string,
  knownPaths: readonly string[] | ReadonlySet<string>
): boolean {
  return resolveBindPath(bind, knownPaths).fieldPath.length > 0
}

/**
 * Read the field a resolved bind's `fieldPath` names from a delta
 * value. Null past the last object layer or for a non-scalar leaf;
 * scalars are the kinds `pushAllValues` already handles for pushed
 * data.
 */
export function getNestedField(
  value: unknown,
  fieldPath: readonly string[]
): SkValue {
  let cur: unknown = value
  for (const key of fieldPath) {
    if (cur === null || typeof cur !== 'object') return null
    cur = (cur as Record<string, unknown>)[key]
  }
  if (
    typeof cur === 'number' ||
    typeof cur === 'string' ||
    typeof cur === 'boolean'
  ) {
    return cur
  }
  return null
}

/** Fetch metadata for a SK path. Returns null on 404 / non-200. */
export async function fetchPathMeta(skPath: string): Promise<PathMeta | null> {
  // Sentinel binds (`@drop_here`) are local device actions, not SignalK
  // paths — the firmware resolves them itself. Asking the server for
  // their metadata is guaranteed to 404 and litters the browser console
  // on every layout load. Guarded here rather than at each call site so
  // new callers cannot reintroduce it.
  if (!skPath || skPath.startsWith('@')) return null
  const slashed = skPath.replace(/\./g, '/')
  const r = await fetch(`/signalk/v1/api/vessels/self/${slashed}/meta`)
  if (!r.ok) return null
  return (await r.json()) as PathMeta
}

/** One row in the synthetic `notifications` virtual array (the
 *  same shape the firmware exposes from its notifications registry
 *  when a list widget binds to `bind: "notifications"`). */
export interface NotificationRow {
  path: string
  state: string
  message: string
  method?: string[]
  createdAt?: string
}

/** Fetch the notifications.* SK tree, walk it client-side, and
 *  return a flat array of `{path, state, message, method?,
 *  createdAt?}` rows. SK exposes notifications as a tree; the device
 *  flattens it internally for its alert overlay / list widget, so
 *  the designer must do the same to render a faithful canvas
 *  preview. Returns an empty array if the tree is missing or empty.
 */
export interface FetchNotificationsOpts {
  /** Include cleared entries (state="normal"/"nominal"). Default
   *  false. The firmware notifications_registry drops cleared
   *  states; matching that here keeps the canvas preview honest
   *  for the common "pending alarms" list. Set true for an
   *  audit-style view that mirrors the raw SK tree. */
  includeCleared?: boolean
}

export async function fetchNotifications(
  opts: FetchNotificationsOpts = {}
): Promise<NotificationRow[]> {
  let r: Response
  try {
    r = await fetch('/signalk/v1/api/vessels/self/notifications')
  } catch {
    return []
  }
  if (!r.ok) return []
  const tree = (await r.json()) as unknown
  const out: NotificationRow[] = []
  const includeCleared = opts.includeCleared ?? false

  function walk(node: unknown, pathParts: string[]): void {
    if (!node || typeof node !== 'object') return
    const rec = node as Record<string, unknown>
    // Leaf detection: SK notification leaves have `value.state` and
    // `value.message`. Trees branch by sub-keys.
    if (
      typeof rec.value === 'object' &&
      rec.value !== null &&
      typeof (rec.value as Record<string, unknown>).state === 'string'
    ) {
      const v = rec.value as Record<string, unknown>
      // Normalize "warning" -> "warn"; some sources emit one, some
      // the other, and the palette + firmware speak "warn".
      const rawState = String(v.state ?? '')
      const state = rawState === 'warning' ? 'warn' : rawState
      if (!includeCleared && (state === 'normal' || state === 'nominal')) {
        return
      }
      out.push({
        path: pathParts.join('.'),
        state,
        message: String(v.message ?? ''),
        method: Array.isArray(v.method) ? (v.method as string[]) : undefined,
        createdAt: typeof v.createdAt === 'string' ? v.createdAt : undefined
      })
      return
    }
    for (const [k, sub] of Object.entries(rec)) {
      if (k === 'value' || k === '$source' || k === 'timestamp') continue
      walk(sub, [...pathParts, k])
    }
  }
  walk(tree, [])
  return out
}

/**
 * Derive display defaults from SK metadata. Returns null if `meta` has
 * no displayUnits at all. Recognised formulas:
 *   "value"            -> scale=1 offset=0  (identity)
 *   "value - <N>"      -> scale=1 offset=-N (K -> C)
 *   "value + <N>"      -> scale=1 offset=+N
 *   "value * <N>"      -> scale=N offset=0  (rad->deg, m/s->kn, ratio->%)
 *   "value / <N>"      -> scale=1/N offset=0
 * Anything else stays identity and the user can fix it.
 */
export function deriveDisplayDefaults(meta: PathMeta): DisplayDefaults | null {
  if (!meta.displayUnits) return null
  const du = meta.displayUnits
  const unit = du.symbol ?? du.targetUnit ?? meta.units ?? ''
  const decimals = decimalsFromFormat(du.displayFormat)
  const { scale, offset } = parseFormula(du.formula ?? 'value')
  return { unit, scale, offset, decimals }
}

function decimalsFromFormat(fmt: string | undefined): number {
  if (!fmt) return 1
  // "0.0" -> 1, "0.00" -> 2, "0" -> 0
  const dot = fmt.indexOf('.')
  if (dot === -1) return 0
  return fmt.length - dot - 1
}

function parseFormula(formula: string): { scale: number; offset: number } {
  const trimmed = formula.trim()
  if (trimmed === 'value') return { scale: 1, offset: 0 }
  const sub = /^value\s*-\s*([\d.eE+-]+)$/.exec(trimmed)
  if (sub && sub[1] !== undefined) return { scale: 1, offset: -Number(sub[1]) }
  const add = /^value\s*\+\s*([\d.eE+-]+)$/.exec(trimmed)
  if (add && add[1] !== undefined) return { scale: 1, offset: Number(add[1]) }
  const mul = /^value\s*\*\s*([\d.eE+-]+)$/.exec(trimmed)
  if (mul && mul[1] !== undefined) return { scale: Number(mul[1]), offset: 0 }
  const div = /^value\s*\/\s*([\d.eE+-]+)$/.exec(trimmed)
  if (div && div[1] !== undefined) {
    const n = Number(div[1])
    return { scale: n === 0 ? 1 : 1 / n, offset: 0 }
  }
  return { scale: 1, offset: 0 }
}

/** A cockpit panel the plugin found on the LAN via mDNS. */
export interface DiscoveredDevice {
  url: string
  name: string
  txt: Record<string, string>
}

/** Ask the plugin to browse `_signalk-player._tcp`. The browse runs on
 *  the SignalK server (which is on the boat LAN), not in the browser,
 *  which cannot do mDNS. Takes ~1.5s while responders answer. */
export async function fetchDevices(): Promise<Discovery> {
  const r = await fetch(`${PLUGIN_BASE}/devices`)
  if (!r.ok) throw new Error(`device discovery failed: ${r.status}`)
  const body: unknown = await r.json()
  if (
    typeof body !== 'object' ||
    body === null ||
    !Array.isArray((body as { devices?: unknown }).devices)
  ) {
    throw new Error('device discovery returned an unexpected shape')
  }
  const { devices, limited, failed } = body as {
    devices: DiscoveredDevice[]
    limited?: unknown
    failed?: unknown
  }
  return { devices, limited: strings(limited), failed: strings(failed) }
}

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((a): a is string => typeof a === 'string')
    : []
}

/**
 * What a network scan found: panels and browser displays (a server that
 * has not let the designer in yet is an entry to connect to), the servers
 * that let it in without admin rights, and the servers that did not
 * answer.
 */
export interface Discovery {
  devices: DiscoveredDevice[]
  limited: string[]
  failed: string[]
}

function hostsOf(servers: readonly string[]): string {
  return servers
    .map((f) => {
      try {
        return new URL(f).host
      } catch {
        return f
      }
    })
    .join(', ')
}

/**
 * What a scan that left servers out tells the user. A server that did
 * not answer is named only when nothing was `found`: on a marina LAN
 * other boats' servers would otherwise flag every scan.
 */
export function scanNotes(d: Discovery, found: boolean): string[] {
  const notes: string[] = []
  if (d.limited.length > 0) {
    notes.push(
      `${hostsOf(d.limited)} let the HMI Designer in without admin ` +
        'rights: give it admin under Security → Devices there'
    )
  }
  if (!found && d.failed.length > 0) {
    notes.push(`no display list from ${hostsOf(d.failed)}`)
  }
  return notes
}

/**
 * The browser displays signalk-espos-hmi serves on this server, as
 * targets. Empty when the plugin is not installed or this user may not
 * read it: the mDNS scan still stands on its own.
 */
export async function fetchServerDisplays(): Promise<DiscoveredDevice[]> {
  const origin = currentOrigin()
  if (origin === undefined) return []
  const r = await fetch(HMI_DISPLAYS, { credentials: 'same-origin' })
  // Absent plugin or no read access is an empty source; a server error
  // is a failure the scan has to report.
  if (r.status === 401 || r.status === 403 || r.status === 404) return []
  if (!r.ok) throw new Error(`browser display discovery failed: ${r.status}`)
  const body: unknown = await r.json().catch(() => null)
  return serverDisplayTargets(body, origin)
}

/** The `GET /displays` answer as picker entries. */
export function serverDisplayTargets(
  body: unknown,
  origin: string
): DiscoveredDevice[] {
  if (typeof body !== 'object' || body === null) return []
  const list = (body as { displays?: unknown }).displays
  if (!Array.isArray(list)) return []
  const out: DiscoveredDevice[] = []
  for (const d of list) {
    if (typeof d !== 'object' || d === null) continue
    const { id, name } = d as { id?: unknown; name?: unknown }
    if (typeof id !== 'string' || id === '') continue
    out.push({
      url: `${origin}${HMI_DISPLAYS}/${encodeURIComponent(id)}`,
      name: `${typeof name === 'string' && name ? name : id} (browser display)`,
      txt: {}
    })
  }
  return out
}

/** Reduce a device URL to what identifies the panel: scheme, host,
 *  port and, for a browser display, its path. Host names are case-insensitive, and neither a trailing slash
 *  nor the trailing dot of an mDNS FQDN makes it a different panel. An
 *  address that does not parse comes back trimmed but otherwise as typed,
 *  so a half-typed URL simply matches nothing. */
export function normalizeDeviceUrl(url: string): string {
  const trimmed = url.trim()
  try {
    const u = new URL(trimmed)
    const host = u.hostname.toLowerCase().replace(/\.$/, '')
    // Browser displays share their server's host and differ by path.
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.protocol}//${host}${u.port ? `:${u.port}` : ''}${path}`
  } catch {
    return trimmed
  }
}

/** The scanned panel the URL box currently points at, if any. */
export function matchDevice(
  devices: readonly DiscoveredDevice[],
  url: string
): DiscoveredDevice | undefined {
  const want = normalizeDeviceUrl(url)
  return devices.find((d) => normalizeDeviceUrl(d.url) === want)
}

/** Picker caption: the mDNS instance name plus where it lives, so two
 *  panels that kept the same default name stay tellable apart. */
export function deviceLabel(d: DiscoveredDevice): string {
  let where = d.url
  try {
    where = new URL(d.url).host
  } catch {
    // keep the raw url
  }
  return d.name && d.name !== where ? `${d.name} (${where})` : where
}

/** mDNS answers arrive in whatever order responders win the race, so
 *  the same two panels would swap places between scans. Sort a copy by
 *  name, then url. */
export function sortDevices(
  devices: readonly DiscoveredDevice[]
): DiscoveredDevice[] {
  return [...devices].sort(
    (a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url)
  )
}

// ---- backlight brightness -------------------------------------------------
//
// Brightness is espOS config, not a layout property: it lives in the device's
// `cockpit` namespace, is stored in NVS and is re-applied on every boot, so a
// value set here survives a reboot without the designer doing anything.
//
// It is served by the espOS web server on port 80. Current panels serve the
// layout API there too, older ones on :8081, so the port is replaced rather
// than the device URL reused as-is.

/** espOS config base (port 80) for a device given its layout API URL. */
function configBase(deviceUrl: string): string {
  const u = new URL(deviceUrl)
  u.port = ''
  u.pathname = ''
  return u.toString().replace(/\/$/, '')
}

/** Current backlight brightness in percent, or null if unsupported. */
export async function fetchBrightness(
  deviceUrl: string
): Promise<number | null> {
  // A browser display's brightness is its monitor's, not the layout's.
  if (isBrowserDisplay(deviceUrl)) return null
  const v = await deviceProxy<unknown>({
    url: `${configBase(deviceUrl)}/api/v1/config`,
    method: 'GET'
  })
  if (typeof v !== 'object' || v === null) return null
  const cockpit = (v as Record<string, unknown>).cockpit
  if (typeof cockpit !== 'object' || cockpit === null) return null
  const b = (cockpit as Record<string, unknown>).brightness
  return typeof b === 'number' ? b : null
}

/**
 * Set the backlight brightness and persist it. The device clamps to the
 * descriptor's 5..100; 0 is not offered because a panel at 0 cannot be
 * turned back up from its own screen.
 */
export async function setBrightness(
  deviceUrl: string,
  pct: number
): Promise<void> {
  const clamped = Math.max(5, Math.min(100, Math.round(pct)))
  await deviceProxy<unknown>({
    url: `${configBase(deviceUrl)}/api/v1/config`,
    method: 'PUT',
    body: { cockpit: { brightness: clamped } }
  })
}
