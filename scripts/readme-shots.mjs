#!/usr/bin/env node
// Real screenshots of the app on the invented demo family, for the README, the website and GitHub's social preview.
// Nothing real is read: a built copy (pnpm build) starts on a throwaway data folder.
//   node scripts/readme-shots.mjs [outDir]       default docs/images
// Writes chart-<lang>.png, card-<lang>.png, map-<lang>.png, story-phone-<lang>.png and social-preview.png (1280x640).
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startApp, cookiesFor } from '../tests/ui/serve.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = path.resolve(process.argv[2] ?? path.join(root, 'docs/images'))
mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const br = await chromium.launch({ channel: 'chrome', headless: true })
const P = (name) => path.join(out, name)

async function session(app, size, { phone = false, lang = 'en' } = {}) {
  const ctx = await br.newContext({ viewport: size, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1, locale: lang === 'ru' ? 'ru-RU' : 'en-GB' })
  await ctx.addCookies(cookiesFor(app.B, app.cookie))
  await ctx.addInitScript(() => { try { localStorage.setItem('folkbranch-tour', '1') } catch {} })
  return { ctx, page: await ctx.newPage() }
}

for (const [i, lang] of ['en', 'ru'].entries()) {
  const app = await startApp({ port: 3930 + i, language: lang })
  try {
    const graph = await (await fetch(app.B + '/api/v1/graph', { headers: { cookie: app.cookie, origin: app.B } })).json()
    // The person with the most links stands in the middle of a family worth showing.
    const links = new Map()
    for (const l of graph.parentChild) for (const id of [l.parentId, l.childId]) links.set(id, (links.get(id) ?? 0) + 1)
    const hub = [...links].sort((a, b) => b[1] - a[1])[0][0]

    // The whole chart: a few generations, faces and names readable.
    let { ctx, page } = await session(app, { width: 1600, height: 1100 }, { lang })
    await page.goto(`${app.B}/`)
    await page.locator('img').first().waitFor({ timeout: 60000 })
    await sleep(2500)
    // The hint about moving the chart goes by itself; a picture without it is cleaner.
    await page.getByText(/wider than the screen|шире экрана/).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    await page.screenshot({ path: P(`chart-${lang}.png`) })
    // The same family with a person's card open beside it.
    await page.goto(`${app.B}/?p=${hub}`)
    await sleep(3000)
    await page.screenshot({ path: P(`card-${lang}.png`) })
    // The family on the map, at a moment with many people placed.
    await page.goto(`${app.B}/?view=map&y=1975`)
    await page.locator('.map-face').first().waitFor({ state: 'attached', timeout: 60000 })
    await sleep(3500)
    await page.screenshot({ path: P(`map-${lang}.png`) })
    await ctx.close()

    // What a relative sees on a phone when asked for a story: no account, one button.
    const made = await (await fetch(app.B + '/api/v1/story-requests', { method: 'POST', headers: { cookie: app.cookie, origin: app.B, 'content-type': 'application/json' }, body: JSON.stringify({ personId: hub, tellerName: lang === 'ru' ? 'Анна' : 'Ann', question: lang === 'ru' ? 'Расскажите, как вы познакомились с дедушкой' : 'Tell us how you met grandfather' }) })).json()
    if (made.token) {
      ;({ ctx, page } = await session(app, { width: 390, height: 844 }, { phone: true, lang }))
      await page.goto(`${app.B}/tell/${made.token}`)
      await sleep(2500)
      await page.screenshot({ path: P(`story-phone-${lang}.png`) })
      await ctx.close()
    }
  } finally { app.stop() }
}

// The social preview: one headline, a big real screen, three words. Legible at 600x300.
const uri = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`
const css = `
@font-face { font-family: Lit; src: url(${uri(path.join(root, 'public/fonts/Literata-SemiBold.ttf'), 'font/ttf')}) }
@font-face { font-family: Gol; src: url(${uri(path.join(root, 'public/fonts/GolosText-Regular.ttf'), 'font/ttf')}) }
body { margin: 0; width: 1280px; height: 640px; background: #f6f2ea; font-family: Gol, sans-serif; color: #2a2620; display: flex; overflow: hidden }
.t { width: 500px; padding: 64px 0 0 64px; box-sizing: border-box }
.logo { display: flex; align-items: center; gap: 14px; font: 600 30px Lit, serif }
h1 { font: 600 54px/1.08 Lit, serif; margin: 44px 0 20px }
p { font-size: 25px; line-height: 1.35; margin: 0; color: #5d554a }
.w { position: absolute; left: 64px; bottom: 54px; font-size: 24px; letter-spacing: .02em; color: #8a3a1c }
.s { position: absolute; left: 560px; top: 64px; width: 780px; height: 540px; border-radius: 14px 0 0 14px; overflow: hidden; box-shadow: 0 10px 40px #2a262033; border: 1px solid #d9d2c3 }
.s img { width: 780px; display: block }`
const page = await (await br.newContext({ viewport: { width: 1280, height: 640 } })).newPage()
await page.setContent(`<style>${css}</style><div class=t><div class=logo><img src="${uri(path.join(root, 'docs/brand/logo.svg'), 'image/svg+xml')}" width=44 height=44>Folkbranch</div><h1>Your family's story, together</h1><p>Family tree, photos and voice stories on your own computer or server.</p></div><div class=w>Free · Private · Open source</div><div class=s><img src="${uri(P('card-en.png'), 'image/png')}"></div>`)
await sleep(800)
await page.screenshot({ path: P('social-preview.png') })
await br.close()
for (const f of ['chart-en', 'card-en', 'map-en', 'story-phone-en', 'chart-ru', 'card-ru', 'map-ru', 'story-phone-ru', 'social-preview']) { try { console.log(f, Math.round(statSync(P(f + '.png')).size / 1024) + ' KB') } catch { console.log(f, 'missing') } }
