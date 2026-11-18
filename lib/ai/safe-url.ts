// An address the owner typed for an AI provider of their own, and the one way the server may call it. The server holds
// the owner's key and sends it to this address, so the address is checked twice: as written, and again at the moment
// of connecting, when the name has become a number (a name can be made to point somewhere else after it was checked).
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { Readable } from 'node:stream'
import { publicOrigins } from '../public-url'

export type UrlProblem = 'form' | 'scheme' | 'credentials' | 'insecure' | 'forbidden' | 'self'

/** What kind of place an address is. `blocked` is never called, whatever the scheme. */
export type Place = 'blocked' | 'loopback' | 'private' | 'public'

const v4 = (s: string): number[] | null => {
  const p = s.split('.')
  return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && Number(x) < 256) ? p.map(Number) : null
}

/** The IPv6 address as eight 16-bit groups, or null when it is not one. */
function groups6(raw: string): number[] | null {
  let ip = raw.toLowerCase().replace(/%.*$/, '')
  if (!net.isIPv6(ip)) return null
  // A tail written as an IPv4 address (::ffff:1.2.3.4) is two groups.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip)
  if (tail) {
    const q = v4(tail[1])
    if (!q) return null
    ip = ip.replace(tail[1], `${((q[0] << 8) | q[1]).toString(16)}:${((q[2] << 8) | q[3]).toString(16)}`)
  }
  const [head, rest] = ip.split('::')
  const a = head ? head.split(':') : []
  const b = rest === undefined ? [] : rest ? rest.split(':') : []
  const fill = rest === undefined ? 0 : 8 - a.length - b.length
  const all = [...a, ...Array(Math.max(fill, 0)).fill('0'), ...b].map((x) => parseInt(x, 16))
  return all.length === 8 && all.every((n) => Number.isInteger(n)) ? all : null
}

