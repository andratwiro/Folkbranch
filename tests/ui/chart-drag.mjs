// Drawing a link on the chart: dropping a couple's dot on a child who has only one of them adds the other parent;
// a child with a parent outside the couple is refused with a message. Invented people only.
import { browser, finish, ok, open, O, COOKIE, shot, sleep } from './lib.mjs'

const call = async (path, json, method = 'POST') => {
  const r = await fetch(`${O}/api/v1/${path}`, { method, headers: { cookie: COOKIE, origin: O, 'content-type': 'application/json' }, body: json ? JSON.stringify(json) : undefined })
  if (!r.ok) throw new Error(`${path} answered ${r.status}: ${await r.text()}`)
  return r.json()
}
const person = async (givenName, sex) => (await call('persons', { person: { givenName, surname: 'Dragtest', sex, living: false } })).id
const [pavel, elena, ilya, igor, oleg, tanya] = [await person('Pavel', 'M'), await person('Elena', 'F'), await person('Ilya', 'M'), await person('Igor', 'M'), await person('Oleg', 'M'), await person('Tanya', 'F')]
await call('relations', { type: 'son', to: pavel, other: ilya })
await call('relations', { type: 'spouse', to: pavel, other: elena })
// A child whose only parent is outside the couple, standing next to them.
await call('relations', { type: 'spouse', to: pavel, other: igor })
await call('relations', { type: 'son', to: igor, other: oleg })
// Tanya was attached to Igor by mistake; she is Pavel's daughter.
await call('relations', { type: 'daughter', to: igor, other: tanya })
const parentsOf = async (id) => (await call('graph', null, 'GET')).parentChild.filter((l) => l.childId === id).map((l) => l.parentId).sort()

const br = await browser()
const { page, ctx, errors } = await open(br, { width: 1440, height: 900 })
await page.goto(O)
await page.locator(`.pcard[data-person="${ilya}"]`).waitFor({ timeout: 30000 })
await sleep(800)
// The invented people stand apart from the demo family: pan the chart until they are all in view.
const reach = async () => (await Promise.all([pavel, elena, ilya, igor, oleg, tanya].map((id) => page.locator(`.pcard[data-person="${id}"]`).boundingBox()))).map((b) => b.x + b.width)
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
// Moving an end of a link that is already there: select the line, drag its handle onto another person.
const selectLine = async (sel, along = 0.5) => {
  const at = await page.evaluate(([sel, along]) => { const el = document.querySelector(sel); const m = el.getScreenCTM(), q = el.getPointAtLength(el.getTotalLength() * along); return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f } }, [sel, along])
  await page.mouse.click(at.x, at.y); await sleep(300)
}
const dragHandle = async (handle, to) => {
  const from = await centre(`[data-link-handle="${handle}"]`), end = await centre(`.pcard[data-person="${to}"] .card-main`)
  await page.mouse.move(from.x, from.y); await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 10 }); await sleep(150)
  const label = await page.locator('.fixed.z-50.float').first().innerText().catch(() => '')
  await shot(page, `chart-drag-handle-${handle}`)
  await page.mouse.up(); await sleep(800)
  return label
}
const linkOf = async (child) => (await call('graph', null, 'GET')).parentChild.filter((l) => l.childId === child).map((l) => l.parentId)
await selectLine(`path[data-edge-child="${tanya}"]`)
ok('a selected link shows handles on its ends', await page.locator('[data-link-handle]').count() === 2)
await shot(page, 'chart-drag-handles')
const moved = await dragHandle('parent', pavel)
ok('the label names where the end goes', /Move to: Pavel/.test(moved), moved)
ok('the wrong parent is replaced by the right one', (await linkOf(tanya)).join() === pavel, (await linkOf(tanya)).join())
await page.getByRole('button', { name: 'Undo' }).last().click().catch(() => {})
await sleep(600)
ok('and Undo puts the old parent back', (await linkOf(tanya)).join() === igor, (await linkOf(tanya)).join())

// A union: its end at Igor moves to Oleg.
const pairs = async () => (await call('graph', null, 'GET')).unions.filter((u) => [u.aId, u.bId].includes(pavel)).map((u) => [u.aId, u.bId].find((x) => x !== pavel))
const withIgor = (await call('graph', null, 'GET')).unions.find((u) => [u.aId, u.bId].includes(pavel) && [u.aId, u.bId].includes(igor)).id
// Off the middle, where the family's dot sits.
await selectLine(`path[data-union-hit="${withIgor}"]`, 0.15)
await shot(page, 'chart-drag-union-handles')
ok('a selected union shows a handle at each person', await page.locator('[data-link-handle]').count() === 2)
// The handle standing nearest Igor is the one at his end.
const igorAt = await centre(`.pcard[data-person="${igor}"] .card-main`)
const handleKeys = await page.evaluate(() => [...document.querySelectorAll('[data-link-handle]')].map((el) => { const r = el.getBoundingClientRect(); return { key: el.dataset.linkHandle, x: r.x + r.width / 2, y: r.y + r.height / 2 } }))
const atIgor = handleKeys.sort((a, b) => Math.hypot(a.x - igorAt.x, a.y - igorAt.y) - Math.hypot(b.x - igorAt.x, b.y - igorAt.y))[0].key
await dragHandle(atIgor, oleg)
const partners = await pairs()
ok('the union now joins Pavel and Oleg, and Elena is still his partner', partners.includes(oleg) && partners.includes(elena) && !partners.includes(igor), partners.join())
ok('no script errors', errors.length === 0, errors.join(' | '))
await ctx.close(); await br.close()
finish()
