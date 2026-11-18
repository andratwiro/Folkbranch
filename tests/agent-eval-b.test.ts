/* eslint-disable @typescript-eslint/no-explicit-any -- tool answers are read as the JSON they are */
// Bulk work found wanting by agents: honest words about review, a token the owner may trust with bulk edits, a draft
// whose people can be read, batch delete and batch link as one change with one undo, and filters that need no client scan.
import { beforeAll, describe, expect, it } from 'vitest'
import { assistantActor } from '../lib/agent/agent'
import { getDb, schema } from '../lib/db'
import { OpError, type Actor } from '../lib/ops/core'
import { createPerson, getGraph } from '../lib/ops/people'
import { actorFromToken, createToken, setTokenTrustBulk } from '../lib/ops/tokens'
import { TOOLS } from '../lib/ops/tools'
import { editor, loadFamily, owner } from './fixture-family'

let f: Awaited<ReturnType<typeof loadFamily>>
beforeAll(async () => { f = await loadFamily() })

const run = (a: Actor, name: string, args: Record<string, unknown> = {}) => { const t = TOOLS.find((x) => x.name === name)!; return Promise.resolve().then(() => t.run(a, t.input.parse(args))) as Promise<any> }
const made = (extra: Partial<{ review: boolean; trustBulk: boolean; role: 'editor' | 'reader' }> = {}) => actorFromToken(createToken(owner, { name: 'Агент', role: extra.role ?? 'editor', review: extra.review ?? false, trustBulk: extra.trustBulk }).token)!
const history = () => getDb().select().from(schema.history).all()
const person = (given: string, extra: Record<string, unknown> = {}) => createPerson(owner, { givenName: given, surname: 'Массовый', ...extra })

describe('what review means for a token', () => {
  it('the overview names the tools that wait for a person, and the draft id comes back', async () => {
    const t = made()
    const o = await run(t, 'get_overview')
    expect(o.you.writes).toMatch(/update_people/)
    expect(o.you.writes).toMatch(/delete_people/)
    expect(o.you.writes).toMatch(/import_text/)
    const r = await run(t, 'add_fact_to_people', { personIds: [f.ivan.id, f.maria.id], fact: { kind: 'Служба', date: '1910' } })
    expect(r).toMatchObject({ status: 'pending_review' })
    expect(r.proposalId).toBeTruthy()
  })

  it('a token the owner trusts applies its bulk edits at once, but imports still wait', async () => {
    const t = made({ trustBulk: true })
    expect(t.trustBulk).toBe(true)
    expect((await run(t, 'get_overview')).you.writes).not.toMatch(/update_people/)
    const a = person('Первый'), b = person('Второй')
    const done = await run(t, 'update_people', { changes: [{ id: a.id, patch: { birthPlace: 'Тула' } }, { id: b.id, patch: { birthPlace: 'Тула' } }] })
    expect(done.status).toBeUndefined()
    expect(getGraph(owner).persons.find((p) => p.id === a.id)!.birthPlace).toBe('Тула')
    expect(await run(t, 'import_text', { text: 'Из Текста b: 1900' })).toMatchObject({ status: 'pending_review' })
  })

  it('only the owner can trust a token, and only one whose edits already apply at once', () => {
    const review = actorFromToken(createToken(owner, { name: 'Проверяемый', role: 'editor', review: true }).token)!
    expect(() => setTokenTrustBulk(owner, review.tokenId!, true)).toThrow(OpError)
    expect(() => setTokenTrustBulk(editor, made().tokenId!, true)).toThrow(/forbidden/)
    const direct = made()
    setTokenTrustBulk(owner, direct.tokenId!, true)
    expect(actorFromToken(createToken(owner, { name: 'x', role: 'editor', review: true, trustBulk: true }).token)!.trustBulk).toBe(false)
  })
})

describe('a draft can be read before it is accepted', () => {
  it('lists who a GEDCOM draft would bring in', async () => {
    const t = made()
    await run(t, 'import_gedcom', { text: '0 HEAD\n0 @I1@ INDI\n1 NAME Анна /Черновая/\n0 @I2@ INDI\n1 NAME Борис /Черновой/\n0 TRLR\n' })
    const mine = await run(t, 'my_proposals')
    const gedcom = mine.flatMap((p: any) => p.ops).find((o: any) => o.op === 'import_gedcom')
    expect(gedcom.details).toEqual(['Анна Черновая', 'Борис Черновой'])
  })
})

