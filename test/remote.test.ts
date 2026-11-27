import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  CertChangedError,
  RemoteAccess,
  approveMessage,
  hmiOrigin
} from '../src/remote'
import type { CertCheck } from '../src/pinned'

const ORIGIN = 'http://boat2.local:3000'

interface Seen {
  method: string
  url: string
  auth: string | undefined
  body: string | undefined
}

/** A Signal K server with security on, answering what `routes` say. */
function fakeServer(routes: Record<string, () => Response>): {
  fetchFn: typeof fetch
  seen: Seen[]
} {
  const seen: Seen[] = []
  const fetchFn = ((input: string | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    seen.push({
      method,
      url,
      auth: new Headers(init.headers).get('authorization') ?? undefined,
      body: typeof init.body === 'string' ? init.body : undefined
    })
    const route = routes[`${method} ${new URL(url).pathname}`]
    return Promise.resolve(
      route ? route() : new Response('{}', { status: 404 })
    )
  }) as typeof fetch
  return { fetchFn, seen }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })

let dataDir: string

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(tmpdir(), 'hmi-remote-'))
})

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true })
})

describe('hmiOrigin', () => {
  it('names the server of a signalk-espos-hmi route', () => {
    expect(hmiOrigin(`${ORIGIN}/plugins/signalk-espos-hmi/displays/x`)).toBe(
      ORIGIN
    )
  })

  it('leaves panels alone', () => {
    expect(hmiOrigin('http://espos-1a2b.local/layout')).toBeUndefined()
    expect(hmiOrigin('not a url')).toBeUndefined()
  })
})

