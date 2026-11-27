import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:https'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pinnedFetch } from '../src/pinned'

let dir: string
let server: Server
let base: string
let fingerprint: string
const seen: Array<{ method?: string; auth?: string; body: string }> = []

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'hmi-pinned-'))
  const key = path.join(dir, 'key.pem')
  const crt = path.join(dir, 'crt.pem')
  // A self-signed certificate, like the one Signal K makes for itself.
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      crt,
      '-days',
      '1',
      '-subj',
      '/CN=localhost'
    ],
    { stdio: 'ignore' }
  )
  const pem = await fs.readFile(crt)
  fingerprint = new X509Certificate(pem).fingerprint256
  server = createServer(
    { key: await fs.readFile(key), cert: pem },
    (req, res) => {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString()))
      req.on('end', () => {
        seen.push({ method: req.method, auth: req.headers.authorization, body })
        if (req.url === '/empty') {
          res.writeHead(204).end()
          return
        }
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
    }
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('no TCP address')
  base = `https://localhost:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await fs.rm(dir, { recursive: true, force: true })
})

describe('pinnedFetch', () => {
  it('shows the certificate, then sends the request', async () => {
    const checks: Array<[string, boolean]> = []
    seen.length = 0
    const r = await pinnedFetch(
      `${base}/layout`,
      {
        method: 'POST',
        body: '{"a":1}'
      },
      (fp, trusted) => {
        checks.push([fp, trusted])
        return Promise.resolve({ Authorization: 'Bearer tok' })
      }
    )
    expect(checks).toEqual([[fingerprint, false]])
    expect(r.status).toBe(201)
    expect(r.headers.get('content-type')).toBe('application/json')
    expect(await r.json()).toEqual({ ok: true })
    expect(seen).toEqual([
      { method: 'POST', auth: 'Bearer tok', body: '{"a":1}' }
    ])
  })

  it('sends nothing once the check refuses', async () => {
    seen.length = 0
    await expect(
      pinnedFetch(
        `${base}/layout`,
        { headers: { Authorization: 'Bearer tok' } },
        () => Promise.reject(new Error('changed'))
      )
    ).rejects.toThrow('changed')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(seen).toEqual([])
  })

  it('answers a reply without a body', async () => {
    const r = await pinnedFetch(`${base}/empty`, {}, () => Promise.resolve({}))
    expect(r.status).toBe(204)
    expect(await r.text()).toBe('')
  })

  it('gives up on an aborted request', async () => {
    const c = new AbortController()
    c.abort()
    await expect(
      pinnedFetch(`${base}/layout`, { signal: c.signal }, () =>
        Promise.resolve({})
      )
    ).rejects.toThrow()
  })
})
