// What people entered must outlive an update, a restart and a crash. The released version fills an archive,
// then this version opens the same data folder: everything is still there, the same, and stays after restarts.
// FG_OLD_BUNDLE: the released archive to start from (a .tar.xz). Without it the latest release for this system is
//   downloaded with `gh`. FG_BUNDLE: this version's archive, from `pnpm build && node scripts/make-bundle.mjs`.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sleep, waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x && !c ? '  ' + x : ''}`); if (!c) process.exitCode = 1 }
const repo = fileURLToPath(new URL('../..', import.meta.url))
const target = `${process.platform}-${process.arch}`
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fg-survive-')))
const PORT = 3493, B = `http://127.0.0.1:${PORT}`

let oldBundle = process.env.FG_OLD_BUNDLE
if (!oldBundle) {
  const r = spawnSync('gh', ['release', 'download', '--repo', 'danarkhipov/folkbranch', '--pattern', `folkbranch-${target}.tar.xz`, '--dir', work], { encoding: 'utf8' })
  if (r.status !== 0) { console.error(`Could not download the latest release for ${target}: ${r.stderr}`); process.exit(1) }
  oldBundle = path.join(work, `folkbranch-${target}.tar.xz`)
}
const newBundle = process.env.FG_BUNDLE ?? path.join(repo, `dist/folkbranch-${target}.tar.xz`)
for (const f of [oldBundle, newBundle]) if (!fs.existsSync(f)) { console.error(`No archive at ${f}`); process.exit(1) }

const unpack = (file, name) => {
  const dir = path.join(work, name)
  fs.mkdirSync(dir)
  const r = spawnSync('tar', ['-xJf', file, '-C', dir, '--strip-components', '1'])
  if (r.status !== 0) throw new Error(`tar failed for ${file}`)
  return dir
}
const OLD = unpack(oldBundle, 'old'), NEW = unpack(newBundle, 'new')
const DATA = path.join(work, 'data')
fs.mkdirSync(DATA)

// Each version runs as the install script runs it: node server.js in its own folder, with the data folder outside.
let server = null
process.on('exit', () => server?.kill('SIGKILL'))
process.on('uncaughtException', (e) => { console.error(e); server?.kill('SIGKILL'); process.exit(1) })
const start = async (dir) => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: { PATH: process.env.PATH, HOME: work, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(PORT), DATA_DIR: DATA, BETTER_AUTH_URL: B, BETTER_AUTH_SECRET: 's'.repeat(64), SETUP_TOKEN: 'survive' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.log = ''
  server.stdout.on('data', (d) => { server.log += d })
  server.stderr.on('data', (d) => { server.log += d })
  await waitUp(B, 90000)
}
const stop = async (signal = 'SIGTERM') => {
  if (!server) return
  const done = new Promise((r) => server.once('exit', r))
  server.kill(signal)
  await done
  server = null
}

