// The assistant's panel, with a model that costs nothing (tests/ui/model-stub.mjs):
//  1. The first message does not twitch: from the frame it appears, its place and size stay put, it is not replaced by
//     another element, and the panel does not jump, at a phone width and at a laptop's.
//  2. While a step runs the panel says what it is about, and how many people so far, not one label for the whole time.
import { browser, finish, ok, open, O, COOKIE, shot, sleep } from './lib.mjs'

const origin = { origin: O, cookie: COOKIE, 'content-type': 'application/json' }
await fetch(`${O}/api/v1/settings`, { method: 'PATCH', headers: origin, body: JSON.stringify({ assistantEnabled: '1' }) })
const graph = await (await fetch(`${O}/api/v1/graph`, { headers: origin })).json()
const people = graph.persons.filter((p) => !p.hidden).slice(0, 6)

/** Every animation frame for `ms` after it is started: where the first message is, how big, which element it is, how far the list is scrolled. */
const RECORD = (ms) => {
  window.__frames = []
  const t0 = performance.now()
  let serial = 0
  const tick = () => {
    const users = [...document.querySelectorAll('.is-user')]
    const el = users[0]
    if (el && !el.__serial) el.__serial = ++serial
    const r = el?.getBoundingClientRect()
    const list = el?.closest('[role="log"]') ?? document.querySelector('[role="log"]')
    const c = document.querySelector('textarea')?.closest('form')?.getBoundingClientRect()
    const think = document.querySelector('.thinking')?.getBoundingClientRect()
    const last = users.length ? document.querySelectorAll('.is-assistant')[0]?.getBoundingClientRect() : null
    window.__frames.push({ t: Math.round(performance.now() - t0), users: users.length, el: el?.__serial ?? 0, top: r?.top ?? null, left: r?.left ?? null, height: r?.height ?? null, width: r?.width ?? null, scroll: list?.scrollTop ?? null, composerTop: c?.top ?? null, composerHeight: c?.height ?? null, thinkTop: think?.top ?? null, answerTop: last?.top ?? null, answerHeight: last?.height ?? null })
    if (performance.now() - t0 < ms) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

const br = await browser()
for (const [name, size] of [['phone-375', { width: 375, height: 812 }], ['desktop-1440', { width: 1440, height: 900 }]]) {
  const { page, ctx, errors } = await open(br, size, { lang: 'en' })
  await page.goto(O + '/')
  await page.locator('.pcard').first().waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: /^AI/ }).first().click()
  const box = page.getByRole('textbox').last()
  await box.waitFor({ timeout: 20000 })
  await box.fill('Hello')
  await page.evaluate(RECORD, 2500)
  await box.press('Enter')
  await page.locator('.is-user').first().waitFor({ timeout: 10000 })
  await sleep(2800)
  const frames = (await page.evaluate(() => window.__frames)).filter((f) => f.el)
  const spread = (k) => Math.max(...frames.map((f) => f[k])) - Math.min(...frames.map((f) => f[k]))
  const at = `@ ${name}`
  if (process.env.FRAMES) console.log(frames.filter((f, i) => i === 0 || ['top', 'left', 'height', 'width', 'scroll', 'el', 'users', 'composerTop', 'composerHeight', 'thinkTop', 'answerTop', 'answerHeight'].some((k) => f[k] !== frames[i - 1][k])).map((f) => JSON.stringify(f)).join('\n'))
  ok(`the first message shows in the first frames ${at}`, frames.length >= 5, `${frames.length} frames`)
  ok(`the first message is one element all along, not replaced ${at}`, new Set(frames.map((f) => f.el)).size === 1 && frames.every((f) => f.users === 1), `elements ${[...new Set(frames.map((f) => f.el))]}`)
  ok(`the first message does not move ${at}`, spread('top') <= 1, `${spread('top').toFixed(1)}px over ${frames.length} frames`)
  ok(`the first message does not change size ${at}`, spread('height') <= 1 && spread('width') <= 1, `height ${spread('height').toFixed(1)}px, width ${spread('width').toFixed(1)}px`)
  ok(`the list does not jump ${at}`, frames.every((f) => f.scroll === null) || spread('scroll') <= 1, `scroll ${spread('scroll')}px`)
  if (process.env.FRAMES) console.log('answer text:', await page.getByText('Hello.').count(), (await page.locator('[role="log"]').textContent().catch(() => '')).slice(0, 200))
  // What follows the message: the "Thinking" line stays where it first showed, and the answer begins in its place.
  const thinking = frames.filter((f) => f.thinkTop !== null).map((f) => f.thinkTop)
  const firstAnswer = frames.find((f) => f.answerHeight > 0)
  ok(`the thinking line stays where it first showed ${at}`, thinking.length > 0 && Math.max(...thinking) - Math.min(...thinking) <= 1, `${thinking.length} frames, ${thinking.length ? (Math.max(...thinking) - Math.min(...thinking)).toFixed(1) : '-'}px`)
  ok(`the answer begins where the thinking line was ${at}`, !!firstAnswer && thinking.length > 0 && Math.abs(firstAnswer.answerTop - thinking.at(-1)) <= 1, `answer at ${firstAnswer?.answerTop}, thinking at ${thinking.at(-1)}`)
  await shot(page, `assistant-first-message-${name}`)
  ok(`no script error ${at}`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

// A bulk read written out slowly: the step must say how many people it covers as the call grows.
{
  const { page, ctx, errors } = await open(br, { width: 1440, height: 900 }, { lang: 'en' })
  await page.goto(O + '/')
  await page.locator('.pcard').first().waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: /^AI/ }).first().click()
  const box = page.getByRole('textbox').last()
  await box.waitFor({ timeout: 20000 })
  await box.fill(`READ:${people.map((p) => p.id).join(',')}`)
  await box.press('Enter')
  const seen = []
  const end = Date.now() + 12000
  while (Date.now() < end && !(await page.getByText('Done.').count())) {
    const s = await page.locator('.step-subject').last().textContent({ timeout: 500 }).catch(() => null)
    if (s && seen.at(-1) !== s) seen.push(s)
    await sleep(120)
  }
  await shot(page, 'assistant-step-subject')
  ok('the running step says what it is about, and it grows with the call', seen.length >= 3, `saw: ${seen.join(' → ')}`)
  ok('it names a few people and counts many', seen.some((s) => people.some((p) => s.includes(p.givenName))) && seen.some((s) => /^\d+$/.test(s) && +s > 3), `saw: ${seen.join(' → ')}`)
  ok('the answer arrives after the step', await page.getByText('Done.').count() > 0)
  ok('no script error: step subject', errors.length === 0, errors.join(' | '))
  await ctx.close()
}
await br.close()
finish()
