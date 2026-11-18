// An English archive from the first screen: no Russian word anywhere a person can reach, including tooltips and placeholders.
// FB_BASE points at a running empty server; otherwise a throwaway container is started.
import { chromium } from 'playwright-core'
import { IMAGE, sh, waitUp } from './lib.mjs'

const fails = []
const ok = (n, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x ? ' · ' + x : ''}`); if (!c) { fails.push(n); process.exitCode = 1 } }
const SHOTS = process.env.SHOTS

let B = process.env.FB_BASE
let created = false
if (!B) {
  B = 'http://localhost:3453'
  // Never remove a container this script did not create: stop and ask instead.
  if (sh('docker ps -aq --filter name=^fb-en$')) throw new Error('container fb-en exists and this script did not create it: remove it by hand or set FB_BASE')
  sh(`docker run -d --name fb-en -p 127.0.0.1:3453:3000 -e BETTER_AUTH_URL=${B} -e SETUP_TOKEN=x ${IMAGE}`)
  created = true
}
await waitUp(B, 180000)

const br = await chromium.launch({ channel: 'chrome', headless: true })

// Everything readable on the page, with what it is. The demo's data is English too, so any Cyrillic is a missed word.
const russian = (page) => page.evaluate(() => {
  const found = new Set()
  const has = (s) => /[А-Яа-яЁё]/.test(s ?? '')
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walk.nextNode()) {
    const el = walk.currentNode.parentElement
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue
    if (has(walk.currentNode.textContent)) found.add(walk.currentNode.textContent.trim().slice(0, 90))
  }
  for (const el of document.querySelectorAll('[title],[aria-label],[placeholder],[alt],[data-placeholder]'))
    for (const a of ['title', 'aria-label', 'placeholder', 'alt', 'data-placeholder'])
      if (has(el.getAttribute(a))) found.add(`${a}: ${el.getAttribute(a).slice(0, 90)}`)
  for (const el of document.querySelectorAll('input,textarea')) if (has(el.value)) found.add(`value: ${el.value.slice(0, 90)}`)
  return [...found]
})
const seen = new Map()
const check = async (page, where) => {
  for (const r of await russian(page)) if (!seen.has(r)) seen.set(r, where)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${where.replace(/\W+/g, '-')}.png` })
}

// The first screen speaks the browser's language.
for (const [locale, heading, lang] of [['ru-RU', 'Семейный архив', 'ru'], ['en-US', 'Family archive', 'en'], ['de-DE', 'Familienarchiv', 'de']]) {
  const ctx = await br.newContext({ locale })
  const page = await ctx.newPage()
  await page.goto(`${B}/setup?code=x`)
  await page.getByRole('heading', { name: heading }).waitFor()
  await page.waitForLoadState('networkidle')
  await page.waitForFunction((l) => document.documentElement.lang === l, lang, { timeout: 15000 })
  ok(`${locale} opens in its language`, true)
  await ctx.close()
}

