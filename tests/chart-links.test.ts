import { describe, expect, it } from 'vitest'
import { relationFor, type LinkWorld } from '../lib/graph/link-rules'
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
    expect(relationFor(w, couple, 'ilya')).toMatchObject({ type: 'mother', to: 'ilya', other: 'elena', otherParentId: null, label: 'сын' })
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
  it('refuses with a reason when the child has a parent outside the couple, or two others', () => {
    expect(relationFor(w, couple, 'oleg')).toHaveProperty('refuse')
    const two = world({ oleg: ['igor', 'mira'] })
    expect(relationFor(two, couple, 'oleg')).toHaveProperty('refuse')
  })
})

describe('dragging from a person', () => {
  it('still reads the row: older is a parent, younger a child, same a spouse', () => {
    expect(relationFor(w, { person: 'ilya' }, 'elena')).toMatchObject({ type: 'mother', to: 'ilya', other: 'elena' })
    expect(relationFor(w, { person: 'elena' }, 'mira')).toMatchObject({ type: 'daughter', to: 'elena', other: 'mira', otherParentId: 'pavel' })
    expect(relationFor(w, { person: 'oleg' }, 'mira')).toMatchObject({ type: 'spouse' })
  })
  it('refuses a third parent', () => {
    const rows = { igor: -1, anna: 1 }
    expect(relationFor(world({ anna: ['pavel', 'elena'] }, rows), { person: 'anna' }, 'igor')).toHaveProperty('refuse')
  })
  it('says nothing for people who are already linked', () => {
    expect(relationFor(w, { person: 'ilya' }, 'pavel')).toBeNull()
    expect(relationFor(w, { person: 'pavel' }, 'elena')).toBeNull()
  })
})
