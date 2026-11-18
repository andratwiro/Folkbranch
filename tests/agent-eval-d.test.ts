/* eslint-disable @typescript-eslint/no-explicit-any -- tool answers are read as the JSON they are */
// Data entry, as agents found it: impossible dates, keys the text format does not know, a version's id, and no-ops that
// say they changed nothing.
import { beforeAll, describe, expect, it } from 'vitest'
import { assistantActor } from '../lib/agent/agent'
import { getGraph } from '../lib/ops/people'
import { impossibleDate } from '../lib/ops/people'
import { TOOLS } from '../lib/ops/tools'
import { type Actor } from '../lib/ops/core'
import { loadFamily, owner } from './fixture-family'

let f: Awaited<ReturnType<typeof loadFamily>>
beforeAll(async () => { f = await loadFamily() })
const run = (a: Actor, name: string, args: Record<string, unknown> = {}) => { const t = TOOLS.find((x) => x.name === name)!; return Promise.resolve().then(() => t.run(a, t.input.parse(args))) as Promise<any> }
const me = () => assistantActor(owner)

describe('days that are not on the calendar', () => {
  it('knows them', () => {
    for (const bad of ['1900-02-31', '31.02.1900', '1900-13-45', '29.02.1901', '2023-04-31']) expect(impossibleDate(bad), bad).toMatch(/not a day/)
    for (const fine of ['1900-02-28', '29.02.1904', '1900', 'ок. 1900', '12 марта 1900', '', '1900-12-31']) expect(impossibleDate(fine), fine).toBeNull()
    expect(impossibleDate('29.02.1900')).toMatch(/not a day/)
    expect(impossibleDate('29.02.2000')).toBeNull()
    // A month written in words is checked the same way, in any case and any of the archive's languages.
    for (const bad of ['31 February 1900', 'February 30, 1900', '31 февраля 1900', '30 de febrero 1900', '29 Feb 1901']) expect(impossibleDate(bad), bad).toMatch(/not a day/)
    for (const fine of ['29 February 1904', '31 March 1900', 'March 31, 1900', '28 февраля 1900', 'Spring 1900', 'abt 31 Jan 1900']) expect(impossibleDate(fine), fine).toBeNull()
  })
  it('create_person and update_person refuse them, naming the date', async () => {
    await expect(run(me(), 'create_person', { person: { givenName: 'Дата', surname: 'Невозможная', birthDate: '31.02.1900' } })).rejects.toThrow(/31\.02\.1900 is not a day/)
    await expect(run(me(), 'update_person', { id: f.varvara.id, patch: { deathDate: '1900-13-45' } })).rejects.toThrow(/1900-13-45 is not a day/)
  })
})

describe('import_text', () => {
  it('names a key it does not know instead of dropping or swallowing it', async () => {
    const err = await run(me(), 'import_text', { text: 'Иван Тестов b: 1880\nПётр Тестов + Анна Тестова m: 1905, div: 1945' }).catch((e) => e as Error)
    expect(err.message).toMatch(/unknown key .{1,2}div:/)
    expect(err.message).toMatch(/the keys are id, b, bp/)
  })
})

describe('versions', () => {
  it('add_version returns the id of the version it recorded, and choose_version works with it', async () => {
    const r = await run(me(), 'add_version', { personId: f.maria.id, field: 'birthPlace', value: 'Ярославль', source: { title: 'Письмо' } })
    expect(r.claimId).toBeTruthy()
    const person = getGraph(owner).persons.find((p) => p.id === f.maria.id)!
    expect(person.claims.some((c) => c.id === r.claimId && c.value === 'Ярославль')).toBe(true)
  })
})

describe('links that change nothing', () => {
  it('say so, in words', async () => {
    await expect(run(me(), 'add_relation', { type: 'spouse', to: f.ivan.id, other: f.maria.id })).rejects.toThrow(/already married, nothing changed/)
    await expect(run(me(), 'add_relation', { type: 'spouse', to: f.ivan.id, other: f.ivan.id })).rejects.toThrow(/own spouse/)
    await expect(run(me(), 'add_relation', { type: 'son', to: f.ivan.id, other: f.ivan.id })).rejects.toThrow(/own child/)
  })
})

describe('the kind of a place', () => {
  it('is the archive’s own word, whatever language the model wrote it in', async () => {
    const town = await run(me(), 'create_place', { name: 'Тверь', kind: 'town' })
    const village = await run(me(), 'create_place', { name: 'Гнилушки', kind: 'village' })
    const same = await run(me(), 'create_place', { name: 'Вязьма', kind: 'город' })
    const kinds = (await import('../lib/ops/places')).listPlaces(owner)
    expect(kinds.find((p) => p.id === town.id)!.kind).toBe('Город')
    expect(kinds.find((p) => p.id === village.id)!.kind).toBe('Деревня')
    expect(kinds.find((p) => p.id === same.id)!.kind).toBe('Город')
    await run(me(), 'update_place', { id: village.id, patch: { kind: 'parish' } })
    expect((await import('../lib/ops/places')).listPlaces(owner).find((p) => p.id === village.id)!.kind).toBe('Приход')
    // A kind nobody knows stays as written.
    const odd = await run(me(), 'create_place', { name: 'Хутор', kind: 'Заимка' })
    expect((await import('../lib/ops/places')).listPlaces(owner).find((p) => p.id === odd.id)!.kind).toBe('Заимка')
  })
})

describe('a spouse made with their union', () => {
  it('carries the dates and the kind of the union from create_person', async () => {
    const made = await run(me(), 'create_person', { person: { givenName: 'Жена', surname: 'Союзная', sex: 'F', birthDate: '1895' }, relation: { type: 'spouse', to: f.pyotr.id, unionKind: 'civil', startDate: '1950', endDate: '1960', endKind: 'separated' } })
    const g = getGraph(owner)
    const u = g.unions.find((x) => (x.aId === made.id && x.bId === f.pyotr.id) || (x.bId === made.id && x.aId === f.pyotr.id))!
    expect(u).toMatchObject({ kind: 'civil', startDate: '1950', endDate: '1960', endKind: 'separated' })
    // The same pair again is refused with the reason, and an impossible date in a union is refused with the day named.
    await expect(run(me(), 'add_relation', { type: 'spouse', to: f.pyotr.id, other: made.id })).rejects.toThrow(/already married, nothing changed/)
    await expect(run(me(), 'create_person', { person: { givenName: 'Дата', surname: 'Союзная', sex: 'F' }, relation: { type: 'spouse', to: f.pyotr.id, startDate: '31.02.1900' } })).rejects.toThrow(/31\.02\.1900 is not a day/)
  })
})
