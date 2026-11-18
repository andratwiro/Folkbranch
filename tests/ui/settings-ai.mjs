// Settings > AI, the Usage cards: no text is cut off by a card's edge at any width, with short and with very long
// figures, and the assistant's daily tokens are not told twice. The server answers for the assistant are replaced
// here, because the demo family has no model connected.
import { browser, COOKIE, finish, ok, open, O, shot, sleep, SIZES } from './lib.mjs'

const provider = (month, tokensToday) => ({ connected: true, provider: 'openrouter', label: 'OpenRouter', model: 'a/very-long-model-name', auto: false, source: 'app', keyEnding: 'abcd', tokensToday, dailyLimit: 5_000_000, month: { dollars: month, unpriced: 0, input: 0, cached: 0, output: 0 } })
const CASES = { priced: provider(1234567.89, 47194), unpriced: provider(0, 4_719_400_000) }

/** Every text node in the cards, measured against the card that holds it. */
const clipped = (page) => page.evaluate(() => {
  const grid = [...document.querySelectorAll('[role="meter"]')].map((m) => m.closest('.rounded-xl'))[0]?.parentElement
  if (!grid) return { cards: 0, cut: ['no cards'], text: [] }
  const cut = [], text = []
  for (const card of grid.children) {
    const box = card.getBoundingClientRect()
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const s = n.textContent.trim()
      if (!s) continue
      const range = document.createRange(); range.selectNodeContents(n)
      for (const r of range.getClientRects()) if (r.right > box.right + 0.5 || r.left < box.left - 0.5) cut.push(`${s} (${Math.round(r.right - box.right)}px over)`)
      const el = n.parentElement
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') cut.push(`${s} (hidden)`)
      text.push(s)
    }
  }
  return { cards: grid.children.length, cut, text }
})

