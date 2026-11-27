import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { hostname, networkInterfaces } from 'node:os'
import path from 'node:path'
import { pinnedFetch } from './pinned.js'

/** Where signalk-espos-hmi lists its browser displays. */
export const HMI_DISPLAYS = '/plugins/signalk-espos-hmi/displays'
const HMI_PREFIX = '/plugins/signalk-espos-hmi/'
const ACCESS_FILE = 'remote-access.json'
const CHECK_TIMEOUT_MS = 2000
/** In place of a pin: this server's certificate chains to a known CA. */
const CA_VOUCHED = 'ca'

export interface RemoteScan {
  displays: RemoteDisplay[]
  /**
   * `locked`: it refused to list them, so the designer has no access
   * there yet. `limited`: it let the designer in, but not far enough to
   * list them. `failed`: it did not answer, or not readably.
   */
  status: 'ok' | 'locked' | 'limited' | 'failed'
}

export interface RemoteDisplay {
  url: string
  name: string
  txt: Record<string, string>
}

interface ServerAccess {
  token?: string
  /** The pending access request's status URL, relative to the server. */
  href?: string
}

interface AccessFile {
  clientId: string
  servers: Record<string, ServerAccess>
  /**
   * The SHA-256 fingerprint of each HTTPS server's self-signed
   * certificate, as first seen, or CA_VOUCHED.
   */
  certs: Record<string, string>
}

type Fetch = typeof fetch
type Pinned = typeof pinnedFetch

/** A server whose certificate is not the one it showed before. */
export class CertChangedError extends Error {
  constructor(origin: string) {
    super(
      `${new URL(origin).host} shows a different certificate than before, ` +
        'so the HMI Designer dropped its access there'
    )
  }
}

/** A server's origin as URL parsing spells it (host in lower case). */
export function originOf(server: string): string {
  return new URL(server).origin
}

/** The message the designer shows while a server has not approved it. */
export function approveMessage(origin: string): string {
  return (
    `approve the HMI Designer on ${new URL(origin).host} ` +
    '(Security → Access Requests there), then try again'
  )
}

/** The message for a token that works but carries less than admin. */
export function adminMessage(origin: string): string {
  return (
    `${new URL(origin).host} let the HMI Designer in without admin ` +
    'rights: give it admin under Security → Devices there'
  )
}

/** Whether `url` is a signalk-espos-hmi route; undefined when it is not. */
export function hmiOrigin(url: string): string | undefined {
  try {
    const u = new URL(url)
    return u.pathname.startsWith(HMI_PREFIX) ? u.origin : undefined
  } catch {
    return undefined
  }
}

/** The addresses this host answers on, to leave this server out of a scan. */
export function localAddresses(): Set<string> {
  const out = new Set<string>(['127.0.0.1', '::1'])
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) out.add(a.address)
  }
  return out
}

/**
 * The designer's access to signalk-espos-hmi on other Signal K servers.
 * Pushing a layout there needs admin rights on that server, which the
 * signed-in user here does not carry. The designer asks for them with a
 * Signal K access request, the way devices do, and keeps the token here:
 * it never reaches the browser.
 */
