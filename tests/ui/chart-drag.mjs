// Drawing a link on the chart: dropping a couple's dot on a child who has only one of them adds the other parent;
// a child with a parent outside the couple is moved to the couple. A child's own handle dropped on a parent they already
// have makes them that parent's only child; on the couple's dot, a child of both. Invented people only.
import { browser, finish, ok, open, O, COOKIE, shot, sleep } from './lib.mjs'

const call = async (path, json, method = 'POST') => {
  const r = await fetch(`${O}/api/v1/${path}`, { method, headers: { cookie: COOKIE, origin: O, 'content-type': 'application/json' }, body: json ? JSON.stringify(json) : undefined })
  if (!r.ok) throw new Error(`${path} answered ${r.status}: ${await r.text()}`)
  return r.json()
}
const person = async (givenName, sex) => (await call('persons', { person: { givenName, surname: 'Dragtest', sex, living: false } })).id
const [pavel, elena, ilya, igor, oleg, tanya, vera] = [await person('Pavel', 'M'), await person('Elena', 'F'), await person('Ilya', 'M'), await person('Igor', 'M'), await person('Oleg', 'M'), await person('Tanya', 'F'), await person('Vera', 'F')]
await call('relations', { type: 'son', to: pavel, other: ilya })
await call('relations', { type: 'spouse', to: pavel, other: elena })
// A child whose only parent is outside the couple, standing next to them.
await call('relations', { type: 'spouse', to: pavel, other: igor })
await call('relations', { type: 'son', to: igor, other: oleg })
await call('relations', { type: 'daughter', to: igor, other: vera })
// Tanya was attached to Igor by mistake; she is Pavel's daughter.
await call('relations', { type: 'daughter', to: igor, other: tanya })
const parentsOf = async (id) => (await call('graph', null, 'GET')).parentChild.filter((l) => l.childId === id).map((l) => l.parentId).sort()

const br = await browser()
const { page, ctx, errors } = await open(br, { width: 1440, height: 900 })
await page.goto(O)
await page.locator(`.pcard[data-person="${ilya}"]`).waitFor({ timeout: 30000 })
await sleep(800)
// The invented people stand apart from the demo family: pan the chart until they are all in view.
const reach = async () => (await Promise.all([pavel, elena, ilya, igor, oleg, tanya, vera].map((id) => page.locator(`.pcard[data-person="${id}"]`).boundingBox()))).map((b) => b.x + b.width)
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

// A child with a parent outside the couple now moves to the couple: the outside link goes, and Undo brings it back.
const veraLabel = await drag(vera)
ok('the label says what Vera becomes', /Make a child of both/.test(veraLabel), veraLabel)
ok('the child of Igor is now a child of Pavel and Elena only', (await parentsOf(vera)).join() === [pavel, elena].sort().join(), (await parentsOf(vera)).join())
ok('the toast says what changed', /Now a child of Pavel Dragtest and Elena Dragtest/.test(await page.locator('body').innerText()))
await page.getByRole('button', { name: 'Undo' }).last().click(); await sleep(700)
ok('one Undo brings Igor back and removes the couple', (await parentsOf(vera)).join() === igor, (await parentsOf(vera)).join())

