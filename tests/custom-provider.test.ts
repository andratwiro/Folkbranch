// A provider the owner adds by hand: its address is checked, its key is bound to that address and never shown, it
// shows in the same list as the built-in ones, and the assistant answers through it. Every server here is on this
// machine and answers from a script: no real provider is called and nothing is paid.
import dns from 'node:dns'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { answerChoices, chooseModel, currentProvider, providerFailure, providerFor, providerStatus } from '../lib/agent/provider-key'
import { assistantResponse } from '../lib/agent/respond'
import { customById, customKey, listCustom, removeCustom, saveCustom, testCustom, customModels } from '../lib/ai/custom-providers'
import { readKeys } from '../lib/ai/keys'
import { checkBaseUrl, placeOf, safeFetch } from '../lib/ai/safe-url'
import { removeOwnProvider } from '../lib/ai/services'
import { monthTotal } from '../lib/ai/usage'
import { getDb, schema } from '../lib/db'
import { exportAiSettings, importAiSettings } from '../lib/ops/ai-config'
import { getSetting, setSetting } from '../lib/ops/settings'
import { seal } from '../lib/sealed'
import { editor, owner, reader } from './fixture-family'

const KEY = 'sk-own-provider-key-91ab33'
const clear = (key: string) => getDb().delete(schema.settings).where(eq(schema.settings.key, key)).run()

interface Seen { method?: string; url?: string; auth?: string; body: string }
let seen: Seen[] = []
let reply: (_req: IncomingMessage, res: import('node:http').ServerResponse, body: string) => void
let server: Server
let other: Server
let otherHits = 0
let otherAuth: (string | undefined)[] = []
let base = ''
let otherBase = ''
const listen = (s: Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)))

const chat = (res: import('node:http').ServerResponse, text = 'Hello.') => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const c = (delta: object, finish: string | null = null) => `data: ${JSON.stringify({ id: 's', object: 'chat.completion.chunk', created: 0, model: 's', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  res.write(c({ role: 'assistant', content: text }))
  res.write(c({}, 'stop'))
  res.write(`data: ${JSON.stringify({ id: 's', object: 'chat.completion.chunk', created: 0, model: 's', choices: [], usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 } })}\n\n`)
  res.end('data: [DONE]\n\n')
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body })
    reply(req, res, body)
  })
  other = createServer((req, res) => { otherHits++; otherAuth.push(req.headers.authorization); res.writeHead(200).end('{}') })
  base = `http://127.0.0.1:${await listen(server)}/v1`
  otherBase = `http://127.0.0.1:${await listen(other)}`
})
afterAll(() => { server.close(); other.close() })

const ENV = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'AGENT_PROVIDER', 'AGENT_MODEL', 'AGENT_BASE_URL']
const keep: Record<string, string | undefined> = {}
beforeEach(() => {
  seen = []
  otherHits = 0
  otherAuth = []
  reply = (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[{"id":"m-one"},{"id":"m-two"}]}') }
  for (const k of ENV) { keep[k] = process.env[k]; delete process.env[k] }
  for (const k of ['agentProvider', 'agentKey', 'agentModel', 'agentFolder', 'agentAuto', 'customProviders']) clear(k)
  setSetting('aiKeys', seal('{}', 'ai-keys'))
  setSetting('assistantEnabled', '0')
})
afterEach(() => { vi.restoreAllMocks(); for (const k of ENV) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k] } })

const add = (extra: Record<string, unknown> = {}) => saveCustom(owner, { name: 'My model', baseUrl: base, key: KEY, model: 'm-one', ...extra })