export class RemoteAccess {
  private loading: Promise<AccessFile> | undefined
  private asking = new Map<string, Promise<boolean>>()
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly dataDir: () => string,
    private readonly fetchFn: Fetch = (...a) => fetch(...a),
    private readonly pinned: Pinned = pinnedFetch
  ) {}

  // One shared load: parallel callers on a first scan must not each make
  // a state with its own client id.
  private load(): Promise<AccessFile> {
    this.loading ??= this.read()
    return this.loading
  }

  private async read(): Promise<AccessFile> {
    try {
      const raw = JSON.parse(
        await fs.readFile(path.join(this.dataDir(), ACCESS_FILE), 'utf-8')
      ) as Partial<AccessFile>
      if (typeof raw.clientId === 'string' && raw.servers) {
        return {
          clientId: raw.clientId,
          servers: raw.servers,
          certs: raw.certs ?? {}
        }
      }
    } catch {
      /* first use, or a broken file: start over */
    }
    return { clientId: randomUUID(), servers: {}, certs: {} }
  }

  private async save(): Promise<void> {
    const state = await this.load()
    // A failed write must not stop every later one.
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        const dir = this.dataDir()
        await fs.mkdir(dir, { recursive: true })
        const file = path.join(dir, ACCESS_FILE)
        // The file holds admin tokens for other servers.
        await fs.writeFile(`${file}.tmp`, JSON.stringify(state), {
          mode: 0o600
        })
        await fs.rename(`${file}.tmp`, file)
      })
    return this.writing
  }

  /**
   * A request to another server, with the designer's token there when
   * `auth` is set. Over HTTPS the certificate is pinned on first use, as
   * SSH does: a Signal K server's own certificate is self-signed, so no
   * CA can vouch for it. The token is read only once the certificate
   * passed, so a request racing a changed one cannot carry it.
   */
  async fetch(
    url: string,
    init: RequestInit = {},
    { auth = false, repin = false } = {}
  ): Promise<Response> {
    const origin = originOf(url)
    const authHeader = async (): Promise<Record<string, string>> => {
      if (!auth) return {}
      const token = (await this.load()).servers[origin]?.token
      return token ? { Authorization: `Bearer ${token}` } : {}
    }
    if (new URL(url).protocol !== 'https:') {
      const headers = new Headers(init.headers)
      for (const [k, v] of Object.entries(await authHeader())) {
        headers.set(k, v)
      }
      return this.fetchFn(url, {
        ...init,
        headers: Object.fromEntries(headers)
      })
    }
    return this.pinned(url, init, async (fp, trusted) => {
      await this.checkCert(origin, fp, trusted, repin)
      return authHeader()
    })
  }

  /**
   * `repin` takes a changed certificate as the server's new one: only an
   * access request does, since the user asked for it and an admin there
   * has to approve it. Otherwise the old pin stays, so a stranger
   * answering once does not lock out the real server.
   */
  private async checkCert(
    origin: string,
    fingerprint: string,
    trusted: boolean,
    repin: boolean
  ): Promise<void> {
    const st = await this.load()
    const known = st.certs[origin]
    if (trusted) {
      // Renewals pass the CA check, but a self-signed stand-in for this
      // server must not then be pinned as if first seen.
      if (known !== CA_VOUCHED) {
        st.certs[origin] = CA_VOUCHED
        await this.save()
      }
      return
    }
    if (known === fingerprint) return
    if (known !== undefined && !repin) {
      // Whoever answers now must not get the token the old server issued.
      if (st.servers[origin]) {
        delete st.servers[origin]
        await this.save()
      }
      throw new CertChangedError(origin)
    }
    st.certs[origin] = fingerprint
    // Nothing the old server issued carries over to the new one.
    if (known !== undefined) delete st.servers[origin]
    await this.save()
  }

  private async timed(
    url: string,
    init: RequestInit = {},
    opts: { auth?: boolean; repin?: boolean } = {}
  ): Promise<Response> {
    return this.fetch(
      url,
      { ...init, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) },
      opts
    )
  }

  /**
   * The token for `server`, after collecting it from a pending access
   * request that has been answered since.
   */
  async token(server: string): Promise<string | undefined> {
    const origin = originOf(server)
    const st = await this.load()
    const s = st.servers[origin]
    if (!s) return undefined
    if (s.token) return s.token
    if (!s.href) return undefined
    try {
      const r = await this.timed(new URL(s.href, origin).href)
      // A request that replaced this one while the answer was on its way
      // is newer: leave it.
      if (st.servers[origin]?.href !== s.href) return st.servers[origin]?.token
      if (r.status === 404) {
        // The server forgot the request (a restart): ask again next time.
        delete st.servers[origin]
        await this.save()
        return undefined
      }
      if (!r.ok) return undefined
      const body = (await r.json()) as {
        state?: unknown
        accessRequest?: { permission?: unknown; token?: unknown }
      }
      if (body.state !== 'COMPLETED') return undefined
      if (st.servers[origin]?.href !== s.href) return st.servers[origin]?.token
      const ar = body.accessRequest
      if (ar?.permission === 'APPROVED' && typeof ar.token === 'string') {
        st.servers[origin] = { token: ar.token }
      } else {
        delete st.servers[origin]
      }
      await this.save()
      return st.servers[origin]?.token
    } catch {
      return undefined
    }
  }

  /**
   * Ask `server` for admin access, unless a request is already open.
   * True when one is open there now.
   */
  request(server: string): Promise<boolean> {
    const origin = originOf(server)
    // A double connect must not file two requests there.
    let p = this.asking.get(origin)
    if (!p) {
      p = this.ask(origin).finally(() => this.asking.delete(origin))
      this.asking.set(origin, p)
    }
    return p
  }

  private async ask(origin: string): Promise<boolean> {
    const st = await this.load()
    // A token collected meanwhile is access already; a cached request is
    // checked first, since the server may have dropped or answered it.
    if ((await this.token(origin)) !== undefined) return true
    if (st.servers[origin]?.href) return true
    try {
      const r = await this.timed(
        `${origin}/signalk/v1/access/requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: st.clientId,
            description: `HMI Designer on ${hostname()}`,
            permissions: 'admin'
          })
        },
        { repin: true }
      )
      const body = (await r.json().catch(() => ({}))) as { href?: unknown }
      if (r.ok && typeof body.href === 'string') {
        st.servers[origin] = { href: body.href }
        await this.save()
        return true
      }
    } catch {
      /* the server did not answer: the next attempt asks again */
    }
    return false
  }

  /**
   * Drop `refused`, a token the server no longer accepts. A newer token
   * collected meanwhile stays.
   */
  async forget(server: string, refused: string): Promise<void> {
    const origin = originOf(server)
    const st = await this.load()
    if (st.servers[origin]?.token !== refused) return
    delete st.servers[origin]
    await this.save()
  }

  /** The browser displays on the Signal K server at `server`. */
  async displays(server: string): Promise<RemoteScan> {
    const origin = originOf(server)
    const token = await this.token(origin)
    let r: Response
    try {
      r = await this.timed(`${origin}${HMI_DISPLAYS}`, {}, { auth: true })
    } catch (err) {
      // A changed certificate is a server to connect to again, which is
      // what accepts the new one; the scan itself sends nothing there.
      if (err instanceof CertChangedError) {
        return { displays: [], status: 'locked' }
      }
      return { displays: [], status: 'failed' }
    }
    if (r.status === 401) {
      if (token) await this.forget(origin, token)
      return { displays: [], status: 'locked' }
    }
    if (r.status === 403) {
      return { displays: [], status: token ? 'limited' : 'locked' }
    }
    // No signalk-espos-hmi there.
    if (r.status === 404) return { displays: [], status: 'ok' }
    if (!r.ok) return { displays: [], status: 'failed' }
    const body = (await r.json().catch(() => null)) as {
      displays?: unknown
    } | null
    if (!Array.isArray(body?.displays))
      return { displays: [], status: 'failed' }
    const list: unknown[] = body.displays
    const out: RemoteDisplay[] = []
    for (const d of list) {
      if (typeof d !== 'object' || d === null) continue
      const { id, name } = d as { id?: unknown; name?: unknown }
      if (typeof id !== 'string' || id === '') continue
      const label = typeof name === 'string' && name ? name : id
      out.push({
        url: `${origin}${HMI_DISPLAYS}/${encodeURIComponent(id)}`,
        name: `${label} (browser display)`,
        txt: {}
      })
    }
    return { displays: out, status: 'ok' }
  }
}