const br = await browser()
for (const [name, size] of Object.entries(SIZES)) {
  for (const [kind, body] of Object.entries(CASES)) {
    const { page, ctx, errors } = await open(br, size)
    await page.route('**/api/**/assistant/provider', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: body }) : r.continue()))
    await page.goto(O + '/')
    await page.locator('.pcard').first().waitFor({ timeout: 60000 })
    await page.getByRole('button', { name: /^Settings/ }).first().click()
    await page.getByRole('button', { name: /^AI$/ }).first().click()
    await page.locator('[role="meter"]').first().waitFor({ timeout: 20000 })
    await sleep(500)
    const m = await clipped(page)
    const at = `${kind} @ ${name}`
    ok(`no text in the usage cards is cut off: ${at}`, m.cards === 3 && m.cut.length === 0, m.cut.join('; '))
    const daily = m.text.filter((s) => /47,194|4,719,400,000/.test(s))
    ok(`the day's tokens are said once: ${at}`, daily.length === 1, daily.join(' | '))
    await shot(page, `settings-ai-${kind}-${name}`)
    ok(`no script error: ${at}`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

// A provider of your own, added from the screen with the free model stub's address (FG_STUB, no key of the real kind):
// the form, Load models, Test, Save, switching to it, and an answer through it. The key must not come back anywhere.
const STUB = process.env.FG_STUB
const KEY = 'stub-key-0f3a9c71'
const api = (path, init = {}) => fetch(`${O}/api/v1/${path}`, { ...init, headers: { origin: O, cookie: COOKIE, 'content-type': 'application/json', ...(init.headers ?? {}) } }).then((r) => r.text())
await api('settings', { method: 'PATCH', body: JSON.stringify({ assistantEnabled: '1' }) })
const goAi = async (page, labels) => {
  await page.goto(O + '/')
  await page.locator('.pcard').first().waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: labels.settings }).first().click()
  await page.getByRole('button', { name: labels.ai }).first().click()
  await page.getByRole('button', { name: labels.add }).waitFor({ timeout: 20000 })
}
for (const [name, size, lang, labels] of [
  ['desktop-1440', SIZES['desktop-1440'], 'en', { settings: /^Settings/, ai: /^AI$/, add: /^Add your own provider/ }],
  ['phone-375', SIZES['phone-375'], 'en', { settings: /^Settings/, ai: /^AI$/, add: /^Add your own provider/ }],
  ['desktop-1440', SIZES['desktop-1440'], 'ru', { settings: /^Настройки/, ai: /^ИИ$/, add: /^Добавить своего провайдера/ }],
  ['phone-375', SIZES['phone-375'], 'ru', { settings: /^Настройки/, ai: /^ИИ$/, add: /^Добавить своего провайдера/ }],
]) {
  const { page, ctx, errors } = await open(br, size, { lang })
  const at = `${lang} @ ${name}`
  await goAi(page, labels)
  await page.getByRole('button', { name: labels.add }).click()
  const form = page.locator('form[aria-label]').filter({ has: page.locator('input[name="provider-url"]') })
  await form.waitFor({ timeout: 10000 })
  await shot(page, `own-provider-form-${lang}-${name}`)
  // Nothing in the form is cut off at this width.
  ok(`the form fits the screen: ${at}`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  // Only the English run goes through the whole flow: it is the same code in every language.
  if (lang === 'en' && name === 'desktop-1440') {
    await form.locator('input[name="provider-name"]').fill('Stub model')
    await form.locator('input[name="provider-url"]').fill(`${STUB}/v1`)
    await form.locator('input[name="provider-key"]').fill(KEY)
    ok('the key field is hidden', await form.locator('input[name="provider-key"]').getAttribute('type') === 'password')
    await form.getByRole('button', { name: 'Load models' }).click()
    await page.locator('#provider-models option').first().waitFor({ state: 'attached', timeout: 10000 })
    ok('Load models offers the provider’s list', (await page.locator('#provider-models option').count()) === 2)
    await form.locator('input[name="provider-model"]').fill('stub-small')
    await form.getByRole('button', { name: 'Test', exact: true }).click()
    await page.locator('[data-test="provider-said"]').waitFor({ timeout: 20000 })
    ok('Test says in words that it is ready', /ready to use/.test(await page.locator('[data-test="provider-said"]').innerText()), await page.locator('[data-test="provider-said"]').innerText())
    await shot(page, 'own-provider-tested-en')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    const row = page.locator('div.px-4').filter({ hasText: 'Stub model' }).first()
    await row.waitFor({ timeout: 10000 })
    ok('the saved provider is in the list, marked as your own', /your provider/.test(await row.innerText()))
    ok('its key is not shown anywhere on the page', !(await page.content()).includes(KEY) && !(await page.locator('input[name="provider-key"]').count()))
    await row.getByRole('button', { name: 'Use', exact: true }).click()
    for (let i = 0; i < 40 && !JSON.parse(await api('ai/custom'))[0]?.active; i++) await sleep(250)
    ok('Use makes it the assistant’s provider', JSON.parse(await api('ai/custom'))[0]?.active === true)
    await sleep(500)
    await shot(page, 'own-provider-in-use-en')
    // What the server tells about it: no key, not even its end.
    const told = (await api('ai/custom')) + (await api('assistant/provider')) + (await api('assistant/choices')) + (await api('ai-settings'))
    ok('no answer of the server holds the key or its end', !told.includes(KEY) && !told.includes(KEY.slice(-4)), told.slice(0, 200))
    // An answer through it: the stub speaks, and the key reached it, and only it.
    await page.goto(O + '/')
    await page.locator('.pcard').first().waitFor({ timeout: 60000 })
    await page.getByRole('button', { name: /^AI/ }).first().click()
    const box = page.getByRole('textbox').last()
    await box.waitFor({ timeout: 20000 })
    await box.fill('Hello')
    await box.press('Enter')
    await page.getByText('Hello.', { exact: true }).first().waitFor({ timeout: 30000 })
    ok('the assistant answers through the provider added by hand', true)
    const keys = JSON.parse(await (await fetch(`${STUB}/__keys`)).text())
    ok('the stub received the key, as a Bearer token, on every request', keys.length > 0 && keys.every((k) => k === `Bearer ${KEY}`), JSON.stringify(keys))
    // Another model of the same provider is not a different key: removing the provider removes it.
    await api('ai/custom/' + JSON.parse(await api('ai/custom'))[0].id, { method: 'DELETE' })
    ok('removing the provider leaves none, and switches the assistant off', JSON.parse(await api('ai/custom')).length === 0 && JSON.parse(await api('assistant/provider')).connected === false)
  } else {
    await form.locator('input[name="provider-url"]').fill('http://example.com/v1')
  }
  ok(`no script error: ${at}`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}
await br.close()
finish()
