import type { Plugin, PluginRouter, ServerAPI } from '@signalk/server-api'
import type { Request, Response } from 'express'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Bonjour, type Service } from 'bonjour-service'
import {
  RemoteAccess,
  adminMessage,
  approveMessage,
  hmiOrigin,
  localAddresses,
  originOf
} from './remote.js'

/** How long a scan waits for other servers to list their displays. */
const REMOTE_SCAN_MS = 3000

/** A cockpit panel found on the LAN via mDNS. */
interface DiscoveredDevice {
  url: string
  name: string
  txt: Record<string, string>
}

// The npm package was renamed to signalk-espos-hmi-designer; the plugin id
// stays so existing installs keep their saved layout and settings.
const PLUGIN_ID = 'signalk-hmi-designer'
const LAYOUT_FILE = 'layout.json'

/**
 * signalk-espos-manager's device broker (its src/broker/), present while
 * that plugin runs. Looked up per request: it comes and goes with the
 * manager, and a server without it proxies directly as before.
 */
interface EsposDeviceBroker {
  readonly version: number
  request(
    url: string,
    init?: {
      method?: string
      headers?: Record<string, string>
      body?: string
      signal?: AbortSignal
    }
  ): Promise<globalThis.Response | undefined>
}

function esposBroker(): EsposDeviceBroker | undefined {
  const b = (globalThis as { __signalk_esposManager?: unknown })
    .__signalk_esposManager as EsposDeviceBroker | undefined
  return b?.version === 1 && typeof b.request === 'function' ? b : undefined
}

interface ProxyBody {
  url?: unknown
  body?: unknown
  method?: unknown
  headers?: unknown
}

/**
 * The base URL of an mDNS answer. Prefers the .local name: it survives a
 * DHCP lease change, whereas the address does not. Falls back to the
 * first IPv4.
 */
function serviceHost(svc: Service): string | undefined {
  return svc.host ?? svc.addresses?.find((a: string) => a.includes('.'))
}

function serviceUrl(svc: Service): string | undefined {
  const host = serviceHost(svc)
  if (!host || !svc.port) return undefined
  const name = host.replace(/\.$/, '')
  return svc.port === 80 ? `http://${name}` : `http://${name}:${svc.port}`
}

/**
 * Whether an mDNS answer is this host. Compared by address only: behind
 * TLS, a reverse proxy or a port mapping the port a request arrives on
 * need not be the one Signal K advertises.
 */
function isThisHost(svc: Service): boolean {
  const mine = localAddresses()
  return (svc.addresses ?? []).some((a: string) => mine.has(a))
}

/** `p`, or `fallback` once `ms` have passed. */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      () => {
        clearTimeout(t)
        resolve(fallback)
      }
    )
  })
}

/**
 * SignalK plugin entry for the HMI Designer webapp.
 *
 * The plugin itself is mostly a thin shell: SignalK serves the
 * compiled React webapp from public/, and this entrypoint exposes a
 * couple of REST helpers under /plugins/signalk-hmi-designer/ that
 * the webapp uses:
 *
 *   GET  /status           — liveness; included so the appstore badge
 *                            shows the plugin as "running".
 *   POST /device-proxy     — forwards a request to a target device on
 *                            the local network. Used by the designer to
 *                            POST /layout to discovered devices without
 *                            tripping browser CORS, and to GET /hello
 *                            for capability discovery.
 *
 *   GET  /devices          — browses mDNS for panels, and for other
 *                            Signal K servers whose signalk-espos-hmi
 *                            displays the designer can push to.
 */
