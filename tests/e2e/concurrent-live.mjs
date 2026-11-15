// What other people see while writes land, and what survives a hard crash under parallel writers.
// Plain Node: the production bundle in dist/, its own server, all data in a throwaway folder.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const APP = path.join(ROOT, 'dist', 'app')
const BUNDLE = process.env.FG_BUNDLE ?? path.join(ROOT, 'dist', `folkbranch-${process.platform}-${process.arch}.tar.xz`)
const PORT = 3513
const B = `http://127.0.0.1:${PORT}`
const SECRET = 's'.repeat(64)
const DATA = fs.mkdtempSync(path.join(ROOT, 'dist', '.tmp-data-concurrent-live-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const ok = (name, condition, detail = '') => {
  if (!condition) failures++
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}

if (!fs.existsSync(path.join(APP, 'server.js'))) {
  fs.mkdirSync(APP, { recursive: true })
  const r = spawnSync('tar', ['-xJf', BUNDLE, '-C', APP, '--strip-components', '1'])
  if (r.status !== 0) throw new Error('tar failed: ' + r.stderr)
}

let server = null
const logs = []
const killNow = () => { if (server) { try { server.kill('SIGKILL') } catch {} } }
process.on('exit', killNow)
process.on('uncaughtException', (e) => { console.error(e); killNow(); process.exit(1) })

async function start(label) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: APP,
    env: {
      PATH: process.env.PATH, HOME: DATA,
      NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(PORT), DATA_DIR: DATA,
      BETTER_AUTH_URL: B, BETTER_AUTH_SECRET: SECRET, SETUP_TOKEN: 'cc',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log = { label, text: '' }
  logs.push(log)
  child.stdout.on('data', (d) => { log.text += d })
  child.stderr.on('data', (d) => { log.text += d })
  server = child
  await waitUp()
  return child
}
async function waitUp(ms = 90000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if ((await fetch(B + '/api/health')).ok) return } catch {}
    await sleep(100)
  }
  throw new Error('server did not come up')
}
async function stop(signal = 'SIGTERM') {
  if (!server) return
  const s = server
  const done = new Promise((r) => s.once('exit', r))
  s.kill(signal)
  await done
  server = null
}

async function api(cookie, method, p, body, signal) {
  const r = await fetch(`${B}/api/v1/${p}`, {
    method,
    signal,
    headers: { cookie, origin: B, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: r.status, ok: r.ok, json, text }
}

/** Opens the live line and keeps every parsed event. */
function listen(cookie) {
  const ac = new AbortController()
  const events = []
  const done = (async () => {
    try {
      const r = await fetch(B + '/api/events', { headers: { cookie, accept: 'text/event-stream' }, signal: ac.signal })
      if (!r.ok) return { status: r.status }
      const dec = new TextDecoder()
      let buf = ''
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true })
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const event = /^event: (.+)$/m.exec(raw)?.[1]
          const data = /^data: (.*)$/m.exec(raw)?.[1]
          if (event) events.push({ event, data, at: Date.now() })
        }
      }
      return { status: 200 }
    } catch (e) {
      return { status: 0, error: String(e) }
    }
  })()
  return { events, stop: () => ac.abort(), done }
}
async function waitEvent(listener, name, ms = 10000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (listener.events.some((e) => e.event === name)) return true
    await sleep(25)
  }
  return false
}
const changeCount = (listener) => listener.events.filter((e) => e.event === 'change').length
/** announceChange coalesces on a 400 ms timer, so a burst is over once no new change has arrived for longer than that. */
async function settledChangeCount(listener, quietMs = 600, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs
  let seen = changeCount(listener)
  let stableSince = Date.now()
  while (Date.now() < end) {
    await sleep(25)
    const now = changeCount(listener)
    if (now !== seen) { seen = now; stableSince = Date.now() }
    else if (Date.now() - stableSince >= quietMs) return now
  }
  return seen
}

const crashPersonDiffers = (p, want) => {
  const fact = p.facts?.[0]
  return p.surname !== want.surname || p.sex !== want.sex || p.birthDate !== want.birthDate || p.birthPlace !== want.birthPlace ||
    JSON.stringify(p.tags) !== JSON.stringify(want.tags) || p.facts?.length !== 1 ||
    fact?.kind !== 'Проверка' || fact?.date !== '1902' || fact?.place !== 'Крахбург' || fact?.note !== 'целая запись'
}

const PERSON = (givenName) => ({
  givenName, surname: 'Живой', sex: 'U', birthDate: '1901', birthPlace: 'Тестоград',
  tags: ['live', 'burst'],
})

