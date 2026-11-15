// Long relation labels ("муж двоюродной прабабушки") on neighbouring cards never overlap, at any zoom,
// and a label too long for two lines shows whole under the cursor.
import { chromium } from 'playwright-core'
import { boot, cookiesOf, IMAGE, sh } from './lib.mjs'
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x && !c ? '  ' + x : ''}`); if (!c) process.exitCode = 1 }
const { B, cookie } = await boot('fg-labels', 3462, IMAGE, { people: 60 })
const g = await (await fetch(B + '/api/v1/graph', { headers: { cookie } })).json()
const b = await chromium.launch({ channel: 'chrome' })
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } })
await ctx.addCookies(cookiesOf(cookie))
const p = await ctx.newPage()
// From the youngest person the oldest relatives get the longest names.
const young = g.persons.reduce((a, x) => ((x.birthYear ?? 0) > (a.birthYear ?? 0) ? x : a))
await p.goto(`${B}/?p=${young.id}`)
await p.locator('.pcard .rel').first().waitFor()
await p.waitForTimeout(1500)
const measure = () => p.evaluate(() => {
  const rels = [...document.querySelectorAll('.pcard .rel')].map((e) => ({ r: e.getBoundingClientRect(), card: e.closest('.pcard'), len: e.textContent.length }))
  const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
  let overlaps = 0, intoCards = 0
  rels.forEach((x, i) => {
    rels.forEach((y, j) => { if (j > i && hit(x.r, y.r)) overlaps++ })
    document.querySelectorAll('.pcard').forEach((c) => { if (c !== x.card && hit(x.r, c.querySelector('.card-main')?.getBoundingClientRect() ?? c.getBoundingClientRect())) intoCards++ })
  })
  return { labels: rels.length, long: rels.filter((x) => x.len > 20).length, overlaps, intoCards }
})
const near = await measure()
ok('long labels are there to test', near.long > 0, JSON.stringify(near))
ok('labels do not overlap each other or another card', near.overlaps === 0 && near.intoCards === 0, JSON.stringify(near))
ok('none is cut short', await p.evaluate(() => [...document.querySelectorAll('.pcard .rel')].every((e) => e.scrollHeight <= e.clientHeight + 1)))
for (let i = 0; i < 3; i++) { await p.keyboard.press('-'); await p.waitForTimeout(300) }
await p.waitForTimeout(800)
const far = await measure()
ok('nor when zoomed out', far.overlaps === 0 && far.intoCards === 0, JSON.stringify(far))
const cut = await p.evaluateHandle(() => [...document.querySelectorAll('.pcard .rel')].find((e) => e.scrollHeight > e.clientHeight + 1)?.closest('.pcard') ?? null)
if (await cut.evaluate((c) => !!c)) {
  const at = await cut.evaluate((c) => { const r = c.querySelector('.ava').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await p.mouse.move(at.x, at.y); await p.waitForTimeout(400)
  ok('a label cut at three lines shows whole under the cursor', await cut.evaluate((c) => { const e = c.querySelector('.rel'); return e.scrollHeight <= e.clientHeight + 1 }))
}
await b.close()
sh('docker rm -fv fg-labels'); try { sh('docker volume rm fg-labels-data') } catch {}
