// Settings > AI, the Usage cards: no text is cut off by a card's edge at any width, with short and with very long
// figures, and the assistant's daily tokens are not told twice. The server answers for the assistant are replaced
// here, because the demo family has no model connected.
import { browser, finish, ok, open, O, shot, sleep, SIZES } from './lib.mjs'

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
await br.close()
finish()