describe('the address of a provider of your own', () => {
  const problem = (u: string) => { const c = checkBaseUrl(u); return c.ok ? null : c.problem }

  it('takes https, and http only for this computer or a home network', () => {
    expect(checkBaseUrl('https://opencode.ai/zen/go/v1/')).toEqual({ ok: true, url: 'https://opencode.ai/zen/go/v1' })
    expect(checkBaseUrl('http://localhost:11434/v1')).toMatchObject({ ok: true })
    expect(checkBaseUrl('http://127.0.0.1:8080/v1')).toMatchObject({ ok: true })
    expect(checkBaseUrl('http://192.168.1.20:1234/v1')).toMatchObject({ ok: true })
    expect(checkBaseUrl('http://10.0.0.5/v1')).toMatchObject({ ok: true })
    expect(checkBaseUrl('http://ollama.local:11434/v1')).toMatchObject({ ok: true })
    expect(problem('http://api.example.com/v1')).toBe('insecure')
    expect(problem('http://8.8.8.8/v1')).toBe('insecure')
    expect(problem('ftp://api.example.com')).toBe('scheme')
    expect(problem('not a url')).toBe('form')
  })

  it('refuses sign-in details in the address, and a query or fragment', () => {
    expect(problem('https://user:secret@api.example.com/v1')).toBe('credentials')
    expect(problem('https://user@api.example.com/v1')).toBe('credentials')
    expect(problem('https://api.example.com/v1?key=abc')).toBe('form')
    expect(problem('https://api.example.com/v1#x')).toBe('form')
  })

  it('refuses the machine’s own services: link-local, cloud metadata, and the app itself', () => {
    for (const u of ['http://169.254.169.254/latest', 'https://169.254.169.254/v1', 'https://metadata.google.internal/v1', 'http://metadata.google.internal', 'https://[fe80::1]/v1', 'https://[fd00:ec2::254]/v1', 'https://[::ffff:169.254.169.254]/v1', 'https://100.100.100.200/v1', 'https://0.0.0.0/v1', 'https://something.internal/v1']) expect(problem(u), u).toBe('forbidden')
    process.env.PORT = '3417'
    expect(problem('http://localhost:3417/api')).toBe('self')
    expect(problem('http://127.0.0.1:3417/v1')).toBe('self')
    expect(problem('http://localhost:3418/v1')).toBeNull()
    delete process.env.PORT
  })

  it('names what an address is, also when written as an IPv4 inside IPv6', () => {
    expect(placeOf('169.254.1.1')).toBe('blocked')
    expect(placeOf('::ffff:169.254.169.254')).toBe('blocked')
    expect(placeOf('fe80::abcd')).toBe('blocked')
    expect(placeOf('127.0.0.1')).toBe('loopback')
    expect(placeOf('::1')).toBe('loopback')
    expect(placeOf('172.20.1.1')).toBe('private')
    expect(placeOf('172.32.1.1')).toBe('public')
    expect(placeOf('fd12::1')).toBe('private')
    expect(placeOf('1.1.1.1')).toBe('public')
  })

  it('is checked again when the name is looked up, so a name cannot lead to a forbidden place later', async () => {
    const lookup = vi.spyOn(dns, 'lookup').mockImplementation(((_h: string, _o: unknown, cb: (e: Error | null, a: dns.LookupAddress[]) => void) => cb(null, [{ address: '169.254.169.254', family: 4 }])) as never)
    await expect(safeFetch('https://api.rebind.example/v1/models')).rejects.toThrow()
    expect(lookup).toHaveBeenCalled()
    // Plain http is for our own machines: a name that leads to the open internet is refused too.
    lookup.mockImplementation(((_h: string, _o: unknown, cb: (e: Error | null, a: dns.LookupAddress[]) => void) => cb(null, [{ address: '93.184.216.34', family: 4 }])) as never)
    await expect(safeFetch('http://box.local/v1/models')).rejects.toThrow()
  })
})

describe('the provider is only called at its own address', () => {
  it('sends the key in the header to the address it was saved for, and follows no redirect to another server', async () => {
    reply = (_req, res) => { res.writeHead(302, { location: `${otherBase}/steal` }).end() }
    const res = await safeFetch(`${base}/models`, { headers: { authorization: `Bearer ${KEY}` } })
    expect(res.status).toBe(302)
    expect(seen).toHaveLength(1)
    expect(seen[0].auth).toBe(`Bearer ${KEY}`)
    expect(otherHits).toBe(0)
  })

  it('a redirect makes a Test say that nothing answers, and the other server never hears of the key', async () => {
    reply = (_req, res) => { res.writeHead(307, { location: `${otherBase}/v1/chat/completions` }).end() }
    const r = await testCustom(owner, { baseUrl: base, key: KEY, model: 'm-one' })
    expect(r.ok).toBe(false)
    expect(otherHits).toBe(0)
  })
})

