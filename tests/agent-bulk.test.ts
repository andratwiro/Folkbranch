// Whole sets in one call: many cards read at once, the same fact added to many people with one confirmation and one
// undo, and what a running step says it is about.
import { beforeAll, describe, expect, it } from 'vitest'
import { assistantActor, assistantTools } from '../lib/agent/agent'
import { stepDetail, stepLabel, toolLabel } from '../lib/agent/labels'
import { progressOf, subjectOf } from '../lib/agent/subject'
import { getDb, schema } from '../lib/db'
import type { Actor } from '../lib/ops/core'
import { getPersonRow } from '../lib/ops/people'
import { toolsFor } from '../lib/ops/tools'
import { editor, loadFamily, owner, reader } from './fixture-family'

let f: Awaited<ReturnType<typeof loadFamily>>
beforeAll(async () => { f = await loadFamily() })
async function run(person: Actor, name: string, args: Record<string, unknown>): Promise<any> {
  const actor = assistantActor(person)
  const def = toolsFor(actor, 'assistant').find((t) => t.name === name)!
  return def.run(actor, def.input.parse(args))
}
const facts = (id: string) => (JSON.parse(getPersonRow(id).facts as unknown as string) as { kind: string }[]).map((x) => x.kind)
const history = () => getDb().select().from(schema.history).all()

describe('get_people', () => {
  it('returns several cards trimmed, in the order asked, with the ids of their closest relatives', async () => {
    const r = await run(owner, 'get_people', { ids: [f.ivan.id, 'nobody', f.nikolai.id] })
    expect(r.map((x: any) => x.id)).toEqual([f.ivan.id, 'nobody', f.nikolai.id])
    expect(r[1]).toEqual({ id: 'nobody', missing: true })
    expect(r[0]).toMatchObject({ name: 'Иван Соколов', parentIds: [f.nikolai.id, f.varvara.id].sort(), spouseIds: [f.maria.id], childIds: [f.pyotr.id] })
    // The long parts of a card (sources, versions, pages) stay in get_person.
    expect(Object.keys(r[0])).not.toContain('sources')
    expect(Object.keys(r[0])).not.toContain('claims')
    expect(JSON.stringify(r).length).toBeLessThan(JSON.stringify(await run(owner, 'get_person', { id: f.ivan.id })).length * 3)
  })
  it('gives a reader nothing of a living person, not even a name', async () => {
    const r = await run(reader, 'get_people', { ids: [f.living.id, f.ivan.id] })
    expect(r[0]).toEqual({ id: f.living.id, hidden: true })
    expect(JSON.stringify(r)).not.toContain('Живинская')
  })
  it('reports how far a long read has got before its answer, ten cards at a time', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => [f.ivan.id, f.maria.id, f.nikolai.id][i % 3])
    const tool = assistantTools(assistantActor(owner)).get_people as unknown as { execute: (a: unknown, o: unknown) => AsyncIterable<unknown> }
    const seen: unknown[] = []
    for await (const part of tool.execute({ ids }, { toolCallId: 'x', messages: [] })) seen.push(part)
    expect(seen.slice(0, -1).map(progressOf)).toEqual([{ done: 10, total: 25 }, { done: 20, total: 25 }])
    expect(seen.at(-1)).toHaveLength(25)
  })
})

describe('add_fact_to_people', () => {
  const ids = () => [f.nikolai.id, f.varvara.id, f.ivan.id]
  const fact = { kind: 'Перепись', date: '1897', place: 'Тула' }
  it('adds one fact to each, keeping the others, as one history entry that one undo takes back', async () => {
    const had = ids().map((id) => facts(id))
    const entries = history().length
    await run(editor, 'add_fact_to_people', { personIds: ids(), fact })
    expect(history().length).toBe(entries + 1)
    ids().forEach((id, i) => expect(facts(id)).toEqual([...had[i], 'Перепись']))
    const last = (await run(editor, 'get_history', { limit: 1 }))[0]
    await run(editor, 'undo', { historyId: last.id })
    expect(ids().map(facts)).toEqual(had)
  })
  it('is always asked, once, with the people on the card', async () => {
    const def = toolsFor(assistantActor(editor), 'assistant').find((t) => t.name === 'add_fact_to_people')!
    expect(def.risk).toBe('danger')
    expect(def.describe!(assistantActor(editor), { personIds: ids(), fact })).toMatch(/Операций: 3[\s\S]*Иван Соколов/)
  })
  it('one bad id or a repeated one changes nothing', async () => {
    const had = facts(f.ivan.id)
    await expect(run(editor, 'add_fact_to_people', { personIds: [f.ivan.id, 'nobody'], fact })).rejects.toThrow(/not found/)
    await expect(run(editor, 'add_fact_to_people', { personIds: [f.ivan.id, f.ivan.id], fact })).rejects.toThrow(/twice/)
    expect(facts(f.ivan.id)).toEqual(had)
  })
  it('waits for review when a token sends it, even one allowed to write directly', async () => {
    const tokenActor: Actor = { ...editor, userId: 'u-token', tokenId: 'tok-bulk', review: false }
    const r = await run(tokenActor, 'add_fact_to_people', { personIds: [f.maria.id, f.pyotr.id], fact })
    expect(r.status).toBe('pending_review')
    expect(facts(f.maria.id)).not.toContain('Перепись')
  })
})

