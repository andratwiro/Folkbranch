/* eslint-disable @typescript-eslint/no-explicit-any -- the tools' answers are read untyped, as the model reads them */
// "How many relatives does X have?": what the assistant's tools say, whether it agrees with the links, and what asking
// costs. The family is invented: a person with sixteen couples of ancestors, each with a brother or sister's family.
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { beforeAll, describe, expect, it } from 'vitest'
import { assistantActor } from '../lib/agent/agent'
import { assistantResponse } from '../lib/agent/respond'
import { Family, RELATIVE_KINDS } from '../lib/kinship'
import { createPerson, getGraph, linkPeople } from '../lib/ops/people'
import { toolsFor } from '../lib/ops/tools'
import { owner, reader } from './fixture-family'

type Ids = { id: string }
const add = (givenName: string, sex: 'M' | 'F', birthDate = '1900') => createPerson(owner, { givenName, surname: 'Тестов', sex, birthDate, deathDate: '1990' }) as Ids
async function call(person: typeof owner, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const actor = assistantActor(person)
  const def = toolsFor(actor, 'assistant').find((t) => t.name === name)!
  return def.run(actor, def.input.parse(args))
}

/** Expected degree and kind of each person, written down while building, not read back from the code under test. */
const expected = new Map<string, { kind: string; degree?: number }>()
let root: Ids
let n = 0
beforeAll(() => {
  root = add('Корень', 'M', '1990')
  // A couple at ancestor level g (1 = parents) has the person's line child plus one side child with a spouse and a child.
  const couple = (child: Ids, g: number) => {
    const f = add(`Отец${++n}`, 'M'), m = add(`Мать${n}`, 'F')
    linkPeople(owner, 'spouse', f.id, m.id)
    linkPeople(owner, 'son', f.id, child.id, m.id)
    expected.set(f.id, { kind: 'blood', degree: g }); expected.set(m.id, { kind: 'blood', degree: g })
    const side = add(`Боковой${n}`, 'M'), spouse = add(`Жена${n}`, 'F'), kid = add(`Ребёнок${n}`, 'M')
    linkPeople(owner, 'son', f.id, side.id, m.id)
    linkPeople(owner, 'spouse', side.id, spouse.id)
    linkPeople(owner, 'son', side.id, kid.id, spouse.id)
    expected.set(side.id, { kind: 'blood', degree: g + 1 }); expected.set(kid.id, { kind: 'blood', degree: g + 2 }); expected.set(spouse.id, { kind: 'marriage' })
    if (g < 4) { couple(f, g + 1); couple(m, g + 1) }
  }
  couple(root, 1)
})

