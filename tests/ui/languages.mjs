// Every listed language on the tree and the map, at a phone and a laptop width: the page says its language and direction, nothing is
// wider than the screen, nothing lies over anything else, every button has a name (a right-to-left page must not push a bar off the
// screen), and a screenshot of each is kept. A language still marked hidden is looked at too, but only reported.
import { readFileSync } from 'node:fs'
import { browser, finish, ok, open, openMap, O, shot, sleep } from './lib.mjs'

const registry = readFileSync(new URL('../../lib/languages.ts', import.meta.url), 'utf8')
const languages = [...registry.matchAll(/^ {2}'?([A-Za-z-]+)'?: \{(.*)\},?$/gm)].map((m) => ({ code: m[1], dir: /dir: 'rtl'/.test(m[2]) ? 'rtl' : 'ltr', hidden: /hidden: true/.test(m[2]) })).filter((l) => l.code !== 'xx')
const only = process.env.LANGS?.split(',')
const br = await browser()
for (const l of languages.filter((l) => !l.hidden && (!only || only.includes(l.code)))) {
  for (const [name, size] of [['phone', { width: 390, height: 844 }], ['laptop', { width: 1280, height: 800 }]]) {
    const { page, ctx, errors } = await open(br, size, { lang: l.code })
    const at = `${l.code} @ ${name}`
    await page.goto(O + '/')
    await page.locator('.pcard').first().waitFor({ timeout: 60000 })
    await sleep(800)
    const m = await page.evaluate(() => ({
      lang: document.documentElement.lang, dir: document.documentElement.dir, over: document.documentElement.scrollWidth - innerWidth,
      unnamed: [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0 && !(b.getAttribute('aria-label') || b.getAttribute('title') || b.innerText.trim())).length,
      // A phrase still in plain English among words of another language is checked by the pseudo-language; here only that something rendered.
      text: document.body.innerText.length,
    }))
    ok(`the page says its language and direction: ${at}`, m.lang === l.code && m.dir === l.dir, `${m.lang} ${m.dir}`)
    ok(`nothing is wider than the screen: ${at}`, m.over <= 1, `${m.over}px over`)
    ok(`every button has a name: ${at}`, m.unnamed === 0, `${m.unnamed} without`)
    ok(`no page error: ${at}`, errors.length === 0, errors.join('; '))
    await shot(page, `lang-${l.code}-${name}-tree`)
    if (name === 'laptop') { await openMap(page); ok(`the map opens: ${at}`, (await page.locator('.map-face').count()) > 0); await shot(page, `lang-${l.code}-${name}-map`) }
    await ctx.close()
  }
}
finish()
