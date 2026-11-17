// Asking a relative for a story from the person's own card: the person is already the subject, the link comes out ready
// to copy or share, what it brings back waits on the card with the teller's name and is accepted there, and a reader
// never sees any of it. Phone and laptop sizes.
import { browser, finish, ok, open, O, shot, sleep, SIZES } from './lib.mjs'

// The shortest thing that is recognised as sound: an Ogg page header.
const SOUND = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(200)])
const br = await browser()
/** A card the bars do not cover, found by what is under its middle. */
const openCard = async (page) => {
  await page.locator('.pcard').first().waitFor({ timeout: 60000 })
  await sleep(1200)
  const at = await page.evaluate(() => {
    for (const c of document.querySelectorAll('.pcard')) {
      const r = c.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2
      if (x > 0 && y > 0 && x < innerWidth && y < innerHeight && c.contains(document.elementFromPoint(x, y))) return { x, y }
    }
  })
  await page.mouse.click(at.x, at.y)
}

for (const [size, view] of [['phone-375', SIZES['phone-375']], ['desktop-1440', SIZES['desktop-1440']]]) {
  const { page, ctx, errors } = await open(br, view)
  const teller = `Aunt ${size}`
  await page.goto(O + '/')
  await openCard(page)
  await page.getByRole('tab', { name: 'Stories' }).click()
  const ask = page.getByRole('button', { name: 'Ask to tell by a link' })
  ok(`${size}: the stories tab offers to ask by a link`, await ask.isVisible())
  await ask.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder('For example, Grandma Nina').fill(teller)
  await dialog.getByRole('button', { name: 'Where were you born, and what was the house like?' }).click().catch(() => {})
  ok(`${size}: the person is already filled in`, /Who the story is about:/.test(await dialog.innerText()))
  await shot(page, `story-ask-form-${size}`)
  await dialog.getByRole('button', { name: 'Create a story link' }).click()
  const link = await dialog.locator('code').innerText()
  ok(`${size}: a link comes out`, /\/tell\/[\w-]{20,}$/.test(link), link)
  ok(`${size}: with a Copy button`, await dialog.getByRole('button', { name: 'Copy' }).isVisible())
  ok(`${size}: and no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await shot(page, `story-ask-link-${size}`)
  await dialog.getByRole('button', { name: 'Done' }).click()
  const wait = page.getByRole('region', { name: 'Waiting for a story' })
  ok(`${size}: the card says who it waits for, and until when`, new RegExp(`Waiting for a story from ${teller} · link valid until`).test(await wait.innerText()))
  ok(`${size}: and says the link cannot be shown again`, /cannot be shown a second time/.test(await wait.innerText()))
  await shot(page, `story-ask-waiting-${size}`)

  // The relative sends a recording through the link, with no account.
  const token = link.split('/tell/')[1]
  const sent = await fetch(`${O}/api/tell/${token}`, { method: 'POST', headers: { origin: O }, body: (() => { const f = new FormData(); f.set('audio', new File([SOUND], 'voice.ogg', { type: 'audio/ogg' })); return f })() })
  ok(`${size}: the relative's recording is taken`, sent.ok, String(sent.status))
  // The card is still open: the live channel brings the recording in without a reload.
  const got = page.getByRole('region', { name: 'Waiting for a story' })
  await got.getByText('waiting for review').waitFor({ timeout: 15000 }).catch(() => {})
  ok(`${size}: it waits for review with the teller's name`, new RegExp(`${teller}: sent a recording`).test(await got.innerText()) && /waiting for review/.test(await got.innerText()))
  await shot(page, `story-ask-review-${size}`)
  await got.getByRole('button', { name: 'Accept' }).click()
  await page.getByText(`As told by: ${teller}`).first().waitFor({ timeout: 10000 })
  ok(`${size}: accepted in place, the story shows on the card`, true)
  ok(`${size}: no errors on the page`, errors.length === 0, errors.join('; '))
  await ctx.close()
}

// A reader is not offered it, and the server refuses.
const reader = await fetch(`${O}/api/v1/story-requests`, { headers: { origin: O } })
ok('without a session the list is refused', reader.status === 401 || reader.status === 403, String(reader.status))
await br.close()
finish()
