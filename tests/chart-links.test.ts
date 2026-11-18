import { describe, expect, it } from 'vitest'
import { dropOnCouple, relationFor, type LinkWorld } from '../lib/graph/link-rules'
import type { Sex } from '../lib/types'

// Invented family: Pavel (M) and Elena (F) are a couple; Ilya (M) has Pavel as his only parent; Anna (F) has both; Oleg (M) has an unrelated father Igor (M).
const sexes: Record<string, Sex> = { pavel: 'M', elena: 'F', ilya: 'M', anna: 'F', oleg: 'M', igor: 'M', mira: 'F' }
const world = (parents: Record<string, string[]>, rows: Record<string, number> = {}): LinkWorld => ({
  parents: new Map(Object.entries(parents)),
  spouses: new Map([['pavel', ['elena']], ['elena', ['pavel']]]),
  sexOf: (id) => sexes[id],
  rowOf: (id) => rows[id] ?? 0,
  rootsBelow: false,
})
const w = world({ ilya: ['pavel'], anna: ['pavel', 'elena'], oleg: ['igor'] }, { pavel: 0, elena: 0, ilya: 1, anna: 1, oleg: 1, mira: 1 })
const couple = { parents: ['pavel', 'elena'] as [string, string] }

describe('dragging a couple\'s dot onto a person', () => {
  it('gives a child with one parent of the couple the other parent', () => {
    expect(relationFor(w, couple, 'ilya')).toMatchObject({ type: 'mother', to: 'ilya', other: 'elena', otherParentId: null, label: 'son' })
    expect(relationFor(w, { parents: ['elena', 'pavel'] }, 'ilya')).toMatchObject({ type: 'mother', other: 'elena' })
    // With the mother present, the missing one is the father.
    const rev = world({ ilya: ['elena'] })
    expect(relationFor(rev, couple, 'ilya')).toMatchObject({ type: 'father', other: 'pavel' })
  })
  it('gives a child with no parents both', () => {
    expect(relationFor(w, couple, 'mira')).toMatchObject({ type: 'daughter', to: 'pavel', other: 'mira', otherParentId: 'elena' })
  })
  it('says nothing when the child already has them both, or is one of the couple', () => {
    expect(relationFor(w, couple, 'anna')).toBeNull()
    expect(relationFor(w, couple, 'pavel')).toBeNull()
  })
  it('replaces any other parents with the couple, instead of refusing', () => {
    expect(relationFor(w, couple, 'oleg')).toMatchObject({ set: { childId: 'oleg', parentIds: ['pavel', 'elena'] } })
    const two = world({ oleg: ['igor', 'mira'] })
    expect(relationFor(two, couple, 'oleg')).toMatchObject({ set: { childId: 'oleg', parentIds: ['pavel', 'elena'] } })
  })
})

describe('changing whose child someone is, by dragging their handle', () => {
  const rows = { pavel: 0, elena: 0, igor: 0, ilya: 1, anna: 1, oleg: 1, mira: 0 }
  it('onto a parent they already have, with another parent: only that parent stays', () => {
    expect(relationFor(w, { person: 'anna' }, 'pavel')).toMatchObject({ set: { childId: 'anna', parentIds: ['pavel'] }, label: 'Make a child of {name} only', name: 'pavel' })
    expect(relationFor(w, { person: 'anna' }, 'elena')).toMatchObject({ set: { childId: 'anna', parentIds: ['elena'] } })
  })
  it('onto their only parent: nothing to change, and it says so', () => {
    expect(relationFor(w, { person: 'ilya' }, 'pavel')).toEqual({ refuse: 'This person is already the only parent' })
  })
  it('onto the dot of a couple: both become the parents, the others go', () => {
    expect(dropOnCouple(w, 'ilya', ['pavel', 'elena'])).toMatchObject({ set: { childId: 'ilya', parentIds: ['pavel', 'elena'] }, label: 'Make a child of both' })
    expect(dropOnCouple(w, 'oleg', ['pavel', 'elena'])).toMatchObject({ set: { childId: 'oleg', parentIds: ['pavel', 'elena'] } })
    expect(dropOnCouple(w, 'anna', ['pavel', 'elena'])).toEqual({ refuse: 'This person is already a child of both' })
    expect(dropOnCouple(w, 'pavel', ['pavel', 'elena'])).toBeNull()
  })
  it('onto a third person with two parents: replaces the one of the same sex', () => {
    const r = world({ anna: ['pavel', 'elena'] }, { ...rows, igor: 0 })
    expect(relationFor(r, { person: 'anna' }, 'igor')).toMatchObject({ set: { childId: 'anna', parentIds: ['igor', 'elena'] } })
    // A mother in the place of the mother.
    expect(relationFor(r, { person: 'anna' }, 'mira')).toMatchObject({ set: { parentIds: ['mira', 'pavel'] } })
  })
  it('refuses when the new parent\'s sex is unknown, or both parents are of that sex', () => {
    const sexless = { ...sexes }
    delete sexless.igor
    const r: LinkWorld = { ...world({ anna: ['pavel', 'elena'] }, { ...rows, igor: 0 }), sexOf: (id) => sexless[id] }
    expect(relationFor(r, { person: 'anna' }, 'igor')).toHaveProperty('refuse')
    const same = world({ anna: ['pavel', 'igor'] }, { ...rows, igor: 0 })
    expect(relationFor(same, { person: 'anna' }, 'mira')).toHaveProperty('refuse')
  })
})

describe('dragging from a person', () => {
  it('still reads the row: older is a parent, younger a child, same a spouse', () => {
    expect(relationFor(w, { person: 'ilya' }, 'elena')).toMatchObject({ type: 'mother', to: 'ilya', other: 'elena' })
    expect(relationFor(w, { person: 'elena' }, 'mira')).toMatchObject({ type: 'daughter', to: 'elena', other: 'mira', otherParentId: 'pavel' })
    expect(relationFor(w, { person: 'oleg' }, 'mira')).toMatchObject({ type: 'spouse' })
  })
  it('refuses a third parent when two parents already share the new one\'s sex', () => {
    const rows = { igor: -1, anna: 1, pavel: 0, oleg: -1 }
    expect(relationFor(world({ anna: ['pavel', 'igor'] }, rows), { person: 'anna' }, 'oleg')).toHaveProperty('refuse')
  })
  it('says nothing for people who are already linked', () => {
    expect(relationFor(w, { person: 'pavel' }, 'ilya')).toBeNull()
    expect(relationFor(w, { person: 'pavel' }, 'elena')).toBeNull()
  })
})