const ctx = await br.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
await page.goto(`${B}/setup?code=x`)
await page.waitForLoadState('networkidle')
ok('English comes first', (await page.locator('form button.bar-btn').first().textContent()) === 'English')
// The choice can still be changed, and the screen follows.
await page.getByRole('button', { name: 'Русский' }).click()
await page.getByRole('heading', { name: 'Семейный архив' }).waitFor()
await page.getByRole('button', { name: 'English' }).click()
await page.getByRole('heading', { name: 'Family archive' }).waitFor()
await check(page, 'setup')
await page.getByLabel('Your name').pressSequentially('Ann')
await page.getByLabel('Family name').pressSequentially('The Whitlocks')
await page.getByRole('checkbox').check()
await page.getByRole('button', { name: 'Create archive' }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/setup'), { timeout: 60000 })
const card = page.getByText('Stephen', { exact: false }).first()
await card.waitFor({ timeout: 30000 })
ok('the logo is in the top bar', await page.locator('.main-bar .bar-logo').isVisible())
// With no card open too, the top bar folds up before it reaches the edge of a narrow window.
for (const width of [1100, 800, 660]) {
  await page.setViewportSize({ width, height: 800 })
  await page.waitForTimeout(250)
  ok(`the top bar fits at ${width}`, await page.locator('.main-bar').evaluate((n) => n.getBoundingClientRect().right <= innerWidth))
}
await page.setViewportSize({ width: 1440, height: 900 })
ok('the demo family is in English', (await page.locator('body').innerText()).includes('Whitlock'))
await check(page, 'chart')

// A person's card and every tab in it.
await card.click()
const panel = page.locator('.panel').filter({ has: page.getByRole('tab') }).first()
await panel.waitFor()
await check(page, 'person')
// Each tab, with its menus and hints open: most words wait behind a click.
const names = await panel.getByRole('tab').allTextContents()
// Escape also closes the card, so it opens again before each step.
const openTab = async (name) => {
  // A dialog that loads on demand can arrive after the Escape meant for it.
  for (let i = 0; i < 3 && await page.locator('[role=dialog]').count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200) }
  if (!(await panel.getByRole('tab', { name }).isVisible().catch(() => false))) { await card.click(); await panel.getByRole('tab', { name }).waitFor() }
  await panel.getByRole('tab', { name }).click()
  await page.waitForTimeout(300)
}
for (const name of names) {
  await openTab(name)
  await check(page, `person-${name}`)
  const buttons = panel.locator('[role="tabpanel"] button')
  const total = await buttons.count()
  for (let i = 0; i < Math.min(total, 40); i++) {
    await openTab(name)
    const b = buttons.nth(i)
    if (!(await b.isVisible().catch(() => false))) continue
    const label = ((await b.getAttribute('aria-label')) ?? (await b.textContent()) ?? '').trim()
    if (!/add|\+|new|source|version|how/i.test(label) || /delete|remove|undo|stop/i.test(label)) continue
    await b.click({ timeout: 1000 }).catch(() => {})
    await page.waitForTimeout(150)
    await check(page, `person-${name}-${label.slice(0, 24)}`)
    await page.keyboard.press('Escape')
  }
}
await openTab('Details')

// The biography opens with its words, and the demo's mention and quote are English.
await openTab('Biography')
await panel.getByText('Born in Portland').waitFor({ timeout: 20000 })
await check(page, 'person-Biography-page')

// Narrow, for the same screens.
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
ok('nothing sideways at 1440', await overflow() <= 0)
await page.setViewportSize({ width: 375, height: 812 })
await page.waitForTimeout(400)
ok('nothing sideways at 375', await overflow() <= 0, String(await overflow()))
await check(page, 'narrow-person')
await panel.getByRole('tab', { name: 'Details' }).click({ timeout: 3000 }).catch(() => {})
await page.waitForTimeout(300)
await check(page, 'narrow-details')
await page.setViewportSize({ width: 1440, height: 900 })
await page.keyboard.press('Escape')