describe('the key is bound to the address it was saved with', () => {
  it('is kept encrypted with its address, and read back only for that address', () => {
    const p = add()
    expect(customKey(customById(p.id)!)).toBe(KEY)
    expect(JSON.stringify(readKeys()[p.id])).toContain(base)
    expect(getSetting('aiKeys')).not.toContain(KEY)
    expect(getSetting('customProviders')).not.toContain(KEY)
  })

  it('changing the address asks for the key again, and the old key is not carried to the new address', () => {
    const p = add()
    expect(() => saveCustom(owner, { id: p.id, name: 'My model', baseUrl: otherBase, model: 'm-one' })).toThrow(/enter the key again/i)
    // Nothing changed by the refusal.
    expect(customById(p.id)!.baseUrl).toBe(base)
    expect(customKey(customById(p.id)!)).toBe(KEY)
    const moved = saveCustom(owner, { id: p.id, name: 'My model', baseUrl: otherBase, key: 'a-new-key-for-the-other-1', model: 'm-one' })
    expect(moved.baseUrl).toBe(otherBase)
    expect(customKey(customById(p.id)!)).toBe('a-new-key-for-the-other-1')
  })

  it('a list that names another address (a restored copy, a hand edit) never gets the saved key', async () => {
    const p = add()
    await chooseModel(owner, { provider: p.id })
    expect(currentProvider()).toMatchObject({ id: p.id, key: KEY })
    // The settings now say another server, while the sealed key still says where it belongs.
    setSetting('customProviders', JSON.stringify([{ ...customById(p.id), baseUrl: otherBase }]))
    expect(customKey(customById(p.id)!)).toBeNull()
    expect(currentProvider()).toBeNull()
    expect(answerChoices().some((c) => c.provider === p.id)).toBe(false)
    expect(providerFor(p.id, 'm-one')).toBeNull()
    expect(listCustom(owner)[0]).toMatchObject({ hasKey: false, keyNeeded: true })
    // Asked to test, it does not borrow the key either.
    await testCustom(owner, { id: p.id, model: 'm-one' })
    expect(seen).toEqual([])
    expect(otherHits).toBe(1)
    expect(otherAuth).toEqual([undefined])
  })

  it('an AI settings file can switch to a saved provider, and can never name or change its address', async () => {
    const p = add()
    const file = exportAiSettings(owner)
    expect(JSON.stringify(file)).not.toContain(base)
    expect(JSON.stringify(file)).not.toContain(KEY)
    const r = await importAiSettings(owner, { folkbranch: 'ai-settings', version: 1, assistant: { provider: p.id, model: 'm-two', baseUrl: otherBase, key: 'stolen' } })
    expect(r.skipped).toEqual([])
    expect(customById(p.id)!.baseUrl).toBe(base)
    expect(customKey(customById(p.id)!)).toBe(KEY)
    // A provider the file names but this server does not have is not made up from the file.
    const unknown = await importAiSettings(owner, { folkbranch: 'ai-settings', version: 1, assistant: { provider: 'custom-zzzzzzzzzz', model: 'x' } })
    expect(unknown.skipped).toHaveLength(1)
    expect(listCustom(owner)).toHaveLength(1)
  })

  it('removing a provider deletes its key', () => {
    const p = add()
    removeCustom(owner, p.id)
    expect(readKeys()[p.id]).toBeUndefined()
    expect(listCustom(owner)).toEqual([])
  })

  it('a key is needed for a remote address, and optional for this computer', () => {
    expect(() => saveCustom(owner, { name: 'Remote', baseUrl: 'https://api.example.com/v1', model: 'm' })).toThrow(/needs a key/i)
    expect(saveCustom(owner, { name: 'Local', baseUrl: base, model: 'm-one' })).toMatchObject({ hasKey: false, keyNeeded: false })
  })
})

describe('the key never leaves in an answer, a log line or an error', () => {
  it('no answer of the app holds it: not the list, the status, the choices nor the settings file', async () => {
    const p = add()
    await chooseModel(owner, { provider: p.id })
    const everything = JSON.stringify([listCustom(owner), providerStatus(owner), answerChoices(), exportAiSettings(owner), p])
    expect(everything).not.toContain(KEY)
    expect(everything).not.toContain(KEY.slice(-4))
  })

  it('a server that repeats the key in its error shows neither the key nor its words in a Test', async () => {
    reply = (_req, res, body) => { res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `bad key ${KEY}`, echo: body })) }
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await testCustom(owner, { baseUrl: base, key: KEY, model: 'm-one' })
    expect(r).toMatchObject({ ok: false, code: 'wrong-key' })
    expect(JSON.stringify(r)).not.toContain(KEY)
    expect(JSON.stringify(r)).not.toContain('bad key')
    expect(JSON.stringify(logged.mock.calls)).not.toContain(KEY)
  })

  it('the log of a failed answer holds the provider’s words but not the key it echoed', async () => {
    const p = add()
    await chooseModel(owner, { provider: p.id })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const text = providerFailure({ statusCode: 401, url: base, responseBody: `Incorrect API key provided: ${KEY}` })
    expect(text).toBeTruthy()
    expect(JSON.stringify(logged.mock.calls)).not.toContain(KEY)
    expect(JSON.stringify(logged.mock.calls)).toContain('Incorrect API key')
  })

  it('a Test says what happened in plain words for each kind of trouble', async () => {
    const say = async (status: number, text = '') => { reply = (_r, res) => { res.writeHead(status).end(text) }; return testCustom(owner, { baseUrl: base, key: KEY, model: 'm-one' }) }
    expect(await say(200, '{"choices":[]}')).toMatchObject({ ok: true, code: 'ok' })
    expect(await say(401)).toMatchObject({ code: 'wrong-key' })
    expect(await say(404, 'no route')).toMatchObject({ code: 'wrong-address' })
    expect(await say(404, '{"error":"model m-one not found"}')).toMatchObject({ code: 'model-missing' })
    expect(await say(503)).toMatchObject({ code: 'no-answer' })
    // Tools refused, a plain question accepted: the server just does not take tools.
    reply = (_r, res, body) => { if (JSON.parse(body).tools) res.writeHead(400).end('{"error":"tools are not supported"}'); else res.writeHead(200).end('{}') }
    expect(await testCustom(owner, { baseUrl: base, key: KEY, model: 'm-one' })).toMatchObject({ ok: false, code: 'no-tools' })
    // Nothing listens there.
    const closed = createServer()
    const port = await listen(closed)
    await new Promise((r) => closed.close(r))
    expect(await testCustom(owner, { baseUrl: `http://127.0.0.1:${port}/v1`, key: KEY, model: 'm-one' })).toMatchObject({ code: 'no-answer' })
  })

  it('the model list comes from the provider’s own /models with the key, and a failure just leaves the name to be typed', async () => {
    expect(await customModels(owner, { baseUrl: base, key: KEY })).toEqual({ models: ['m-one', 'm-two'], listed: true })
    expect(seen[0]).toMatchObject({ url: '/v1/models', auth: `Bearer ${KEY}` })
    reply = (_r, res) => { res.writeHead(500).end('boom') }
    expect(await customModels(owner, { baseUrl: base, key: KEY })).toEqual({ models: [], listed: false })
  })
})