describe('RemoteAccess', () => {
  it('reports a server that refuses as locked, without asking it', async () => {
    const { fetchFn, seen } = fakeServer({
      'GET /plugins/signalk-espos-hmi/displays': () => json({}, 401)
    })
    const ra = new RemoteAccess(() => dataDir, fetchFn)
    expect(await ra.displays(ORIGIN)).toEqual({
      displays: [],
      status: 'locked'
    })
    expect(seen.filter((s) => s.method === 'POST')).toHaveLength(0)
  })

  it('asks for admin access once while a request is open', async () => {
    const { fetchFn, seen } = fakeServer({
      'POST /signalk/v1/access/requests': () =>
        json({ state: 'PENDING', href: '/signalk/v1/requests/42' }, 202),
      'GET /signalk/v1/requests/42': () => json({ state: 'PENDING' })
    })
    const ra = new RemoteAccess(() => dataDir, fetchFn)
    expect(await ra.request(ORIGIN)).toBe(true)
    expect(await ra.request(ORIGIN)).toBe(true)
    const posts = seen.filter((s) => s.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse(posts[0]?.body ?? '')).toMatchObject({
      permissions: 'admin'
    })
  })

  it('shares one client id between parallel first calls', async () => {
    const ids: string[] = []
    const { fetchFn } = fakeServer({
      'POST /signalk/v1/access/requests': () =>
        json({ href: `/signalk/v1/requests/${ids.length}` }, 202)
    })
    const spy = ((input: string | URL, init?: RequestInit) => {
      if (typeof init?.body === 'string') {
        ids.push((JSON.parse(init.body) as { clientId: string }).clientId)
      }
      return fetchFn(input, init)
    }) as typeof fetch
    const ra = new RemoteAccess(() => dataDir, spy)
    await Promise.all([
      ra.request('http://a.local:3000'),
      ra.request('http://b.local:3000')
    ])
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(ids[1])
    const saved = JSON.parse(
      await fs.readFile(path.join(dataDir, 'remote-access.json'), 'utf-8')
    ) as { servers: Record<string, unknown> }
    expect(Object.keys(saved.servers).sort()).toEqual([
      'http://a.local:3000',
      'http://b.local:3000'
    ])
  })

  it('keys servers by origin, whatever the case of the host', async () => {
    const { fetchFn } = fakeServer({
      'POST /signalk/v1/access/requests': () =>
        json({ href: '/signalk/v1/requests/42' }, 202),
      'GET /signalk/v1/requests/42': () =>
        json({
          state: 'COMPLETED',
          accessRequest: { permission: 'APPROVED', token: 'tok' }
        })
    })
    const ra = new RemoteAccess(() => dataDir, fetchFn)
    await ra.request('http://Boat2.local:3000')
    expect(await ra.token(ORIGIN)).toBe('tok')
  })

  it('collects the token once approved and keeps it across restarts', async () => {
    const { fetchFn, seen } = fakeServer({
      'GET /plugins/signalk-espos-hmi/displays': () =>
        json({ displays: [{ id: 'salon', name: 'Salon' }] }),
      'POST /signalk/v1/access/requests': () =>
        json({ href: '/signalk/v1/requests/42' }, 202),
      'GET /signalk/v1/requests/42': () =>
        json({
          state: 'COMPLETED',
          accessRequest: { permission: 'APPROVED', token: 'tok' }
        })
    })
    const ra = new RemoteAccess(() => dataDir, fetchFn)
    await ra.request(ORIGIN)
    expect(await ra.token(ORIGIN)).toBe('tok')

    const again = new RemoteAccess(() => dataDir, fetchFn)
    const { displays } = await again.displays(ORIGIN)
    expect(displays).toEqual([
      {
        url: `${ORIGIN}/plugins/signalk-espos-hmi/displays/salon`,
        name: 'Salon (browser display)',
        txt: {}
      }
    ])
    expect(seen.at(-1)?.auth).toBe('Bearer tok')
  })

  it('asks again after a denial', async () => {
    let posts = 0
    const { fetchFn } = fakeServer({
      'POST /signalk/v1/access/requests': () => {
        posts++
        return json({ href: '/signalk/v1/requests/42' }, 202)
      },
      'GET /signalk/v1/requests/42': () =>
        json({ state: 'COMPLETED', accessRequest: { permission: 'DENIED' } })
    })
    const ra = new RemoteAccess(() => dataDir, fetchFn)
    await ra.request(ORIGIN)
    expect(await ra.token(ORIGIN)).toBeUndefined()
    await ra.request(ORIGIN)
    expect(posts).toBe(2)
  })

  it('drops a token the server no longer takes', async () => {
    const { fetchFn } = fakeServer({
      'GET /plugins/signalk-espos-hmi/displays': () => json({}, 401),
      'POST /signalk/v1/access/requests': () =>
        json({ href: '/signalk/v1/requests/1' }, 202),
      'GET /signalk/v1/requests/1': () =>
        json({
          state: 'COMPLETED',
          accessRequest: { permission: 'APPROVED', token: 'old' }
        })
    })
    const ra = new RemoteAccess(() => dataDir, fetchFn)
    await ra.request(ORIGIN)
    expect(await ra.token(ORIGIN)).toBe('old')
    expect(await ra.displays(ORIGIN)).toEqual({
      displays: [],
      status: 'locked'
    })
    expect(await ra.token(ORIGIN)).toBeUndefined()
  })

  it('keeps writing after a failed write', async () => {
    let dir = path.join(dataDir, 'missing', '\0bad')
    const { fetchFn } = fakeServer({
      'POST /signalk/v1/access/requests': () =>
        json({ href: '/signalk/v1/requests/1' }, 202)
    })
    const ra = new RemoteAccess(() => dir, fetchFn)
    await ra.request(ORIGIN)
    dir = dataDir
    await ra.request('http://other.local:3000')
    const saved = JSON.parse(
      await fs.readFile(path.join(dataDir, 'remote-access.json'), 'utf-8')
    ) as { servers: Record<string, unknown> }
    expect(Object.keys(saved.servers)).toContain('http://other.local:3000')
  })

  it('lists nothing from a server without the plugin', async () => {
    const { fetchFn } = fakeServer({})
    const ra = new RemoteAccess(() => dataDir, fetchFn)
    expect(await ra.displays(ORIGIN)).toEqual({ displays: [], status: 'ok' })
  })

  it('asks again when the server forgot the open request', async () => {
    let posts = 0
    const { fetchFn } = fakeServer({
      'POST /signalk/v1/access/requests': () => {
        posts++
        return json({ href: '/signalk/v1/requests/gone' }, 202)
      }
    })
    const ra = new RemoteAccess(() => dataDir, fetchFn)
    await ra.request(ORIGIN)
    await ra.request(ORIGIN)
    expect(posts).toBe(2)
  })

  it('reports a server that answers with an error as failed', async () => {
    const { fetchFn } = fakeServer({
      'GET /plugins/signalk-espos-hmi/displays': () => json({}, 500)
    })
    const ra = new RemoteAccess(() => dataDir, fetchFn)
    expect(await ra.displays(ORIGIN)).toEqual({
      displays: [],
      status: 'failed'
    })
  })

  it('keeps a request that replaced one being checked', async () => {
    let release: (() => void) | undefined
    const { fetchFn } = fakeServer({
      'POST /signalk/v1/access/requests': () =>
        json({ href: '/signalk/v1/requests/new' }, 202),
      'GET /signalk/v1/requests/new': () => json({ state: 'PENDING' })
    })
    const slow = ((input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith('/requests/old')) {
        return new Promise<Response>((resolve) => {
          release = () =>
            resolve(
              json({
                state: 'COMPLETED',
                accessRequest: { permission: 'APPROVED', token: 'stale' }
              })
            )
        })
      }
      return fetchFn(input, init)
    }) as typeof fetch
    await fs.writeFile(
      path.join(dataDir, 'remote-access.json'),
      JSON.stringify({
        clientId: 'c',
        servers: { [ORIGIN]: { href: '/signalk/v1/requests/old' } }
      })
    )
    const ra = new RemoteAccess(() => dataDir, slow)
    const checking = ra.token(ORIGIN)
    await vi.waitFor(() => expect(release).toBeDefined())
    // Meanwhile the server forgot the old request and a new one went in.
    const st = JSON.parse(
      await fs.readFile(path.join(dataDir, 'remote-access.json'), 'utf-8')
    ) as { servers: Record<string, { href?: string }> }
    expect(st.servers[ORIGIN]?.href).toBe('/signalk/v1/requests/old')
    ;(
      ra as unknown as {
        loading: Promise<{ servers: Record<string, { href?: string }> }>
      }
    ).loading.then((s) => {
      s.servers[ORIGIN] = { href: '/signalk/v1/requests/new' }
    })
    await Promise.resolve()
    release?.()
    expect(await checking).toBeUndefined()
    expect(await ra.request(ORIGIN)).toBe(true)
    const after = JSON.parse(
      await fs.readFile(path.join(dataDir, 'remote-access.json'), 'utf-8')
    ) as { servers: Record<string, unknown> }
    expect(after.servers[ORIGIN]).not.toHaveProperty('token')
  })

  it('tells a token short of admin from no access', async () => {
    await fs.writeFile(
      path.join(dataDir, 'remote-access.json'),
      JSON.stringify({ clientId: 'c', servers: { [ORIGIN]: { token: 't' } } })
    )
    const { fetchFn } = fakeServer({
      'GET /plugins/signalk-espos-hmi/displays': () => json({}, 403)
    })
    const ra = new RemoteAccess(() => dataDir, fetchFn)
    expect(await ra.displays(ORIGIN)).toEqual({
      displays: [],
      status: 'limited'
    })
    expect(await ra.token(ORIGIN)).toBe('t')
  })

  it('reports an answer that is not a display list as failed', async () => {
    const { fetchFn } = fakeServer({
      'GET /plugins/signalk-espos-hmi/displays': () =>
        new Response('<html></html>', { status: 200 })
    })
    const ra = new RemoteAccess(() => dataDir, fetchFn)
    expect(await ra.displays(ORIGIN)).toEqual({
      displays: [],
      status: 'failed'
    })
  })

  it('says where to approve', () => {
    expect(approveMessage(ORIGIN)).toContain('boat2.local:3000')
  })
})

