// The marks that say how people are linked: an ended union is crossed out, and a child's line says adopted, foster or step.
// The legend explains each one, in each language. Invented people only.
import { browser, finish, ok, open, O, COOKIE, shot, sleep } from './lib.mjs'

const call = async (path, json, method = 'POST') => {
  const r = await fetch(`${O}/api/v1/${path}`, { method, headers: { cookie: COOKIE, origin: O, 'content-type': 'application/json' }, body: json ? JSON.stringify(json) : undefined })
  if (!r.ok) throw new Error(`${path} answered ${r.status}: ${await r.text()}`)
  return r.json()
}
const person = async (givenName, sex) => (await call('persons', { person: { givenName, surname: 'Marktest', sex, living: false } })).id
const [dad, mum, a, f, s] = [await person('Dad', 'M'), await person('Mum', 'F'), await person('Adopted', 'M'), await person('Foster', 'F'), await person('Stepson', 'M')]
await call('relations', { type: 'spouse', to: dad, other: mum, endDate: '1990' })
// Three more couples: unmarried and together, separated, and widowed.
const [c1, c2, s1, s2, w1, w2] = [await person('Civil1', 'M'), await person('Civil2', 'F'), await person('Sep1', 'M'), await person('Sep2', 'F'), await person('Wid1', 'M'), await person('Wid2', 'F')]
await call('relations', { type: 'spouse', to: c1, other: c2, unionKind: 'civil' })
await call('relations', { type: 'spouse', to: s1, other: s2 })
await call('relations', { type: 'spouse', to: w1, other: w2 })
const unionOf = async (x) => (await call('graph', null, 'GET')).unions.find((u) => u.aId === x || u.bId === x).id
await call(`relations/union/${await unionOf(s1)}`, { endKind: 'separated', endDate: '?' }, 'PATCH')
await call(`relations/union/${await unionOf(w1)}`, { endKind: 'widowed', endDate: '?' }, 'PATCH')
for (const [child, kind] of [[a, 'adopted'], [f, 'foster'], [s, 'step']]) await call('relations', { type: child === f ? 'daughter' : 'son', to: dad, other: child, otherParentId: mum, kind })

const WORDS = {
  en: ['Divorce', 'Separation', 'Unmarried partners', 'Widowed', 'Adopted child', 'Foster child', 'Stepchild'],
  es: ['Divorcio', 'Separación', 'Pareja sin casar', 'Viudez', 'Hijo adoptado', 'Hijo en acogida', 'Hijastro'],
  ca: ['Divorci', 'Separació', 'Parella sense casar', 'Viduïtat', 'Fill adoptat', 'Fill en acolliment', 'Fillastre'],
}
const br = await browser()
for (const lang of Object.keys(WORDS)) {
  const { page, ctx, errors } = await open(br, { width: 1440, height: 900 }, { lang })
  await page.goto(O)
  await page.locator('.pcard').first().waitFor({ timeout: 30000 })
  await sleep(800)
  const styles = await page.evaluate(() => Object.fromEntries(['adopted', 'foster', 'step'].map((k) => [k, document.querySelectorAll(`svg path.line.${k}`).length])))
  ok(`${lang}: the three kinds of link are drawn apart`, styles.adopted >= 1 && styles.foster >= 1 && styles.step >= 1, JSON.stringify(styles))
  const dashes = await page.evaluate(() => ['adopted', 'foster', 'step'].map((k) => getComputedStyle(document.querySelector(`svg path.line.${k}`)).strokeDasharray))
  ok(`${lang}: each has its own dash`, new Set(dashes).size === 3, dashes.join(' | '))
  // Two slashes for a divorce (an end date with no reason counts as one), one for a separation, none for a widowhood.
  const slashes = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('path.union-end[data-union-end]')].map((el) => [el.dataset.end, (el.getAttribute('d').match(/M/g) ?? []).length])))
  ok(`${lang}: a divorce has two slashes, a separation one, a widowhood none`, slashes.divorced === 2 && slashes.separated === 1 && !slashes.widowed && Object.keys(slashes).length === 2, JSON.stringify(slashes))
  const civil = await page.evaluate(() => ({ lines: document.querySelectorAll('svg path.union.civil').length, dash: getComputedStyle(document.querySelector('svg path.union.civil')).strokeDasharray, plain: getComputedStyle([...document.querySelectorAll('svg path.union')].find((el) => !el.classList.contains('civil'))).strokeDasharray }))
  ok(`${lang}: unmarried partners have a dashed line, a marriage a solid one`, civil.lines === 1 && civil.dash !== 'none' && civil.plain === 'none', JSON.stringify(civil))
  await page.getByRole('button', { name: /^(Legend|Leyenda|Com es llegeix)/i }).click()
  await sleep(400)
  const text = await page.locator('[role=dialog], [data-radix-popper-content-wrapper]').last().innerText().catch(() => '')
  for (const w of WORDS[lang]) ok(`${lang}: the legend says "${w}"`, text.includes(w), text.includes(w) ? "" : text.slice(0, 80))
  if (lang === 'en') await shot(page, 'chart-marks-legend')
  ok(`${lang}: no script errors`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}
await br.close()
finish()
