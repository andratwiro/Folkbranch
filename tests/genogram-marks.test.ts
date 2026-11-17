import { describe, expect, it } from 'vitest'
import { parseGedcom, writeGedcom } from '../lib/gedcom'
import { layoutFamily } from '../lib/graph/layout'
import { unionEnd, type Graph, type ParentKind, type Person, type UnionEnd } from '../lib/types'

// Invented family: two parents, a child of each kind, and a former partner of the father.
const person = (id: string, sex: 'M' | 'F', birthYear: number) => ({ id, sex, birthYear, givenName: id, surname: 'Test', living: false, facts: [], sources: [], otherNames: '', birthDate: String(birthYear), deathDate: '' } as unknown as Person)
const graph = (kinds: Record<string, ParentKind>, endDate = '', endKind: UnionEnd = ''): Graph => ({
  persons: [person('dad', 'M', 1950), person('mum', 'F', 1952), ...Object.keys(kinds).map((id, i) => person(id, 'M', 1980 + i))],
  parentChild: Object.entries(kinds).flatMap(([childId, kind]) => ['dad', 'mum'].map((parentId) => ({ id: `${parentId}-${childId}`, parentId, childId, kind, certainty: 'family' }))),
  unions: [{ id: 'u1', aId: 'dad', bId: 'mum', kind: 'marriage', startDate: '1975', endDate, endKind, place: '', certainty: 'family' }],
}) as unknown as Graph

describe('how a child is linked shows on the chart', () => {
  const l = layoutFamily(graph({ own: 'birth', adopted: 'adopted', foster: 'foster', step: 'step' }))
  const style = (id: string) => l.edges.find((e) => e.childId === id)!.style
  it('draws each kind of link in its own style', () => {
    expect(['own', 'adopted', 'foster', 'step'].map(style)).toEqual(['solid', 'adopted', 'foster', 'step'])
  })
  it('keeps adopted ahead of the others when a child has links of two kinds', () => {
    const g = graph({ kid: 'step' })
    g.parentChild[0].kind = 'adopted'
    expect(layoutFamily(g).edges[0].style).toBe('adopted')
  })
})

describe('an ended union', () => {
  it('has a point on its line, beside the dot, to cross out', () => {
    const u = layoutFamily(graph({ kid: 'birth' }, '1990')).unions[0]
    expect(u.union.endDate).toBe('1990')
    expect(Math.abs(u.endAt[0] - u.x)).toBeGreaterThan(5)
    expect(u.endAt[1]).toBeCloseTo(u.y)
  })
})

describe('GEDCOM carries foster children', () => {
  const out = writeGedcom(graph({ fost: 'foster', adop: 'adopted', own: 'birth' }), { hideLiving: false, source: 'test' })
  it('writes PEDI foster, and PEDI adopted for the adopted one', () => {
    expect(out).toMatch(/PEDI foster/)
    expect(out.match(/PEDI adopted/g)).toHaveLength(1)
  })
  it('reads PEDI foster back as foster, not as a birth child', () => {
    const kids = parseGedcom(out).families[0].children
    const byXref = Object.fromEntries(kids.map((c) => [c.xref, c]))
    expect(kids.filter((c) => c.foster)).toHaveLength(1)
    expect(kids.filter((c) => c.adopted)).toHaveLength(1)
    expect(Object.keys(byXref)).toHaveLength(3)
  })
})

describe('how a union ended', () => {
  it('reads an end date with no stated reason as a divorce, as older files wrote it', () => {
    expect(unionEnd({ endDate: '1990' })).toBe('divorced')
    expect(unionEnd({ endDate: '1990', endKind: 'widowed' })).toBe('widowed')
    expect(unionEnd({ endDate: '' })).toBe('')
  })
  const written = (endDate: string, endKind: UnionEnd) => writeGedcom(graph({ kid: 'birth' }, endDate, endKind), { hideLiving: false, source: 'test' })
  it('writes a divorce as DIV and a separation as an event, and a widowhood as neither', () => {
    expect(written('1990', 'divorced')).toMatch(/1 DIV/)
    expect(written('1990', '')).toMatch(/1 DIV/)
    const sep = written('1990', 'separated')
    expect(sep).toMatch(/1 EVEN\n2 TYPE Separation\n2 DATE 1990/)
    expect(sep).not.toMatch(/1 DIV/)
    expect(written('1990', 'widowed')).not.toMatch(/DIV|Separation/)
  })
  it('reads them back: a DIV leaves the reason open, a separation says so', () => {
    expect(parseGedcom(written('1990', 'divorced')).families[0]).toMatchObject({ end: '1990' })
    expect(parseGedcom(written('1990', 'divorced')).families[0].endKind).toBeUndefined()
    expect(parseGedcom(written('1990', 'separated')).families[0]).toMatchObject({ end: '1990', endKind: 'separated' })
  })
})
