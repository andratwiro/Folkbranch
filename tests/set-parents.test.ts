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
const person = (name: string, sex?: 'M' | 'F') => people.createPerson(owner, { givenName: name, surname: 'Parentson', sex }).id
type Link = { id: string; parentId: string; childId: string; kind: string }
const links = (child: string) => (people.getGraph(owner) as { parentChild: Link[] }).parentChild.filter((l) => l.childId === child)
const parentsOf = (child: string) => links(child).map((l) => l.parentId).sort()
const historyLength = () => settings.listHistory(owner).length

describe('setting the parents of a child', () => {
  it('one child of both, one of one: switches both ways as one change each, and one undo takes each back', () => {
    const a = person('A', 'M'), b = person('B', 'F'), kid = person('Kid', 'M')
    people.linkPeople(owner, 'spouse', a, b)
    people.linkPeople(owner, 'son', a, kid)
    expect(parentsOf(kid)).toEqual([a])
    // One -> both.
    people.setParents(owner, kid, [a, b])
    expect(parentsOf(kid)).toEqual([a, b].sort())
    // Both -> one.
    const before = historyLength()
    people.setParents(owner, kid, [b])
    expect(parentsOf(kid)).toEqual([b])
    expect(historyLength()).toBe(before + 1)
    core.undo(owner, settings.listHistory(owner)[0].id, 'undo')
    expect(parentsOf(kid)).toEqual([a, b].sort())
  })

  it('replaces a parent outside the couple, whatever kind that link was, and keeps the kind of the link that stays', () => {
    const a = person('Xa', 'M'), b = person('Xb', 'F'), c = person('Xc', 'M'), kid = person('Xkid', 'F')
    people.linkPeople(owner, 'daughter', a, kid, null, { kind: 'step' })
    people.linkPeople(owner, 'daughter', c, kid, null, { kind: 'adopted' })
    people.setParents(owner, kid, [a, b])
    expect(parentsOf(kid)).toEqual([a, b].sort())
    expect(links(kid).find((l) => l.parentId === a)?.kind).toBe('step')
    expect(links(kid).find((l) => l.parentId === b)?.kind).toBe('birth')
    expect(links(kid).find((l) => l.parentId === c)).toBeUndefined()
  })

  it('refuses what it could not draw: nobody, three, itself, a descendant, no change, and a reader', () => {
    const a = person('Ya', 'M'), b = person('Yb', 'F'), c = person('Yc', 'F'), kid = person('Ykid', 'M'), grand = person('Ygrand', 'F')
    people.linkPeople(owner, 'son', a, kid)
    people.linkPeople(owner, 'daughter', kid, grand)
    expect(() => people.setParents(owner, kid, [])).toThrow()
    expect(() => people.setParents(owner, kid, [a, b, c])).toThrow()
    expect(() => people.setParents(owner, kid, [kid])).toThrow('same person')
    expect(() => people.setParents(owner, kid, [grand])).toThrow('own ancestor')
    expect(() => people.setParents(owner, kid, [a])).toThrow('nothing to change')
    expect(() => people.setParents(reader, kid, [b])).toThrow()
    expect(parentsOf(kid)).toEqual([a])
  })
})