describe('the provider list and the assistant', () => {
  it('an own provider is in the same list as the built-in ones, marked as the owner’s, and can be made the active one', async () => {
    const p = add()
    expect(answerChoices()).toContainEqual(expect.objectContaining({ provider: p.id, label: 'My model', model: 'm-one', custom: true, current: false }))
    const status = await chooseModel(owner, { provider: p.id })
    expect(status).toMatchObject({ connected: true, custom: true, label: 'My model', model: 'm-one', keyEnding: null })
    expect(getSetting('assistantEnabled')).toBe('1')
    expect(answerChoices().find((c) => c.provider === p.id)?.current).toBe(true)
    expect(providerFor(p.id, 'm-one')).toMatchObject({ id: p.id, custom: true, key: KEY })
    // Another model of the same provider is not offered unless it is the saved one.
    expect(providerFor(p.id, 'something-else')).toBeNull()
  })

  it('removing the active provider switches the assistant off', async () => {
    const p = add()
    await chooseModel(owner, { provider: p.id })
    removeOwnProvider(owner, p.id)
    expect(currentProvider()).toBeNull()
    expect(getSetting('assistantEnabled')).toBe('0')
    expect(readKeys()[p.id]).toBeUndefined()
  })

  it('the assistant answers through it, sends the key only to its address, and counts the tokens with the price unknown', async () => {
    const p = add()
    await chooseModel(owner, { provider: p.id })
    reply = (_req, res) => chat(res, 'Hello from the stub.')
    const before = monthTotal('assistant')
    const res = await assistantResponse(owner, { messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }] })
    expect(await res.text()).toContain('Hello from the stub.')
    const asked = seen.filter((s) => s.url?.endsWith('/chat/completions'))
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((s) => s.auth === `Bearer ${KEY}`)).toBe(true)
    expect(otherHits).toBe(0)
    const after = monthTotal('assistant')
    expect(after.tokens - before.tokens).toBeGreaterThanOrEqual(50)
    // No money is assumed: the request counts as one whose price nobody stated.
    expect(after.dollars).toBe(before.dollars)
    expect(after.unpriced - before.unpriced).toBeGreaterThanOrEqual(1)
  })
})

describe('only the owner', () => {
  it('can read or change providers and keys, or ask the server to call one', async () => {
    const p = add()
    for (const who of [editor, reader]) {
      expect(() => listCustom(who)).toThrow(/owner|forbidden|only/i)
      expect(() => saveCustom(who, { name: 'x', baseUrl: base, key: KEY, model: 'm' })).toThrow()
      expect(() => removeCustom(who, p.id)).toThrow()
      expect(() => removeOwnProvider(who, p.id)).toThrow()
      await expect(testCustom(who, { id: p.id, model: 'm-one' })).rejects.toMatchObject({ status: 403 })
      await expect(customModels(who, { id: p.id })).rejects.toMatchObject({ status: 403 })
      await expect(chooseModel(who, { provider: p.id })).rejects.toMatchObject({ status: 403 })
    }
    expect(seen).toEqual([])
    expect(customKey(customById(p.id)!)).toBe(KEY)
  })
})