describe('what a running step says', () => {
  it('names the person of a single step, the people of a short one, and counts a long one', () => {
    expect(subjectOf('get_person', { id: 'a' })).toEqual({ ids: ['a'], total: 1 })
    expect(subjectOf('get_people', { ids: ['a', 'b', 'c', 'd'] })).toEqual({ ids: ['a', 'b', 'c', 'd'], total: 4 })
    expect(subjectOf('get_people', { ids: ['a', 'b', 'c', 'd'] }, { progress: { done: 2, total: 4 } })).toMatchObject({ done: 2, total: 4 })
    expect(subjectOf('add_fact', { personId: 'a', fact: { kind: 'Служба' } })).toEqual({ ids: ['a'], total: 1, what: 'Служба' })
    expect(subjectOf('add_fact_to_people', { personIds: ['a', 'b'], fact: { kind: 'Перепись' } })).toMatchObject({ total: 2, what: 'Перепись' })
    expect(subjectOf('update_people', { changes: [{ id: 'a', patch: { deathPlace: 'x' } }, { id: 'b', patch: { birthPlace: 'y' } }] })).toMatchObject({ ids: ['a', 'b'], what: 'deathPlace, birthPlace' })
    expect(subjectOf('add_relation', { type: 'son', to: 'a', other: 'b' })).toMatchObject({ ids: ['a', 'b'], what: 'son' })
    // Half-streamed input of a call still being written: nothing to say yet, and no crash.
    expect(subjectOf('get_people', undefined)).toEqual({ ids: [], total: 0 })
    expect(subjectOf('get_people', { ids: ['a', 3, null] }).ids).toEqual(['a'])
  })
  it('writes it in a line: a name, a count, how far, and the fact', () => {
    const name = (id: string) => ({ a: 'Иван Соколов', b: 'Мария Белова' } as Record<string, string | undefined>)[id]
    expect(stepDetail({ ids: ['a'], total: 1 }, name, 'из')).toBe('Иван Соколов')
    expect(stepDetail({ ids: ['a', 'b'], total: 2 }, name, 'из')).toBe('Иван Соколов, Мария Белова')
    expect(stepDetail({ ids: [], total: 40, done: 12 }, name, 'of')).toBe('12 of 40')
    expect(stepDetail({ ids: new Array(40).fill('a'), total: 40 }, name, 'из')).toBe('40')
    expect(stepDetail({ ids: ['a'], total: 1, what: 'Служба' }, name, 'из')).toBe('«Служба»: Иван Соколов')
    expect(stepDetail({ ids: ['x'], total: 1 }, name, 'из')).toBe('')
  })
  it('has a label in every language for the new tools', () => {
    for (const lang of ['ru', 'en', 'es', 'ca'] as const) {
      for (const tool of ['get_people', 'add_fact_to_people', 'count_relatives']) {
        expect(stepLabel(tool, lang), `${tool} ${lang}`).not.toBe(tool)
        expect(toolLabel(tool, lang)).not.toBe(tool)
      }
    }
    expect(stepLabel('get_people', 'en')).toBe('Reading cards')
    expect(stepLabel('get_people', 'es')).not.toBe(stepLabel('get_people', 'en'))
    expect(stepLabel('get_people', 'ca')).not.toBe(stepLabel('get_people', 'en'))
  })
})
