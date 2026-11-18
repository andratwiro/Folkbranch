import { beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'

const owner: Actor = { userId: 'o', name: 'Owner', role: 'owner', personId: null }
const reader: Actor = { userId: 'r', name: 'Reader', role: 'reader', personId: null }

let people: typeof import('../lib/ops/people')
let settings: typeof import('../lib/ops/settings')
let core: typeof import('../lib/ops/core')

beforeAll(async () => {
  ;[people, settings, core] = await Promise.all([import('../lib/ops/people'), import('../lib/ops/settings'), import('../lib/ops/core')])
})
const person = (name: string, sex?: 'M' | 'F') => people.createPerson(owner, { givenName: name, surname: 'Mover', sex }).id
const graph = () => people.getGraph(owner)
const parentLink = (parent: string, child: string) => (graph() as { parentChild: { id: string; parentId: string; childId: string }[] }).parentChild.find((l) => l.parentId === parent && l.childId === child)
const unionOf = (a: string, b: string) => (graph() as { unions: { id: string; aId: string; bId: string; endKind?: string }[] }).unions.find((u) => [u.aId, u.bId].includes(a) && [u.aId, u.bId].includes(b))

describe('moving the end of a link', () => {
  it('re-points a parent link to another parent, as one change that one undo takes back', () => {
    const pavel = person('Pavel', 'M'), elena = person('Elena', 'F'), ilya = person('Ilya', 'M')
    people.linkPeople(owner, 'son', pavel, ilya)
    const link = parentLink(pavel, ilya)!
    people.moveRelation(owner, 'parent', link.id, 'parent', elena)
    expect(parentLink(pavel, ilya)).toBeUndefined()
    expect(parentLink(elena, ilya)?.id).toBe(link.id)
    core.undo(owner, settings.listHistory(owner)[0].id, 'undo')
    expect(parentLink(pavel, ilya)?.id).toBe(link.id)
    expect(parentLink(elena, ilya)).toBeUndefined()
  })

  it('moves the child end, and the partner end of a union', () => {
    const a = person('A', 'M'), b = person('B', 'F'), c = person('C', 'M'), d = person('D', 'F')
    people.linkPeople(owner, 'son', a, c)
    people.moveRelation(owner, 'parent', parentLink(a, c)!.id, 'child', d)
    expect(parentLink(a, d)).toBeDefined()
    people.linkPeople(owner, 'spouse', a, b)
    people.moveRelation(owner, 'union', unionOf(a, b)!.id, 'b', c)
    expect(unionOf(a, c)).toBeDefined()
    expect(unionOf(a, b)).toBeUndefined()
  })

  it('refuses what drawing the same link new would refuse', () => {
    const g = person('G', 'M'), p = person('P', 'M'), k = person('K', 'M'), s1 = person('S1', 'F'), s2 = person('S2', 'F')
    people.linkPeople(owner, 'son', g, p)
    people.linkPeople(owner, 'son', p, k)
    // A grandfather under his grandson, a duplicate link, and a pair of siblings as a couple.
    expect(() => people.moveRelation(owner, 'parent', parentLink(g, p)!.id, 'parent', k)).toThrow('own ancestor')
    expect(() => people.moveRelation(owner, 'parent', parentLink(g, p)!.id, 'child', g)).toThrow('same person')
    people.linkPeople(owner, 'daughter', g, s1); people.linkPeople(owner, 'daughter', g, s2)
    people.linkPeople(owner, 'spouse', s1, k)
    expect(() => people.moveRelation(owner, 'union', unionOf(s1, k)!.id, 'b', s2)).toThrow('siblings')
    expect(() => people.moveRelation(owner, 'union', unionOf(s1, k)!.id, 'b', k)).toThrow('already ends')
    expect(parentLink(g, p)).toBeDefined()
  })

  it('is for editors', () => {
    const a = person('Ea', 'M'), b = person('Eb', 'M'), c = person('Ec', 'M')
    people.linkPeople(owner, 'son', a, b)
    expect(() => people.moveRelation(reader, 'parent', parentLink(a, b)!.id, 'child', c)).toThrow()
  })
})

describe('how a union ended', () => {
  it('is kept with the union, and cleared again', () => {
    const a = person('Ua', 'M'), b = person('Ub', 'F')
    people.linkPeople(owner, 'spouse', a, b)
    const id = unionOf(a, b)!.id
    people.updateRelation(owner, 'union', id, { endKind: 'separated', endDate: '?' })
    expect(unionOf(a, b)).toMatchObject({ endKind: 'separated' })
    people.updateRelation(owner, 'union', id, { endKind: '', endDate: '' })
    expect(unionOf(a, b)).toMatchObject({ endKind: '' })
  })
})
