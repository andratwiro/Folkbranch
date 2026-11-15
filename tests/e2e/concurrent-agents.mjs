// A person, the built-in assistant (against the local model stub) and an outside agent over MCP,
// all changing one archive: in sequence, at the same time, on one field and on different people.
// Review tokens draft, direct tokens write, history names each author, and a restart keeps it all.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readUIMessageStream } from 'ai'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const PORT = 3512, B = `http://127.0.0.1:${PORT}`, STUB = 'http://127.0.0.1:3499'
const APP = path.join(repo, 'dist', 'app')
const DATA = path.join(repo, 'dist', 'data-concurrent-agents')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x && !c ? '  ' + x : ''}`); if (!c) process.exitCode = 1 }
const LABEL = { birthPlace: 'Место рождения', deathPlace: 'Место смерти', tags: 'Название группы', facts: 'Факты', givenName: 'Имя' }

// The production bundle, unpacked once, and a data folder this run owns.
if (!fs.existsSync(path.join(APP, 'server.js'))) {
  fs.mkdirSync(APP, { recursive: true })
  const r = spawnSync('tar', ['-xJf', process.env.FG_BUNDLE ?? path.join(repo, 'dist', `folkbranch-${process.platform}-${process.arch}.tar.xz`), '-C', APP, '--strip-components', '1'])
  if (r.status !== 0) { console.error('could not unpack the bundle'); process.exit(1) }
}
fs.rmSync(DATA, { recursive: true, force: true })
fs.mkdirSync(DATA, { recursive: true })

// The model stand-in: a fake key and a local address, so no provider is ever called.
const stub = spawn(process.execPath, [fileURLToPath(new URL('model-stub.mjs', import.meta.url))], { cwd: repo, stdio: 'ignore' })
let server = null
const killAll = () => { try { server?.kill('SIGKILL') } catch {} ; try { stub.kill('SIGKILL') } catch {} }
process.on('exit', killAll)
process.on('uncaughtException', (e) => { console.error(e); killAll(); process.exit(1) })

const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(PORT),
  DATA_DIR: DATA, BETTER_AUTH_URL: B, BETTER_AUTH_SECRET: 's'.repeat(64), SETUP_TOKEN: 'cc',
  AGENT_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'fake-key-not-real', ANTHROPIC_BASE_URL: STUB, AGENT_MODEL: 'stub',
}
let log = ''
async function start() {
  server = spawn(process.execPath, ['server.js'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] })
  log = ''
  server.stdout.on('data', (d) => { log += d })
  server.stderr.on('data', (d) => { log += d })
  const end = Date.now() + 90000
  while (Date.now() < end) {
    if (await fetch(B + '/api/health').then((r) => r.ok).catch(() => false)) return
    await sleep(150)
  }
  throw new Error('server did not come up: ' + log.slice(-400))
}
async function stop(signal = 'SIGTERM') {
  if (!server) return
  const done = new Promise((r) => server.once('exit', r))
  server.kill(signal)
  await done
  server = null
}

let cookie = ''
const req = (method, p, body, headers = {}) => fetch(B + p, {
  method,
  headers: { origin: B, cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
  body: body !== undefined ? JSON.stringify(body) : undefined,
})
const read = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
const v1 = async (method, p, body) => { const r = await req(method, '/api/v1/' + p, body); return { status: r.status, body: await read(r) } }
const graph = async () => (await v1('GET', 'graph')).body
const card = (g, id) => g.persons.find((p) => p.id === id)
const history = async () => (await v1('GET', 'history?limit=500')).body
const proposals = async () => (await v1('GET', 'proposals')).body
const mkPerson = async (givenName, surname, extra = {}) => {
  const r = await v1('POST', 'persons', { person: { givenName, surname, sex: 'M', birthDate: '1880', deathDate: '1955', ...extra } })
  const id = r.body?.id ?? r.body?.person?.id
  if (!id) throw new Error(`create person failed: ${r.status} ${JSON.stringify(r.body)}`)
  return id
}
const mint = async (name, review) => {
  const r = await v1('POST', 'tokens', { name, role: 'editor', review })
  if (!r.body?.token) throw new Error(`token failed: ${r.status} ${JSON.stringify(r.body)}`)
  return r.body.token
}

// ---- MCP: JSON-RPC over POST /api/mcp, a fresh stateless transport per request. ----
async function mcp(token, method, params, id = 1) {
  const r = await fetch(B + '/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  const text = await r.text()
  const payload = /^(event|data):/m.test(text) ? text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('') : text
  let json = null
  try { json = JSON.parse(payload) } catch {}
  return { status: r.status, json, raw: text }
}
async function tool(token, name, args) {
  const r = await mcp(token, 'tools/call', { name, arguments: args })
  const res = r.json?.result
  const text = res?.content?.find?.((c) => c.type === 'text')?.text
  let data = null
  try { data = JSON.parse(text) } catch {}
  return { status: r.status, isError: !!res?.isError, data, text, error: r.json?.error }
}

// ---- The built-in assistant: one turn, answering each write confirmation the way a person would. ----
async function ask(text, approve = true) {
  const messages = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text }] }]
  const asked = []
  for (let round = 0; round < 8; round++) {
    const r = await req('POST', '/api/agent', { messages, trustWrites: false })
    if (!r.ok) return { error: `${r.status} ${await r.text()}`, asked, messages }
    const chunks = (await r.text()).split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]')).map((l) => JSON.parse(l.slice(6)))
    const streamError = chunks.find((c) => c.type === 'error')
    if (streamError) return { streamError: streamError.errorText, asked, messages }
    const stream = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close() } })
    const prior = messages.at(-1).role === 'assistant' ? messages.pop() : undefined
    let message
    for await (const m of readUIMessageStream({ stream, message: prior })) message = m
    if (!message) return { streamError: 'empty stream', asked, messages }
    messages.push(message)
    const waiting = message.parts.filter((p) => p.state === 'approval-requested')
    if (!waiting.length) break
    for (const p of waiting) {
      asked.push(p.type.replace('tool-', ''))
      p.state = 'approval-responded'
      p.approval = { ...p.approval, approved: approve }
    }
  }
  const parts = messages.at(-1).parts
  return {
    asked, messages,
    tools: parts.filter((p) => p.type.startsWith('tool-')).map((p) => p.type.replace('tool-', '')),
    failed: parts.filter((p) => p.state === 'output-error').map((p) => p.errorText),
    reply: parts.filter((p) => p.type === 'text').map((p) => p.text).join(' '),
  }
}
const setIds = (ids) => fetch(STUB + '/ids', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ids) })

// History: one entry per write, found by person, field label and the value it wrote.
const writesOf = (h, id, actor, field) => h.filter((e) => e.personIds?.includes(id) && e.actorName === actor && (e.details ?? []).some((d) => d.label === LABEL[field]))
const oneWrite = (name, h, id, actor, field, after) => {
  const all = writesOf(h, id, actor, field)
  const match = all.filter((e) => after === undefined || e.details.some((d) => d.label === LABEL[field] && d.after === after))
  ok(name, match.length === 1, `entries for ${id} ${field} by ${actor}: ${JSON.stringify(all.map((e) => e.details))}`)
  return match.length
}
const noWrite = (name, h, id, field, after) => {
  const match = h.filter((e) => e.personIds?.includes(id) && (e.details ?? []).some((d) => d.label === LABEL[field] && d.after === after))
  ok(name, match.length === 0, JSON.stringify(match.map((e) => ({ actor: e.actorName, details: e.details }))))
}

try {
  await start()
  const setup = await fetch(B + '/api/auth/family/setup', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: B },
    body: JSON.stringify({ name: 'Анна', familyName: 'Проба', language: 'ru', demo: true, code: 'cc' }),
  })
  cookie = setup.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  ok('the owner is signed in', setup.ok && cookie.includes('session_token'), `${setup.status} ${cookie.slice(0, 40)}`)
  ok('the assistant is turned on', (await v1('PATCH', 'settings', { assistantEnabled: '1' })).status === 200)
  const direct = await mint('Внешний агент', false)
  // One pending draft per token: separate review tokens keep unrelated drafts from queuing into one.
  const review = await mint('Рецензент', true)
  const reviewJ = await mint('Рецензент И', true)
  const reviewF = await mint('Рецензент Ф', true)
  const reviewD = await mint('Рецензент Д', true)
  const reviewL = await mint('Рецензент Л', true)
  const list = await mcp(direct, 'tools/list', {})
  ok('MCP lists the writing tools to an editor token', list.status === 200 && list.json?.result?.tools?.some((t) => t.name === 'update_person'), `status ${list.status}`)

  const A = await mkPerson('Аркадий', 'Пробин')
  const Bp = await mkPerson('Борис', 'Пробин')
  const E = await mkPerson('Ефим', 'Пробин')
  const F = await mkPerson('Фёдор', 'Пробин')
  const D = await mkPerson('Даниил', 'Пробин')
  const L = await mkPerson('Лука', 'Пробин')
  const G = await mkPerson('Глеб', 'Пробин')
  const I = await mkPerson('Илья', 'Пробин')
  const J = await mkPerson('Иван', 'Пробин')
  const H = await mkPerson('Харитон', 'Пробин')

  // ---- 1. At the same time: the assistant adds someone, a person edits A, a direct agent edits A. ----
  const [said, pe, ae] = await Promise.all([
    ask('Добавь нового человека в архив.'),
    v1('PATCH', `persons/${A}`, { birthPlace: 'Ржев', seen: { birthPlace: '' } }),
    tool(direct, 'update_person', { id: A, patch: { deathPlace: 'Псков' } }),
  ])
  let g = await graph()
  const aConcurrent = card(g, A)
  ok('at the same time: the person’s edit and the direct agent’s edit both land on one card',
    pe.status === 200 && !ae.isError && ae.data?.id === A && aConcurrent?.birthPlace === 'Ржев' && aConcurrent?.deathPlace === 'Псков',
    `person ${pe.status} ${JSON.stringify(pe.body)}; agent ${ae.status} ${ae.text}; card ${JSON.stringify(aConcurrent && { birthPlace: aConcurrent.birthPlace, deathPlace: aConcurrent.deathPlace })}`)
  const N = g.persons.find((p) => p.givenName === 'Проба' && p.surname === 'Агентова')
  ok('at the same time: the assistant’s new person is in the graph',
    !!N && said.asked.includes('create_person') && (said.failed?.length ?? 0) === 0,
    `person ${!!N}; asked ${said.asked}; failed ${said.failed}; reply ${said.reply}; error ${said.error ?? said.streamError}`)
  ok('a different person is untouched by the concurrent writes', card(g, Bp)?.birthPlace === '', JSON.stringify(card(g, Bp)?.birthPlace))

  // ---- All three writers in sequence on the assistant's person: person, direct agent, person. ----
  const nSeen = N?.deathPlace ?? ''
  const p1 = await v1('PATCH', `persons/${N.id}`, { deathPlace: 'Тихвин', seen: { deathPlace: nSeen } })
  const m1 = await tool(direct, 'update_person', { id: N.id, patch: { birthPlace: 'Устюг' } })
  const p2 = await v1('PATCH', `persons/${N.id}`, { birthPlace: 'Великий Устюг', seen: { birthPlace: 'Устюг' } })
  g = await graph()
  const nAfter = card(g, N.id)
  ok('in sequence on one card, the person and the direct agent each change it',
    p1.status === 200 && !m1.isError && m1.data?.id === N.id && p2.status === 200 && nAfter?.deathPlace === 'Тихвин' && nAfter?.birthPlace === 'Великий Устюг',
    `${p1.status}/${m1.status}/${p2.status}; card ${JSON.stringify(nAfter && { deathPlace: nAfter.deathPlace, birthPlace: nAfter.birthPlace })}`)

  // ---- The assistant as a third writer in sequence on one card: two edits, then a delete. ----
  const hp = await v1('PATCH', `persons/${H}`, { birthPlace: 'Бежецк', seen: { birthPlace: '' } })
  const ha = await tool(direct, 'update_person', { id: H, patch: { deathPlace: 'Кашин' } })
  await setIds([H, ''])
  const hDel = await ask('Удали этого человека.')
  g = await graph()
  ok('in sequence on one card, the assistant deletes it after the person’s and the agent’s edits',
    hp.status === 200 && !ha.isError && card(g, H) === undefined && hDel.asked.includes('delete_person') && (hDel.failed?.length ?? 0) === 0,
    `person ${hp.status}; agent ${ha.status} ${ha.text}; gone ${card(g, H) === undefined}; asked ${hDel.asked}; failed ${hDel.failed}; error ${hDel.error ?? hDel.streamError}`)

  // ---- A deliberately stale `seen`: the agent already changed the field, so the person is refused. ----
  const iAgent = await tool(direct, 'update_person', { id: I, patch: { birthPlace: 'Кунгур' } })
  const iStale = await v1('PATCH', `persons/${I}`, { birthPlace: 'Чердынь', seen: { birthPlace: '' } })
  g = await graph()
  ok('a stale `seen` is refused with 409, names the field, and leaves the agent’s value',
    !iAgent.isError && iStale.status === 409 && /birthPlace/.test(String(iStale.body?.error)) && card(g, I)?.birthPlace === 'Кунгур',
    `agent ${iAgent.status} ${iAgent.text}; person ${iStale.status} ${JSON.stringify(iStale.body)}; card ${JSON.stringify(card(g, I)?.birthPlace)}`)

  // ---- The same field at the same time: person PATCH-with-seen races a direct agent write. ----
  const [gp, ga] = await Promise.all([
    v1('PATCH', `persons/${G}`, { deathPlace: 'Рязань', seen: { deathPlace: '' } }),
    tool(direct, 'update_person', { id: G, patch: { deathPlace: 'Тула' } }),
  ])
  g = await graph()
  const gNow = card(g, G)?.deathPlace
  const personWon = gp.status === 200, agentWon = !ga.isError && ga.data?.id === G
  const oneVisibleWinner = (personWon && !agentWon && gNow === 'Рязань') || (agentWon && !personWon && gNow === 'Тула')
  ok('same-field race (person vs direct agent): exactly one wins, the other is refused or merged, never silently overwritten',
    oneVisibleWinner && (gp.status === 409 || ga.isError),
    `person ${gp.status} ${JSON.stringify(gp.body)}; agent ${ga.status} isError=${ga.isError} ${ga.text}; card ${JSON.stringify(gNow)}; both succeeded=${personWon && agentWon}`)

  // ---- The same field at the same time, both writes carrying `seen`: accept a review draft while the person edits. ----
  const jDraft = await tool(reviewJ, 'update_person', { id: J, patch: { deathPlace: 'Сыктывкар' } })
  const [jp, ja] = await Promise.all([
    v1('PATCH', `persons/${J}`, { deathPlace: 'Ухта', seen: { deathPlace: '' } }),
    v1('POST', `proposals/${jDraft.data.proposalId}/accept`),
  ])
  g = await graph()
  const jNow = card(g, J)?.deathPlace
  const jPending = (await proposals()).find?.((p) => p.id === jDraft.data?.proposalId)
  const jPersonWins = jp.status === 200 && ja.status === 409 && jNow === 'Ухта' && !!jPending && jPending.status === 'pending' && /deathPlace/.test(String(jPending.error))
  const jDraftWins = ja.status === 200 && jp.status === 409 && jNow === 'Сыктывкар' && !jPending
  ok('same-field race (person vs review draft accept): exactly one wins, the loser is refused and nothing is lost',
    jPersonWins || jDraftWins,
    `person ${jp.status} ${JSON.stringify(jp.body)}; accept ${ja.status} ${JSON.stringify(ja.body)}; card ${JSON.stringify(jNow)}; pending ${JSON.stringify(jPending)}`)

  // ---- 2. A review token drafts; nothing changes until a person accepts, then it applies exactly. ----
  const draft1 = await tool(review, 'update_person', { id: E, patch: { deathPlace: 'Галич' } })
  g = await graph()
  const pending1 = (await proposals()).find?.((p) => p.id === draft1.data?.proposalId)
  ok('a review agent’s write waits as a draft and changes nothing',
    draft1.data?.status === 'pending_review' && !!draft1.data?.proposalId && card(g, E)?.deathPlace === '' && !!pending1 && pending1.authorName === 'Рецензент' && pending1.ops?.some((o) => o.op === 'update_person'),
    `${draft1.status} ${draft1.text}; card ${JSON.stringify(card(g, E)?.deathPlace)}; proposal ${JSON.stringify(pending1)}`)
  const acc1 = await v1('POST', `proposals/${draft1.data.proposalId}/accept`)
  g = await graph()
  ok('accepting the draft applies it exactly and clears it',
    acc1.status === 200 && card(g, E)?.deathPlace === 'Галич' && !(await proposals()).some?.((p) => p.id === draft1.data.proposalId),
    `${acc1.status} ${JSON.stringify(acc1.body)}; card ${JSON.stringify(card(g, E)?.deathPlace)}`)

  // ---- A draft after the person changed the SAME field: refused, person's value kept, draft keeps its error. ----
  const draftF = await tool(reviewF, 'update_person', { id: F, patch: { birthPlace: 'Соль' } })
  const meanwhileF = await v1('PATCH', `persons/${F}`, { birthPlace: 'Тотьма', seen: { birthPlace: '' } })
  const accF = await v1('POST', `proposals/${draftF.data.proposalId}/accept`)
  g = await graph()
  const fLeft = (await proposals()).find?.((p) => p.id === draftF.data.proposalId)
  ok('a draft on the SAME field changed meanwhile is refused (409), keeps the person’s value and stays with an error',
    meanwhileF.status === 200 && accF.status === 409 && /birthPlace/.test(String(accF.body?.error)) && card(g, F)?.birthPlace === 'Тотьма' && !!fLeft && fLeft.status === 'pending' && /birthPlace/.test(String(fLeft.error)),
    `meanwhile ${meanwhileF.status}; accept ${accF.status} ${JSON.stringify(accF.body)}; card ${JSON.stringify(card(g, F)?.birthPlace)}; draft ${JSON.stringify(fLeft)}`)

  // ---- A draft after the person changed a DIFFERENT field: applies, both changes stay. ----
  const draftD = await tool(reviewD, 'update_person', { id: D, patch: { deathPlace: 'Галич' } })
  const meanwhileD = await v1('PATCH', `persons/${D}`, { birthPlace: 'Вологда', seen: { birthPlace: '' } })
  const accD = await v1('POST', `proposals/${draftD.data.proposalId}/accept`)
  g = await graph()
  ok('a draft on a DIFFERENT field changed meanwhile applies, and both changes remain',
    meanwhileD.status === 200 && accD.status === 200 && card(g, D)?.deathPlace === 'Галич' && card(g, D)?.birthPlace === 'Вологда',
    `meanwhile ${meanwhileD.status}; accept ${accD.status} ${JSON.stringify(accD.body)}; card ${JSON.stringify(card(g, D) && { birthPlace: card(g, D).birthPlace, deathPlace: card(g, D).deathPlace })}`)

  // ---- Lists (facts, tags) changed by both merge; neither addition is lost. ----
  const draftL = await tool(reviewL, 'update_person', { id: L, patch: { tags: ['рецензент'], facts: [{ kind: 'Награда', date: '', place: '', note: '', source: '' }] } })
  const meanwhileL = await v1('PATCH', `persons/${L}`, { tags: ['родня'], facts: [{ kind: 'Служба', date: '', place: '', note: '', source: '' }], seen: { tags: [], facts: [] } })
  const accL = await v1('POST', `proposals/${draftL.data.proposalId}/accept`)
  g = await graph()
  const lNow = card(g, L)
  ok('lists (tags, facts) changed by both merge, keeping both sides',
    meanwhileL.status === 200 && accL.status === 200 && lNow?.tags?.includes('родня') && lNow?.tags?.includes('рецензент') && lNow?.facts?.some((f) => f.kind === 'Служба') && lNow?.facts?.some((f) => f.kind === 'Награда'),
    `meanwhile ${meanwhileL.status}; accept ${accL.status} ${JSON.stringify(accL.body)}; tags ${JSON.stringify(lNow?.tags)}; facts ${JSON.stringify(lNow?.facts?.map((f) => f.kind))}`)

  // ---- 3. A direct token writes at once, with no draft. ----
  const before3 = (await proposals()).length
  const directWrite = await tool(direct, 'update_person', { id: Bp, patch: { deathPlace: 'Орёл' } })
  g = await graph()
  ok('a direct agent’s write applies at once and leaves no draft',
    !directWrite.isError && directWrite.data?.id === Bp && !directWrite.data?.proposalId && card(g, Bp)?.deathPlace === 'Орёл' && (await proposals()).length === before3,
    `${directWrite.status} ${directWrite.text}; card ${JSON.stringify(card(g, Bp)?.deathPlace)}`)

  // ---- 4. History: one entry per write, matched by person and field, with the right author. ----
  const h = await history()
  const A_ = 'Анна', AG = 'Внешний агент', AS = 'Ассистент → Анна', RE = 'Рецензент → Анна', RD = 'Рецензент Д → Анна', RL = 'Рецензент Л → Анна', RJ = 'Рецензент И → Анна'
  oneWrite('history: the person’s A birth place', h, A, A_, 'birthPlace', 'Ржев')
  oneWrite('history: the direct agent’s A death place', h, A, AG, 'deathPlace', 'Псков')
  const nCreate = h.filter((e) => e.actorName === AS && e.personIds?.includes(N.id) && /Проба/.test(e.summary ?? ''))
  ok('history: the assistant’s new person is recorded with the assistant as author', nCreate.length === 1, JSON.stringify(nCreate.map((e) => e.summary)))
  oneWrite('history: the person’s first edit of the assistant’s person', h, N.id, A_, 'deathPlace', 'Тихвин')
  oneWrite('history: the direct agent’s edit of the assistant’s person', h, N.id, AG, 'birthPlace', 'Устюг')
  oneWrite('history: the person’s second edit of the assistant’s person', h, N.id, A_, 'birthPlace', 'Великий Устюг')
  oneWrite('history: the accepted draft author is named', h, E, RE, 'deathPlace', 'Галич')
  oneWrite('history: the person’s edit that beat the refused draft', h, F, A_, 'birthPlace', 'Тотьма')
  noWrite('history: the refused draft left no value in history', h, F, 'birthPlace', 'Соль')
  oneWrite('history: the person’s I edit was refused, only the agent’s Kунгур stands', h, I, AG, 'birthPlace', 'Кунгур')
  noWrite('history: the stale-seen I edit left no history entry', h, I, 'birthPlace', 'Чердынь')
  oneWrite('history: the person’s D birth place', h, D, A_, 'birthPlace', 'Вологда')
  oneWrite('history: the D draft applied after a different field changed', h, D, RD, 'deathPlace', 'Галич')
  oneWrite('history: the person’s L list edit', h, L, A_, 'tags')
  oneWrite('history: the person’s L fact', h, L, A_, 'facts')
  oneWrite('history: the accepted L draft', h, L, RL, 'tags')
  oneWrite('history: the accepted L fact', h, L, RL, 'facts')
  oneWrite('history: the direct token’s B write', h, Bp, AG, 'deathPlace', 'Орёл')
  oneWrite('history: the person’s H edit before the assistant deleted it', h, H, A_, 'birthPlace', 'Бежецк')
  oneWrite('history: the agent’s H edit', h, H, AG, 'deathPlace', 'Кашин')
  const hDelete = h.filter((e) => e.actorName === AS && e.personIds?.includes(H) && /Удал/.test(e.summary ?? ''))
  ok('history: the assistant’s delete is recorded with the assistant as author', hDelete.length === 1, JSON.stringify(hDelete.map((e) => e.summary)))
  if (personWon) oneWrite('history: the same-field race winner (person) is recorded', h, G, A_, 'deathPlace', 'Рязань')
  if (agentWon && !personWon) oneWrite('history: the same-field race winner (agent) is recorded', h, G, AG, 'deathPlace', 'Тула')
  if (jPersonWins) oneWrite('history: the J race winner (person) is recorded', h, J, A_, 'deathPlace', 'Ухта')
  if (jDraftWins) oneWrite('history: the J race winner (draft) is recorded', h, J, RJ, 'deathPlace', 'Сыктывкар')

  // ---- 5. A restart keeps every card, every history entry and every pending draft. ----
  g = await graph()
  const ids = [A, N.id, E, F, D, L, G, I, J, Bp]
  const cardsBefore = Object.fromEntries(ids.map((id) => [id, card(g, id)]))
  const historyBefore = await history()
  const pendingBefore = await proposals()
  await stop()
  await start()
  g = await graph()
  const firstDiff = ids.find((id) => JSON.stringify(cardsBefore[id]) !== JSON.stringify(card(g, id)))
  ok('after a restart every full card is deep-equal (all fields, facts, tags, updatedAt)',
    !firstDiff,
    firstDiff ? `${firstDiff}: before ${JSON.stringify(cardsBefore[firstDiff])} after ${JSON.stringify(card(g, firstDiff))}` : '')
  const historyAfter = await history()
  const byId = (a) => Object.fromEntries(a.map((e) => [e.id, e]))
  const histB = byId(historyBefore), histA = byId(historyAfter)
  const hIds = Object.keys(histB).sort(), hIdsAfter = Object.keys(histA).sort()
  const hDiff = hIds.find((id) => !histA[id] || JSON.stringify(histB[id]) !== JSON.stringify(histA[id]))
  ok('after a restart every history entry is still there, unchanged',
    JSON.stringify(hIds) === JSON.stringify(hIdsAfter) && !hDiff && hIds.length > 0,
    hDiff ? `${hDiff}: before ${JSON.stringify(histB[hDiff])} after ${JSON.stringify(histA[hDiff])}` : `${hIds.length} vs ${hIdsAfter.length}`)
  const pendingAfter = await proposals()
  ok('after a restart the pending drafts are still there, with their errors',
    JSON.stringify(pendingBefore) === JSON.stringify(pendingAfter) && pendingAfter.some?.((p) => p.id === draftF.data.proposalId && p.status === 'pending' && /birthPlace/.test(String(p.error))),
    `before ${JSON.stringify(pendingBefore)} after ${JSON.stringify(pendingAfter)}`)
  const afterRestart = await tool(direct, 'get_overview', {})
  ok('the outside agent’s token still works after the restart', !afterRestart.isError && afterRestart.data?.people?.total > 0, `${afterRestart.status} ${afterRestart.text}`)
} finally {
  await stop()
  await sleep(200)
  killAll()
  fs.rmSync(DATA, { recursive: true, force: true })
}