/** Cloud metadata services and the link-local range are never reachable: they hand out the machine's own credentials. */
export function placeOf(address: string): Place {
  const a = v4(address)
  if (a) {
    const [x, y] = a
    if (x === 0) return 'blocked'
    if (x === 169 && y === 254) return 'blocked'
    // Alibaba Cloud's metadata address sits in the shared address range.
    if (x === 100 && y === 100 && a[2] === 100 && a[3] === 200) return 'blocked'
    if (x === 127) return 'loopback'
    if (x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168)) return 'private'
    // The shared address range (carrier-grade NAT), used by Tailscale and the like: a private network.
    if (x === 100 && y >= 64 && y <= 127) return 'private'
    return 'public'
  }
  const g = groups6(address)
  if (!g) return 'blocked'
  // ::ffff:a.b.c.d is the same machine as a.b.c.d.
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return placeOf(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`)
  if (g.every((n) => n === 0)) return 'blocked'
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return 'loopback'
  // fe80::/10 is link-local; AWS's IPv6 metadata address is fd00:ec2::254.
  if ((g[0] & 0xffc0) === 0xfe80) return 'blocked'
  if (g[0] === 0xfd00 && g[1] === 0x0ec2) return 'blocked'
  if ((g[0] & 0xfe00) === 0xfc00) return 'private'
  return 'public'
}

const NAMES_BLOCKED = new Set(['metadata.google.internal', 'metadata', 'instance-data', 'instance-data.ec2.internal'])
const unbracket = (h: string) => h.replace(/^\[|\]$/g, '')

/** A host the person typed that is plainly this machine or a home network, before any lookup. */
export const looksLocal = (host: string) => {
  const h = unbracket(host.toLowerCase())
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.lan')) return true
  if (net.isIP(h)) { const p = placeOf(h); return p === 'loopback' || p === 'private' }
  return false
}

/** The port this app itself listens on, and the names it is reached by: a provider must never be the app. */
function isSelf(url: URL, address?: string) {
  const own = String(process.env.PORT || 3417)
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  const host = unbracket(url.hostname.toLowerCase())
  const named = publicOrigins().some((o) => { try { return new URL(o).hostname.toLowerCase() === host && (new URL(o).port || (o.startsWith('https') ? '443' : '80')) === port } catch { return false } })
  if (named) return true
  const here = address ? placeOf(address) === 'loopback' : looksLocal(host) && (host === 'localhost' || host.endsWith('.localhost') || net.isIP(host) !== 0)
  return here && port === own
}

export type Checked = { ok: true; url: string } | { ok: false; problem: UrlProblem }

/**
 * The address as written: https, or http for a server on this machine or a home network. No sign-in details, no
 * query. The place it leads to is checked again when connecting.
 */
export function checkBaseUrl(raw: string): Checked {
  let u: URL
  try { u = new URL(raw.trim()) } catch { return { ok: false, problem: 'form' } }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, problem: 'scheme' }
  if (u.username || u.password) return { ok: false, problem: 'credentials' }
  if (u.search || u.hash) return { ok: false, problem: 'form' }
  const host = unbracket(u.hostname.toLowerCase())
  if (!host || NAMES_BLOCKED.has(host) || host.endsWith('.internal')) return { ok: false, problem: 'forbidden' }
  if (net.isIP(host) && placeOf(host) === 'blocked') return { ok: false, problem: 'forbidden' }
  if (isSelf(u)) return { ok: false, problem: 'self' }
  if (u.protocol === 'http:' && !looksLocal(host)) return { ok: false, problem: 'insecure' }
  return { ok: true, url: `${u.origin}${u.pathname.replace(/\/+$/, '')}` }
}

/** Where a key may be left out: a server on this machine or a home network. */
export const keyOptional = (url: string) => { try { return looksLocal(new URL(url).hostname) } catch { return false } }

/** An address's problem in words that say what to change. */
export const PROBLEM_TEXT: Record<UrlProblem, string> = {
  form: 'That is not a web address. It looks like https://host/v1',
  scheme: 'The address must start with https://',
  credentials: 'Leave the name and password out of the address: the key has its own field',
  insecure: 'The address must start with https://. Only a server on this computer or your home network may use http://',
  forbidden: 'This address cannot be used: it leads to the machine’s own services',
  self: 'This address is this app itself',
}

class Refused extends Error {}

/** The address a name leads to is checked here, at the moment of connecting, so a name cannot change after the check. */
function guardedLookup(plain: boolean, self: (address: string) => boolean): net.LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, found) => {
      if (err) return (callback as (e: Error | null) => void)(err)
      const okay = found.filter((f) => {
        const place = placeOf(f.address)
        if (place === 'blocked' || self(f.address)) return false
        // Plain http is for a machine that is ours; a name that leads to the open internet is not.
        return !plain || place === 'loopback' || place === 'private'
      })
      if (!okay.length) return (callback as (e: Error | null) => void)(new Refused('address refused'))
      if ((options as { all?: boolean }).all) return (callback as (e: Error | null, a: dns.LookupAddress[]) => void)(null, okay)
      ;(callback as (e: Error | null, a: string, f: number) => void)(null, okay[0].address, okay[0].family)
    })
  }
}

const MAX_BODY = 16 * 1024 * 1024

/**
 * `fetch` for a provider of the owner's own: only to the address checked above, with the name resolved and checked
 * again on connecting, no redirects followed (a redirect would carry the key to another server), and a time limit.
 * A 3xx answer comes back as it is, with no body, for the caller to call an error.
 */
export async function safeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  const first = checkBaseUrl(`${target.origin}${target.pathname}`)
  if (!first.ok) throw new Refused('address refused')
  const plain = target.protocol === 'http:'
  const host = unbracket(target.hostname)
  const self = (address: string) => isSelf(target, address)
  // A number written in the address is checked now: nothing is looked up for it.
  if (net.isIP(host) && (placeOf(host) === 'blocked' || (plain && placeOf(host) === 'public'))) throw new Refused('address refused')
  const headers: Record<string, string> = {}
  new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((v, k) => { headers[k] = v })
  const body = init.body == null ? null : typeof init.body === 'string' ? Buffer.from(init.body) : init.body instanceof Uint8Array ? Buffer.from(init.body) : init.body instanceof ArrayBuffer ? Buffer.from(init.body) : null
  if (init.body != null && !body) throw new Error('unsupported body')
  if (body) headers['content-length'] = String(body.length)
  const signal = init.signal ?? undefined
  return new Promise<Response>((resolve, reject) => {
    const mod = plain ? http : https
    const req = mod.request(target, { method: init.method ?? 'GET', headers, lookup: guardedLookup(plain, self) }, (res) => {
      const status = res.statusCode ?? 502
      if (status >= 300 && status < 400) {
        res.resume()
        return resolve(new Response(null, { status }))
      }
      let seen = 0
      res.on('data', (c: Buffer) => { seen += c.length; if (seen > MAX_BODY) res.destroy(new Error('answer too large')) })
      const out = new Headers()
      for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(', ') : v)
      resolve(new Response(status === 204 || status === 205 ? null : (Readable.toWeb(res) as ReadableStream), { status, headers: out }))
    })
    req.on('error', reject)
    if (signal) {
      if (signal.aborted) req.destroy(signal.reason)
      else signal.addEventListener('abort', () => req.destroy(signal.reason as Error), { once: true })
    }
    req.end(body ?? undefined)
  })
}
