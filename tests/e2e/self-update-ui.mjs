// The "Update now" button as the owner sees it: a dot on Settings, the notice, the confirmation, the wait, and the
// page coming back by itself on the new version with everything in place.
// FG_BUNDLE: this version's archive. FG_NEXT_BUNDLE: an archive built with "version": "9.9.9" in package.json, the
// version the stand-in release source announces. FG_SHOTS: a folder for screenshots (optional).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { waitUp } from './lib.mjs'

const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x && !c ? '  ' + x : ''}`); if (!c) process.exitCode = 1 }
const repo = fileURLToPath(new URL('../..', import.meta.url))
const first = process.env.FG_BUNDLE ?? path.join(repo, `dist/folkbranch-${process.platform}-${process.arch}.tar.xz`)
const next = process.env.FG_NEXT_BUNDLE
if (!next) { console.error('Needs FG_NEXT_BUNDLE, an archive built as version 9.9.9'); process.exit(1) }
const shots = process.env.FG_SHOTS
const sum = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fg-selfupdate-ui-')))
const dir = path.join(work, 'folkbranch')
fs.mkdirSync(path.join(work, 'next'))
const nextCopy = path.join(work, 'next', path.basename(next))
fs.copyFileSync(next, nextCopy)
fs.writeFileSync(`${nextCopy}.sha256`, `${sum(nextCopy)}  ${path.basename(nextCopy)}\n`)
const PORT = 3494, B = `http://localhost:${PORT}`
const releases = http.createServer((_, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ tag_name: 'v9.9.9', html_url: 'https://example.org/v9.9.9' })) }).listen(0)
const env = { HOME: work, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: work }
let browser
try {
  const inst = spawnSync('sh', [`${repo}install.sh`, '--local', '--dir', dir, '--port', String(PORT)], { cwd: work, env: { ...env, FOLKBRANCH_BUNDLE: pathToFileURL(first).href }, encoding: 'utf8', timeout: 300000 })
  ok('installed', inst.status === 0, String(inst.stderr).slice(-300))
  fs.appendFileSync(path.join(dir, '.env'), `\nFOLKBRANCH_RELEASES_API=http://127.0.0.1:${releases.address().port}/latest\nFOLKBRANCH_INSTALLER=${pathToFileURL(path.join(repo, 'install.sh')).href}\nFOLKBRANCH_BUNDLE=${pathToFileURL(nextCopy).href}\n`)
  spawnSync('sh', ['-c', './folkbranch restart'], { cwd: dir, env, encoding: 'utf8' })
  await waitUp(B, 90000)
  const code = fs.readFileSync(path.join(dir, '.env'), 'utf8').match(/^SETUP_TOKEN=(.*)$/m)[1]
  const setup = await fetch(B + '/api/auth/family/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ name: 'Анна', familyName: 'Соколовы', language: 'ru', demo: true, code }) })
  const cookie = setup.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const people = (await (await fetch(B + '/api/v1/graph', { headers: { cookie } })).json()).persons.length

  browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ctx.setDefaultTimeout(60000)
  await ctx.addCookies(cookie.split('; ').map((c) => ({ name: c.split('=')[0], value: c.slice(c.indexOf('=') + 1), domain: 'localhost', path: '/' })))
  await ctx.addInitScript(() => { try { localStorage.setItem('folkbranch-tour', '1') } catch {} })
  const p = await ctx.newPage()
  await p.goto(B)
  await p.locator('.pcard').first().waitFor()
  const settings = p.getByRole('button', { name: /Настройки\. Вышла новая версия/ })
  ok('a dot on Settings says a new version is out', await settings.count() > 0)
  await settings.first().click()
  await p.getByText('Вышла версия 9.9.9').waitFor()
  if (shots) await p.screenshot({ path: path.join(shots, 'update-1-notice.png') })
  await p.getByRole('button', { name: 'Обновить сейчас' }).click()
  await p.getByRole('alertdialog').or(p.getByRole('dialog').last()).getByRole('button', { name: 'Обновить' }).click()
  await p.getByText('Обновляется. Копия базы сохранена').waitFor()
  if (shots) await p.screenshot({ path: path.join(shots, 'update-2-running.png') })
  // The page reloads by itself once the new version answers.
  await p.waitForEvent('load', { timeout: 240000 })
  await p.locator('.pcard').first().waitFor({ timeout: 60000 })
  const after = await (await fetch(B + '/api/v1/update', { headers: { cookie } })).json()
  ok('the page came back by itself on the new version', after.current === '9.9.9', JSON.stringify(after))
  ok('no notice is left, since nothing is newer now', await p.getByRole('button', { name: /Вышла новая версия/ }).count() === 0)
  const now = (await (await fetch(B + '/api/v1/graph', { headers: { cookie } })).json()).persons.length
  ok('everyone is still in the archive', now === people, `${now} vs ${people}`)
  if (shots) await p.screenshot({ path: path.join(shots, 'update-3-done.png') })
} finally {
  await browser?.close()
  spawnSync('sh', ['-c', './folkbranch stop'], { cwd: dir, env, encoding: 'utf8' })
  releases.close()
  fs.rmSync(work, { recursive: true, force: true })
}
