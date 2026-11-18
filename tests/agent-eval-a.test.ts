// Privacy and safety found by agents driving the app over MCP: a hidden person answers like a missing one, hidden
// counts and placeholder records are gone for readers, text cannot hide direction marks, history names the token, and
// a typo in a filter is an error rather than the whole archive.
import { beforeAll, describe, expect, it } from 'vitest'
import { assistantActor } from '../lib/agent/agent'
import { getDb, schema } from '../lib/db'
import { type Actor } from '../lib/ops/core'
import { TOOLS } from '../lib/ops/tools'
import { editor, loadFamily, owner, reader } from './fixture-family'

let f: Awaited<ReturnType<typeof loadFamily>>
beforeAll(async () => { f = await loadFamily() })

const token: Actor = { userId: 'token:abc123', name: 'Исследователь', role: 'editor', personId: null, tokenId: 'abc123', review: false }
const run = (a: Actor, name: string, args: Record<string, unknown> = {}) => { const t = TOOLS.find((x) => x.name === name)!; return Promise.resolve().then(() => t.run(a, t.input.parse(args))) as Promise<any> }

describe('hidden people', () => {
  it('a reader gets the same answer for a hidden id and for one that does not exist, everywhere it matters', async () => {
    const hidden = await run(reader, 'get_people', { ids: [f.living.id] })
    const nobody = await run(reader, 'get_people', { ids: ['nobody-here'] })
    expect(hidden).toEqual([{ id: f.living.id, missing: true }])
    expect(nobody).toEqual([{ id: 'nobody-here', missing: true }])
    await expect(run(reader, 'get_person', { id: f.living.id })).rejects.toThrow(`person ${f.living.id} not found`)
    await expect(run(reader, 'get_person', { id: 'nobody-here' })).rejects.toThrow('person nobody-here not found')
  })

  it('no total, relative count or relative list a reader gets includes a hidden person or says how many there are', async () => {
    const overview = await run(reader, 'get_overview')
    const all = await run(owner, 'get_overview')
    expect(overview.people.total).toBe(all.people.total - 1)
    expect(JSON.stringify(overview)).not.toContain('hidden')
    const rel = await run(reader, 'get_relatives', { id: f.pyotr.id })
    expect(rel.some((r: any) => r.hidden || r.id === f.living.id)).toBe(false)
    const count = await run(reader, 'count_relatives', { id: f.pyotr.id })
    expect(JSON.stringify(count)).not.toMatch(/hidden/i)
  })

  it('a reader’s GEDCOM has no record, not even an unnamed one, for a person they may not see', async () => {
    const text = await run(reader, 'export_gedcom', { hideLiving: false })
    expect(text).not.toContain('Живинская')
    expect(text).not.toMatch(/Living/i)
    expect((text.match(/^0 @\w+@ INDI/gm) ?? []).length).toBe(5)
    // An editor still gets the family, with the living as the file always wrote them.
    expect(await run(editor, 'export_gedcom', { hideLiving: true })).toMatch(/INDI/)
  })
})

describe('text that hides in text', () => {
  it('direction marks and control codes are removed from every text a write carries', async () => {
    const made = await run(assistantActor(owner), 'create_person', { person: { givenName: 'Ива‮н', surname: 'Тест​ов\u0007', birthPlace: 'Тул⁦а⁩' } })
    const row = getDb().select().from(schema.persons).all().find((p) => p.id === made.id)!
    expect(row.givenName).toBe('Иван')
    expect(row.surname).toBe('Тестов')
    expect(row.birthPlace).toBe('Тула')
    await run(assistantActor(owner), 'update_person', { id: made.id, patch: { deathPlace: 'Моск‮ва' } })
    expect(getDb().select().from(schema.persons).all().find((p) => p.id === made.id)!.deathPlace).toBe('Москва')
    const page = await run(assistantActor(owner), 'create_page', { personId: made.id, title: 'Жизнь‮', markdown: 'Текст‮' })
    expect(getDb().select().from(schema.pages).all().find((p) => p.id === page.id)!.title).toBe('Жизнь')
    // A joiner some scripts need stays.
    const persian = await run(assistantActor(owner), 'create_person', { person: { givenName: 'می‌خواهم', surname: 'نمونه' } })
    expect(getDb().select().from(schema.persons).all().find((p) => p.id === persian.id)!.givenName).toBe('می‌خواهم'.replace('‌', '‌'))
  })

  it('a name made only of such characters is no name', async () => {
    await expect(run(assistantActor(owner), 'create_person', { person: { givenName: '‮​', surname: '⁦' } })).rejects.toThrow(/name/)
    await expect(run(assistantActor(owner), 'update_person', { id: f.varvara.id, patch: { givenName: '‮', surname: '​' } })).rejects.toThrow(/name/)
  })
})

describe('history', () => {
  it('names the token and carries no internal id', async () => {
    await run(token, 'create_person', { person: { givenName: 'Записан', surname: 'Токеновский' } })
    const entries = await run(token, 'get_history', { limit: 5 })
    const mine = entries.find((e: any) => e.actorName === 'Исследователь')
    expect(mine).toBeTruthy()
    expect(JSON.stringify(entries)).not.toContain('token:')
    expect(mine).not.toHaveProperty('userId')
  })
})

describe('a typo in a filter', () => {
  it('is refused by name, so it cannot return everyone', async () => {
    await expect(run(reader, 'query_people', { surnme: 'Соколов' })).rejects.toThrow(/surnme/)
    await expect(run(reader, 'query_people', { lastName: 'Соколов' })).rejects.toThrow(/lastName/)
    await expect(run(assistantActor(owner), 'update_person', { id: f.varvara.id, patch: { birthPlac: 'Тула' } })).rejects.toThrow(/birthPlac/)
    await expect(run(assistantActor(owner), 'create_person', { person: { givenName: 'Х', surnam: 'Y' } })).rejects.toThrow(/surnam/)
  })

  it('says when a range is empty, instead of silently returning nobody', async () => {
    const r = await run(reader, 'query_people', { bornFrom: 1950, bornTo: 1900 })
    expect(r.total).toBe(0)
    expect(r.notes.join(' ')).toMatch(/bornFrom is after bornTo/)
    expect((await run(reader, 'query_people', { bornFrom: 1800, bornTo: 1900 })).notes).toBeUndefined()
  })
})