const plugin = (app: ServerAPI): Plugin => {
  const remote = new RemoteAccess(() => app.getDataDirPath())
  return {
    id: PLUGIN_ID,
    name: 'HMI Designer',
    description:
      'Drag-and-drop designer for runtime-rendering HMI display devices',

    schema: () => ({
      type: 'object',
      properties: {}
    }),

    start: () => {
      app.setPluginStatus('Running')
    },

    stop: () => {
      app.setPluginStatus('Stopped')
    },

    registerWithRouter(router: PluginRouter) {
      // Anyone allowed to read the server may browse for panels and open
      // the saved layout; saving it and talking to a panel stay admin-only.
      // Servers before 2.34 have no access() and gate no plugin route.
      const readable =
        typeof router.access === 'function' ? router.access('readonly') : router
      // Browse the LAN for cockpit panels so the webapp does not have to
      // guess a hostname. Devices advertise `_signalk-player._tcp`;
      // espOS names them per-MAC (espos-<mac4>), so no hardcoded default
      // can be right and a typed URL goes stale the moment a panel is
      // reflashed or replaced.
      readable.get('/devices', (_req: Request, res: Response) => {
        const bonjour = new Bonjour()
        const found = new Map<string, DiscoveredDevice>()
        const servers = new Set<string>()
        // Other Signal K servers on the LAN may run signalk-espos-hmi
        // with displays of their own.
        const skBrowser = bonjour.find({
          type: 'signalk-http',
          protocol: 'tcp'
        })
        skBrowser.on('up', (svc) => {
          const url = serviceUrl(svc)
          if (url && !isThisHost(svc)) servers.add(originOf(url))
        })
        const browser = bonjour.find({
          type: 'signalk-player',
          protocol: 'tcp'
        })
        browser.on('up', (svc) => {
          const url = serviceUrl(svc)
          if (!url) return
          found.set(url, {
            url,
            name: svc.name ?? serviceHost(svc) ?? url,
            txt: (svc.txt ?? {}) as Record<string, string>
          })
        })
        // mDNS is lossy and answers trickle in; give responders a moment,
        // then return whatever answered rather than holding the request.
        setTimeout(() => {
          browser.stop()
          skBrowser.stop()
          bonjour.destroy()
          if (servers.size === 0) {
            res.json({ devices: [...found.values()] })
            return
          }
          // A slow or broken server must not hold back what answered.
          void Promise.all(
            [...servers].map(async (origin) => ({
              origin,
              ...(await within(remote.displays(origin), REMOTE_SCAN_MS, {
                displays: [],
                locked: false
              }))
            }))
          ).then((answers) => {
            const devices = [...found.values()]
            const locked: string[] = []
            for (const a of answers) {
              devices.push(...a.displays)
              if (a.locked) locked.push(a.origin)
            }
            res.json(locked.length ? { devices, locked } : { devices })
          })
        }, 1500)
      })

      readable.get('/status', (_req: Request, res: Response) => {
        res.json({ ok: true, plugin: PLUGIN_ID })
      })

      // Layout persistence — stored in the plugin's private data dir
      // so the webapp can reload its last-pushed layout after a
      // browser refresh.
      readable.get('/layout', async (_req: Request, res: Response) => {
        try {
          const file = path.join(app.getDataDirPath(), LAYOUT_FILE)
          const data = await fs.readFile(file, 'utf-8')
          res.type('application/json').send(data)
        } catch (err) {
          const e = err as NodeJS.ErrnoException
          if (e.code === 'ENOENT') {
            res.status(404).json({ error: 'no layout saved yet' })
            return
          }
          // The file system's message names server paths, and anyone who
          // can read the layout sees this answer.
          app.error(`could not read ${LAYOUT_FILE}: ${e.message}`)
          res.status(500).json({ error: 'could not read the saved layout' })
        }
      })

      router.put('/layout', async (req: Request, res: Response) => {
        if (!req.body || typeof req.body !== 'object') {
          res.status(400).json({ error: 'body must be JSON object' })
          return
        }
        try {
          const dir = app.getDataDirPath()
          await fs.mkdir(dir, { recursive: true })
          const file = path.join(dir, LAYOUT_FILE)
          const tmp = `${file}.tmp`
          await fs.writeFile(tmp, JSON.stringify(req.body))
          await fs.rename(tmp, file)
          res.json({ ok: true })
        } catch (err) {
          const e = err as Error
          res.status(500).json({ error: e.message })
        }
      })

      // Ask another Signal K server to let the designer push there. Admin
      // only: the request asks that server for admin rights.
      router.post('/remote-access', async (req: Request, res: Response) => {
        const server = (req.body as { server?: unknown } | undefined)?.server
        let origin: string
        try {
          if (typeof server !== 'string') throw new Error('no server')
          const u = new URL(server)
          if (u.protocol !== 'http:' && u.protocol !== 'https:')
            throw new Error('not http')
          origin = u.origin
        } catch {
          res.status(400).json({ error: 'server must be an http(s) url' })
          return
        }
        if (await remote.request(origin)) {
          res.json({ message: approveMessage(origin) })
        } else {
          res.status(502).json({
            error: `${new URL(origin).host} took no access request`
          })
        }
      })

      // Forward arbitrary GET/POST to a device on the local network.
      // The webapp can't talk to a device directly because the browser
      // sees that as a cross-origin call. Sending it via the SK server
      // origin keeps everything same-origin and inherits SK auth. A panel
      // that signalk-espos-manager knows is reached through the manager,
      // which adds the panel's API key; the key never reaches this plugin.
      router.post('/device-proxy', async (req: Request, res: Response) => {
        const b = (req.body ?? {}) as ProxyBody
        if (typeof b.url !== 'string') {
          res.status(400).json({ error: 'url required' })
          return
        }
        const url = b.url
        // NOTE: the target is NOT restricted to private addresses -- this
        // parses the URL to catch typos and rejects non-http(s) schemes, but
        // any reachable host is forwarded to. The proxy runs with the SK
        // server's network position and inherits its auth, so an authenticated
        // webapp user can reach anything the server can. That was already true
        // for GET/POST; PUT raises the stakes because it can change state.
        // An allowlist of discovered panels would close this.
        let parsed: URL
        try {
          parsed = new URL(url)
        } catch {
          res.status(400).json({ error: 'invalid url' })
          return
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          res.status(400).json({ error: 'only http(s) supported' })
          return
        }

        const method =
          typeof b.method === 'string' ? b.method.toUpperCase() : 'GET'
        // PUT is here for espOS's config API (/api/v1/config), which the
        // brightness control writes to; the device's layout API uses POST.
        if (method !== 'GET' && method !== 'POST' && method !== 'PUT') {
          res.status(400).json({ error: 'method must be GET, POST or PUT' })
          return
        }

        const headers: Record<string, string> = { Accept: 'application/json' }
        if (b.headers && typeof b.headers === 'object') {
          for (const [k, v] of Object.entries(
            b.headers as Record<string, unknown>
          )) {
            if (typeof v === 'string') headers[k] = v
          }
        }

        const init: RequestInit = { method, headers }
        if (method === 'POST' || method === 'PUT') {
          const payload =
            typeof b.body === 'string' ? b.body : JSON.stringify(b.body ?? {})
          init.body = payload
          if (!('Content-Type' in headers))
            headers['Content-Type'] = 'application/json'
        }

        try {
          const controller = new AbortController()
          // 30s timeout: device's /layout apply budget is 10s and
          // /screenshot can take up to 6s; allow a healthy margin
          // for the upstream + buffered response so an in-flight
          // apply that just exceeded the device-side budget can
          // still propagate its 504 back to the browser rather
          // than abort here first.
          const t = setTimeout(() => controller.abort(), 30_000)
          init.signal = controller.signal
          let upstream: globalThis.Response | undefined
          // A browser display on another Signal K server: the designer's
          // own access there, not the panel broker.
          const hmi = hmiOrigin(url)
          const token = hmi ? await remote.token(hmi) : undefined
          if (token) headers.Authorization = `Bearer ${token}`
          const broker = hmi ? undefined : esposBroker()
          if (broker) {
            try {
              upstream = await broker.request(url, {
                method,
                headers,
                body: typeof init.body === 'string' ? init.body : undefined,
                signal: controller.signal
              })
            } catch (err) {
              // The panel itself not answering is the answer; a manager
              // failing for any other reason must not cut the designer off.
              if (controller.signal.aborted) throw err
              const msg = err instanceof Error ? err.message : String(err)
              app.debug(`espos-manager could not send ${url}: ${msg}`)
            }
          }
          upstream ??= await fetch(url, init)
          if (hmi && (upstream.status === 401 || upstream.status === 403)) {
            clearTimeout(t)
            // The refusal's body is not read: release the connection.
            controller.abort()
            // A token that works but carries too little: asking again
            // would only pile up requests there.
            if (token && upstream.status === 403) {
              res.status(403).json({ error: adminMessage(hmi) })
              return
            }
            if (token) await remote.forget(hmi, token)
            const asked = await remote.request(hmi)
            res.status(401).json({
              error: asked
                ? approveMessage(hmi)
                : `${new URL(hmi).host} refused this (${upstream.status})`
            })
            return
          }
          // Read as a Buffer so binary responses (BMP screenshots etc)
          // pass through unmangled. The timeout covers the body too: a
          // screenshot can stall after its headers.
          const body = Buffer.from(await upstream.arrayBuffer())
          clearTimeout(t)
          res.status(upstream.status)
          const ct = upstream.headers.get('content-type')
          if (ct) res.setHeader('content-type', ct)
          res.send(body)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          res.status(502).json({ error: msg })
        }
      })
    }
  }
}

export default plugin
