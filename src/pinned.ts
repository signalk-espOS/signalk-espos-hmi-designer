import https from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import tls from 'node:tls'

/**
 * Decides on a server's certificate before anything is sent to it.
 * `trusted` is true when it chains to a known CA and names the host.
 * Throwing refuses the connection; the headers it returns join the
 * request, so a token is picked only for the certificate it suits.
 */
export type CertCheck = (
  fingerprint: string,
  trusted: boolean
) => Promise<Record<string, string>>

const NO_BODY = new Set([204, 205, 304])

function connect(
  u: URL,
  signal: AbortSignal | undefined
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const host = u.hostname.replace(/^\[|\]$/g, '')
    // A Signal K server's own certificate is self-signed, so the chain
    // is judged by the caller, not here.
    const socket = tls.connect({
      host,
      port: Number(u.port || 443),
      servername: isIP(host) ? undefined : host,
      rejectUnauthorized: false
    })
    const abort = (): void => {
      socket.destroy()
      reject(signal?.reason as Error)
    }
    signal?.addEventListener('abort', abort, { once: true })
    socket.once('secureConnect', () => {
      signal?.removeEventListener('abort', abort)
      resolve(socket)
    })
    socket.once('error', (err) => {
      signal?.removeEventListener('abort', abort)
      reject(err)
    })
  })
}

/**
 * `fetch` over HTTPS that lets `check` see the certificate after the
 * handshake and before the request, token included, goes out.
 */
export async function pinnedFetch(
  url: string,
  init: RequestInit,
  check: CertCheck
): Promise<Response> {
  const u = new URL(url)
  const signal = init.signal ?? undefined
  const raw = init.body
  if (
    raw !== undefined &&
    raw !== null &&
    typeof raw !== 'string' &&
    !(raw instanceof Uint8Array)
  ) {
    throw new TypeError('pinnedFetch sends only string or byte bodies')
  }
  const body = raw ?? undefined
  const headers = new Headers(init.headers)
  // Node's http client, unlike fetch, does not decode a compressed body.
  headers.set('accept-encoding', 'identity')
  const socket = await connect(u, signal)
  try {
    // Without a certificate there is nothing to pin.
    const fp = socket.getPeerCertificate().fingerprint256
    if (!fp) throw new Error(`${u.host} showed no certificate`)
    const extra = await check(fp, socket.authorized)
    for (const [k, v] of Object.entries(extra)) headers.set(k, v)
  } catch (err) {
    socket.destroy()
    throw err
  }
  return new Promise((resolve, reject) => {
    const req = https.request(u, {
      method: init.method ?? 'GET',
      headers: Object.fromEntries(headers),
      // Honoured only with no agent: this socket's certificate was checked.
      createConnection: () => socket,
      signal
    })
    // Redirects are not followed: the response goes back as it came, so
    // the token never follows one to another server.
    req.once('response', (res) => {
      try {
        const out = new Headers()
        for (const [k, v] of Object.entries(res.headers)) {
          for (const one of Array.isArray(v) ? v : [v]) {
            if (one !== undefined) out.append(k, one)
          }
        }
        const status = res.statusCode ?? 502
        if (NO_BODY.has(status)) res.resume()
        resolve(
          new Response(
            NO_BODY.has(status)
              ? null
              : (Readable.toWeb(res) as ReadableStream<Uint8Array>),
            { status, headers: out }
          )
        )
      } catch (err) {
        res.destroy()
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    req.once('error', (err) => {
      socket.destroy()
      reject(err)
    })
    req.end(body)
  })
}
