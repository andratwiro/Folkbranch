// Drawing a link on the chart: dropping a couple's dot on a child who has only one of them adds the other parent;
// a child with a parent outside the couple is refused with a message. Invented people only.
import { browser, finish, ok, open, O, COOKIE, shot, sleep } from './lib.mjs'

const call = async (path, json, method = 'POST') => {
  const r = await fetch(`${O}/api/v1/${path}`, { method, headers: { cookie: COOKIE, origin: O, 'content-type': 'application/json' }, body: json ? JSON.stringify(json) : undefined })
  if (!r.ok) throw new Error(`${path} answered ${r.status}: ${await r.text()}`)
  return r.json()
}
const person = async (givenName, sex) => (await call('persons', { person: { givenName, surname: 'Dragtest', sex, living: false } })).id
const [pavel, elena, ilya, igor, oleg] = [await person('Pavel', 'M'), await person('Elena', 'F'), await person('Ilya', 'M'), await person('Igor', 'M'), await person('Oleg', 'M')]
await call('relations', { type: 'son', to: pavel, other: ilya })
await call('relations', { type: 'spouse', to: pavel, other: elena })
// A child whose only parent is outside the couple, standing next to them.
await call('relations', { type: 'spouse', to: pavel, other: igor })
await call('relations', { type: 'son', to: igor, other: oleg })
const parentsOf = async (id) => (await call('graph', null, 'GET')).parentChild.filter((l) => l.childId === id).map((l) => l.parentId).sort()

const br = await browser()
const { page, ctx, errors } = await open(br, { width: 1440, height: 900 })
await page.goto(O)
await page.locator(`.pcard[data-person="${ilya}"]`).waitFor({ timeout: 30000 })
await sleep(800)
// The invented people stand apart from the demo family: pan the chart until they are all in view.
const reach = async () => (await Promise.all([pavel, elena, ilya, igor, oleg].map((id) => page.locator(`.pcard[data-person="${id}"]`).boundingBox()))).map((b) => b.x + b.width)
const over = Math.max(...await reach()) - 1300
if (over > 0) {
  await page.mouse.move(900, 450); await page.mouse.down()
  await page.mouse.move(900 - over - 60, 450, { steps: 8 }); await page.mouse.up()
  await sleep(500)
}
const unionId = (await call('graph', null, 'GET')).unions.find((u) => [u.aId, u.bId].includes(pavel) && [u.aId, u.bId].includes(elena))?.id
ok('the couple has its dot', !!unionId && await page.locator(`.dot-group[data-union="${unionId}"]`).count() === 1)
const centre = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return b && { x: b.x + b.width / 2, y: b.y + Math.min(30, b.height / 2) } }
const drag = async (to) => {
  const from = await centre(`.dot-group[data-union="${unionId}"] .dot`)
  const end = await centre(`.pcard[data-person="${to}"] .card-main`)
  await page.mouse.move(from.x, from.y); await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 10 }); await sleep(150)
  const label = await page.locator('.fixed.z-50.float').first().innerText().catch(() => '')
  await shot(page, `chart-drag-${to === ilya ? 'adds-mother' : 'refused'}`)
  await page.mouse.up(); await sleep(800)
  return label
}
const before = await parentsOf(ilya)
ok('Ilya starts with Pavel only', before.length === 1 && before[0] === pavel)
const label = await drag(ilya)
ok('the label says what he becomes', /son/i.test(label), label)
const after = await parentsOf(ilya)
ok('Elena is now his mother, Pavel stays', after.length === 2 && after.includes(pavel) && after.includes(elena), after.join())

const refusedLabel = await drag(oleg)
ok('a child with a parent outside the couple is refused with a reason', /outside this couple/.test(refusedLabel), refusedLabel)
ok('and nothing was linked', (await parentsOf(oleg)).join() === igor)
ok('no script errors', errors.length === 0, errors.join(' | '))
await ctx.close(); await br.close()
finish()
