import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RemoteAccess, approveMessage, hmiOrigin } from '../src/remote'

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
    const headers = (init.headers ?? {}) as Record<string, string>
    seen.push({
      method,
      url,
      auth: headers.Authorization,
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
    expect(await ra.displays(ORIGIN)).toEqual({ displays: [], locked: true })
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
        name: 'Salon (browser display on boat2.local:3000)',
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
    expect(await ra.displays(ORIGIN)).toEqual({ displays: [], locked: true })
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
    expect(await ra.displays(ORIGIN)).toEqual({ displays: [], locked: false })
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

  it('says where to approve', () => {
    expect(approveMessage(ORIGIN)).toContain('boat2.local:3000')
  })
})