describe('counting relatives', () => {
  it('totals what was built: blood by degree, spouses of blood relatives apart', async () => {
    const r = await call(owner, 'count_relatives', { id: root.id })
    const want = [...expected.values()]
    expect(r.total).toBe(want.length)
    expect(r.byKind).toEqual({ blood: want.filter((x) => x.kind === 'blood').length, adopted: 0, step: 0, spouse: 0, marriage: want.filter((x) => x.kind === 'marriage').length })
    expect(r.byKind.blood).toBe(60)
    expect(r.byKind.marriage).toBe(15)
    for (const d of [1, 2, 3, 4, 5, 6]) expect(r.bloodByDegree[d] ?? 0, `degree ${d}`).toBe(want.filter((x) => x.degree === d).length)
    // The kinds add up to the total, so a number given for "relatives" always says what it counts.
    expect(Object.values(r.byKind).reduce((a: number, b) => a + (b as number), 0)).toBe(r.total)
    expect(Object.keys(r.byKind)).toEqual([...RELATIVE_KINDS])
    expect(r.definition).toContain('spouse of a blood relative')
  })

  it('names only the immediate family until asked, and lists one group on request, trimmed to what an answer needs', async () => {
    const r = await call(owner, 'count_relatives', { id: root.id })
    expect(r.list).toBeUndefined()
    expect(r.immediateFamily.map((x: any) => x.relation).sort()).toEqual(['брат', 'мать', 'отец'])
    expect(Object.keys(r.immediateFamily[0]).sort()).toEqual(['degree', 'id', 'kind', 'name', 'relation', 'years'])
    const marriage = await call(owner, 'count_relatives', { id: root.id, kind: 'marriage', limit: 5 })
    expect(marriage.matching).toBe(15)
    expect(marriage.list).toHaveLength(5)
    expect(marriage.more).toBe(10)
    expect(marriage.list.every((x: any) => x.kind === 'marriage')).toBe(true)
    const close = await call(owner, 'count_relatives', { id: root.id, kind: 'blood', maxDegree: 2 })
    expect(close.matching).toBe(2 + 4 + 1)
    expect(close.list.every((x: any) => x.degree <= 2)).toBe(true)
  })

  it('agrees with the per-person kinship terms and with a reader who cannot see living people', async () => {
    const all = await call(owner, 'get_relatives', { id: root.id })
    const counted = await call(owner, 'count_relatives', { id: root.id })
    expect(all).toHaveLength(counted.total)
    expect(all.filter((x: any) => x.kind === 'blood')).toHaveLength(counted.byKind.blood)
    // A reader cannot see a living relative: no name in the answer, and the count says how many are out of sight.
    const father = all.find((x: any) => x.relation === 'отец')
    const alive = createPerson(owner, { givenName: 'Живой', surname: 'Скрытов', sex: 'M', birthDate: '1995' }) as Ids
    linkPeople(owner, 'son', father.id, alive.id)
    const seen = await call(reader, 'count_relatives', { id: father.id, kind: 'blood', maxDegree: 2 })
    expect(JSON.stringify(seen)).not.toContain('Живой')
    expect(JSON.stringify(seen)).not.toContain('Скрытов')
    expect(seen.hiddenFromYou).toBeGreaterThanOrEqual(1)
    expect(seen.total).toBe((await call(owner, 'count_relatives', { id: father.id })).total)
  })

  it('takes a name instead of an id, and hands a name that fits several people back instead of choosing', async () => {
    expect((await call(owner, 'count_relatives', { name: 'Корень' })).person.id).toBe(root.id)
    const twin = [add('Двойной', 'M'), add('Двойной', 'M')]
    const r = await call(owner, 'count_relatives', { name: 'Двойной' })
    expect(r.ambiguous.map((x: any) => x.id).sort()).toEqual(twin.map((x) => x.id).sort())
    expect(r.total).toBeUndefined()
    await expect(call(owner, 'count_relatives', { name: 'Никтонетакой' })).rejects.toThrow('nobody')
    await expect(call(owner, 'count_relatives', {})).rejects.toThrow('id or name')
  })

  it('reads the links as they are now, not as they were when it was last asked', async () => {
    const lone = add('Один', 'M', '1991')
    const father = (await call(owner, 'get_relatives', { id: root.id })).find((x: any) => x.relation === 'отец')
    linkPeople(owner, 'son', father.id, lone.id)
    const before = await call(owner, 'count_relatives', { id: root.id })
    const mother = (await call(owner, 'get_relatives', { id: root.id })).find((x: any) => x.relation === 'мать')
    linkPeople(owner, 'son', mother.id, lone.id)
    const after = await call(owner, 'count_relatives', { id: root.id })
    expect(after.total).toBe(before.total)
    expect((await call(owner, 'how_related', { from: root.id, to: lone.id })).relation).toBe('брат')
  })
})

describe('what is said of siblings, adopted and step children', () => {
  const rel = async (from: string, to: string) => (await call(owner, 'how_related', { from, to })).relation as string
  it('calls a sibling half only when both have another parent on record, and adopted and step children by their own words', async () => {
    const dad = add('Папа', 'M', '1950'), mum = add('Мама', 'F', '1952'), other = add('Другая', 'F', '1955'), man = add('Другой', 'M', '1948')
    const kid = add('Ребёнок', 'M', '1980'), full = add('Полный', 'M', '1982'), half = add('Единокровный', 'M', '1985'), halfBoth = add('Сводный', 'M', '1986'), lone = add('Одинокий', 'M', '1987'), adopted = add('Приёмный', 'M', '1990'), stepSon = add('Пасынок', 'M', '1975')
    linkPeople(owner, 'spouse', dad.id, mum.id)
    for (const c of [kid, full]) linkPeople(owner, 'son', dad.id, c.id, mum.id)
    linkPeople(owner, 'son', dad.id, half.id, other.id)
    linkPeople(owner, 'son', dad.id, lone.id)
    linkPeople(owner, 'son', man.id, halfBoth.id, other.id)
    linkPeople(owner, 'son', dad.id, adopted.id, mum.id, { kind: 'adopted' })
    linkPeople(owner, 'son', dad.id, stepSon.id, null, { kind: 'step' })
    expect(await rel(kid.id, full.id)).toBe('брат')
    expect(await rel(kid.id, half.id)).toBe('сводный брат')
    expect(await rel(kid.id, lone.id)).toBe('брат')
    expect(await rel(kid.id, adopted.id)).toBe('приёмный брат')
    expect(await rel(dad.id, stepSon.id)).toBe('пасынок')
    const c = await call(owner, 'count_relatives', { id: kid.id, kind: 'adopted' })
    expect(c.list.map((x: any) => x.id)).toEqual([adopted.id])
    const s = await call(owner, 'count_relatives', { id: dad.id, kind: 'step' })
    expect(s.list.map((x: any) => x.id)).toEqual([stepSon.id])
    expect(new Family(getGraph(owner)).relation(halfBoth.id, half.id, 'en')?.label).toBe('half-brother')
  })
})