describe('many at once', () => {
  it('delete_people is one change, one undo, and names every id it did not find', async () => {
    const ids = [person('Лишний1'), person('Лишний2'), person('Лишний3')].map((p) => p.id)
    const before = history().length
    await run(assistantActor(owner), 'delete_people', { ids })
    expect(history().length).toBe(before + 1)
    expect(getGraph(owner).persons.some((p) => ids.includes(p.id))).toBe(false)
    const entry = history().at(-1)!
    await run(assistantActor(owner), 'undo', { historyId: entry.id })
    expect(getGraph(owner).persons.filter((p) => ids.includes(p.id))).toHaveLength(3)
    await expect(run(assistantActor(owner), 'delete_people', { ids: [ids[0], 'nope', 'nada'] })).rejects.toThrow(/nope, nada/)
    expect(getGraph(owner).persons.filter((p) => ids.includes(p.id))).toHaveLength(3)
  })

  it('link_people picks son or daughter by sex, in one change, and refuses before linking anything when a sex is unknown', async () => {
    const dad = person('Отец', { sex: 'M' }), mum = person('Мать', { sex: 'F' })
    const kids = [person('Сын', { sex: 'M', birthDate: '2000' }), person('Дочь', { sex: 'F', birthDate: '2002' })]
    const before = history().length
    await run(assistantActor(owner), 'link_people', { parentId: dad.id, otherParentId: mum.id, childIds: kids.map((k) => k.id) })
    expect(history().length).toBe(before + 1)
    const g = getGraph(owner)
    for (const k of kids) expect(g.parentChild.filter((l) => l.childId === k.id).map((l) => l.parentId).sort()).toEqual([dad.id, mum.id].sort())
    const stray = person('Неизвестный'), ok = person('Ещё', { sex: 'M', birthDate: '2004' })
    await expect(run(assistantActor(owner), 'link_people', { parentId: dad.id, childIds: [ok.id, stray.id] })).rejects.toThrow(/Неизвестный/)
    expect(getGraph(owner).parentChild.some((l) => l.childId === ok.id)).toBe(false)
  })

  it('update_people reports every wrong entry at once and changes nothing', async () => {
    const a = person('Ошибка1'), b = person('Ошибка2')
    const err = await run(assistantActor(owner), 'update_people', { changes: [{ id: a.id, patch: { birthPlac: 'X' } }, { id: 'nobody', patch: { birthPlace: 'Y' } }, { id: b.id, patch: { birthPlace: 'Z' } }] }).catch((e) => e as Error)
    expect(err.message).toMatch(/2 of 3/)
    expect(err.message).toContain(a.id)
    expect(err.message).toContain('nobody')
    expect(getGraph(owner).persons.find((p) => p.id === b.id)!.birthPlace).toBe('')
  })
})

describe('questions that need no scan by the client', () => {
  it('query_people filters by surname, by birth or death place on its own, and by what is missing', async () => {
    person('Пустой', { sex: 'M' })
    expect((await run(editor, 'query_people', { surname: 'Соколов' })).people.every((p: any) => p.name.includes('Соколов'))).toBe(true)
    const born = await run(editor, 'query_people', { birthPlace: 'Тула' })
    const either = await run(editor, 'query_people', { place: 'Тула' })
    expect(born.total).toBeLessThanOrEqual(either.total)
    expect((await run(editor, 'query_people', { birthPlace: 'Москва' })).people.map((p: any) => p.name)).toEqual(['Пётр Соколов'])
    expect((await run(editor, 'query_people', { deathPlace: 'Москва' })).total).toBe(0)
    const gaps = await run(editor, 'query_people', { missing: ['birthPlace', 'parents'], surname: 'Массовый', limit: 500 })
    expect(gaps.total).toBeGreaterThan(0)
    expect(gaps.people.every((p: any) => p.name.includes('Массовый'))).toBe(true)
  })

  it('find_gaps can be asked for one kind of gap, in an order, and up to 500', async () => {
    const parents = await run(editor, 'find_gaps', { field: 'parents', limit: 500, sort: 'name' })
    expect(parents.length).toBeGreaterThan(1)
    expect(parents.every((r: any) => r.missing.includes('parents'))).toBe(true)
    const names = parents.map((r: any) => `${r.surname ?? ''}${r.name}`)
    expect(names.length).toBe(parents.length)
    await expect(run(editor, 'find_gaps', { feild: 'parents' })).rejects.toThrow(/feild/)
  })
})