let cookie = ''
const api = async (method, p, body) => {
  const r = await fetch(`${B}/api/v1/${p}`, { method, headers: { cookie, origin: B, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}
const sha = (b) => createHash('sha256').update(b).digest('hex')

/** Everything a person could have entered, read back through the app, in a stable order. */
async function snapshot() {
  const g = await api('GET', 'graph')
  const byId = (a) => [...a].sort((x, y) => String(x.id).localeCompare(String(y.id)))
  const pages = {}, photos = {}
  for (const p of g.persons) {
    const list = await api('GET', `persons/${p.id}/pages`)
    if (list.length) pages[p.id] = await Promise.all(list.map((x) => api('GET', `pages/${x.id}`)))
  }
  for (const m of await api('GET', 'media')) {
    const file = await fetch(`${B}/api/v1/media/${m.id}/file?size=orig`, { headers: { cookie } })
    photos[m.id] = { ...m, bytes: sha(Buffer.from(await file.arrayBuffer())) }
  }
  const settings = await api('GET', 'settings')
  return { persons: byId(g.persons), unions: byId(g.unions), parentChild: byId(g.parentChild), pages, photos, familyName: settings.familyName, language: settings.language }
}

/** The newer version may add fields; it may not lose or change any that were there. */
function missing(before, after, at = '') {
  if (before === null || typeof before !== 'object') return before === after ? [] : [`${at}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`]
  if (after === null || typeof after !== 'object') return [`${at}: gone`]
  if (Array.isArray(before)) {
    if (!Array.isArray(after) || after.length < before.length) return [`${at}: ${before.length} → ${Array.isArray(after) ? after.length : 'gone'}`]
    return before.flatMap((v, i) => missing(v, after[i], `${at}[${i}]`))
  }
  // Read-time values the server computes, not data anyone entered.
  const skip = new Set(['updatedAt', 'url', 'thumb', 'expiresAt'])
  return Object.keys(before).filter((k) => !skip.has(k)).flatMap((k) => missing(before[k], after[k], `${at}.${k}`))
}

// ---------- the released version fills the archive ----------
await start(OLD)
const setup = await fetch(`${B}/api/auth/family/setup`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ name: 'Анна', familyName: 'Проверка обновления', language: 'ru', demo: true, code: 'survive' }) })
ok('the released version sets up an archive', setup.ok, String(setup.status))
cookie = setup.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
const g0 = await api('GET', 'graph')
const someone = g0.persons[0]
await api('PATCH', `persons/${someone.id}`, { birthPlace: 'Тверь', facts: [{ kind: 'Профессия', date: '1930', place: 'Тверь', note: 'учитель', source: '' }] })
const added = await api('POST', 'persons', { person: { givenName: 'Ёжик', surname: 'Длинноимённый-Проверочный', sex: 'M', birthDate: '~1876', birthPlace: 'деревня «Кривое Колено»' } })
const addedId = added.id ?? added.person?.id ?? added.result?.id
await api('POST', 'pages', { personId: someone.id, title: 'Воспоминания', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Текст, который нельзя потерять. 😊' }] }] })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8Dwn4GBgYGJgYEBAB0EAgFVZ3G9AAAAAElFTkSuQmCC', 'base64')
await api('POST', 'media', { base64: png.toString('base64'), filename: 'семья.png', personId: someone.id })
const before = await snapshot()
ok('the archive holds what was entered', before.persons.length > 3 && Object.keys(before.photos).length > 0 && Object.keys(before.pages).length > 0, JSON.stringify({ persons: before.persons.length, photos: Object.keys(before.photos).length }))
await stop()

// ---------- this version on the same data ----------
await start(NEW)
const upgraded = await fetch(`${B}/api/v1/graph`, { headers: { cookie } })
ok('still signed in after the update', upgraded.ok, String(upgraded.status))
const after = await snapshot()
const lost = missing(before, after)
ok('nothing entered is lost or changed by the update', !lost.length, lost.slice(0, 5).join('; '))
ok('the added person is still there', after.persons.some((p) => p.id === addedId))
const copies = fs.existsSync(path.join(DATA, 'backups')) ? fs.readdirSync(path.join(DATA, 'backups')).filter((n) => n.startsWith('before-migration-')) : []
const migrated = /Applied \d+ migration/.test(server.log)
ok('a copy of the database is made before any migration', !migrated || copies.length > 0, server.log.slice(-300))

// ---------- a restart ----------
await stop()
await start(NEW)
ok('nothing is lost after a restart', !missing(before, await snapshot()).length)

// ---------- a crash right after a change ----------
await api('PATCH', `persons/${someone.id}`, { deathPlace: 'Москва' })
await stop('SIGKILL')
await start(NEW)
const crashed = await snapshot()
ok('a change saved just before a crash is still there', crashed.persons.find((p) => p.id === someone.id)?.deathPlace === 'Москва')
ok('and nothing else is lost after the crash', !missing(before, crashed).filter((m) => !m.includes('deathPlace')).length)

await stop()
await sleep(200)
fs.rmSync(work, { recursive: true, force: true })
