import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x && !c ? '  ' + x : ''}`); if (!c) process.exitCode = 1 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const repo = fileURLToPath(new URL('../..', import.meta.url))
const PORT = 3511, B = `http://127.0.0.1:${PORT}`
const APP = path.join(repo, 'dist/app')
const BUNDLE = process.env.FG_BUNDLE ?? path.join(repo, 'dist', `folkbranch-${process.platform}-${process.arch}.tar.xz`)

if (!fs.existsSync(path.join(APP, 'server.js'))) {
  fs.mkdirSync(APP, { recursive: true })
  const r = spawnSync('tar', ['-xJf', BUNDLE, '-C', APP, '--strip-components', '1'], { encoding: 'utf8' })
  if (r.status !== 0) { console.error('could not unpack ' + BUNDLE + ': ' + r.stderr); process.exit(1) }
}
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-concurrent-people-'))

let server = null
const waitUp = async (ms = 90000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fetch(B + '/api/health').then((r) => r.ok).catch(() => false)) return
    await sleep(150)
  }
  throw new Error('server did not come up: ' + (server?.log ?? '').slice(-1500))
}
const start = async () => {
  const s = spawn(process.execPath, ['server.js'], {
    cwd: APP,
    env: { PATH: process.env.PATH, HOME: DATA, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(PORT), DATA_DIR: DATA, BETTER_AUTH_URL: B, BETTER_AUTH_SECRET: 's'.repeat(64), SETUP_TOKEN: 'cc' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  s.log = ''
  s.stdout.on('data', (d) => { s.log += d })
  s.stderr.on('data', (d) => { s.log += d })
  server = s
  await Promise.race([
    waitUp(),
    new Promise((_, reject) => s.once('exit', (code) => reject(new Error(`server exited ${code}: ${s.log.slice(-1500)}`)))),
  ])
}
const stop = async () => {
  const s = server
  if (!s) return
  server = null
  await new Promise((resolve) => {
    const t = setTimeout(() => s.kill('SIGKILL'), 10000)
    s.once('exit', () => { clearTimeout(t); resolve() })
    s.kill('SIGTERM')
  })
}
process.on('exit', () => server?.kill('SIGKILL'))

const read = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
const call = async (method, p, session, body) => {
  const headers = { origin: B }
  if (session?.cookie) headers.cookie = session.cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const r = await fetch(B + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: await read(r) }
}
const cookieOf = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

const tally = (list) => list.reduce((m, r) => { const k = r.error ? 'network' : String(r.status); m[k] = (m[k] ?? 0) + 1; return m }, {})
const sortDeep = (v) => {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
  return v
}
const byId = (a, b) => String(a.id).localeCompare(String(b.id))
const normalGraph = (g) => sortDeep({ persons: [...g.persons].sort(byId), parentChild: [...g.parentChild].sort(byId), unions: [...g.unions].sort(byId) })
const firstDiff = (a, b, at = '') => {
  if (a === b) return null
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return `${at}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`
  if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array/non-array`
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${at}: length ${a.length} → ${b.length}`
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${at}[${i}]`); if (d) return d }
    return null
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], `${at}.${k}`); if (d) return d }
  return null
}

try {
  await start()
  const setup = await fetch(B + '/api/auth/family/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ name: 'Анна', familyName: 'Проба', language: 'ru', demo: true, code: 'cc' }) })
  const setupText = await setup.text()
  ok('owner Анна sets up the archive', setup.ok, `${setup.status} ${setupText.slice(0, 200)}`)
  const owner = { name: 'Анна', cookie: cookieOf(setup) }

  const join = async (name) => {
    const inv = await call('POST', '/api/v1/invites', owner, { name, role: 'editor' })
    if (inv.status !== 200) throw new Error(`invite ${name}: ${inv.status} ${JSON.stringify(inv.body)}`)
    const acc = await fetch(B + '/api/auth/family/accept', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ token: inv.body.token }) })
    const text = await acc.text()
    if (!acc.ok) throw new Error(`accept ${name}: ${acc.status} ${text}`)
    return { name, cookie: cookieOf(acc) }
  }
  const petr = await join('Пётр')
  const maria = await join('Мария')
  const sessions = [owner, petr, maria]
  const me = await Promise.all(sessions.map((s) => call('GET', '/api/v1/me', s)))
  ok('three sessions are signed in', me.every((r, i) => r.status === 200 && r.body?.name === sessions[i].name), JSON.stringify(me.map((r) => [r.status, r.body?.name])))
  const graph = async () => (await call('GET', '/api/v1/graph', owner)).body

  const mk = async (givenName) => {
    const r = await call('POST', '/api/v1/persons', owner, { person: { givenName, surname: 'Параллель', birthDate: '1900' } })
    if (r.status !== 200 || !r.body?.id) throw new Error(`create ${givenName}: ${r.status} ${JSON.stringify(r.body)}`)
    return r.body
  }
  const fieldTargets = [await mk('Поле-0'), await mk('Поле-1'), await mk('Поле-2')]
  const factTarget = await mk('Факты-цель')
  const tagTarget = await mk('Метки-цель')
  const conflictTarget = await mk('Спор-цель')
  const victims = []
  for (let i = 0; i < 8; i++) victims.push(await mk(`Жертва-${i}`))
  const pool = []
  for (let i = 0; i < 40; i++) pool.push(await mk(`Связь-${i}`))

  const linkers = []
  for (let i = 0; i < victims.length; i++) linkers.push(await mk(`Связной-${i}`))
  for (let i = 0; i < victims.length; i++) {
    const v = victims[i]
    const links = [
      ['father', v.id, pool[2 * i + 1].id],
      ['son', v.id, pool[2 * i + 2].id],
      ['spouse', v.id, pool[2 * i + 18].id],
    ]
    for (const [type, to, other] of links) {
      const r = await call('POST', '/api/v1/relations', owner, { type, to, other })
      if (r.status !== 200) throw new Error(`link ${i} ${type}: ${r.status} ${JSON.stringify(r.body)}`)
    }
  }

  const g0 = await graph()
  const at = (id) => g0.persons.find((p) => p.id === id)
  const baseFacts = at(factTarget.id).facts ?? []
  const baseTags = at(tagTarget.id).tags ?? []

  const writes = []
  const add = (w) => writes.push(w)
  for (let i = 0; i < 30; i++) {
    const name = `Новый-${i}`
    add({ kind: 'person', name, session: sessions[i % 3], req: (s) => call('POST', '/api/v1/persons', s, { person: { givenName: name, surname: 'Параллель', birthDate: '1900' } }) })
  }
  const FIELDS = ['birthPlace', 'deathPlace', 'patronymic', 'maidenName', 'otherNames', 'givenName', 'surname', 'birthDate', 'deathDate', 'sex']
  const valueOf = (field, ti, fi) => field === 'birthDate' ? '1901' : field === 'deathDate' ? '1971' : field === 'sex' ? 'F' : `${field}-${ti}-${fi}`
  let wi = 30
  for (let ti = 0; ti < fieldTargets.length; ti++) {
    for (let fi = 0; fi < FIELDS.length; fi++) {
      const field = FIELDS[fi], value = valueOf(field, ti, fi), id = fieldTargets[ti].id
      const seen = at(id)[field] ?? ''
      add({ kind: 'field', id, field, value, seen, session: sessions[wi++ % 3], req: (s) => call('PATCH', `/api/v1/persons/${id}`, s, { [field]: value, seen: { [field]: seen } }) })
    }
  }
  for (let i = 0; i < 30; i++) {
    const note = `метка-${i}`
    const fact = { id: `fact-${i}`, kind: 'Проверка', date: '', place: '', note, source: '' }
    add({ kind: 'fact', id: factTarget.id, note, factId: fact.id, factKind: fact.kind, session: sessions[wi++ % 3], req: (s) => call('PATCH', `/api/v1/persons/${factTarget.id}`, s, { facts: [...baseFacts, fact], seen: { facts: baseFacts } }) })
  }
  for (let i = 0; i < 20; i++) {
    const tag = `метка-${i}`
    add({ kind: 'tag', id: tagTarget.id, tag, session: sessions[wi++ % 3], req: (s) => call('PATCH', `/api/v1/persons/${tagTarget.id}`, s, { tags: [...baseTags, tag], seen: { tags: baseTags } }) })
  }
  for (let i = 0; i < 20; i++) {
    const parent = pool[i * 2], child = pool[i * 2 + 1]
    add({ kind: 'parent', parentId: parent.id, childId: child.id, session: sessions[wi++ % 3], req: (s) => call('POST', '/api/v1/relations', s, { type: 'father', to: child.id, other: parent.id }) })
  }
  for (let i = 0; i < 20; i++) {
    const a = i < 10 ? pool[(i * 4)] : pool[(i - 10) * 4 + 1]
    const b = i < 10 ? pool[(i * 4) + 2] : pool[(i - 10) * 4 + 3]
    add({ kind: 'union', aId: a.id, bId: b.id, session: sessions[wi++ % 3], req: (s) => call('POST', '/api/v1/relations', s, { type: 'spouse', to: a.id, other: b.id }) })
  }
  const stalePlan = [
    ['birthPlace', 'устаревшее-место-0', 'заведомо-неверное-0'],
    ['deathPlace', 'устаревшее-место-1', 'заведомо-неверное-1'],
    ['patronymic', 'устаревшее-отчество', 'заведомо-неверное-2'],
  ]
  for (const [field, value, seen] of stalePlan) {
    add({ kind: 'stale', id: conflictTarget.id, field, value, seen, session: sessions[wi++ % 3], expect: 409, req: (s) => call('PATCH', `/api/v1/persons/${conflictTarget.id}`, s, { [field]: value, seen: { [field]: seen } }) })
  }
  ok('scenario contains 150 writes plus 3 deliberately stale ones', writes.length === 153, String(writes.length))

  const results = await Promise.all(writes.map(async (w) => {
    try { const r = await w.req(w.session); return { ...w, status: r.status, res: r.body } }
    catch (e) { return { ...w, status: 0, error: String(e) } }
  }))
  const t1 = tally(results)
  const g1 = await graph()
  const personById = new Map(g1.persons.map((p) => [p.id, p]))
  const g0Card = at(conflictTarget.id)
  const bad2xx = [], bad409 = []
  for (const r of results) {
    const ok2 = r.status >= 200 && r.status < 300
    const p = r.id ? personById.get(r.id) : null
    if (ok2) {
      if (r.kind === 'person') {
        const x = g1.persons.find((y) => y.id === r.res?.id)
        if (!x || x.givenName !== r.name || x.surname !== 'Параллель' || x.birthDate !== '1900') bad2xx.push(`${r.kind}:${r.name}:${JSON.stringify(x && { givenName: x.givenName, surname: x.surname, birthDate: x.birthDate })}`)
      }
      if (r.kind === 'field' && p?.[r.field] !== r.value) bad2xx.push(`${r.kind}:${r.id}:${r.field}=${p?.[r.field]}`)
      if (r.kind === 'fact' && !(p?.facts ?? []).some((f) => f.note === r.note && f.id === r.factId && f.kind === r.factKind)) bad2xx.push(`${r.kind}:${r.note}`)
      if (r.kind === 'tag' && !(p?.tags ?? []).includes(r.tag)) bad2xx.push(`${r.kind}:${r.tag}`)
      if (r.kind === 'parent' && !g1.parentChild.some((l) => l.parentId === r.parentId && l.childId === r.childId)) bad2xx.push(`${r.kind}:${r.childId}`)
      if (r.kind === 'union' && !g1.unions.some((u) => (u.aId === r.aId && u.bId === r.bId) || (u.aId === r.bId && u.bId === r.aId))) bad2xx.push(`${r.kind}:${r.aId}`)
    } else if (r.status === 409) {
      if (r.kind === 'person' && g1.persons.some((x) => x.givenName === r.name)) bad409.push(`${r.kind}:${r.name}`)
      if (r.kind === 'field' && p?.[r.field] !== r.seen) bad409.push(`${r.kind}:${r.id}:${r.field}=${p?.[r.field]}`)
      if (r.kind === 'stale' && p?.[r.field] !== g0Card[r.field]) bad409.push(`${r.kind}:${r.id}:${r.field}=${p?.[r.field]}`)
      if (r.kind === 'fact' && (p?.facts ?? []).some((f) => f.note === r.note || f.id === r.factId)) bad409.push(`${r.kind}:${r.note}`)
      if (r.kind === 'tag' && (p?.tags ?? []).includes(r.tag)) bad409.push(`${r.kind}:${r.tag}`)
      if (r.kind === 'parent' && g1.parentChild.some((l) => l.parentId === r.parentId && l.childId === r.childId)) bad409.push(`${r.kind}:${r.childId}`)
      if (r.kind === 'union' && g1.unions.some((u) => (u.aId === r.aId && u.bId === r.bId) || (u.aId === r.bId && u.bId === r.aId))) bad409.push(`${r.kind}:${r.aId}`)
    }
  }
  const independent = results.filter((r) => r.expect !== 409)
  const stale = results.filter((r) => r.expect === 409)
  const cardDiff = firstDiff(g0Card, personById.get(conflictTarget.id))
  ok('no burst write hit a server or network error', results.every((r) => r.status === 200 || r.status === 409), JSON.stringify(t1))
  ok('all 150 independent writes were applied', independent.length === 150 && independent.every((r) => r.status === 200), JSON.stringify(t1))
  ok('all 3 deliberately stale writes were refused with 409', stale.length === 3 && stale.every((r) => r.status === 409), JSON.stringify(stale.map((r) => [r.field, r.status])))
  ok('every write answered 2xx is in the final graph exactly', bad2xx.length === 0, bad2xx.slice(0, 8).join('; '))
  ok('every write answered 409 changed nothing', bad409.length === 0, bad409.slice(0, 8).join('; '))
  ok('each 409 left the conflicted card exactly as before', cardDiff === null, cardDiff ?? '')
  ok('the burst added exactly 30 people, 20 parent links and 20 unions', g1.persons.length === g0.persons.length + 30 && g1.parentChild.length === g0.parentChild.length + 20 && g1.unions.length === g0.unions.length + 20, JSON.stringify({ persons: `${g1.persons.length}/${g0.persons.length + 30}`, parentChild: `${g1.parentChild.length}/${g0.parentChild.length + 20}`, unions: `${g1.unions.length}/${g0.unions.length + 20}` }))
  const factsNow = personById.get(factTarget.id).facts, tagsNow = personById.get(tagTarget.id).tags
  const baseKept = baseFacts.every((b) => factsNow.some((f) => JSON.stringify(f) === JSON.stringify(b))) && baseTags.every((t) => tagsNow.includes(t))
  ok('the base facts and tags are still there', baseKept, JSON.stringify({ facts: factsNow.length, tags: tagsNow.length }))
  ok('the fact and tag lists hold exactly the base plus the 50 additions', factsNow.length === baseFacts.length + 30 && tagsNow.length === baseTags.length + 20, JSON.stringify({ facts: `${factsNow.length}/${baseFacts.length + 30}`, tags: `${tagsNow.length}/${baseTags.length + 20}` }))

  const c0 = at(conflictTarget.id)
  const seenBp = c0.birthPlace ?? ''
  const [r1, r2] = await Promise.all([
    call('PATCH', `/api/v1/persons/${conflictTarget.id}`, petr, { birthPlace: 'Рига', seen: { birthPlace: seenBp } }),
    call('PATCH', `/api/v1/persons/${conflictTarget.id}`, maria, { birthPlace: 'Пермь', seen: { birthPlace: seenBp } }),
  ])
  const statuses = [r1.status, r2.status].sort((a, b) => a - b).join()
  ok('one field, two editors, same start: exactly one wins and one is refused', statuses === '200,409', statuses)
  const winner = r1.status === 200 ? { name: 'Пётр', value: 'Рига' } : { name: 'Мария', value: 'Пермь' }
  const loserValue = winner.value === 'Рига' ? 'Пермь' : 'Рига'
  const g2 = await graph()
  ok('the winning value stands on the card', g2.persons.find((p) => p.id === conflictTarget.id)?.birthPlace === winner.value, g2.persons.find((p) => p.id === conflictTarget.id)?.birthPlace)
  const hist = (await call('GET', `/api/v1/persons/${conflictTarget.id}/history?limit=100`, owner)).body
  const winnerEntry = Array.isArray(hist) && hist.find((e) => e.actorName === winner.name && (e.details ?? []).some((d) => d.label === 'Место рождения' && d.after === winner.value))
  ok('history names who changed the contested field, and to what', !!winnerEntry, JSON.stringify(Array.isArray(hist) ? hist.slice(0, 4) : hist).slice(0, 400))
  ok('history names the person the change was about', !!winnerEntry && Array.isArray(winnerEntry.personIds) && winnerEntry.personIds.includes(conflictTarget.id), JSON.stringify(winnerEntry?.personIds))
  ok('the refused edit left no history entry of its own', !Array.isArray(hist) || !hist.some((e) => e.actorName !== winner.name && (e.details ?? []).some((d) => d.label === 'Место рождения' && d.after === loserValue)))

  const unionOf = (g, a, b) => g.unions.some((u) => (u.aId === a && u.bId === b) || (u.aId === b && u.bId === a))
  const raceRounds = []
  for (let i = 0; i < victims.length; i++) {
    const v = victims[i]
    const [ed, del, ln] = await Promise.all([
      call('PATCH', `/api/v1/persons/${v.id}`, i % 2 ? petr : maria, { birthPlace: `Жертва-${i}` }),
      call('DELETE', `/api/v1/persons/${v.id}`, owner),
      call('POST', '/api/v1/relations', i % 2 ? maria : petr, { type: 'spouse', to: v.id, other: linkers[i].id }),
    ])
    raceRounds.push({ i, id: v.id, linkerId: linkers[i].id, edit: ed.status, del: del.status, add: ln.status })
  }
  const g3 = await graph()
  const byId3 = new Map(g3.persons.map((p) => [p.id, p]))
  const raceBad = []
  for (const r of raceRounds) {
    const p = byId3.get(r.id)
    if (r.edit !== 200 && r.edit !== 404) raceBad.push(`${r.i}: edit answered ${r.edit}`)
    if (r.del !== 200 && r.del !== 404) raceBad.push(`${r.i}: delete answered ${r.del}`)
    if (r.add !== 200 && r.add !== 404) raceBad.push(`${r.i}: added link answered ${r.add}`)
    if (p) {
      if (r.edit !== 200) raceBad.push(`${r.i}: edit ${r.edit} but card remains`)
      else if (p.birthPlace !== `Жертва-${r.i}`) raceBad.push(`${r.i}: edit 200 lost, card says ${p.birthPlace}`)
      if (r.del !== 404) raceBad.push(`${r.i}: delete ${r.del} but card remains`)
      if (r.add === 200 && !unionOf(g3, r.id, r.linkerId)) raceBad.push(`${r.i}: add 200 but no link on the card`)
    } else if (unionOf(g3, r.id, r.linkerId)) raceBad.push(`${r.i}: deleted card still has its new link`)
  }
  ok('delete against edit and link: every answer is consistent with the final archive', raceBad.length === 0, raceBad.join('; '))

  const ids = new Set(g3.persons.map((p) => p.id))
  const dangling = [
    ...g3.parentChild.flatMap((l) => [[l.id, l.parentId], [l.id, l.childId]]),
    ...g3.unions.flatMap((u) => [[u.id, u.aId], [u.id, u.bId]]),
  ].filter(([, id]) => !ids.has(id))
  ok('no link points at a missing person', dangling.length === 0, JSON.stringify(dangling.slice(0, 6)))

  const deletedIds = new Set(raceRounds.filter((r) => !byId3.get(r.id)).map((r) => r.id))
  const g0Links = [
    ...g0.parentChild.map((l) => ({ table: 'parentChild', id: l.id, ends: [l.parentId, l.childId] })),
    ...g0.unions.map((u) => ({ table: 'unions', id: u.id, ends: [u.aId, u.bId] })),
  ]
  const g3Ids = { parentChild: new Set(g3.parentChild.map((l) => l.id)), unions: new Set(g3.unions.map((u) => u.id)) }
  const lostLinks = g0Links.filter((l) => l.ends.every((id) => !deletedIds.has(id)) && !g3Ids[l.table].has(l.id))
  ok('no unrelated link was lost in the delete-versus-edit race', lostLinks.length === 0, JSON.stringify(lostLinks.slice(0, 6)))

  const before = await graph()
  await stop()
  await start()
  const afterRestart = await graph()
  ok('the archive answers after a restart', Array.isArray(afterRestart?.persons) && afterRestart.persons.length === before.persons.length, `${before.persons.length} → ${afterRestart?.persons?.length}`)
  const diff = firstDiff(normalGraph(before), normalGraph(afterRestart))
  ok('after a restart the graph is identical, field by field', diff === null, diff ?? '')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  await stop()
  console.log('data folder: ' + DATA)
}
