import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import GridLayout, {
  getCompactor,
  type LayoutItem as GLLayout
} from 'react-grid-layout'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  closestCenter
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import { setTransform, type PositionStrategy } from 'react-grid-layout/core'
import { WasmCanvas } from './WasmCanvas'
import { Popover } from './Popover'
import { fitTabs } from './fitTabs'
import { formatPathValue, type PathInfo } from './pathSearch'
import { UI_ICONS } from './uiIcons'
import { bindsOf } from './widgetBinds'
import { WidgetSheet, kindHasData, type SheetTab } from './WidgetSheet'
import { KIND_INFO, kindMatches } from './widgetIcons'
import {
  EDITOR_THEMES,
  applyEditorTheme,
  loadEditorTheme,
  parseEditorTheme,
  saveEditorTheme,
  type EditorTheme
} from './editorTheme'
import {
  NOTIFICATION_STATES,
  REPEAT_OPTIONS,
  SOUND_OPTIONS,
  effectiveLevels,
  withLevel
} from './notificationLevels'
import { useNotifications, useSkValues } from './skStream'
import {
  DEFAULT_TAB_STRIP_HEIGHT,
  effectiveVoice,
  IDLE_DIM_PRESETS,
  MIC_KINDS,
  IDLE_TIMEOUT_PRESETS,
  MIN_DEVICE_FIRMWARE,
  parseFirmwareVersion,
  STATUS_OVERLAY_HEIGHT,
  firmwareMeets,
  dayBase,
  mergeTheme,
  PANEL_THEME_MODES,
  panelThemeModes,
  resolvePanelTheme,
  tabStripModes,
  fontSizeOptions,
  type PanelThemeMode,
  type TabStripMode
} from './schema'

import {
  deriveDisplayDefaults,
  deviceLabel,
  checkServerAccess,
  fetchDevices,
  isServerAccessEntry,
  scanNotes,
  fetchServerDisplays,
  connectPanel,
  fetchPathMeta,
  fetchBrightness,
  fetchScreenshot,
  fetchSelfPathInfo,
  isNestedBind,
  loadSavedLayout,
  matchDevice,
  pushLayout,
  resolveBindPath,
  saveLayout,
  sortDevices,
  setBrightness,
  type DiscoveredDevice,
  type MetaZone,
  type PushResult
} from './api'
import type {
  Layout,
  Screen,
  Widget,
  WidgetKind,
  HelloResponse,
  NotificationSound
} from './schema'
import './app.css'

declare const __PLUGIN_VERSION__: string

// Gap between the canvas and the tabs drawn below it for an overlay strip.
const TAB_BELOW_GAP = 8

/* ---------- helpers ---------- */

// react-grid-layout uses unitless column/row coordinates. We translate
// to device pixels on export. Column width is derived per-render from
// the target display's `display.w` reported in /hello; rows are a
// fixed pixel height, 25 px, or 4 px on a small panel (SMALL_PANEL_H).
const COLS = 24
const ROW_HEIGHT = 25
// A panel lower than this snaps to 4 px rows: 25 px rows leave up to
// 24 px at the bottom of a 240 px panel unreachable, while 4 divides
// every height a 240 px panel offers (240, 212, 184, 156).
const SMALL_PANEL_H = 400
const SMALL_ROW_HEIGHT = 4
// Grid lines on a small panel every 5 rows, so 4 px snapping does not
// fill the canvas with lines.
const SMALL_ROW_LINES = 5

// react-grid-layout 2 takes its settings as config objects instead of
// flat props. The ones that never change live here so their identity is
// stable across renders.
//
// The designer must NOT auto-reflow: a drag of one widget should never
// displace another. No compaction disables gravity, and allowing overlap
// lets tiles park anywhere without pushing their siblings.
const FREEFORM_COMPACTOR = getCompactor(null, true)
// Drag only via the chrome bar (which only appears on selected widgets),
// so unselected widgets behave as pure click targets. The library's
// default 3px drag threshold is left on, so a click on the bar is never
// taken for a drag.
const DRAG_CONFIG = { handle: '.chrome' } as const
// Fallback width used before a device has connected (hello not loaded
// yet). 1024 matches the Waveshare 7B which we develop against.
const DEFAULT_DISPLAY_W = 1024
const DEFAULT_DISPLAY_H = 600

