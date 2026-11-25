import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  connectPanel,
  otherPanelUrl,
  NEEDS_KEY_MESSAGE
} from '../webapp/src/api'

const hello = {
  schema: 1,
  name: 'x',
  widgets: {},
  display: { w: 1024, h: 600 }
}

/** The device proxy, answering per target URL. */
function proxyAnswering(byUrl: Record<string, [number, unknown]>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_: string, init: { body: string }) => {
      const { url } = JSON.parse(init.body) as { url: string }
      const [status, body] = byUrl[url] ?? [502, { error: 'ECONNREFUSED' }]
      return new Response(JSON.stringify(body), { status })
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('otherPanelUrl', () => {
  it('swaps between the old layout API port and none', () => {
    expect(otherPanelUrl('http://espos-ab12.local:8081')).toBe(
      'http://espos-ab12.local'
    )
    expect(otherPanelUrl('http://192.168.0.167:8081/')).toBe(
      'http://192.168.0.167'
    )
    expect(otherPanelUrl('http://espos-ab12.local')).toBe(
      'http://espos-ab12.local:8081'
    )
  })

  it('leaves a port the user chose alone', () => {
    expect(otherPanelUrl('http://espos-ab12.local:8080')).toBeUndefined()
    expect(otherPanelUrl('nonsense')).toBeUndefined()
  })
})

describe('connectPanel', () => {
  it('finds a panel that moved from :8081 to port 80', async () => {
    proxyAnswering({ 'http://p.local/hello': [200, hello] })
    const r = await connectPanel('http://p.local:8081')
    expect(r.url).toBe('http://p.local')
    expect(r.hello.schema).toBe(1)
  })

  it('keeps a panel that still answers on :8081', async () => {
    proxyAnswering({ 'http://p.local:8081/hello': [200, hello] })
    expect((await connectPanel('http://p.local:8081')).url).toBe(
      'http://p.local:8081'
    )
  })

  it('finds an older panel on :8081 from a URL without a port', async () => {
    proxyAnswering({ 'http://p.local:8081/hello': [200, hello] })
    expect((await connectPanel('http://p.local')).url).toBe(
      'http://p.local:8081'
    )
  })

  it('prefers the error of a panel that answered', async () => {
    proxyAnswering({
      'http://p.local/hello': [401, { error: 'unauthorized' }]
    })
    await expect(connectPanel('http://p.local:8081')).rejects.toThrow(
      NEEDS_KEY_MESSAGE
    )
  })

  it('does not try the other port after a timeout', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_: string, init: { body: string }) => {
        calls.push((JSON.parse(init.body) as { url: string }).url)
        return new Response(
          JSON.stringify({ error: 'This operation was aborted' }),
          { status: 502 }
        )
      })
    )
    await expect(connectPanel('http://p.local:8081')).rejects.toThrow('abort')
    expect(calls).toEqual(['http://p.local:8081/hello'])
  })

  it('reports the first failure when neither answers', async () => {
    proxyAnswering({})
    await expect(connectPanel('http://p.local:8081')).rejects.toThrow(
      'ECONNREFUSED'
    )
  })

  it("explains a panel's 401, not the server's", async () => {
    proxyAnswering({
      'http://p.local/hello': [401, { error: 'unauthorized', message: 'x' }],
      'http://q.local/hello': [401, { message: 'login required' }],
      'http://p.local:8081/hello': [401, { error: 'unauthorized' }],
      'http://q.local:8081/hello': [401, { message: 'login required' }]
    })
    await expect(connectPanel('http://p.local')).rejects.toThrow(
      NEEDS_KEY_MESSAGE
    )
    await expect(connectPanel('http://q.local')).rejects.toThrow(
      'device proxy 401'
    )
  })
})
