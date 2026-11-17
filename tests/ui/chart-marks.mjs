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
for (const [child, kind] of [[a, 'adopted'], [f, 'foster'], [s, 'step']]) await call('relations', { type: child === f ? 'daughter' : 'son', to: dad, other: child, otherParentId: mum, kind })

const WORDS = { en: ['Ended union', 'Adopted child', 'Foster child', 'Stepchild'], es: ['Unión terminada', 'Hijo adoptado', 'Hijo en acogida', 'Hijastro'], ca: ['Unió acabada', 'Fill adoptat', 'Fill en acolliment', 'Fillastre'] }
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
  ok(`${lang}: the ended union is crossed out`, await page.locator('path.union-end[data-union-end]').count() === 1)
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