try {
  await start('first start')
  const setup = await fetch(B + '/api/auth/family/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: B },
    body: JSON.stringify({ name: 'Анна', familyName: 'Проба', language: 'ru', demo: true, code: 'cc' }),
  })
  let cookie = setup.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  ok('owner is created', setup.ok && !!cookie, `${setup.status}`)

  const invite = await api(cookie, 'POST', 'invites', { name: 'Пётр', role: 'editor' })
  const token = invite.json?.token
  const accepted = await fetch(B + '/api/auth/family/accept', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ token }),
  })
  const otherCookie = accepted.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  ok('a second person signs in', accepted.ok && !!otherCookie, `${accepted.status}`)

  // ---------- 1. two live listeners while one session writes ----------
  const me = listen(cookie)
  const other = listen(otherCookie)
  const hello = (await waitEvent(me, 'hello')) && (await waitEvent(other, 'hello'))
  ok('both live listeners are open', hello, `me=${me.events.length} other=${other.events.length}`)

  const made = []
  let writeProblem = ''
  const meBefore = changeCount(me)
  let expectedMeChanges = 0
  for (const group of [1, 2]) {
    // Wait out burst 1's coalescing timer: a late event from it must not satisfy burst 2.
    const before = await settledChangeCount(other)
    const startAt = Date.now()
    for (let i = 0; i < 10; i++) {
      const person = PERSON(`Живой-${group}-${i}`)
      const r = await api(cookie, 'POST', 'persons', { person })
      if (!r.ok || !r.json?.id) writeProblem ||= `group ${group} write ${i}: ${r.status} ${r.text.slice(0, 120)}`
      else made.push({ id: r.json.id, person })
    }
    const lastWriteAt = Date.now()
    const duration = lastWriteAt - startAt
    // The app announces at most once per 400 ms of continuous writing, so a burst of `duration` needs at least this many.
    const minChanges = Math.max(1, Math.ceil(duration / 400))
    expectedMeChanges += minChanges
    const end = Date.now() + 1500 + minChanges * 600
    let count = changeCount(other)
    while (Date.now() < end && count - before < minChanges) {
      await sleep(25)
      count = changeCount(other)
    }
    ok(`listener receives change events for burst ${group}`, count - before >= minChanges, `change events ${count - before} (need >=${minChanges}) over ${duration}ms of writes`)
    const firstChange = other.events.filter((e) => e.event === 'change').slice(before)[0]
    ok(`burst ${group} event arrives soon after the writes`, !!firstChange && firstChange.at <= lastWriteAt + 800, firstChange ? `${firstChange.at - lastWriteAt}ms after the last write` : 'none')
  }
  ok('all 20 writes answered 2xx with an id', !writeProblem && made.length === 20, writeProblem || `${made.length}/20`)
  const meChanges = changeCount(me) - meBefore
  ok('the writing listener sees the changes too', meChanges >= expectedMeChanges, `change events ${meChanges} (need >=${expectedMeChanges})`)

  await sleep(700)
  const g1 = await api(cookie, 'GET', 'graph')
  const byId = new Map((g1.json?.persons ?? []).map((p) => [p.id, p]))
  const absent = made.filter((m) => !byId.has(m.id))
  const different = made.filter((m) => {
    const p = byId.get(m.id)
    return p && (p.givenName !== m.person.givenName || p.surname !== m.person.surname || p.sex !== m.person.sex || p.birthDate !== m.person.birthDate || p.birthPlace !== m.person.birthPlace || JSON.stringify(p.tags) !== JSON.stringify(m.person.tags))
  })
  ok('the graph afterwards has every write, whole', !absent.length && !different.length, `missing ${absent.length}, changed ${different.length}`)
  me.stop(); other.stop()
  await Promise.all([me.done, other.done])

  // ---------- 2. hard crashes under five parallel writers ----------
  const roundStats = []
  const ackedAll = []
  const inflightAtKill = []
  let crashProblem = ''
  for (let round = 1; round <= 3; round++) {
    const prefix = `Крах-${round}-`
    const ac = new AbortController()
    let writing = true
    const acked = []
    const attempts = new Map()
    const unexpected = []
    const writer = async (w) => {
      for (let n = 0; writing; n++) {
        const person = { givenName: `${prefix}${w}-${n}`, surname: 'Сбой', sex: 'U', birthDate: '1902', birthPlace: 'Крахбург', tags: ['crash', `r${round}`], facts: [{ kind: 'Проверка', date: '1902', place: 'Крахбург', note: 'целая запись', source: '' }] }
        attempts.set(person.givenName, person)
        try {
          const r = await api(cookie, 'POST', 'persons', { person }, ac.signal)
          if (r.ok && r.json?.id) acked.push({ id: r.json.id, person })
          else if (writing || r.ok) unexpected.push(`${person.givenName}: ${r.status} ${r.text.slice(0, 100)}`)
        } catch (e) {
          if (writing) unexpected.push(`${person.givenName}: ${String(e).slice(0, 100)}`)
        }
      }
    }
    const writers = Array.from({ length: 5 }, (_, w) => writer(w))
    await sleep(3000)
    // Keep writing right up to the kill, and count requests sent but not yet answered at that instant.
    const dying = server
    const unanswered = attempts.size - acked.length - unexpected.length
    inflightAtKill.push(unanswered)
    const exited = new Promise((r) => dying.once('exit', r))
    dying.kill('SIGKILL')
    writing = false
    ac.abort()
    await exited
    server = null
    await Promise.all(writers)
    ok(`round ${round}: writers were active and acknowledged writes`, acked.length > 0, `${acked.length} acknowledged, ${attempts.size} attempted`)
    ok(`round ${round}: no failed write before the kill`, !unexpected.length, unexpected.slice(0, 2).join('; '))
    ackedAll.push(...acked)
    roundStats.push({ round, acked: acked.length, attempted: attempts.size, unanswered })

    await start(`after crash ${round}`)
    const g = await api(cookie, 'GET', 'graph')
    if (!g.ok) { crashProblem ||= `graph ${g.status} after round ${round}`; continue }
    const now = new Map(g.json.persons.map((p) => [p.id, p]))
    const lost = acked.filter((a) => !now.has(a.id))
    ok(`round ${round}: every acknowledged write is in the graph`, !lost.length, `lost ${lost.length}/${acked.length}`)

    const sent = new Map([...attempts].filter(([name]) => name.startsWith(prefix)))
    const landed = g.json.persons.filter((p) => String(p.givenName).startsWith(prefix))
    const unknown = landed.filter((p) => !sent.has(p.givenName))
    const broken = landed.filter((p) => {
      const want = sent.get(p.givenName)
      return want ? crashPersonDiffers(p, want) : false
    })
    ok(`round ${round}: no person is half-written`, !unknown.length && !broken.length, `unknown ${unknown.length}, incomplete ${broken.map((p) => p.givenName).slice(0, 3).join(',') || '0'}`)
  }
  ok('three crash rounds ran under load', roundStats.length === 3 && !crashProblem, JSON.stringify(roundStats))
  ok('a kill landed while a write was still unanswered', inflightAtKill.some((n) => n > 0), `unanswered at kill per round: ${inflightAtKill.join(', ')}`)

  // ---------- 3. consistency and a clean log after the crashes ----------
  const g = await api(cookie, 'GET', 'graph')
  const persons = g.json?.persons ?? []
  const ids = new Set(persons.map((p) => p.id))
  const finalById = new Map(persons.map((p) => [p.id, p]))
  const gone = ackedAll.filter((a) => !finalById.has(a.id))
  const changed = ackedAll.filter((a) => { const p = finalById.get(a.id); return p ? crashPersonDiffers(p, a.person) : false })
  ok('every acknowledged write from all three rounds is in the final graph, whole', !gone.length && !changed.length, `lost ${gone.length}/${ackedAll.length}, incomplete ${changed.length}`)
  const danglingParents = (g.json?.parentChild ?? []).filter((l) => !ids.has(l.parentId) || !ids.has(l.childId))
  const danglingUnions = (g.json?.unions ?? []).filter((u) => !ids.has(u.aId) || !ids.has(u.bId))
  ok('no link points at a missing person', !danglingParents.length && !danglingUnions.length, `parent ${danglingParents.length}, union ${danglingUnions.length}`)
  const all = logs.map((l) => l.text).join('\n')
  const corruption = /database disk image is malformed|SQLITE_CORRUPT|SQLITE_NOTADB|SQLITE_IOERR|database is locked|A migration failed|migration[s]? failed/i
  const hit = corruption.exec(all)
  ok('server log has no corruption or migration error', !hit, hit ? hit[0] : `${logs.length} server runs`)
} finally {
  if (server) {
    const s = server
    const done = new Promise((r) => s.once('exit', r))
    s.kill('SIGTERM')
    await Promise.race([done, sleep(5000)])
    killNow()
    await sleep(200)
  }
  try { fs.rmSync(DATA, { recursive: true, force: true }) } catch {}
}

process.exitCode = failures ? 1 : 0