describe('what asking costs', () => {
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
  let k = 0
  const calls = (...list: [string, unknown][]) => ({ stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, ...list.map(([toolName, input]) => ({ type: 'tool-call', toolCallId: `c${++k}`, toolName, input: JSON.stringify(input) })), { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage }] as never[] }) })
  const say = (text: string) => ({ stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: text }, { type: 'text-end', id: 't' }, { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage }] as never[] }) })

  /** One question to a scripted model; its prompts, as tokens (4 characters each), are counted request by request. */
  async function ask(script: ReturnType<typeof say>[]) {
    const m = new MockLanguageModelV4({ doStream: script as never })
    const began = performance.now()
    const res = await assistantResponse(owner, { messages: [{ id: 'q', role: 'user', parts: [{ type: 'text', text: 'Сколько у Корня родственников?' }] }] }, { model: m })
    const raw = await res.text()
    const wall = performance.now() - began
    expect(raw).toContain('Готово')
    const perRequest = m.doStreamCalls.map((c) => Math.round((JSON.stringify(c.prompt).length + JSON.stringify(c.tools).length) / 4))
    return { requests: m.doStreamCalls.length, perRequest, tokens: perRequest.reduce((a, b) => a + b, 0), wall, m }
  }

  it('answers in fewer round trips and far fewer tokens than reading every card and relative', async () => {
    const before = await ask([calls(['search_people', { query: 'Корень' }]), calls(['get_person', { id: root.id }]), calls(['use_tools', { groups: ['people'] }]), calls(['get_relatives', { id: root.id }]), say('Готово')])
    const after = await ask([calls(['count_relatives', { name: 'Корень' }]), say('Готово')])
    const row = (name: string, r: typeof before) => `${name.padEnd(8)} requests ${r.requests}  input tokens ${String(r.tokens).padStart(6)}  (${r.perRequest.join(' + ')})  stub wall ${r.wall.toFixed(0)} ms`
    if (process.env.MEASURE) process.stderr.write(`\n${row('before', before)}\n${row('after', after)}\n`)
    expect(after.requests).toBeLessThan(before.requests)
    expect(after.tokens).toBeLessThan(before.tokens * 0.6)
    // count_relatives needs no use_tools round trip: it is offered from the first request.
    expect((after.m.doStreamCalls[0].tools ?? []).map((t) => t.name)).toContain('count_relatives')
    expect((before.m.doStreamCalls[0].tools ?? []).map((t) => t.name)).not.toContain('get_relatives')
  })

  it('reads twelve cards in one trimmed call for a fraction of twelve get_person answers', async () => {
    const ids = (await call(owner, 'get_relatives', { id: root.id })).slice(0, 12).map((x: any) => x.id)
    const before = await ask([calls(...ids.map((id: string): [string, unknown] => ['get_person', { id }])), say('Готово')])
    const after = await ask([calls(['get_people', { ids }]), say('Готово')])
    if (process.env.MEASURE) process.stderr.write(`\n12 cards: get_person x12 ${before.perRequest.join(' + ')} = ${before.tokens} tokens; get_people ${after.perRequest.join(' + ')} = ${after.tokens} tokens\n`)
    expect(after.requests).toBe(2)
    expect(after.perRequest[1] - after.perRequest[0]).toBeLessThan((before.perRequest[1] - before.perRequest[0]) / 2)
  })

  it('keeps the answer small however big the family: the whole list is many times larger', async () => {
    const counts = JSON.stringify(await call(owner, 'count_relatives', { id: root.id }))
    const list = JSON.stringify(await call(owner, 'get_relatives', { id: root.id }))
    expect(counts.length).toBeLessThan(2000)
    expect(list.length).toBeGreaterThan(counts.length * 3)
  })
})
