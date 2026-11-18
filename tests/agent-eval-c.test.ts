// Search and answer quality found by agents: a typo still finds a name, one definition of a relative across the three
// tools that say who is one, a text export that leaves the living out like the GEDCOM one, readable history, and the
// questions that were left to the client to compute.
import { beforeAll, describe, expect, it } from 'vitest'
import { assistantActor } from '../lib/agent/agent'
import { linkPeople, createPerson, updatePerson } from '../lib/ops/people'
import { TOOLS } from '../lib/ops/tools'
import { type Actor } from '../lib/ops/core'
import { editor, loadFamily, owner, reader } from './fixture-family'

let f: Awaited<ReturnType<typeof loadFamily>>
beforeAll(async () => { f = await loadFamily() })
const run = (a: Actor, name: string, args: Record<string, unknown> = {}) => { const t = TOOLS.find((x) => x.name === name)!; return Promise.resolve().then(() => t.run(a, t.input.parse(args))) as Promise<any> }

describe('a name with a typo', () => {
  it('search_people finds it, as its description says', async () => {
    for (const typo of ['Соколав', 'Соклов', 'Сококолов', 'Соколлов']) expect((await run(reader, 'search_people', { query: typo })).map((p: any) => p.name), typo).toContain('Николай Соколов')
    expect(await run(reader, 'search_people', { query: 'Ксенофонт' })).toEqual([])
    // A word that is another name altogether is not forced onto a person.
    expect(await run(reader, 'search_people', { query: 'Соловьёв' })).toEqual([])
  })
})

describe('who is a relative', () => {
  it('get_relatives, count_relatives and the immediate family agree on adopted and step relatives', async () => {
    const adopted = createPerson(owner, { givenName: 'Приёмный', surname: 'Соколов', sex: 'M', birthDate: '1950' })
    linkPeople(owner, 'son', f.pyotr.id, adopted.id, null, { kind: 'adopted' })
    const stepchild = createPerson(owner, { givenName: 'Пасынок', surname: 'Чужой', sex: 'M', birthDate: '1960' })
    const partner = createPerson(owner, { givenName: 'Партнёрша', surname: 'Чужая', sex: 'F', birthDate: '1930' })
    linkPeople(owner, 'spouse', f.pyotr.id, partner.id)
    linkPeople(owner, 'son', partner.id, stepchild.id)
    const list = await run(owner, 'get_relatives', { id: f.pyotr.id })
    const count = await run(owner, 'count_relatives', { id: f.pyotr.id })
    // The same people, counted the same way.
    expect(list.length).toBe(count.total)
    const byKind = (k: string) => list.filter((r: any) => r.kind === k).length
    for (const k of ['blood', 'adopted', 'step', 'spouse', 'marriage']) expect(byKind(k), k).toBe(count.byKind[k])
    // "blood" means the same thing in all of them: an adopted child is not blood.
    expect(list.find((r: any) => r.id === adopted.id)).toMatchObject({ kind: 'adopted', blood: false })
    expect(list.find((r: any) => r.id === stepchild.id)).toMatchObject({ kind: 'step', blood: false })
    const immediate = count.immediateFamily.map((r: any) => r.id)
    expect(immediate).toContain(adopted.id)
    expect(immediate).toContain(stepchild.id)
    expect(immediate).toContain(partner.id)
  })

  it('says what a degree is', () => {
    expect(TOOLS.find((t) => t.name === 'count_relatives')!.description).toMatch(/4 first cousin, 5 first cousin once removed/)
  })
})

describe('exports and privacy', () => {
  it('export_text leaves the living out unless asked, like export_gedcom, and a reader never gets them', async () => {
    expect(await run(owner, 'export_text')).not.toContain('Живинская')
    expect(await run(owner, 'export_text', { hideLiving: false })).toContain('Живинская')
    expect(await run(reader, 'export_text', { hideLiving: false })).not.toContain('Живинская')
    expect(await run(owner, 'export_text')).toContain('Соколов')
  })
})

describe('history that can be read', () => {
  it('a new link names both ends and which is the parent, and a sex change shows its values', async () => {
    const a = createPerson(owner, { givenName: 'Родитель', surname: 'Историков', sex: 'M', birthDate: '1900' }), b = createPerson(owner, { givenName: 'Ребёнок', surname: 'Историков', sex: 'M', birthDate: '1930' })
    linkPeople(owner, 'son', a.id, b.id)
    const entry = (await run(owner, 'get_history', { limit: 3 })).find((e: any) => e.details?.some((d: any) => d.label.toLowerCase().includes('связ') || d.label.toLowerCase().includes('relation')))
    const line = entry.details[0].after as string
    expect(line.indexOf('Родитель')).toBeLessThan(line.indexOf('Ребёнок'))
    expect(line).toMatch(/→/)
    updatePerson(owner, a.id, { sex: 'F' })
    const sex = (await run(owner, 'get_history', { limit: 3 })).flatMap((e: any) => e.details ?? []).find((d: any) => d.before === 'M' && d.after === 'F')
    expect(sex).toBeTruthy()
  })
})

describe('questions that were left to the client', () => {
  it('statistics by decade: how many, the average age at death, marriages', async () => {
    const r = await run(editor, 'get_statistics', { by: 'decade' })
    const sixties = r.groups.find((g: any) => g.group === '1860s')
    expect(sixties).toMatchObject({ people: 2, died: 2, averageAgeAtDeath: 72.5, ageKnownFor: 2 })
    expect(r.groups.map((g: any) => g.group)).toEqual([...r.groups.map((g: any) => g.group)].sort((m: string, n: string) => m.localeCompare(n, undefined, { numeric: true })))
    expect((await run(editor, 'get_statistics', { by: 'generation' })).groups.find((g: any) => g.group === '0').people).toBeGreaterThan(1)
    expect((await run(editor, 'get_statistics', { by: 'place' })).groups.find((g: any) => g.group === 'Тула').people).toBe(3)
  })

  it('statistics never count the people a reader may not see', async () => {
    const all = await run(owner, 'get_statistics', { by: 'sex' })
    const seen = await run(reader, 'get_statistics', { by: 'sex' })
    expect(seen.people).toBeLessThan(all.people)
  })

  it('who lived in the same place at the same time', async () => {
    const r = await run(editor, 'find_overlaps', { place: 'Тула' })
    expect(r[0].place).toBe('Тула')
    expect(r[0].people.map((p: any) => p.name)).toEqual(expect.arrayContaining(['Николай Соколов', 'Варвара Соколова', 'Иван Соколов']))
    expect(r[0].overlapping).toBeGreaterThanOrEqual(3)
    expect(await run(editor, 'find_overlaps', { place: 'Атлантида' })).toEqual([])
  })
})
void assistantActor