// The bars, and every button with a name: each opens a panel, a menu or a list.
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
// Hiding the bars would leave nothing to press after it.
const bars = await page.locator('button[aria-label]').evaluateAll((all) => [...new Set(all.map((b) => b.getAttribute('aria-label')).filter((l) => !/(Hide|Show) panels/.test(l)))])
for (const name of bars) {
  if (/delete|remove|undo|log out|sign out/i.test(name)) continue
  const b = page.locator(`button[aria-label=${JSON.stringify(name)}]`).first()
  if (!(await b.isVisible().catch(() => false))) continue
  await b.click({ timeout: 1500 }).catch(() => {})
  // Panels load on first opening, so wait for the network and for what they draw.
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(900)
  await check(page, `open-${name}`)
  // Its own sections, which load when opened.
  for (const label of ['To check', 'Similar']) {
    const inner = page.locator('button, [role="tab"]').filter({ hasText: new RegExp(`^${label}`) }).first()
    if (!(await inner.isVisible().catch(() => false))) continue
    await inner.click({ timeout: 800 }).catch(() => {})
    await page.waitForTimeout(900)
    await check(page, `open-${name}-${label}`)
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

// Settings, section by section.
await page.keyboard.press('Escape')
const settings = page.getByRole('button', { name: /^Settings/ }).first()
if (await settings.isVisible().catch(() => false)) {
  await settings.click()
  const dialog = page.getByRole('dialog').first()
  await dialog.waitFor()
  for (const name of ['Getting started', 'My account', 'Users and access', 'General settings', 'Ways to sign in', 'AI', 'Assistant', 'Speech recognition', 'Face recognition', 'MCP server and access tokens', 'Data and backups']) {
    // On a narrow screen a section takes the whole dialog, and the list is one step back.
    const back = dialog.getByRole('button', { name: 'Settings', exact: true })
    if (await back.isVisible().catch(() => false)) { await back.click(); await page.waitForTimeout(100) }
    const b = dialog.getByRole('button', { name, exact: true }).first()
    if (!(await b.isVisible().catch(() => false))) { console.log(`  no settings section "${name}"`); continue }
    await b.click()
    await page.waitForTimeout(200)
    await check(page, `settings-${name}`)
    for (const inner of await dialog.locator('summary, button[aria-expanded="false"]:not([role=combobox])').all()) {
      await inner.click({ timeout: 800 }).catch(() => {})
    }
    await check(page, `settings-${name}-open`)
  }
  await page.keyboard.press('Escape')
}

// The language can change inside the app, both ways, and everything follows.
const language = async (value, word) => {
  // Settings stay open after a switch: close them first.
  for (let i = 0; i < 2 && await page.locator('[role=dialog]').count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200) }
  await page.getByRole('button', { name: /^(Settings|Настройки)/ }).first().click()
  const d = page.getByRole('dialog').first()
  // The interface language is on My account; the archive's own language is under General settings.
  await d.getByRole('button', { name: /^(My account|Мой аккаунт)$/ }).click()
  await d.getByRole('combobox', { name: /^(Interface language|Язык интерфейса)$/ }).click()
  await page.getByRole('option', { name: value === 'ru' ? 'Русский' : 'English' }).click()
  await page.waitForLoadState('load')
  // The bar's button, not the way back inside the open settings, which is named the same.
  await page.locator(`button[aria-label="${word}"]`).first().waitFor({ timeout: 15000 })
  await page.waitForFunction((l) => document.documentElement.lang === l, value)
  ok(`switches to ${value}`, true)
}
await language('ru', 'Настройки')
if (SHOTS) await page.screenshot({ path: `${SHOTS}/switched-ru.png` })
await language('en', 'Settings')

// A signed-out guest gets the browser's language (cookie, then browser, then archive), so a ru-RU guest reads Russian
// and an en-US guest reads English. The sweep for stray Russian runs in the en-US context.
for (const [locale, lang] of [['ru-RU', 'ru'], ['en-US', 'en']]) {
  const g = await br.newContext({ locale })
  const p = await g.newPage()
  await p.goto(`${B}/login`)
  await p.waitForLoadState('networkidle')
  ok(`the sign-in page follows the browser language (${locale})`, await p.evaluate(() => document.documentElement.lang) === lang)
  if (locale === 'en-US') {
    await check(p, 'login')
    await p.goto(`${B}/share/nope`)
    await check(p, 'share-bad-link')
    await p.goto(`${B}/invite/nope`)
    await check(p, 'invite-bad-link')
  }
  await g.close()
}

ok('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
// The languages' own names on the first screen (Ukrainian is a draft, so its picker label carries "beta").
for (const name of ['Русский', 'Українська · beta']) seen.delete(name)
ok('no Russian on any screen', seen.size === 0, `${seen.size} found`)
for (const [text, where] of seen) console.log(`  [${where}] ${text}`)
await br.close()
if (created) sh('docker rm -fv fb-en')
if (fails.length) console.log('FAILED:', fails.join(', '))