// A child's own handle: "one child of both, one child of one parent", changed by dragging.
const plusOf = async (id) => {
  await page.locator(`.pcard[data-person="${id}"]`).hover(); await sleep(200)
  return centre(`.pcard[data-person="${id}"] .tool.add.top`)
}
const dragPlus = async (child, point) => {
  const from = await plusOf(child)
  await page.mouse.move(from.x, from.y); await page.mouse.down()
  const end = await point()
  await page.mouse.move(end.x, end.y, { steps: 12 }); await sleep(200)
  const label = await page.locator('.fixed.z-50.float').first().innerText().catch(() => '')
  const lit = { card: await page.locator('.pcard.drop-target').count(), dot: await page.locator('.dot-group.drop-target').count() }
  return { label, lit, done: async (name) => { await shot(page, name); await page.mouse.up(); await sleep(900) } }
}
const onCard = (id) => () => centre(`.pcard[data-person="${id}"] .card-main`)
const onDot = () => centre(`.dot-group[data-union="${unionId}"] .dot`)
await shot(page, 'chart-drag-before-one-parent')
ok('Ilya has both parents before', (await parentsOf(ilya)).length === 2)
const toPavel = await dragPlus(ilya, onCard(pavel))
ok('over a parent they have, the label says only that parent, and the card lights up', /Make a child of Pavel Dragtest only/.test(toPavel.label) && toPavel.lit.card === 1, JSON.stringify([toPavel.label, toPavel.lit]))
await toPavel.done('chart-drag-after-one-parent')
ok('the other parent link is gone: Ilya is Pavel\'s child only', (await parentsOf(ilya)).join() === pavel, (await parentsOf(ilya)).join())
ok('the toast says Now a child of Pavel only', /Now a child of Pavel Dragtest only/.test(await page.locator('body').innerText()))
await page.getByRole('button', { name: 'Undo' }).last().click(); await sleep(700)
ok('one Undo gives Elena back', (await parentsOf(ilya)).join() === [pavel, elena].sort().join(), (await parentsOf(ilya)).join())
await dragPlus(ilya, onCard(pavel)).then((d) => d.done('chart-drag-only-pavel'))
const again = await dragPlus(ilya, onCard(pavel))
ok('over their only parent, it says so and nothing changes', /already the only parent/.test(again.label), again.label)
await again.done('chart-drag-already-only')
ok('Ilya is still Pavel\'s only child link', (await parentsOf(ilya)).join() === pavel)
const toDot = await dragPlus(ilya, onDot)
ok('over the couple\'s dot, the label says both, and the dot lights up', /Make a child of both/.test(toDot.label) && toDot.lit.dot === 1, JSON.stringify([toDot.label, toDot.lit]))
await toDot.done('chart-drag-both-again')
ok('and he is a child of both again', (await parentsOf(ilya)).join() === [pavel, elena].sort().join(), (await parentsOf(ilya)).join())

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
// Phone width: the dot and the parents' cards can still be hit, and the drop works there too.
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${O}/?p=${ilya}`); await page.locator('.pcard').first().waitFor({ timeout: 30000 }); await sleep(1500)
await shot(page, 'chart-drag-phone-start')
console.log('cards on the phone:', await page.locator('.pcard').count(), 'ilya:', await page.locator(`.pcard[data-person="${ilya}"]`).count())
await page.keyboard.press('Escape'); await sleep(400)
const pan = async (...need) => {
  // Bring the child and what he is dropped on into the phone's view, as a person would by dragging the chart.
  const sels = [ilya, ...need].map((x) => x === 'dot' ? `.dot-group[data-union="${unionId}"] .dot` : `.pcard[data-person="${x}"]`)
  const drag = async (dx, dy) => { await page.mouse.move(195, 300); await page.mouse.down(); await page.mouse.move(195 + dx, 300 + dy, { steps: 6 }); await page.mouse.up(); await sleep(350) }
  for (let i = 0; i < 40; i++) {
    const here = await Promise.all(sels.map((q) => page.locator(q).count()))
    if (here.some((n) => !n)) { await drag(i < 20 ? -240 : 240, i % 4 === 3 ? -200 : 0); continue }
    const bs = await Promise.all(sels.map((q) => page.locator(q).first().boundingBox()))
    if (bs.every((b) => b.x > 0 && b.x + b.width < 390 && b.y > 60 && b.y + b.height < 780)) return true
    const mid = { x: bs.reduce((a, b) => a + b.x + b.width / 2, 0) / bs.length, y: bs.reduce((a, b) => a + b.y + b.height / 2, 0) / bs.length }
    await drag(195 - mid.x, 420 - mid.y)
  }
  return false
}
ok('at 390 px the child and his father fit in view', await pan(pavel))
const phoneOnly = await dragPlus(ilya, onCard(pavel))
ok('at 390 px a parent\'s card takes the drop', /only/.test(phoneOnly.label) && phoneOnly.lit.card === 1, JSON.stringify([phoneOnly.label, phoneOnly.lit]))
await phoneOnly.done('chart-drag-phone-only')
ok('Ilya is Pavel\'s only child link after the phone drag', (await parentsOf(ilya)).join() === pavel, (await parentsOf(ilya)).join())
const reachable = await pan('dot')
if (!reachable) { await shot(page, 'chart-drag-phone-stuck'); console.log(JSON.stringify(await Promise.all([`.pcard[data-person="${ilya}"]`, `.dot-group[data-union="${unionId}"] .dot`].map((q) => page.locator(q).first().boundingBox().catch(() => null))))) }
ok('and the child and the couple\'s dot can be brought into view', reachable)
const phoneDot = await dragPlus(ilya, onDot)
const hit = await page.locator(`.dot-group[data-union="${unionId}"] .dot-hit`).boundingBox()
ok('while dragging, the couple\'s dot is a target a finger can hit (at least 32 px)', hit && hit.width >= 32, JSON.stringify(hit))
ok('at 390 px the dot takes the drop', /Make a child of both/.test(phoneDot.label) && phoneDot.lit.dot === 1, JSON.stringify([phoneDot.label, phoneDot.lit]))
await phoneDot.done('chart-drag-phone')
ok('and he is a child of both again', (await parentsOf(ilya)).join() === [pavel, elena].sort().join(), (await parentsOf(ilya)).join())
ok('no script errors', errors.length === 0, errors.join(' | '))
await ctx.close(); await br.close()
finish()