describe('RemoteAccess over HTTPS', () => {
  const SECURE = 'https://boat2.local:3443'

  /** The server behind `fetchFn`, showing whichever certificate `cert` names. */
  function tlsServer(fetchFn: typeof fetch, trusted = false) {
    const cert = { fp: 'AA:01' }
    const pinned = async (
      url: string,
      init: RequestInit,
      check: CertCheck
    ): Promise<Response> => {
      const extra = await check(cert.fp, trusted)
      const headers = { ...(init.headers as Record<string, string>), ...extra }
      return fetchFn(url, { ...init, headers })
    }
    return { cert, pinned }
  }

  const approved = () =>
    fakeServer({
      'GET /plugins/signalk-espos-hmi/displays': () => json({ displays: [] }),
      'POST /signalk/v1/access/requests': () =>
        json({ href: '/signalk/v1/requests/42' }, 202),
      'GET /signalk/v1/requests/42': () =>
        json({
          state: 'COMPLETED',
          accessRequest: { permission: 'APPROVED', token: 'tok' }
        })
    })

  it('keeps the token while the certificate stays the same', async () => {
    const { fetchFn, seen } = approved()
    const { pinned } = tlsServer(fetchFn)
    const ra = new RemoteAccess(() => dataDir, fetchFn, pinned)
    await ra.request(SECURE)
    expect(await ra.token(SECURE)).toBe('tok')

    const again = new RemoteAccess(() => dataDir, fetchFn, pinned)
    expect((await again.displays(SECURE)).status).toBe('ok')
    expect(seen.at(-1)?.auth).toBe('Bearer tok')
  })

  it('drops the token rather than send it past a new certificate', async () => {
    const { fetchFn, seen } = approved()
    const { cert, pinned } = tlsServer(fetchFn)
    const ra = new RemoteAccess(() => dataDir, fetchFn, pinned)
    await ra.request(SECURE)
    expect(await ra.token(SECURE)).toBe('tok')
    const sent = seen.length

    cert.fp = 'BB:02'
    await expect(
      ra.fetch(`${SECURE}/plugins/signalk-espos-hmi/displays/x/layout`)
    ).rejects.toBeInstanceOf(CertChangedError)
    expect(seen).toHaveLength(sent)
    expect(await ra.token(SECURE)).toBeUndefined()

    // The old pin survives a restart; the scan offers a reconnect and
    // sends nothing there.
    const again = new RemoteAccess(() => dataDir, fetchFn, pinned)
    expect((await again.displays(SECURE)).status).toBe('locked')
    expect(seen).toHaveLength(sent)
  })

  it('keeps the old pin when a stranger answers once', async () => {
    const { fetchFn } = approved()
    const { cert, pinned } = tlsServer(fetchFn)
    const ra = new RemoteAccess(() => dataDir, fetchFn, pinned)
    await ra.displays(SECURE)
    cert.fp = 'BB:02'
    await expect(ra.fetch(`${SECURE}/x`)).rejects.toBeInstanceOf(
      CertChangedError
    )
    cert.fp = 'AA:01'
    expect((await ra.fetch(`${SECURE}/x`)).status).toBe(404)
  })

  it('takes a new certificate when asked for access', async () => {
    const { fetchFn, seen } = approved()
    const { cert, pinned } = tlsServer(fetchFn)
    const ra = new RemoteAccess(() => dataDir, fetchFn, pinned)
    await ra.request(SECURE)
    expect(await ra.token(SECURE)).toBe('tok')

    // The server was set up again: the user connects, an admin approves.
    cert.fp = 'BB:02'
    await expect(
      ra.fetch(`${SECURE}/x`, {}, { auth: true })
    ).rejects.toBeInstanceOf(CertChangedError)
    expect(await ra.request(SECURE)).toBe(true)
    expect(seen.filter((r) => r.method === 'POST')).toHaveLength(2)
    expect(await ra.token(SECURE)).toBe('tok')
    expect((await ra.displays(SECURE)).status).toBe('ok')
    expect(seen.at(-1)?.auth).toBe('Bearer tok')
  })

  it('pins nothing for a certificate a CA vouches for', async () => {
    const { fetchFn } = approved()
    const { cert, pinned } = tlsServer(fetchFn, true)
    const ra = new RemoteAccess(() => dataDir, fetchFn, pinned)
    await ra.request(SECURE)
    cert.fp = 'BB:02'
    expect(await ra.token(SECURE)).toBe('tok')
  })

  it('refuses a self-signed stand-in for a CA-signed server', async () => {
    const { fetchFn, seen } = approved()
    const ca = tlsServer(fetchFn, true)
    const ra = new RemoteAccess(() => dataDir, fetchFn, ca.pinned)
    await ra.request(SECURE)
    expect(await ra.token(SECURE)).toBe('tok')
    const sent = seen.length

    const stand = tlsServer(fetchFn, false)
    const again = new RemoteAccess(() => dataDir, fetchFn, stand.pinned)
    await expect(
      again.fetch(`${SECURE}/x`, {}, { auth: true })
    ).rejects.toBeInstanceOf(CertChangedError)
    expect(seen).toHaveLength(sent)
  })

  it('goes over plain fetch for HTTP', async () => {
    const { fetchFn } = approved()
    const pinned = vi.fn()
    const ra = new RemoteAccess(() => dataDir, fetchFn, pinned)
    await ra.displays(ORIGIN)
    expect(pinned).not.toHaveBeenCalled()
  })
})