/** Returns the first `<prefix>-<n>` not already present in `existing`. */
function freshId(
  prefix: string,
  existing: ReadonlyArray<{ id: string }>
): string {
  const taken = new Set(existing.map((w) => w.id))
  for (let n = 1; n < 1_000_000; n++) {
    const candidate = `${prefix}-${n}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error('genId exhausted (somehow)')
}

function defaultWidget(
  kind: WidgetKind,
  existing: ReadonlyArray<{ id: string }>,
  displayW: number = DEFAULT_DISPLAY_W,
  displayH: number = DEFAULT_DISPLAY_H,
  reservedH: number = DEFAULT_TAB_STRIP_HEIGHT
): Widget {
  const id = freshId(kind, existing)
  const base = {
    id,
    x: 0,
    y: 0,
    w: 240,
    h: 100,
    label: kind
  } as const
  switch (kind) {
    case 'label':
      return {
        ...base,
        type: 'label',
        display: { unit: '', scale: 1, offset: 0, decimals: 1 }
      }
    case 'value':
      return {
        ...base,
        type: 'value',
        bind: '',
        w: 180,
        h: 100,
        display: { unit: '', scale: 1, offset: 0, decimals: 1 }
      }
    case 'toggle':
      return { ...base, type: 'toggle', bind: '' }
    case 'arc':
      return {
        ...base,
        type: 'arc',
        bind: '',
        min: 0,
        max: 100,
        display: { unit: '', scale: 1, offset: 0, decimals: 0 }
      }
    case 'bar':
      return {
        ...base,
        type: 'bar',
        bind: '',
        min: 0,
        max: 100,
        display: { unit: '', scale: 1, offset: 0, decimals: 0 }
      }
    case 'bargroup':
      return {
        ...base,
        type: 'bargroup',
        w: 360,
        h: 160,
        bars: [
          { label: 'A', bind: '', min: 0, max: 100 },
          { label: 'B', bind: '', min: 0, max: 100 },
          { label: 'C', bind: '', min: 0, max: 100 }
        ]
      }
    case 'button':
      return {
        ...base,
        type: 'button',
        bind: '',
        press_value: 1
      }
    case 'notifications':
      return {
        ...base,
        type: 'notifications',
        w: 480,
        h: 320,
        max_rows: 8,
        columns: [
          { label: 'PATH', field: 'path', width: 220 },
          { label: 'STATE', field: 'state', width: 80 },
          { label: 'MSG', field: 'message', width: 180 }
        ],
        row_color_field: 'state'
      }
    case 'anchor':
      return {
        ...base,
        type: 'anchor',
        // Square — the dial is drawn into min(w,h).
        w: 240,
        h: 240,
        label: '',
        display: { unit: 'm', scale: 1, offset: 0, decimals: 1 }
      }
    case 'anchor_track':
      return {
        ...base,
        type: 'anchor_track',
        // Square — the swing plot is drawn into min(w,h).
        w: 240,
        h: 240,
        label: '',
        display: { unit: 'm', scale: 1, offset: 0, decimals: 1 }
      }
    // The four voice widgets are panel-local: no bind, no SignalK. Sized like
    // the switch tiles they resemble; the device supplies its own caption
    // (TALK / SPEAKER / MIC / VOLUME) when label is empty.
    case 'voice':
      return { ...base, type: 'voice', w: 200, h: 100, label: '' }
    case 'speaker':
      return { ...base, type: 'speaker', w: 200, h: 100, label: '' }
    case 'mic':
      return { ...base, type: 'mic', w: 200, h: 100, label: '' }
    case 'volume':
      return { ...base, type: 'volume', w: 320, h: 100, label: '' }
    case 'stream':
      // Deliberately NOT ...base: the device's field list for stream has
      // no label, and the firmware rejects unadvertised fields. Default
      // to the connected panel's full screen minus the tab-strip row —
      // the capture is panel-sized and frames render unscaled, so
      // anything smaller crops.
      return {
        id,
        type: 'stream',
        x: 0,
        y: 0,
        w: displayW,
        h: displayH - reservedH
      }
    case 'slider':
      return {
        ...base,
        type: 'slider',
        w: 320,
        h: 100,
        label: '',
        bind: '',
        min: 0,
        max: 100,
        // decimals:1 (not 0) so a bound path's nonzero metadata precision
        // isn't blocked by applyBind's merge sentinel below, which treats
        // 1 as "still default" and 0 as "user set".
        display: { unit: '', scale: 1, offset: 0, decimals: 1 }
      }
  }
}

/* ---------- layout <-> grid conversion ---------- */

interface GridSpec {
  i: string
  x: number
  y: number
  w: number
  h: number
}

// A stream sized for a single screen fills the page, so a strip that
// appears later (status bar, fixed tabs) would crop it on the panel.
// Move it up first and shrink it only if it is taller than the page:
// the capture is panel-sized, so a smaller stream crops more.
function fitStreams(screens: Screen[], pageH: number): Screen[] {
  const overflows = (w: Widget): boolean =>
    w.type === 'stream' && w.y + w.h > pageH
  return screens.map((s) => {
    if (!s.widgets.some(overflows)) return s
    return {
      ...s,
      widgets: s.widgets.map((w) => {
        if (!overflows(w)) return w
        const h = Math.max(1, Math.min(w.h, pageH))
        return { ...w, y: Math.max(0, pageH - h), h }
      })
    }
  })
}

function widgetToGrid(w: Widget, colPxW: number, rowPxH: number): GridSpec {
  // Round the edges, not the sizes, so two widgets that touch in pixels
  // still share a grid line and do not overlap after a drag.
  const x = Math.round(w.x / colPxW)
  const y = Math.round(w.y / rowPxH)
  return {
    i: w.id,
    x,
    y,
    w: Math.max(1, Math.round((w.x + w.w) / colPxW) - x),
    h: Math.max(1, Math.round((w.y + w.h) / rowPxH) - y)
  }
}

function applyGrid(
  w: Widget,
  g: GLLayout,
  colPxW: number,
  rowPxH: number
): Widget {
  return {
    ...w,
    // Edges again, so neighbours on fractional columns neither gap
    // nor overlap by a pixel.
    x: Math.round(g.x * colPxW),
    y: Math.round(g.y * rowPxH),
    w: Math.round((g.x + g.w) * colPxW) - Math.round(g.x * colPxW),
    h: Math.round((g.y + g.h) * rowPxH) - Math.round(g.y * rowPxH)
  }
}

/** Single tab button wired into @dnd-kit's sortable list.
 *
 *  The whole tab is the drag handle (touch-friendly: the user can
 *  grab anywhere on the tab to drag it). Click activation distance
 *  on the parent PointerSensor keeps a normal tap-to-switch from
 *  starting a drag — only a deliberate drag move past ~5 px begins
 *  a sort gesture.
 *
 *  The × close button stops propagation so a click on it never
 *  triggers the tab switch or starts a drag. */
function SortableTab(props: {
  id: string
  title: string
  active: boolean
  showClose: boolean
  onActivate: () => void
  onClose: () => void
}): React.JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: props.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    // Bump z so the dragged tab overlays its neighbors instead of
    // disappearing under them while in motion.
    zIndex: isDragging ? 5 : 'auto'
  }
  return (
    <button
      ref={setNodeRef}
      style={style}
      className={`tab ${props.active ? 'active' : ''}`}
      onClick={props.onActivate}
      title={props.id}
      {...attributes}
      {...listeners}
    >
      {props.title || props.id}
      {props.showClose && (
        <span
          className="tab-x"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            props.onClose()
          }}
          title="Delete this screen"
        >
          ×
        </span>
      )}
    </button>
  )
}

/** Fallback when nothing has been saved yet. Devices announce
 *  themselves as `_signalk-player._tcp` over mDNS; espOS names them
 *  `espos-<last 4 hex of MAC>`, so there is no single correct default —
 *  this is only a shape to edit, and the last working URL is remembered
 *  below. */
const DEFAULT_DEVICE_URL = 'http://espos-cockpit.local'
const DEVICE_URL_KEY = 'hmi-designer.deviceUrl'

// Room under the canvas for its one-line footer.
const CANVAS_FOOT_H = 36
// A tile this close to the top (in shown pixels) gets its selection bar
// below it, so the bar stays on the canvas.
const CHROME_ROOM = 60
const RAIL_OPEN_KEY = 'hmi-designer.railOpen'

/** Phone width: the widget list becomes a drawer and closes after a pick. */
function isPhone(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(max-width: 640px)').matches === true
  )
}

/** The widget list starts open where there is room for it, unless the
 *  user chose otherwise before. */
function loadRailOpen(): boolean {
  try {
    const saved = window.localStorage.getItem(RAIL_OPEN_KEY)
    if (saved === '1') return !isPhone()
    if (saved === '0') return false
  } catch {
    // Storage blocked: fall back to the width.
  }
  return typeof window !== 'undefined' && window.innerWidth >= 1400
}

function saveRailOpen(open: boolean): void {
  try {
    window.localStorage.setItem(RAIL_OPEN_KEY, open ? '1' : '0')
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}

/** The tab the sheet opens on for a widget. */
function firstTab(w: Widget): SheetTab {
  return kindHasData(w.type) ? 'data' : 'display'
}

/** What the device chip calls the connected panel: its mDNS name when a
 *  scan found it, else the host of its address. */
function shortDeviceName(
  url: string,
  devices: readonly DiscoveredDevice[] | null
): string {
  const found = devices ? matchDevice(devices, url) : undefined
  if (found) return found.name
  try {
    return new URL(url).hostname.replace(/\.local$/, '')
  } catch {
    return url
  }
}

/* ---------- the app ---------- */

export function App(): React.JSX.Element {
  // Remember the last device the user actually talked to. The old
  // hardcoded default ("p4-cockpit.local") stopped resolving when the
  // firmware moved to espOS, which derives the mDNS name from the MAC
  // (espos-<mac4>.local) — so every reload put a dead address in the
  // box and the connection failed until it was retyped by hand.
  const [deviceUrl, setDeviceUrl] = useState<string>(() => {
    try {
      const saved = window.localStorage.getItem(DEVICE_URL_KEY)
      if (saved) return saved
    } catch {
      // localStorage can throw in private mode / with cookies blocked;
      // fall through to the default rather than failing to render.
    }
    return DEFAULT_DEVICE_URL
  })
  const [editorTheme, setEditorTheme] = useState<EditorTheme>(loadEditorTheme)
  useEffect(() => {
    applyEditorTheme(editorTheme)
    saveEditorTheme(editorTheme)
  }, [editorTheme])
  const [kindFilter, setKindFilter] = useState<string>('')
  const [hello, setHello] = useState<HelloResponse | null>(null)
  const [helloErr, setHelloErr] = useState<string | null>(null)
  // Backlight brightness (percent). null = not loaded or unsupported by the
  // device. Persisted on the device in NVS, so this is a read of device
  // state, not designer state.
  const [brightness, setBrightnessState] = useState<number | null>(null)
  const [brightnessErr, setBrightnessErr] = useState<string | null>(null)
  // Every connect attempt takes the next generation; results from an older
  // one are dropped. A URL comparison alone is not enough -- reconnecting to
  // the SAME url must also invalidate the previous attempt's in-flight
  // results, and only a generation distinguishes those.
  const connectGen = useRef(0)
  // The url of the connection that actually answered. The input box is
  // editable, so `deviceUrl` is where the user is typing, not where the
  // device is; writes must target the latter.
  const [connectedUrl, setConnectedUrl] = useState<string | null>(null)

  const [paths, setPaths] = useState<string[]>([])
  const [pathInfo, setPathInfo] = useState<PathInfo[]>([])
  const knownPathSet = useMemo(() => new Set(paths), [paths])

  const [screens, setScreens] = useState<Screen[]>([
    { id: 'main', title: 'Main', widgets: [] }
  ])
  const [activeIdx, setActiveIdx] = useState<number>(0)
  const [statusOverlay, setStatusOverlay] = useState<boolean>(true)
  const [tabStrip, setTabStrip] = useState<TabStripMode>('fixed')
  // Kept from a loaded layout so a save does not drop it.
  const [tabStripHeightCfg, setTabStripHeightCfg] = useState<
    number | undefined
  >(undefined)
  const [notifConfig, setNotifConfig] = useState<
    Layout['notifications'] | undefined
  >(undefined)
  const [showNotifModal, setShowNotifModal] = useState<boolean>(false)
  // Asked in the page: kiosk browsers on a plotter may block window.confirm().
  const [pendingConfirm, setPendingConfirm] = useState<{
    message: string
    action: string
    run: () => void
  } | null>(null)
  const [displayConfig, setDisplayConfig] = useState<
    Layout['display'] | undefined
  >(undefined)
  const [showDisplayModal, setShowDisplayModal] = useState<boolean>(false)
  const [voiceConfig, setVoiceConfig] = useState<Layout['voice'] | undefined>(
    undefined
  )
  const [showVoiceModal, setShowVoiceModal] = useState<boolean>(false)
  const [themeConfig, setThemeConfig] = useState<Layout['theme'] | undefined>(
    undefined
  )
  const [showThemeModal, setShowThemeModal] = useState<boolean>(false)
  // Which panel theme the canvas shows. `auto` follows the layout; the
  // others preview a theme without changing the layout.
  const [previewTheme, setPreviewTheme] = useState<PanelThemeMode>('auto')
  // Clearing the last set field should drop the whole `theme` block
  // rather than leave a stray `{}` in the exported layout.
  const updateTheme = (patch: Partial<NonNullable<Layout['theme']>>): void => {
    setThemeConfig((prev) => mergeTheme(prev, patch))
  }
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Interim position of a currently-dragging/resizing tile. Set by
  // RGL onDrag/onResize, cleared on stop. Read by the WASM canvas
  // overlay so the LVGL render moves in lockstep with the chrome.
  // Null when nothing is being dragged.
  const [dragPreview, setDragPreview] = useState<{
    id: string
    grid: GLLayout
  } | null>(null)
  // The currently-active screen. Reads use this; writes use setActive().
  // Multi-screen layouts: tab strip at the bottom of canvas switches.
  const screen = screens[activeIdx] ??
    screens[0] ?? {
      id: 'main',
      title: 'Main',
      widgets: []
    }

  // Replace the active screen with a new value. Helper because every
  // legacy site that did setScreen((prev) => ...) now needs to splice
  // into the screens array at activeIdx.
  const setScreen = (update: Screen | ((prev: Screen) => Screen)): void => {
    setScreens((prev) => {
      const cur = prev[activeIdx] ?? prev[0]
      if (!cur) return prev
      const next = typeof update === 'function' ? update(cur) : update
      const out = [...prev]
      out[activeIdx] = next
      return out
    })
  }
  const [pathZones, setPathZones] = useState<Map<string, MetaZone[]>>(
    () => new Map()
  )
  // SK meta `description` per bound path; a label widget shows this
  // instead of the formatted value when `show_description` is set
  // (matches firmware behaviour).
  const [pathDescriptions, setPathDescriptions] = useState<Map<string, string>>(
    () => new Map()
  )
  const [shotUrl, setShotUrl] = useState<string | null>(null)
  const [shotOpacity, setShotOpacity] = useState<number>(1)
  const [shotErr, setShotErr] = useState<string | null>(null)
  // Preview backend behind the canvas. Two modes:
  //   'wasm'   — LVGL+widget_factory compiled to WebAssembly renders
  //              the layout into a 1024x600 <canvas> locally. Bit-
  //              identical to the device, no device needed. Default.
  //   'mirror' — poll the device's /screenshot?fmt=jpeg ~1 Hz; shows
  //              real device pixels (needs a reachable device).
  // The old SVG-approximation mode is gone — WASM gives pixel parity
  // for free on localhost, and the visual drift between SVG and the
  // actual device was the main reason for adding WASM in the first
  // place.
  const [previewMode, setPreviewMode] = useState<'mirror' | 'wasm'>('wasm')
  const liveMirror = previewMode === 'mirror'
  const liveShotRef = useRef<string | null>(null)
  const [liveMirrorStatus, setLiveMirrorStatus] = useState<string>('')
  const [wasmStatus, setWasmStatus] = useState<string>('')
  const [pushResult, setPushResult] = useState<PushResult | null>(null)
  const [pushErr, setPushErr] = useState<string | null>(null)

  // The in-flight (or settled) self-paths request. Push awaits it so a
  // push right after load still gets its binds checked, and retries it
  // once after a failure instead of trusting an empty list.
  const pathsRequest = useRef<Promise<string[]> | null>(null)
  const loadPaths = (): Promise<string[]> => {
    const req = fetchSelfPathInfo()
      .then((info) => {
        const p = info.map((i) => i.path)
        setPathInfo(info)
        setPaths(p)
        return p
      })
      .catch((e: unknown) => {
        setPathInfo([])
        setPaths([])
        throw e
      })
    pathsRequest.current = req
    return req
  }
  useEffect(() => {
    loadPaths().catch(() => {
      /* surfaced by whatever needs the list, e.g. onPush */
    })
  }, [])

  // Restore previously-saved layout on first mount. Hydrates all
  // screens (multi-screen support); zones are pre-fetched for every
  // bound path across every screen. Loaded layouts go through the
  // same adoptLayout path used by Load / Import so the migration
  // hook runs once and only once — keeps the saved-then-pushed flow
  // consistent (no risk of pushing a pre-migration shape to a
  // post-migration firmware).
  useEffect(() => {
    void loadSavedLayout()
      .then((saved) => {
        if (saved) adoptLayoutRef.current?.(saved)
      })
      .catch(() => {
        /* nothing to restore — leave the empty default */
      })
  }, [])

  // Live-mirror polling. When enabled, fetch /screenshot back-to-back
  // (no fixed interval — the device's encode + transfer time is the
  // natural rate-limit, currently ~700 ms for a JPEG frame). We loop
  // instead of using setInterval so we never queue overlapping
  // requests on a slow link. The previous blob URL is revoked when
  // a new frame lands so we don't leak browser memory at 1 fps for
  // hours.
  useEffect(() => {
    if (!liveMirror) {
      // Tearing down: free the last live frame so the next enable
      // starts clean. Leaves shotUrl alone if it was set from the
      // one-shot Show device button.
      if (liveShotRef.current) {
        URL.revokeObjectURL(liveShotRef.current)
        liveShotRef.current = null
      }
      setLiveMirrorStatus('')
      return
    }
    let cancelled = false
    // Minimum gap between the START of one screenshot fetch and the
    // next. Each /screenshot on the device takes an lv_snapshot +
    // JPEG encode on its single LVGL (UI) task (~hundreds of
    // ms). Polling with no gap pins that task at 100% and starves
    // everything else on it — most visibly, a concurrent push times
    // out ("device proxy 504"). 750 ms keeps the mirror feeling live
    // while leaving the device room to service pushes and its own
    // work. The device also single-flights /screenshot (429 on a
    // second concurrent request) as a belt-and-suspenders backstop.
    const MIN_INTERVAL_MS = 750
    const loop = async () => {
      while (!cancelled) {
        const t0 = performance.now()
        try {
          const blob = await fetchScreenshot(deviceUrl)
          const url = URL.createObjectURL(blob)
          // Atomic swap: revoke the OLD live URL only after the new
          // one is in state so the <img> never holds a freed URL.
          const prev = liveShotRef.current
          liveShotRef.current = url
          if (!cancelled) {
            setShotUrl(url)
            const ms = Math.round(performance.now() - t0)
            setLiveMirrorStatus(
              `${(blob.size / 1024).toFixed(0)} KB · ${ms} ms`
            )
          }
          if (prev) URL.revokeObjectURL(prev)
        } catch (e) {
          if (!cancelled) {
            setLiveMirrorStatus(
              `err: ${e instanceof Error ? e.message : String(e)}`
            )
            // Back off harder on errors (incl. 429 in-flight) so we
            // don't hammer a busy or down device.
            await new Promise((r) => setTimeout(r, 1000))
            continue
          }
        }
        // Pace the loop: sleep out the remainder of MIN_INTERVAL_MS
        // since this iteration started, so a fast device doesn't get
        // polled back-to-back.
        const remaining = MIN_INTERVAL_MS - (performance.now() - t0)
        if (remaining > 0 && !cancelled) {
          await new Promise((r) => setTimeout(r, remaining))
        }
      }
    }
    void loop()
    return () => {
      cancelled = true
    }
  }, [liveMirror, deviceUrl])

  const layoutDoc: Layout = useMemo(
    () => ({
      schema: 1,
      name: 'Designer',
      status_overlay: statusOverlay,
      ...(tabStrip !== 'fixed' ? { tab_strip: tabStrip } : {}),
      ...(tabStripHeightCfg !== undefined
        ? { tab_strip_height: tabStripHeightCfg }
        : {}),
      ...(notifConfig ? { notifications: notifConfig } : {}),
      ...(displayConfig ? { display: displayConfig } : {}),
      ...(themeConfig ? { theme: themeConfig } : {}),
      ...(voiceConfig ? { voice: voiceConfig } : {}),
      screens
    }),
    [
      screens,
      statusOverlay,
      tabStrip,
      tabStripHeightCfg,
      notifConfig,
      displayConfig,
      themeConfig,
      voiceConfig
    ]
  )
  const layoutVoice = useMemo(() => effectiveVoice(layoutDoc), [layoutDoc])
  const layoutHasMicWidget = useMemo(
    () =>
      screens.some((s) => s.widgets.some((w) => MIC_KINDS.includes(w.type))),
    [screens]
  )

  // Canvas dimensions track the connected device's /hello.display
  // so the designer is 1:1 with whatever panel it's targeting.
  // Before Connect, fall back to the Waveshare 7B native resolution.
  const displayW = hello?.display?.w ?? DEFAULT_DISPLAY_W
  const displayH = hello?.display?.h ?? DEFAULT_DISPLAY_H
  const colPxW = displayW / COLS
  const smallPanel = displayH < SMALL_PANEL_H
  const rowPxH = smallPanel ? SMALL_ROW_HEIGHT : ROW_HEIGHT
  const gridLinePxH = smallPanel ? rowPxH * SMALL_ROW_LINES : rowPxH
  // Tab strip is rendered only when there's more than one screen, to
  // match the firmware (which hides the strip in that case).
  const tabStripHeight = tabStripHeightCfg ?? DEFAULT_TAB_STRIP_HEIGHT
  const showTabStrip = screens.length > 1
  // An overlay strip leaves the pages the full height on the device.
  // The canvas marks where it shows and puts the editable tabs below.
  const tabOverlay = showTabStrip && tabStrip === 'overlay-bottom'
  const tabStripSpace = showTabStrip && !tabOverlay ? tabStripHeight : 0
  const tabModes = useMemo(() => tabStripModes(hello), [hello])
  const themeModes = useMemo(() => panelThemeModes(hello), [hello])
  const shownTheme = resolvePanelTheme(themeConfig, previewTheme)
  const tabBelowOffset = tabStripHeight + TAB_BELOW_GAP
  const fixedStripPageH =
    displayH - (statusOverlay ? STATUS_OVERLAY_HEIGHT : 0) - tabStripHeight

  const grid = useMemo(
    () => screen.widgets.map((w) => widgetToGrid(w, colPxW, rowPxH)),
    [screen.widgets, colPxW, rowPxH]
  )

  // Rows that fit the canvas: the display minus the status overlay strip
  // and the tab strip. With autoSize off this makes the grid container
  // fill the full canvas height, so widgets can be dragged into the lower
  // portion; otherwise RGL sizes itself to the lowest existing widget's
  // row, which leaves no drop zone below.
  const maxRows = Math.floor(
    (displayH - (statusOverlay ? STATUS_OVERLAY_HEIGHT : 0) - tabStripSpace) /
      rowPxH
  )
  // RGL defaults margin and containerPadding to [10,10], which shifts
  // everything by 10-20px per widget, and the canvas no longer reflects
  // the device 1:1. Zero both so JSON pixel coords map directly to canvas
  // pixels. Memoized: a fresh object each render would look like a config
  // change to the grid.
  const gridConfig = useMemo(
    () => ({
      cols: COLS,
      rowHeight: rowPxH,
      margin: [0, 0] as const,
      containerPadding: [0, 0] as const,
      maxRows
    }),
    [maxRows, rowPxH]
  )

  // Effective layout for the WASM canvas: layoutDoc with the
  // currently-dragging widget's coords overridden from dragPreview
  // so the wasm render moves in real-time as the user drags. When
  // nothing's being dragged, this is just layoutDoc verbatim.
  const wasmLayoutDoc = useMemo<Layout>(() => {
    if (!dragPreview) return layoutDoc
    const apply = (w: Widget): Widget =>
      w.id === dragPreview.id
        ? applyGrid(w, dragPreview.grid, colPxW, rowPxH)
        : w
    return {
      ...layoutDoc,
      screens: layoutDoc.screens.map((s, i) =>
        i === activeIdx ? { ...s, widgets: s.widgets.map(apply) } : s
      )
    }
  }, [layoutDoc, dragPreview, activeIdx, colPxW, rowPxH])

  // Live SK values for any bound widget. The hook re-subscribes when
  // the set of bound paths changes. Includes top-level widget binds
  // AND sub-bar binds inside bargroup widgets so per-bar tinting and
  // value display work in the canvas preview.
  const boundPaths = useMemo(
    () => screens.flatMap((s) => s.widgets.flatMap(bindsOf)),
    [screens]
  )
  const skValues = useSkValues(boundPaths, paths)
  // A slider bound to @brightness shows this panel's backlight, which is
  // not a SignalK path: feed the preview the level read from the
  // connected panel, so the knob sits where the panel's does.
  const previewValues = useMemo(() => {
    if (brightness === null) return skValues
    const next = new Map(skValues)
    next.set('@brightness', brightness)
    return next
  }, [skValues, brightness])

  // Notifications widgets are fed by polling SK's notifications.*
  // tree. Only poll if a layout actually uses a notifications widget
  // anywhere (don't hammer SK otherwise). If any widget asks for
  // include_cleared, widen the poll to cover cleared rows; the
  // wasm-side notifications registry filters per-widget when it
  // renders.
  const wantsNotifications = useMemo(
    () =>
      screens.some((s) => s.widgets.some((w) => w.type === 'notifications')),
    [screens]
  )
  const wantsCleared = useMemo(
    () =>
      screens.some((s) =>
        s.widgets.some(
          (w) => w.type === 'notifications' && w.include_cleared === true
        )
      ),
    [screens]
  )
  const notifications = useNotifications(wantsNotifications, wantsCleared)
  const selected = screen.widgets.find((w) => w.id === selectedId) ?? null

  // Set while a drag or resize runs, and for the click that ends it.
  const draggedRef = useRef(false)
  // Apply RGL geometry back to state ONLY for the single widget the
  // user just dragged or resized. Uses onDragStop / onResizeStop
  // (not onLayoutChange) because the latter fires on mount, remount,
  // and any layout-prop change — including tab switches, paste, load
  // — and writing those back to state grid-quantizes pixel positions,
  // drifting widgets over time.
  const onDragStop = (
    _layout: readonly GLLayout[],
    _oldItem: GLLayout | null,
    newItem: GLLayout | null
  ): void => {
    // The click that ends the drag fires after this; let it pass first.
    setTimeout(() => {
      draggedRef.current = false
    }, 0)
    setDragPreview(null)
    if (!newItem) return
    setScreen((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) =>
        w.id === newItem.i ? applyGrid(w, newItem, colPxW, rowPxH) : w
      )
    }))
  }
  const onResizeStop = onDragStop
  // During a drag/resize, RGL gives us interim positions on every
  // tick. We hold the interim shape in `dragPreview` (NOT in the
  // canonical screens state, which would grid-quantize the pixel
  // positions and drift widgets over time per the onDragStop
  // comment above). The wasm canvas reads from dragPreview when
  // set, falling back to the canonical layout otherwise — so
  // WASM mode shows the widget moving in real LVGL as you drag,
  // while SVG mode (which already updates from screens state)
  // sees no behaviour change.
  const onDragOrResize = (
    _layout: readonly GLLayout[],
    _oldItem: GLLayout | null,
    newItem: GLLayout | null
  ): void => {
    draggedRef.current = true
    if (!newItem) return
    setDragPreview({ id: newItem.i, grid: newItem })
  }

  /* ---- screen management ---- */

  const addScreen = (): void => {
    setScreens((prev) => {
      const taken = new Set(prev.map((s) => s.id))
      let n = prev.length + 1
      let id = `screen${n}`
      while (taken.has(id)) {
        n++
        id = `screen${n}`
      }
      const added = [...prev, { id, title: `Tab ${n}`, widgets: [] }]
      const next =
        prev.length === 1 && tabStrip !== 'overlay-bottom'
          ? fitStreams(added, fixedStripPageH)
          : added
      setActiveIdx(next.length - 1)
      return next
    })
    setSelectedId(null)
  }

  // By id: a confirmed delete runs after later renders may have
  // reordered the tabs, so the index is resolved from current state.
  const removeScreen = (id: string): void => {
    setScreens((prev) => {
      const idx = prev.findIndex((x) => x.id === id)
      if (idx < 0 || prev.length <= 1) return prev // keep at least one
      const next = prev.filter((_, i) => i !== idx)
      // Keep active in range; prefer the screen to the left.
      setActiveIdx((cur) => {
        if (cur > idx) return cur - 1
        if (cur === idx) return Math.max(0, idx - 1)
        return cur
      })
      return next
    })
    setSelectedId(null)
  }

  // Reorder screens after a tab drag. Keeps the active screen
  // active (its index follows along with the move) so the canvas
  // doesn't visibly switch tabs when the user only meant to reorder.
  const reorderScreens = (fromIdx: number, toIdx: number): void => {
    if (fromIdx === toIdx) return
    setScreens((prev) => arrayMove(prev, fromIdx, toIdx))
    setActiveIdx((cur) => {
      if (cur === fromIdx) return toIdx
      // Active was between from and to; shift by one in the right
      // direction since the dragged tab passed over it.
      if (fromIdx < toIdx && cur > fromIdx && cur <= toIdx) return cur - 1
      if (fromIdx > toIdx && cur < fromIdx && cur >= toIdx) return cur + 1
      return cur
    })
  }

  // Pointer + keyboard sensors. The 5 px activation distance lets a
  // normal tap-to-switch through; a deliberate drag past that starts
  // a sort. Keyboard works via Tab to focus + Space to pick up +
  // arrow keys to move.
  const sortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )
  const onTabDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const fromIdx = screens.findIndex((s) => s.id === active.id)
    const toIdx = screens.findIndex((s) => s.id === over.id)
    if (fromIdx === -1 || toIdx === -1) return
    reorderScreens(fromIdx, toIdx)
  }

  const renameScreen = (idx: number, title: string): void => {
    setScreens((prev) => {
      const cur = prev[idx]
      if (!cur) return prev
      const out = [...prev]
      out[idx] = { ...cur, title }
      return out
    })
  }

  const addWidget = (kind: WidgetKind): void => {
    // Pick a fresh id based on the *current* set so we don't collide
    // with anything already in the layout (e.g. loaded from server).
    setScreen((prev) => {
      // A new stream fills the page: below the status bar, and above
      // the tab strip when one takes room on the page.
      const w = defaultWidget(
        kind,
        prev.widgets,
        displayW,
        displayH,
        (statusOverlay ? STATUS_OVERLAY_HEIGHT : 0) + tabStripSpace
      )
      setSelectedId(w.id)
      return { ...prev, widgets: [...prev.widgets, w] }
    })
  }

  const removeWidget = (id: string): void => {
    setScreen((prev) => ({
      ...prev,
      widgets: prev.widgets.filter((w) => w.id !== id)
    }))
    if (selectedId === id) {
      setSelectedId(null)
      setSheetOpen(false)
    }
  }

  /* ---- copy/paste clipboard (in-memory, session-scoped) ---- */
  const clipboardRef = useRef<Widget | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Forward-ref so the boot-restore effect (declared above
  // adoptLayout for ordering reasons) can route through the same
  // migration + state-hydration path as Load / Import.
  const adoptLayoutRef = useRef<((l: Layout) => void) | null>(null)

  const copySelected = (): void => {
    const w = screen.widgets.find((x) => x.id === selectedId)
    if (!w) return
    clipboardRef.current = w
  }

  const pasteFromClipboard = (): void => {
    if (clipboardRef.current) insertCopy(clipboardRef.current)
  }

  // Paste and duplicate: a copy of `src` on the active screen, selected.
  const insertCopy = (src: Widget): void => {
    setScreen((prev) => {
      const kind = src.type
      // Keep the existing id-prefix scheme so the paste fits in.
      const id = freshId(kind, prev.widgets)
      // Offset the paste so it doesn't overlap the source exactly.
      // 20 device-px down+right is enough to be obviously a copy
      // without leaving the visible area.
      const pasted = {
        ...src,
        id,
        x: src.x + 20,
        y: src.y + 20
      } as Widget
      setSelectedId(id)
      return { ...prev, widgets: [...prev.widgets, pasted] }
    })
  }

  // Wire Ctrl/Cmd-C / Ctrl/Cmd-V to copy/paste. Ignore when the user
  // is typing in an input/textarea so native text copy/paste still
  // works in the property panels and path filter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      // A paste behind an open confirmation would change the layout the
      // user is about to confirm clearing or replacing.
      if (document.querySelector('dialog[open]')) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      const isEditable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (t?.isContentEditable ?? false)
      if (isEditable) return
      if (e.key === 'c' || e.key === 'C') {
        if (!selectedId) return
        e.preventDefault()
        copySelected()
      } else if (e.key === 'v' || e.key === 'V') {
        if (!clipboardRef.current) return
        e.preventDefault()
        pasteFromClipboard()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedId, screen.widgets, activeIdx])

  const updateWidget = (id: string, patch: Partial<Widget>): void => {
    setScreen((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) =>
        w.id === id ? ({ ...w, ...patch } as Widget) : w
      )
    }))
  }

  // Setting the bind ALSO triggers a metadata fetch from SK and
  // prefills any unfilled display fields (unit/scale/offset/decimals).
  // User-modified fields aren't overwritten — only empty/default
  // values get filled. Toggle / button widgets have no display block,
  // so the fetch is skipped.
  const applyBind = (id: string, path: string): void => {
    updateWidget(id, { bind: path })
    if (!path) return
    // An extended bind (`navigation.position.latitude`, reaching into
    // the leaf's object value) has no meta of its own: fetch the leaf's,
    // but keep prefill/zone state keyed by the full bind so the wasm
    // bridge (which subjects by the literal bind string) still gets it
    // under the right key.
    const { skPath } = resolveBindPath(path, paths)
    void fetchPathMeta(skPath).then((meta) => {
      if (!meta) return
      if (meta.zones && meta.zones.length > 0) {
        setPathZones((prev) => {
          const next = new Map(prev)
          next.set(path, meta.zones!)
          return next
        })
      }
      if (meta.description) {
        setPathDescriptions((prev) => {
          const next = new Map(prev)
          next.set(path, meta.description!)
          return next
        })
      }
      const d = deriveDisplayDefaults(meta)
      if (!d) return
      setScreen((prev) => ({
        ...prev,
        widgets: prev.widgets.map((w) => {
          if (w.id !== id) return w
          // Only widgets that have a display block get prefilled.
          if (
            w.type !== 'label' &&
            w.type !== 'value' &&
            w.type !== 'arc' &&
            w.type !== 'bar' &&
            w.type !== 'slider' &&
            w.type !== 'button'
          ) {
            return w
          }
          const cur = w.display ?? {}
          const merged = {
            unit: cur.unit && cur.unit !== '' ? cur.unit : d.unit,
            scale:
              cur.scale !== undefined && cur.scale !== 1 ? cur.scale : d.scale,
            offset:
              cur.offset !== undefined && cur.offset !== 0
                ? cur.offset
                : d.offset,
            decimals:
              cur.decimals !== undefined && cur.decimals !== 1
                ? cur.decimals
                : d.decimals
          }
          return { ...w, display: merged } as Widget
        })
      }))
    })
  }

  // Sub-bar counterpart of applyBind: bind the i-th bar of a bargroup
  // and hydrate its zones, description and display defaults the same
  // way, whether the path was picked from the list or typed.
  const applyBarBind = (id: string, i: number, bind: string): void => {
    setScreen((prev) => ({
      ...prev,
      widgets: prev.widgets.map((w) => {
        if (w.id !== id || w.type !== 'bargroup') return w
        return {
          ...w,
          bars: w.bars.map((b, j) => (j === i ? { ...b, bind } : b))
        }
      })
    }))
    if (!bind) return
    const { skPath } = resolveBindPath(bind, paths)
    void fetchPathMeta(skPath).then((meta) => {
      if (!meta) return
      if (meta.zones && meta.zones.length > 0) {
        setPathZones((prev) => {
          const next = new Map(prev)
          next.set(bind, meta.zones!)
          return next
        })
      }
      if (meta.description) {
        setPathDescriptions((prev) => {
          const next = new Map(prev)
          next.set(bind, meta.description!)
          return next
        })
      }
      // Only fills empty/default fields, never a user-set value.
      const d = deriveDisplayDefaults(meta)
      if (!d) return
      setScreen((prev) => ({
        ...prev,
        widgets: prev.widgets.map((wid) => {
          if (wid.id !== id || wid.type !== 'bargroup') return wid
          const bars2 = wid.bars.map((b, j) => {
            // The bind may have been retyped before the fetch resolved.
            if (j !== i || b.bind !== bind) return b
            const cur = b.display ?? {}
            return {
              ...b,
              display: {
                unit: cur.unit && cur.unit !== '' ? cur.unit : d.unit,
                scale:
                  cur.scale !== undefined && cur.scale !== 1
                    ? cur.scale
                    : d.scale,
                offset:
                  cur.offset !== undefined && cur.offset !== 0
                    ? cur.offset
                    : d.offset,
                decimals:
                  cur.decimals !== undefined && cur.decimals !== 1
                    ? cur.decimals
                    : d.decimals
              }
            }
          })
          return { ...wid, bars: bars2 }
        })
      }))
    })
  }

  /* ---- device discovery (mDNS, via the plugin) ---- */

  const [devices, setDevices] = useState<DiscoveredDevice[] | null>(null)
  const [scanning, setScanning] = useState(false)

  const onScan = async (): Promise<void> => {
    setScanning(true)
    setHelloErr(null)
    try {
      // The mDNS scan and this server's browser displays are separate
      // sources: one failing must not hide what the other found.
      const [panels, displays] = await Promise.allSettled([
        fetchDevices(),
        fetchServerDisplays()
      ])
      if (panels.status === 'rejected' && displays.status === 'rejected') {
        throw panels.reason
      }
      const found = sortDevices([
        ...(panels.status === 'fulfilled' ? panels.value.devices : []),
        ...(displays.status === 'fulfilled' ? displays.value : [])
      ])
      // A source that failed is said, also beside what the other found.
      const notes =
        panels.status === 'fulfilled'
          ? scanNotes(panels.value, found.length > 0)
          : []
      for (const r of [panels, displays]) {
        if (r.status === 'rejected') {
          notes.push(
            r.reason instanceof Error ? r.reason.message : String(r.reason)
          )
        }
      }
      setDevices(found)
      // One panel on the LAN is the common case — select it outright
      // rather than making the user pick from a list of one.
      // Never an access entry: connecting to it asks another server.
      if (found.length === 1 && found[0] && !isServerAccessEntry(found[0].url))
        setDeviceUrl(found[0].url)
      if (notes.length > 0) {
        setHelloErr(notes.join('; '))
      } else if (found.length === 0) {
        setHelloErr(
          'No panels or browser displays found. Check the panel is ' +
            'on the same network, or type its address.'
        )
      }
    } catch (e) {
      setHelloErr(e instanceof Error ? e.message : String(e))
    } finally {
      setScanning(false)
    }
  }

  // `url` is for callers that have just chosen a target: the state update
  // from setDeviceUrl has not landed yet, so reading deviceUrl would
  // connect to the previous panel.
  const onConnect = async (url?: string): Promise<void> => {
    setHelloErr(null)
    setHello(null)
    // Drop the previous device's identity and brightness immediately: leaving
    // either on screen during a connect would show one panel's state while
    // the slider writes to another.
    setConnectedUrl(null)
    setBrightnessState(null)
    setBrightnessErr(null)
    const target = url ?? deviceUrl
    const gen = ++connectGen.current
    // Results only count while this is still the newest attempt.
    const current = (): boolean => gen === connectGen.current
    if (isServerAccessEntry(target)) {
      try {
        const next = await checkServerAccess(target)
        if (current()) setHelloErr(next)
      } catch (e) {
        if (current()) setHelloErr(e instanceof Error ? e.message : String(e))
      }
      return
    }
    try {
      // A remembered :8081 is a panel from before the layout API moved to
      // port 80; connectPanel finds it there and the box follows, unless
      // the user has typed something else since.
      const { hello: h, url: answered } = await connectPanel(target)
      if (!current()) return
      setHello(h)
      setConnectedUrl(answered)
      if (answered !== target) {
        setDeviceUrl((typed) => (typed === target ? answered : typed))
      }
      // Only remember a URL that actually answered, so a typo does not
      // become the sticky default for every future session.
      try {
        window.localStorage.setItem(DEVICE_URL_KEY, answered)
      } catch {
        // non-fatal: the session still works, it just will not be remembered
      }
      // Brightness lives on the espOS config API, not /hello. null hides the
      // slider and means "this device does not report one"; a failed request
      // is an error and must say so, or a reachable panel looks unsupported.
      try {
        const b = await fetchBrightness(answered)
        if (current()) setBrightnessState(b)
      } catch (e) {
        if (current()) {
          setBrightnessState(null)
          setBrightnessErr(
            `brightness unavailable: ${e instanceof Error ? e.message : String(e)}`
          )
        }
      }
    } catch (e) {
      if (!current()) return
      setHelloErr(e instanceof Error ? e.message : String(e))
    }
  }

  // Choosing a scanned panel is the whole intent: fill the box and
  // connect, rather than asking for a second click on Connect.
  const onPickDevice = (url: string): void => {
    if (!url) return
    setDeviceUrl(url)
    void onConnect(url)
  }

  /**
   * Commit the brightness the slider was released on. Dragging updates the
   * number locally; only this writes, so one drag is one NVS write rather
   * than one per intermediate value.
   */
  const onBrightnessCommit = async (pct: number): Promise<void> => {
    // Write to the device that answered, never to whatever is currently in
    // the url box: the user may have typed or scanned a new one since.
    const target = connectedUrl
    if (!target) return
    const gen = connectGen.current
    setBrightnessErr(null)
    try {
      await setBrightness(target, pct)
    } catch (e) {
      if (gen !== connectGen.current) return
      setBrightnessErr(e instanceof Error ? e.message : String(e))
      // Put the slider back where the device actually is.
      try {
        const b = await fetchBrightness(target)
        if (gen === connectGen.current) setBrightnessState(b)
      } catch {
        /* leave the shown value; the error is already surfaced */
      }
    }
  }

  /* ---- file ops: save / load / export / import / clear ---- */

  const [fileMsg, setFileMsg] = useState<string | null>(null)

  /** One-shot migration for layouts saved under v0.1 schema:
   *
   *  - button widgets with `action: {put: {value, path?}}` are
   *    rewritten to `{bind: path ?? bind, press_value: value}`.
   *  - `list` widgets whose only data source was `bind: "notifications"`
   *    are renamed to `notifications` (the dedicated kind). The
   *    `bind` field is dropped (notifications is always the source).
   *    Any `list` with a different bind is left as-is so a future
   *    generic-table widget can reclaim that kind without a
   *    silent rewrite.
   *
   *  Non-button, non-list widgets pass through.
   */
  const migrateLayout = (l: Layout): Layout => {
    return {
      ...l,
      screens: l.screens.map((s) => ({
        ...s,
        widgets: s.widgets.map((w) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const legacy = w as any
          if (
            legacy.type === 'list' &&
            (legacy.bind === 'notifications' || legacy.bind === undefined)
          ) {
            const { type: _t, bind: _b, ...rest } = legacy
            void _t
            void _b
            return { ...rest, type: 'notifications' } as Widget
          }
          if (w.type !== 'button') return w
          if (legacy.action?.put && legacy.press_value === undefined) {
            const { action: _drop, ...rest } = legacy
            void _drop
            return {
              ...rest,
              bind: legacy.action.put.path ?? w.bind ?? '',
              press_value: legacy.action.put.value
            } as Widget
          }
          return w
        })
      }))
    }
  }

  // Zones, descriptions and the displayUnits prefill for every bind in
  // a layout, keyed by the bind string. Extended binds take the meta of
  // the leaf they reach into, resolved against `knownPaths`.
  const hydrateLayoutMeta = (
    l: Layout,
    knownPaths: readonly string[],
    onlyExtended = false
  ): void => {
    const known = new Set(knownPaths)
    for (const scr of l.screens) {
      for (const w of scr.widgets) {
        for (const p of bindsOf(w)) {
          // Capture the widget id + (for bargroup) sub-bar bind so
          // the async meta resolution can route the displayUnits
          // prefill back to the right slot without re-traversing
          // the layout.
          const widId = w.id
          const { skPath, fieldPath } = resolveBindPath(p, known)
          if (onlyExtended && fieldPath.length === 0) continue
          void fetchPathMeta(skPath).then((meta) => {
            if (!meta) return
            if (meta.zones && meta.zones.length > 0) {
              setPathZones((prev) => {
                const next = new Map(prev)
                next.set(p, meta.zones!)
                return next
              })
            }
            if (meta.description) {
              setPathDescriptions((prev) => {
                const next = new Map(prev)
                next.set(p, meta.description!)
                return next
              })
            }
            // Retroactive displayUnits prefill: existing layouts
            // (saved before the prefill code was added, or saved
            // before the user set unitsPreferences in SK) have raw
            // values and no `display` block. Patch those in here
            // without overwriting user-edited fields.
            const d = deriveDisplayDefaults(meta)
            if (!d) return
            setScreens((prev) =>
              prev.map((s) => ({
                ...s,
                widgets: s.widgets.map((wid) => {
                  if (wid.id !== widId) return wid
                  if (wid.type === 'bargroup') {
                    const bars2 = wid.bars.map((b) => {
                      if (b.bind !== p) return b
                      const cur = b.display ?? {}
                      return {
                        ...b,
                        display: {
                          unit: cur.unit && cur.unit !== '' ? cur.unit : d.unit,
                          scale:
                            cur.scale !== undefined && cur.scale !== 1
                              ? cur.scale
                              : d.scale,
                          offset:
                            cur.offset !== undefined && cur.offset !== 0
                              ? cur.offset
                              : d.offset,
                          decimals:
                            cur.decimals !== undefined && cur.decimals !== 1
                              ? cur.decimals
                              : d.decimals
                        }
                      }
                    })
                    return { ...wid, bars: bars2 }
                  }
                  if (
                    wid.type !== 'label' &&
                    wid.type !== 'value' &&
                    wid.type !== 'arc' &&
                    wid.type !== 'bar' &&
                    wid.type !== 'slider' &&
                    wid.type !== 'button'
                  ) {
                    return wid
                  }
                  // Only fill for the widget whose bind matches the
                  // path we just fetched meta for — a widget can have
                  // a bind set without it matching `p` if user
                  // changed it before the fetch resolved.
                  if ((wid as { bind?: string }).bind !== p) return wid
                  const cur = wid.display ?? {}
                  return {
                    ...wid,
                    display: {
                      unit: cur.unit && cur.unit !== '' ? cur.unit : d.unit,
                      scale:
                        cur.scale !== undefined && cur.scale !== 1
                          ? cur.scale
                          : d.scale,
                      offset:
                        cur.offset !== undefined && cur.offset !== 0
                          ? cur.offset
                          : d.offset,
                      decimals:
                        cur.decimals !== undefined && cur.decimals !== 1
                          ? cur.decimals
                          : d.decimals
                    }
                  } as Widget
                })
              }))
            )
          })
        }
      }
    }
  }

  // Replaces the entire designer state (screens + statusOverlay) with
  // a loaded Layout. Also re-fetches zones for every bound path so
  // colors appear immediately.
  const adoptLayout = (raw: Layout): void => {
    const l = migrateLayout(raw)
    setScreens(
      l.screens.length > 0
        ? l.screens
        : [{ id: 'main', title: 'Main', widgets: [] }]
    )
    setActiveIdx(0)
    setSelectedId(null)
    // A loaded layout replaces the whole designer state: a block it
    // omits has to go too, or the previous layout's settings ride along
    // into this one on the next save or push.
    setStatusOverlay(l.status_overlay ?? true)
    setTabStripHeightCfg(
      typeof l.tab_strip_height === 'number' && l.tab_strip_height > 0
        ? l.tab_strip_height
        : undefined
    )
    // A mode this designer does not know would leave the select, the
    // canvas and the saved JSON disagreeing.
    setTabStrip(l.tab_strip === 'overlay-bottom' ? 'overlay-bottom' : 'fixed')
    setNotifConfig(l.notifications)
    setDisplayConfig(l.display)
    setThemeConfig(l.theme)
    setVoiceConfig(l.voice)
    hydrateLayoutMeta(l, paths)
  }
  // Expose adoptLayout to the boot-restore effect via the ref. The
  // effect can't call adoptLayout directly because it's declared
  // above this point; the ref bridges the ordering.
  adoptLayoutRef.current = adoptLayout

  // An extended bind can only resolve once the self-paths list is
  // there, and both the boot restore and a bind typed early beat that
  // request. When the list lands, hydrate the extended binds of
  // whatever layout is current, from any source: restored, loaded or
  // typed. Plain binds were hydrated fine the first time, so only the
  // extended ones are fetched. `paths` is the trigger; the rest is
  // read from this render on purpose.
  useEffect(() => {
    if (paths.length === 0) return
    hydrateLayoutMeta(layoutDoc, paths, true)
  }, [paths])

  const onSave = async (): Promise<void> => {
    setFileMsg(null)
    try {
      await saveLayout(layoutDoc)
      setFileMsg('saved to SK server')
    } catch (e) {
      setFileMsg(`save failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const onLoad = (): void => {
    setFileMsg(null)
    setPendingConfirm({
      message: 'Load saved layout from SK server? Unsaved edits will be lost.',
      action: 'load',
      run: () => void loadFromServer()
    })
  }

  const loadFromServer = async (): Promise<void> => {
    try {
      const saved = await loadSavedLayout()
      if (!saved) {
        setFileMsg('no saved layout on server')
        return
      }
      adoptLayoutRef.current?.(saved)
      setFileMsg('loaded from SK server')
    } catch (e) {
      setFileMsg(`load failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const onExport = (): void => {
    const blob = new Blob([JSON.stringify(layoutDoc, null, 2)], {
      type: 'application/json'
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safeName = (layoutDoc.name || 'layout').replace(/[^a-z0-9_-]/gi, '_')
    a.href = url
    a.download = `${safeName}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setFileMsg(`exported ${safeName}.json`)
  }

  const onImportFile = async (file: File): Promise<void> => {
    setFileMsg(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as Layout
      if (parsed.schema !== 1 || !Array.isArray(parsed.screens)) {
        throw new Error('not a valid layout (schema 1 with screens[])')
      }
      adoptLayout(parsed)
      setFileMsg(`imported ${file.name}`)
    } catch (e) {
      setFileMsg(`import failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const onClear = (): void => {
    setPendingConfirm({
      message: 'Clear the canvas? All screens and widgets will be removed.',
      action: 'clear',
      run: () => {
        setScreens([{ id: 'main', title: 'Main', widgets: [] }])
        setActiveIdx(0)
        setSelectedId(null)
        setFileMsg('cleared')
      }
    })
  }

  const onPush = async (): Promise<void> => {
    setPushErr(null)
    setPushResult(null)
    // Refuse to push to a device whose firmware predates the fixes
    // this designer assumes are in place (boot-store recovery, touch
    // release-coords, backlight inversion). Pushing through anyway
    // tends to leave the screen showing just the status overlay over
    // black after the next reboot.
    if (hello && !firmwareMeets(hello.firmware, MIN_DEVICE_FIRMWARE)) {
      // Distinguish "too old" from "no version we can read": an
      // unparseable string is a reporting bug on the device, not an
      // outdated build, and saying "older than" sends people off to
      // reflash firmware that may already be newer.
      const parsed = parseFirmwareVersion(hello.firmware)
      setPushErr(
        parsed
          ? `Device firmware ${hello.firmware} is older than the ` +
              `${MIN_DEVICE_FIRMWARE} this designer build requires. Flash a ` +
              `newer release and try again.`
          : `Cannot read a version from the device firmware string ` +
              `${hello.firmware ?? '(none reported)'}. GET /hello must report ` +
              `a firmware ending in MAJOR.MINOR.PATCH (a -suffix is fine).`
      )
      return
    }
    // A panel that does not list the mode draws the strip fixed, over
    // the bottom of pages laid out for the full height.
    // One screen draws no strip, so the mode does not matter there.
    // The modes must come from the panel being pushed to, not from an
    // earlier connection or none.
    if (
      showTabStrip &&
      layoutDoc.tab_strip &&
      (!hello ||
        connectedUrl !== deviceUrl ||
        !tabModes.includes(layoutDoc.tab_strip))
    ) {
      setPushErr(
        !hello || connectedUrl !== deviceUrl
          ? `Connect to this panel first: tabs set to "${layoutDoc.tab_strip}" ` +
              'need a panel that lists that mode.'
          : `This panel cannot draw the tab strip as "${layoutDoc.tab_strip}". ` +
              'Set tabs to fixed, or update the panel firmware.'
      )
      return
    }
    // Firmware without panel themes would draw its old dark colors
    // whatever the layout says, so the mode must come from the panel
    // being pushed to.
    const wantMode = layoutDoc.theme?.mode
    const wantsThemes =
      wantMode !== undefined || layoutDoc.theme?.day_base !== undefined
    if (
      wantsThemes &&
      (!hello ||
        connectedUrl !== deviceUrl ||
        themeModes.length === 0 ||
        (wantMode !== undefined && !themeModes.includes(wantMode)))
    ) {
      setPushErr(
        !hello || connectedUrl !== deviceUrl
          ? 'Connect to this panel first: the layout picks a panel theme, ' +
              'which needs a panel that lists it.'
          : 'This panel has no day, dark and night themes. Under Theme, set ' +
              'both panel theme and by day to their defaults, or update the ' +
              'panel firmware.'
      )
      return
    }
    // The preview resolves a nested bind client-side, but the layout
    // reaches the panel with the bind as typed, and the firmware
    // subscribes to it literally: the widget would show nothing. Refuse
    // rather than push a layout that is broken on the device. Telling a
    // nested bind from a leaf needs the self-paths list, so wait for it
    // and refuse as well when it cannot be had.
    let known: ReadonlySet<string>
    try {
      const req = pathsRequest.current ?? loadPaths()
      known = new Set(
        await req.catch(() => {
          // Another push may already have started the retry; share it
          // rather than fetching the whole self tree once per click.
          const latest = pathsRequest.current
          return latest && latest !== req ? latest : loadPaths()
        })
      )
    } catch {
      setPushErr(
        'Could not load the SignalK path list, so binds cannot be ' +
          'checked before pushing. Check the server connection and try again.'
      )
      return
    }
    const nested = layoutDoc.screens.flatMap((s) =>
      s.widgets.flatMap((w) =>
        bindsOf(w)
          .filter((b) => isNestedBind(b, known))
          .map((b) => `${w.id}: ${b}`)
      )
    )
    if (nested.length > 0) {
      setPushErr(
        'The panel cannot resolve a bind that reaches into an object ' +
          'value; it subscribes to binds as literal SignalK paths. Bind ' +
          `to the parent path or remove the field first: ${nested.join(', ')}`
      )
      return
    }
    try {
      const r = await pushLayout(deviceUrl, layoutDoc)
      setPushResult(r)
      // Persist on successful device push (not on validation failure).
      // Save errors are non-fatal — surface but don't overwrite the
      // push success message.
      if (r.ok) {
        try {
          await saveLayout(layoutDoc)
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('layout saved on device but failed to persist on SK:', e)
        }
      }
    } catch (e) {
      setPushErr(e instanceof Error ? e.message : String(e))
    }
  }

  const availableKinds = useMemo<WidgetKind[]>(() => {
    if (!hello)
      return [
        'label',
        'value',
        'toggle',
        'arc',
        'bar',
        'bargroup',
        'button',
        'notifications',
        'anchor',
        'anchor_track',
        'voice',
        'speaker',
        'mic',
        'volume',
        'stream',
        'slider'
      ]
    return Object.keys(hello.widgets).filter(
      (k): k is WidgetKind =>
        k === 'label' ||
        k === 'value' ||
        k === 'toggle' ||
        k === 'arc' ||
        k === 'bar' ||
        k === 'bargroup' ||
        k === 'button' ||
        k === 'notifications' ||
        k === 'anchor' ||
        k === 'anchor_track' ||
        k === 'voice' ||
        k === 'speaker' ||
        k === 'mic' ||
        k === 'volume' ||
        k === 'stream' ||
        k === 'slider'
    )
  }, [hello])

  /* ---- editor chrome: widget list, sheet, menus, canvas fit ---- */

  const [railOpen, setRailOpenState] = useState<boolean>(loadRailOpen)
  const setRailOpen = (open: boolean): void => {
    setRailOpenState(open)
    // A phone opens the list as a drawer for one pick; only a choice
    // made on a wider screen is worth keeping.
    if (!isPhone()) saveRailOpen(open)
  }
  const [sheetOpen, setSheetOpen] = useState<boolean>(false)
  // A screen switch, delete or clear drops the selection; the sheet goes
  // with it, so a later paste does not reopen it unasked.
  useEffect(() => {
    if (!selectedId) setSheetOpen(false)
  }, [selectedId])
  const [sheetTab, setSheetTab] = useState<SheetTab>('data')
  const [menuOpen, setMenuOpen] = useState<boolean>(false)
  const [deviceOpen, setDeviceOpen] = useState<boolean>(false)
  const [screensOpen, setScreensOpen] = useState<boolean>(false)
  const menuBtnRef = useRef<HTMLButtonElement | null>(null)
  const deviceBtnRef = useRef<HTMLButtonElement | null>(null)
  const screensBtnRef = useRef<HTMLButtonElement | null>(null)
  const activeTabRef = useRef<HTMLButtonElement | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  const spacerRef = useRef<HTMLDivElement | null>(null)
  const addTabRef = useRef<HTMLButtonElement | null>(null)
  const tabEls = useRef<(HTMLButtonElement | null)[]>([])
  // Tabs that fit the toolbar; the rest move behind the screens menu, so a
  // layout with many screens stays one readable row on a tablet.
  const [tabFit, setTabFit] = useState<{
    shown: number[]
    overflow: boolean
  } | null>(null)
  useLayoutEffect(() => {
    const nav = navRef.current
    const spacer = spacerRef.current
    const bar = nav?.parentElement
    if (!nav || !spacer || !bar) return
    const measure = (): void => {
      // Narrow layouts hide the tabs and show the menu instead.
      if (nav.offsetParent === null) return
      const widths = screens.map((_, i) => tabEls.current[i]?.offsetWidth ?? 0)
      const more = screensBtnRef.current
      const moreShown = more !== null && more.offsetParent !== null
      // Room the tabs, the add button and the menu share: what the nav and
      // the spacer hold now, plus the menu while it is on screen.
      const avail =
        nav.clientWidth +
        spacer.clientWidth +
        (moreShown ? more.offsetWidth + 6 : 0) -
        8
      const next = fitTabs(widths, avail, {
        add: addTabRef.current?.offsetWidth ?? 40,
        more: moreShown ? more.offsetWidth + 6 : 110,
        gap: 2,
        active: activeIdx
      })
      setTabFit((prev) =>
        prev &&
        prev.overflow === next.overflow &&
        prev.shown.join() === next.shown.join()
          ? prev
          : next
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    // The spacer absorbs width changes of the other toolbar controls (a
    // longer device name), which leave the bar itself the same size.
    ro.observe(bar)
    ro.observe(spacer)
    ro.observe(nav)
    return () => ro.disconnect()
  }, [screens, activeIdx])
  const tabsOverflow = tabFit?.overflow === true

  // The panel is drawn at its own pixel size and scaled down to fit the
  // space between the widget list and the sheet; positions stay in
  // device pixels, react-grid-layout is told the scale for its drags.
  const canvasRef = useRef<HTMLElement | null>(null)
  const [canvasBox, setCanvasBox] = useState<{ w: number; h: number } | null>(
    null
  )
  useEffect(() => {
    const el = canvasRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setCanvasBox({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const stageH = displayH + (tabOverlay ? tabBelowOffset : 0)
  const fitScale = canvasBox
    ? Math.max(
        0.1,
        Math.min(
          1,
          canvasBox.w / displayW,
          (canvasBox.h - CANVAS_FOOT_H) / stageH
        )
      )
    : 1
  // Not createScaledStrategy: its drag start measures from the viewport
  // instead of the grid, so a tile jumped by the canvas offset on the
  // first move. Without calcDragPosition the library measures from the
  // grid and still divides by the scale.
  const scaledStrategy = useMemo<PositionStrategy>(
    () => ({
      type: 'transform',
      scale: fitScale,
      calcStyle: (pos) => setTransform(pos)
    }),
    [fitScale]
  )

  const recentBinds = useMemo(
    () => [...new Set(boundPaths)].sort(),
    [boundPaths]
  )
  const pathInfoByPath = useMemo(
    () => new Map(pathInfo.map((i) => [i.path, i])),
    [pathInfo]
  )
  const liveValueOf = (bind: string): string | undefined => {
    if (!bind) return undefined
    const info = pathInfoByPath.get(bind)
    const v = skValues.has(bind) ? skValues.get(bind) : info?.value
    return formatPathValue(v, info?.units)
  }

  const openWidget = (w: Widget): void => {
    if (selectedId !== w.id) setSheetTab(firstTab(w))
    setSelectedId(w.id)
    setSheetOpen(true)
  }

  const duplicateWidget = (id: string): void => {
    const src = screen.widgets.find((w) => w.id === id)
    if (src) insertCopy(src)
  }

  const chromeButton = (
    label: string,
    icon: React.ReactNode,
    run: () => void,
    className?: string
  ): React.JSX.Element => (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      // Not a drag: the bar around it is the drag handle.
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        run()
      }}
    >
      {icon}
    </button>
  )

  const previewSwitch = (
    <div className="segmented" role="group" aria-label="Canvas preview">
      <button
        type="button"
        className={previewMode === 'wasm' ? 'on' : ''}
        aria-pressed={previewMode === 'wasm'}
        onClick={() => {
          setPreviewMode('wasm')
          // Mirror leaves an <img> overlay at full opacity; if we
          // don't tear it down on the switch back to WASM, the
          // last-fetched JPEG sits on top of the LVGL canvas and
          // pretends to be the live render.
          if (shotUrl) {
            URL.revokeObjectURL(shotUrl)
            setShotUrl(null)
          }
        }}
        title="The panel's own widget code, compiled for the browser. Works without a panel."
      >
        Preview
      </button>
      <button
        type="button"
        className={previewMode === 'mirror' ? 'on' : ''}
        aria-pressed={previewMode === 'mirror'}
        onClick={() => {
          setPreviewMode('mirror')
          setShotErr(null)
          setShotOpacity(1)
        }}
        title="Show the connected panel's real screen, refreshed continuously"
      >
        Mirror
      </button>
    </div>
  )

  const notices: Array<{
    key: string
    text: string
    ok: boolean
    clear: () => void
  }> = []
  if (pushResult)
    notices.push({
      key: 'push',
      ok: pushResult.ok,
      text: pushResult.ok
        ? `Pushed ${pushResult.screens} screens, ${pushResult.widgets} widgets`
        : (pushResult.err ?? 'Push failed'),
      clear: () => setPushResult(null)
    })
  if (pushErr)
    notices.push({
      key: 'pushErr',
      ok: false,
      text: pushErr,
      clear: () => setPushErr(null)
    })
  if (helloErr)
    notices.push({
      key: 'hello',
      ok: false,
      text: helloErr,
      clear: () => setHelloErr(null)
    })
  if (brightnessErr)
    notices.push({
      key: 'brightness',
      ok: false,
      text: brightnessErr,
      clear: () => setBrightnessErr(null)
    })
  if (shotErr)
    notices.push({
      key: 'shot',
      ok: false,
      text: shotErr,
      clear: () => setShotErr(null)
    })
  if (fileMsg)
    notices.push({
      key: 'file',
      ok: !/fail/i.test(fileMsg),
      text: fileMsg,
      clear: () => setFileMsg(null)
    })

  const deviceState: 'on' | 'err' | 'off' =
    connectedUrl !== null && hello ? 'on' : helloErr ? 'err' : 'off'
  const deviceName =
    connectedUrl !== null ? shortDeviceName(connectedUrl, devices) : 'No panel'

  const closeMenus = (): void => {
    setMenuOpen(false)
    setDeviceOpen(false)
    setScreensOpen(false)
  }

  const screenPopover = (
    <div className="pop-section">
      <div className="pop-group">Screens</div>
      <div className="pop-screens">
        {screens.map((s, i) => (
          <button
            type="button"
            key={s.id}
            className={`pop-item ${i === activeIdx ? 'on' : ''}`}
            onClick={() => {
              setActiveIdx(i)
              setSelectedId(null)
            }}
          >
            {s.title || s.id}
            <span className="muted">{i + 1}</span>
          </button>
        ))}
        <button type="button" className="pop-item" onClick={addScreen}>
          {UI_ICONS.plus}
          Add screen
        </button>
      </div>
      <hr />
      <label>
        name of this screen
        <input
          value={screen.title}
          onChange={(e) => renameScreen(activeIdx, e.target.value)}
        />
      </label>
      {(tabModes.length > 1 || tabStrip !== 'fixed') && (
        <label title="Where the tab strip sits when the layout has more than one screen. Overlay: the pages take the full height, a swipe up from the bottom edge shows the tabs.">
          tab strip on the panel
          <select
            value={tabStrip}
            onChange={(e) => {
              const mode = e.target.value as TabStripMode
              setTabStrip(mode)
              if (mode === 'fixed' && showTabStrip) {
                setScreens((prev) => fitStreams(prev, fixedStripPageH))
              }
            }}
          >
            <option value="fixed">always shown</option>
            <option value="overlay-bottom">swipe up to show</option>
          </select>
        </label>
      )}
      {screens.length > 1 && (
        <button
          type="button"
          className="pop-item danger"
          onClick={() =>
            setPendingConfirm({
              message: `Delete screen "${screen.title}"?`,
              action: 'delete',
              run: () => removeScreen(screen.id)
            })
          }
        >
          {UI_ICONS.trash}
          Delete this screen
        </button>
      )}
    </div>
  )

  return (
    <div
      className={`hmi-app ${railOpen ? 'rail-open' : ''} ${sheetOpen && selected ? 'sheet-open' : ''}`}
      // Click anywhere not absorbed by a tile or interactive control
      // clears the selection and closes the sheet. Tile clicks
      // stopPropagation below.
      onClick={() => {
        setSelectedId(null)
        setSheetOpen(false)
      }}
    >
      <header
        className={`topbar${tabsOverflow ? ' tabs-overflow' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pop-anchor">
          <button
            ref={menuBtnRef}
            type="button"
            className="icon-btn"
            aria-label="Menu"
            title="Menu"
            aria-expanded={menuOpen}
            onClick={() => {
              const next = !menuOpen
              closeMenus()
              setMenuOpen(next)
            }}
          >
            {UI_ICONS.menu}
          </button>
          <Popover
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchorRef={menuBtnRef}
            label="Menu"
            className="menu"
          >
            <div className="pop-group">Layout</div>
            <button
              type="button"
              className="pop-item"
              onClick={() => {
                setMenuOpen(false)
                void onSave()
              }}
            >
              {UI_ICONS.save}
              Save to server
            </button>
            <button
              type="button"
              className="pop-item"
              onClick={() => {
                setMenuOpen(false)
                onLoad()
              }}
            >
              {UI_ICONS.open}
              Load from server
            </button>
            <button
              type="button"
              className="pop-item"
              onClick={() => {
                setMenuOpen(false)
                onExport()
              }}
            >
              {UI_ICONS.download}
              Export file
            </button>
            <button
              type="button"
              className="pop-item"
              onClick={() => {
                setMenuOpen(false)
                fileInputRef.current?.click()
              }}
            >
              {UI_ICONS.upload}
              Import file
            </button>
            <hr />
            <div className="pop-group">Panel</div>
            <button
              type="button"
              className="pop-item"
              onClick={() => {
                setMenuOpen(false)
                setShowNotifModal(true)
              }}
            >
              {UI_ICONS.bell}
              Alert overlay
            </button>
            <button
              type="button"
              className="pop-item"
              onClick={() => {
                setMenuOpen(false)
                setShowThemeModal(true)
              }}
            >
              {UI_ICONS.palette}
              Panel theme and colors
            </button>
            {hello?.display?.idle_timeout && (
              <button
                type="button"
                className="pop-item"
                onClick={() => {
                  setMenuOpen(false)
                  setShowDisplayModal(true)
                }}
              >
                {UI_ICONS.display}
                Display power save
              </button>
            )}
            {hello?.voice_config && (
              <button
                type="button"
                className="pop-item"
                onClick={() => {
                  setMenuOpen(false)
                  setShowVoiceModal(true)
                }}
              >
                {UI_ICONS.mic}
                Voice control
              </button>
            )}
            <hr />
            <div className="pop-group">View</div>
            <div className="pop-row narrow-only">
              <span>Preview</span>
              {previewSwitch}
            </div>
            <label className="pop-row">
              <span>Panel colors in the preview</span>
              <select
                aria-label="Panel theme preview"
                title="Which panel theme the canvas shows. As layout follows the panel theme; the others only change the preview."
                value={previewTheme}
                onChange={(e) =>
                  setPreviewTheme(
                    PANEL_THEME_MODES.find((m) => m === e.target.value) ??
                      'auto'
                  )
                }
              >
                <option value="auto">as layout</option>
                <option value="day">day</option>
                <option value="dark">dark</option>
                <option value="night">night</option>
              </select>
            </label>
            <label className="pop-row">
              <span>Editor theme</span>
              <select
                aria-label="Editor theme"
                title="How the editor looks. The panel's own theme is set under Panel theme and colors."
                value={editorTheme}
                onChange={(e) =>
                  setEditorTheme(parseEditorTheme(e.target.value))
                }
              >
                {EDITOR_THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id === 'auto' ? 'auto' : t.label.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <hr />
            <button
              type="button"
              className="pop-item danger"
              onClick={() => {
                setMenuOpen(false)
                onClear()
              }}
            >
              {UI_ICONS.trash}
              Clear layout…
            </button>
            <div className="pop-foot">HMI Designer v{__PLUGIN_VERSION__}</div>
          </Popover>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onImportFile(f)
              // Reset so picking the same file again still fires onChange.
              e.target.value = ''
            }}
          />
        </div>
        <button
          type="button"
          className="icon-btn rail-toggle"
          aria-label={
            railOpen ? 'Collapse the widget list' : 'Expand the widget list'
          }
          title={
            railOpen ? 'Collapse the widget list' : 'Expand the widget list'
          }
          aria-pressed={railOpen}
          onClick={() => setRailOpen(!railOpen)}
        >
          {UI_ICONS.rail}
        </button>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <strong>HMI Designer</strong>
        </div>
        <nav className="screen-tabs" aria-label="Screens" ref={navRef}>
          {screens.map((s, i) => {
            // Hidden tabs stay in the DOM, out of the flow, so they can
            // still be measured when the toolbar grows.
            const hidden = tabsOverflow && tabFit?.shown.includes(i) !== true
            return (
              <button
                type="button"
                key={s.id}
                ref={(el) => {
                  tabEls.current[i] = el
                  if (i === activeIdx) activeTabRef.current = el
                }}
                className={`${i === activeIdx ? 'on' : ''}${hidden ? ' tab-hidden' : ''}`}
                aria-hidden={hidden || undefined}
                tabIndex={hidden ? -1 : undefined}
                aria-current={i === activeIdx ? 'page' : undefined}
                title={
                  i === activeIdx
                    ? 'Screen settings'
                    : `Show ${s.title || s.id}`
                }
                onClick={() => {
                  if (i === activeIdx) {
                    const next = !screensOpen
                    closeMenus()
                    setScreensOpen(next)
                    return
                  }
                  setActiveIdx(i)
                  setSelectedId(null)
                }}
              >
                {s.title || s.id}
              </button>
            )
          })}
          <button
            ref={addTabRef}
            type="button"
            className="add"
            aria-label="Add screen"
            title="Add screen"
            onClick={addScreen}
          >
            {UI_ICONS.plus}
          </button>
        </nav>
        <div className="pop-anchor screens-anchor">
          <button
            ref={screensBtnRef}
            type="button"
            className="screen-select"
            aria-label="Screens"
            aria-expanded={screensOpen}
            onClick={() => {
              const next = !screensOpen
              closeMenus()
              setScreensOpen(next)
            }}
          >
            <span className="screen-more" aria-hidden="true">
              ⋯
            </span>
            <span className="screen-select-title">
              {screen.title || screen.id}
            </span>
            <span className="muted">
              {activeIdx + 1}/{screens.length}
            </span>
            {UI_ICONS.chevron}
          </button>
          <Popover
            open={screensOpen}
            onClose={() => setScreensOpen(false)}
            anchorRef={screensBtnRef}
            altAnchorRef={activeTabRef}
            label="Screens"
            className="screens-pop"
          >
            {screenPopover}
          </Popover>
        </div>
        <div className="topbar-spacer" ref={spacerRef} />
        <div className="wide-only">{previewSwitch}</div>
        <div className="pop-anchor">
          <button
            ref={deviceBtnRef}
            type="button"
            className={`device-chip ${deviceState}`}
            aria-expanded={deviceOpen}
            title="Panel connection"
            onClick={() => {
              const next = !deviceOpen
              closeMenus()
              setDeviceOpen(next)
            }}
          >
            <span className="dot" aria-hidden="true" />
            <span className="device-name">{deviceName}</span>
          </button>
          <Popover
            open={deviceOpen}
            onClose={() => setDeviceOpen(false)}
            anchorRef={deviceBtnRef}
            align="right"
            label="Panel connection"
            className="device-pop"
          >
            <div className="pop-section">
              <div className="device-head">
                <span className={`dot ${deviceState}`} aria-hidden="true" />
                <strong>{deviceName}</strong>
                <span className="muted">
                  {deviceState === 'on'
                    ? 'connected'
                    : deviceState === 'err'
                      ? 'not reachable'
                      : 'not connected'}
                </span>
              </div>
              {hello && (
                <p className="muted small">
                  {hello.firmware ?? 'device'}
                  {hello.display
                    ? ` · ${hello.display.w}×${hello.display.h}`
                    : ''}{' '}
                  · schema {hello.schema}
                  {hello.active_layout_name &&
                    ` · showing ${hello.active_layout_name} (${hello.layout_source ?? '?'})`}
                </p>
              )}
              <label>
                panel address
                <input
                  type="text"
                  className="mono"
                  value={deviceUrl}
                  onChange={(e) => setDeviceUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void onConnect()
                  }}
                  placeholder={DEFAULT_DEVICE_URL}
                />
              </label>
              {/* A real select, not a datalist: a datalist only offers entries
                  matching the text already in the box, and the box is pre-filled
                  with the last URL, so the other panels never showed. */}
              {devices && devices.length > 0 && (
                <label>
                  panels found on this network
                  <select
                    title="Picking one connects to it."
                    value={matchDevice(devices, deviceUrl)?.url ?? ''}
                    onChange={(e) => onPickDevice(e.target.value)}
                  >
                    <option value="" disabled>
                      {devices.length === 1
                        ? '1 panel found'
                        : `${devices.length} panels found`}
                    </option>
                    {devices.map((d) => (
                      <option key={d.url} value={d.url}>
                        {deviceLabel(d)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="grid-2">
                <button
                  type="button"
                  onClick={() => void onScan()}
                  disabled={scanning}
                  title="Find cockpit panels on this network (mDNS)"
                >
                  {scanning ? 'Searching…' : 'Search network'}
                </button>
                <button type="button" onClick={() => void onConnect()}>
                  Connect
                </button>
              </div>
              <label
                className="pop-row"
                title="Show the device's status strip at the top of the screen"
              >
                <span>Status strip at the top</span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={statusOverlay}
                  onChange={(e) => {
                    const on = e.target.checked
                    setStatusOverlay(on)
                    if (on) {
                      setScreens((prev) =>
                        fitStreams(
                          prev,
                          displayH - STATUS_OVERLAY_HEIGHT - tabStripSpace
                        )
                      )
                    }
                  }}
                />
              </label>
              {connectedUrl !== null && brightness !== null && (
                <label
                  className="pop-row"
                  title="Panel backlight brightness, stored on the device; survives a reboot"
                >
                  <span>Brightness {brightness}%</span>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={brightness}
                    onChange={(e) => setBrightnessState(Number(e.target.value))}
                    // pointerup, not mouseup+touchend: a touch dispatches
                    // touchend AND a compatibility mouseup, which would send two
                    // PUTs -- and two NVS writes -- for one release.
                    onPointerUp={(e) =>
                      void onBrightnessCommit(Number(e.currentTarget.value))
                    }
                    onKeyUp={(e) =>
                      void onBrightnessCommit(Number(e.currentTarget.value))
                    }
                  />
                </label>
              )}
            </div>
          </Popover>
        </div>
        <button
          type="button"
          className="primary push-btn"
          onClick={() => void onPush()}
          title="Send this layout to the panel"
        >
          {UI_ICONS.push}
          <span className="push-label">Push</span>
        </button>
      </header>

      {notices.length > 0 && (
        <div className="notices" onClick={(e) => e.stopPropagation()}>
          {notices.map((n) => (
            <div
              key={n.key}
              className={`notice ${n.ok ? 'ok' : 'err'}`}
              role="status"
            >
              <span>{n.text}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Dismiss"
                onClick={n.clear}
              >
                {UI_ICONS.close}
              </button>
            </div>
          ))}
        </div>
      )}

      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          action={pendingConfirm.action}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => {
            setPendingConfirm(null)
            pendingConfirm.run()
          }}
        />
      )}

      {showNotifModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowNotifModal(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Alert overlay</h3>
            <p className="muted small">
              Layout-level setting, per notification state: whether the device
              pops its full-screen modal, whether it chimes (never, when the
              notification&apos;s SK <code>method</code> asks for sound, or
              always) and whether the chime repeats until ACK. Only states that
              show or chime wake a dimmed panel. Tapping ACK on the device PUTs{' '}
              <code>state: "normal"</code> to the notification path. Defaults:
              enabled, alarm and emergency shown, sound as the source asks.
            </p>
            <label>
              <input
                type="checkbox"
                checked={notifConfig?.enabled ?? true}
                onChange={(e) =>
                  setNotifConfig({
                    ...notifConfig,
                    enabled: e.target.checked,
                    min_state: notifConfig?.min_state ?? 'alarm',
                    ack_method: 'modal'
                  })
                }
              />
              enabled
            </label>
            <table className="levels">
              <thead>
                <tr>
                  <th>state</th>
                  <th>show</th>
                  <th>sound</th>
                  <th>repeat</th>
                </tr>
              </thead>
              <tbody>
                {NOTIFICATION_STATES.map((s) => {
                  const l = effectiveLevels(notifConfig)[s]
                  return (
                    <tr key={s}>
                      <td>{s}</td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`show ${s}`}
                          checked={l.show}
                          onChange={(e) =>
                            setNotifConfig(
                              withLevel(notifConfig, s, {
                                show: e.target.checked
                              })
                            )
                          }
                        />
                      </td>
                      <td>
                        <select
                          aria-label={`sound for ${s}`}
                          value={l.sound}
                          onChange={(e) =>
                            setNotifConfig(
                              withLevel(notifConfig, s, {
                                sound: e.target.value as NotificationSound
                              })
                            )
                          }
                        >
                          {SOUND_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label={`repeat for ${s}`}
                          value={l.repeat_s}
                          disabled={l.sound === 'off'}
                          onChange={(e) =>
                            setNotifConfig(
                              withLevel(notifConfig, s, {
                                repeat_s: parseInt(e.target.value, 10)
                              })
                            )
                          }
                        >
                          {REPEAT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <label>
              ack method
              <select value="modal" disabled>
                <option value="modal">modal</option>
              </select>
            </label>
            <div className="modal-actions">
              <button
                className="ghost"
                onClick={() => {
                  setNotifConfig(undefined)
                  setShowNotifModal(false)
                }}
                title="Drop the notifications block (firmware defaults apply)"
              >
                clear
              </button>
              <button onClick={() => setShowNotifModal(false)}>done</button>
            </div>
          </div>
        </div>
      )}

      {showDisplayModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowDisplayModal(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Display</h3>
            <p className="muted small">
              Backlight power save. After the chosen idle interval the panel
              dims to the chosen brightness. Any touch, incoming notification (≥
              min state), or a fresh layout push wakes it and re-arms the timer.
            </p>
            <label>
              idle timeout
              <select
                value={displayConfig?.idle_timeout_sec ?? 0}
                onChange={(e) => {
                  const sec = parseInt(e.target.value, 10)
                  if (sec === 0) {
                    setDisplayConfig(undefined)
                  } else {
                    setDisplayConfig({
                      idle_timeout_sec: sec,
                      idle_dim_pct: displayConfig?.idle_dim_pct ?? 0
                    })
                  }
                }}
              >
                {IDLE_TIMEOUT_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              idle brightness
              <select
                value={displayConfig?.idle_dim_pct ?? 0}
                disabled={!displayConfig?.idle_timeout_sec}
                onChange={(e) => {
                  const pct = parseInt(e.target.value, 10)
                  setDisplayConfig({
                    idle_timeout_sec: displayConfig?.idle_timeout_sec ?? 0,
                    idle_dim_pct: pct
                  })
                }}
              >
                {IDLE_DIM_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted small">
              While dimmed the device shows a "TAP TO WAKE" overlay that
              consumes the first wake-tap, so no toggle or button underneath
              fires by accident. Tap-wake works at every brightness level —
              including 0% (fully off).
            </p>
            <div className="modal-actions">
              <button onClick={() => setShowDisplayModal(false)}>done</button>
            </div>
          </div>
        </div>
      )}

      {showVoiceModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowVoiceModal(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Voice control</h3>
            <p className="muted small">
              Lets a voice orchestrator (signalk-wyoming, Home Assistant) use
              the panel's microphone and speaker: push-to-talk with a talk
              button, spoken replies, and the wake word. Off, the panel does not
              listen at all. Alert chimes sound either way.
            </p>
            <label className="pop-row">
              <span>Voice control</span>
              <input
                type="checkbox"
                className="switch"
                checked={layoutVoice.enabled}
                onChange={(e) =>
                  setVoiceConfig({
                    enabled: e.target.checked,
                    wake: layoutVoice.wake
                  })
                }
              />
            </label>
            <label className="pop-row">
              <span>Listen for the wake word</span>
              <input
                type="checkbox"
                className="switch"
                checked={layoutVoice.wake}
                disabled={!layoutVoice.enabled}
                onChange={(e) =>
                  setVoiceConfig({
                    enabled: layoutVoice.enabled,
                    wake: e.target.checked
                  })
                }
              />
            </label>
            {voiceConfig?.enabled === undefined && (
              <p className="muted small">
                {layoutVoice.enabled
                  ? 'Not set in this layout: on, because the layout has a talk button or a mic switch.'
                  : 'Not set in this layout: off, because the layout has no talk button or mic switch.'}
              </p>
            )}
            {!layoutVoice.enabled && layoutHasMicWidget && (
              <p className="muted small">
                With voice control off, the talk buttons and mic switches in
                this layout do nothing.
              </p>
            )}
            {hello?.voice_config && (
              <p className="muted small">
                When the designer connected, the panel ran voice control{' '}
                {hello.voice_config.enabled
                  ? hello.voice_config.wake
                    ? 'on, with the wake word'
                    : 'on, push-to-talk only'
                  : 'off'}
                .
              </p>
            )}
            <div className="modal-actions">
              <button onClick={() => setShowVoiceModal(false)}>done</button>
            </div>
          </div>
        </div>
      )}

      {showThemeModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowThemeModal(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Theme</h3>
            <p className="muted small">
              Layout-wide defaults. Zone state and a widget's own bg_color/
              fg_color always win over these — they only apply where neither one
              does. Clear a field to fall back to the firmware default.
            </p>
            <label>
              panel theme
              <select
                value={themeConfig?.mode ?? ''}
                onChange={(e) => {
                  const mode = PANEL_THEME_MODES.find(
                    (m) => m === e.target.value
                  )
                  // by day only matters for auto, and its select hides
                  // otherwise: keep no value the dialog cannot show.
                  updateTheme(
                    mode === undefined || mode === 'auto'
                      ? { mode }
                      : { mode, day_base: undefined }
                  )
                }}
                title="Day is light for sunlight, dark is the classic look, night is red on black. Auto switches to night at sunset."
              >
                <option value="">firmware default (auto)</option>
                <option value="auto">auto: night after sunset</option>
                <option value="day">day</option>
                <option value="dark">dark</option>
                <option value="night">night</option>
              </select>
            </label>
            {(themeConfig?.mode ?? 'auto') === 'auto' && (
              <label>
                by day
                <select
                  value={themeConfig?.day_base ?? ''}
                  onChange={(e) =>
                    updateTheme({
                      day_base:
                        e.target.value === 'day' || e.target.value === 'dark'
                          ? e.target.value
                          : undefined
                    })
                  }
                  title="What auto shows between sunrise and sunset"
                >
                  <option value="">default ({dayBase(themeConfig)})</option>
                  <option value="day">day</option>
                  <option value="dark">dark</option>
                </select>
              </label>
            )}
            {(themeConfig?.mode !== undefined ||
              themeConfig?.day_base !== undefined) &&
              themeModes.length === 0 && (
                <p className="muted small">
                  {hello
                    ? 'This panel does not list panel themes; it will refuse the push until its firmware is updated.'
                    : 'Connect to the panel to check it supports panel themes.'}
                </p>
              )}
            <p className="muted small">
              The panel's own setting (its settings menu or cockpit.theme) wins
              over this when it is not auto.
            </p>
            <label>
              screen background
              <input
                type="color"
                value={themeConfig?.bg ?? '#0d1117'}
                onChange={(e) => updateTheme({ bg: e.target.value })}
              />
              <button
                type="button"
                className="ghost"
                onClick={() => updateTheme({ bg: undefined })}
                title="Clear (use firmware default background)"
              >
                clear
              </button>
            </label>
            <label>
              default text / indicator color
              <input
                type="color"
                value={themeConfig?.fg ?? '#e6edf3'}
                onChange={(e) => updateTheme({ fg: e.target.value })}
              />
              <button
                type="button"
                className="ghost"
                onClick={() => updateTheme({ fg: undefined })}
                title="Clear (use firmware default)"
              >
                clear
              </button>
            </label>
            <label>
              default active color (bars / arcs / buttons)
              <input
                type="color"
                value={themeConfig?.accent ?? '#58a6ff'}
                onChange={(e) => updateTheme({ accent: e.target.value })}
              />
              <button
                type="button"
                className="ghost"
                onClick={() => updateTheme({ accent: undefined })}
                title="Clear (use firmware default accent)"
              >
                clear
              </button>
            </label>
            <p className="muted small">
              "Active" is the fill used for a bar/arc indicator or a button tile
              when the bound path has no matching SK zone (or, for buttons, no
              SK feedback loop at all) and the widget has no bg_color/fg_color
              override of its own.
            </p>
            <div className="modal-actions">
              <button
                className="ghost"
                onClick={() => setThemeConfig(undefined)}
                title="Drop the whole theme block (firmware defaults apply)"
              >
                clear all
              </button>
              <button onClick={() => setShowThemeModal(false)}>done</button>
            </div>
          </div>
        </div>
      )}

      <div className="workspace">
        <aside
          className="rail"
          aria-label="Widgets"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="rail-head">
            <span>Widgets</span>
            <button
              type="button"
              className="icon-btn rail-close"
              aria-label="Close the widget list"
              onClick={() => setRailOpen(false)}
            >
              {UI_ICONS.close}
            </button>
          </div>
          <input
            className="palette-search"
            type="search"
            aria-label="Search widgets"
            placeholder="Search widgets"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
          />
          <div className="palette">
            {availableKinds
              .filter((k) => kindMatches(k, kindFilter))
              .map((k) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => {
                    addWidget(k)
                    setSheetTab(kindHasData(k) ? 'data' : 'display')
                    setSheetOpen(true)
                    if (isPhone()) setRailOpen(false)
                  }}
                  title={`Add ${KIND_INFO[k].name}`}
                  aria-label={`Add ${KIND_INFO[k].name}`}
                >
                  {KIND_INFO[k].icon}
                  <span>{KIND_INFO[k].name}</span>
                </button>
              ))}
          </div>
        </aside>

        <main className="canvas" ref={canvasRef}>
          <div
            className="canvas-stage"
            data-panel-theme={shownTheme}
            style={{
              width: `${displayW * fitScale}px`,
              height: `${stageH * fitScale}px`,
              ['--screen-h' as string]: `${displayH * fitScale}px`,
              ['--grid-size' as string]: `${colPxW * fitScale}px ${gridLinePxH * fitScale}px`,
              // Rows start below the status strip; so must the lines.
              ['--grid-pos' as string]: `0 ${(statusOverlay ? STATUS_OVERLAY_HEIGHT : 0) * fitScale}px`
            }}
          >
            {/* WASM preview: full-canvas LVGL render, sits beneath
                widget tile chrome so the user can still drag and
                resize over it. Note SDL captures pointer events on
                the canvas itself; we pointer-events: none in
                WasmCanvas so RGL drag handles still receive
                clicks. */}
            {/* Always mount the wasm canvas so emscripten SDL stays
                bound to the same DOM element for the whole session.
                Hide it when another preview mode is active — toggling
                back to WASM then just flips display:block, no
                remount, no rebuild. */}
            <WasmCanvas
              layout={wasmLayoutDoc}
              activeIdx={activeIdx}
              displayW={displayW}
              displayH={displayH}
              pathZones={pathZones}
              pathDescriptions={pathDescriptions}
              skValues={previewValues}
              notifications={notifications}
              visible={previewMode === 'wasm'}
              panelTheme={previewTheme}
              onStatus={setWasmStatus}
              cssScale={fitScale}
            />
            {/* Deselect on click bubbles up to the app root. */}
            <div
              className="grid-wrap"
              style={{
                width: `${displayW}px`,
                height: `${displayH}px`,
                transform: `scale(${fitScale})`
              }}
            >
              {statusOverlay && (
                <div
                  className="canvas-overlay"
                  style={{ height: `${STATUS_OVERLAY_HEIGHT}px` }}
                >
                  <span>host · wifi · sk · n2k · uptime · heap</span>
                </div>
              )}
              {shotUrl && (
                <img
                  className="canvas-shot"
                  src={shotUrl}
                  alt="device screenshot"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    opacity: shotOpacity,
                    pointerEvents: 'none',
                    zIndex: 100
                  }}
                />
              )}
              <div
                className="canvas-content"
                style={{
                  position: 'absolute',
                  top: statusOverlay ? STATUS_OVERLAY_HEIGHT : 0,
                  left: 0,
                  right: 0,
                  bottom: tabStripSpace
                }}
              >
                <GridLayout
                  className="grid"
                  layout={grid}
                  width={displayW}
                  // Keep the container at the height maxRows gives it rather
                  // than shrinking to the lowest widget (see gridConfig).
                  autoSize={false}
                  gridConfig={gridConfig}
                  dragConfig={DRAG_CONFIG}
                  compactor={FREEFORM_COMPACTOR}
                  onDrag={onDragOrResize}
                  onResize={onDragOrResize}
                  onDragStop={onDragStop}
                  positionStrategy={scaledStrategy}
                  onResizeStop={onResizeStop}
                >
                  {screen.widgets.map((w) => {
                    const isSel = selectedId === w.id
                    return (
                      <div
                        key={w.id}
                        className={`tile ${isSel ? 'sel' : ''}`}
                        tabIndex={0}
                        aria-label={`${KIND_INFO[w.type]?.name ?? w.type} ${('label' in w && w.label) || w.id}`}
                        onKeyDown={(e) => {
                          // Keys on the Edit, Duplicate and Delete buttons are theirs.
                          if (e.target !== e.currentTarget) return
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          openWidget(w)
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          // The click that ends a drag on the bar is no tap.
                          if (draggedRef.current) return
                          openWidget(w)
                        }}
                      >
                        {isSel && (
                          <div
                            className={`chrome ${w.y < CHROME_ROOM / fitScale ? 'below' : ''}`}
                            style={{ transform: `scale(${1 / fitScale})` }}
                            title="Drag to move"
                          >
                            <span className="chrome-grip">
                              {UI_ICONS.grip}
                              {KIND_INFO[w.type]?.name ?? w.type}
                            </span>
                            {chromeButton('Edit', UI_ICONS.edit, () => {
                              setSheetOpen(true)
                            })}
                            {chromeButton('Duplicate', UI_ICONS.copy, () =>
                              duplicateWidget(w.id)
                            )}
                            {chromeButton(
                              'Delete',
                              UI_ICONS.trash,
                              () => removeWidget(w.id),
                              'danger'
                            )}
                          </div>
                        )}
                        {/* No per-tile preview render. The wasm canvas
                        and the device-mirror overlay both paint the
                        full widget surface elsewhere; the tile
                        itself is just a click + drag target with
                        chrome on selection. */}
                      </div>
                    )
                  })}
                </GridLayout>
              </div>
              {tabOverlay && (
                <div
                  className="canvas-tabs-ghost"
                  style={{ height: `${tabStripHeight}px` }}
                >
                  <span>tabs: swipe up</span>
                </div>
              )}
              {showTabStrip && (
                <div
                  className={`canvas-tabs${tabOverlay ? ' below' : ''}`}
                  style={{
                    height: `${tabStripHeight}px`,
                    ...(tabOverlay ? { bottom: `-${tabBelowOffset}px` } : {})
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <DndContext
                    sensors={sortSensors}
                    collisionDetection={closestCenter}
                    onDragEnd={onTabDragEnd}
                  >
                    <SortableContext
                      items={screens.map((s) => s.id)}
                      strategy={horizontalListSortingStrategy}
                    >
                      {screens.map((s, i) => (
                        <SortableTab
                          key={s.id}
                          id={s.id}
                          title={s.title || s.id}
                          active={i === activeIdx}
                          showClose={screens.length > 1 && i === activeIdx}
                          onActivate={() => {
                            setActiveIdx(i)
                            setSelectedId(null)
                          }}
                          onClose={() =>
                            setPendingConfirm({
                              message: `Delete screen "${s.title}"?`,
                              action: 'delete',
                              run: () => removeScreen(s.id)
                            })
                          }
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              )}
            </div>
          </div>
          <div className="canvas-foot" onClick={(e) => e.stopPropagation()}>
            <span>
              {displayW}×{displayH}
              {fitScale < 1 ? ` · shown at ${Math.round(fitScale * 100)}%` : ''}
            </span>
            {previewMode === 'mirror' && liveMirrorStatus && (
              <span>{liveMirrorStatus}</span>
            )}
            {previewMode === 'wasm' && wasmStatus && <span>{wasmStatus}</span>}
            {shotUrl && (
              <label className="inline" title="Mirror opacity">
                opacity
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={shotOpacity}
                  onChange={(e) => setShotOpacity(Number(e.target.value))}
                />
              </label>
            )}
          </div>
        </main>

        <button
          type="button"
          className="fab"
          aria-label="Add widget"
          onClick={(e) => {
            e.stopPropagation()
            setRailOpen(true)
          }}
        >
          {UI_ICONS.plus}
        </button>

        {selected && sheetOpen && (
          <WidgetSheet
            key={selected.id}
            selected={selected}
            tab={sheetTab}
            onTab={setSheetTab}
            infos={pathInfo}
            infoByPath={pathInfoByPath}
            recent={recentBinds}
            knownPathSet={knownPathSet}
            liveValue={liveValueOf}
            zonesOf={(b) => pathZones.get(b)}
            displayW={displayW}
            fontSizes={fontSizeOptions(
              hello,
              selected.type,
              'display' in selected ? selected.display?.font_size : undefined
            )}
            pageH={
              displayH -
              (statusOverlay ? STATUS_OVERLAY_HEIGHT : 0) -
              tabStripSpace
            }
            updateWidget={updateWidget}
            applyBind={applyBind}
            applyBarBind={applyBarBind}
            onDuplicate={() => duplicateWidget(selected.id)}
            onDelete={() => removeWidget(selected.id)}
            onClose={() => setSheetOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

/**
 * A native modal <dialog>: the browser moves focus in, keeps it there, makes
 * the page behind inert and turns Escape into a cancel.
 */
function ConfirmDialog({
  message,
  action,
  onCancel,
  onConfirm
}: {
  message: string
  action: string
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDialogElement | null>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="confirm-message"
      onCancel={(e) => {
        e.preventDefault()
        onCancel()
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog itself, outside its box.
        const box = e.currentTarget.getBoundingClientRect()
        const outside =
          e.clientX < box.left ||
          e.clientX > box.right ||
          e.clientY < box.top ||
          e.clientY > box.bottom
        if (e.target === e.currentTarget && outside) onCancel()
      }}
    >
      <p id="confirm-message">{message}</p>
      <div className="modal-actions">
        <button className="ghost" autoFocus onClick={onCancel}>
          cancel
        </button>
        <button onClick={onConfirm}>{action}</button>
      </div>
    </dialog>
  )
}
