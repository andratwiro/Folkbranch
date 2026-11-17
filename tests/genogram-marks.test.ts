import { describe, expect, it } from 'vitest'
import { parseGedcom, writeGedcom } from '../lib/gedcom'
import { layoutFamily } from '../lib/graph/layout'
import type { Graph, ParentKind, Person } from '../lib/types'

// Invented family: two parents, a child of each kind, and a former partner of the father.
const person = (id: string, sex: 'M' | 'F', birthYear: number) => ({ id, sex, birthYear, givenName: id, surname: 'Test', living: false, facts: [], sources: [], otherNames: '', birthDate: String(birthYear), deathDate: '' } as unknown as Person)
const graph = (kinds: Record<string, ParentKind>, endDate = ''): Graph => ({
  persons: [person('dad', 'M', 1950), person('mum', 'F', 1952), ...Object.keys(kinds).map((id, i) => person(id, 'M', 1980 + i))],
  parentChild: Object.entries(kinds).flatMap(([childId, kind]) => ['dad', 'mum'].map((parentId) => ({ id: `${parentId}-${childId}`, parentId, childId, kind, certainty: 'family' }))),
  unions: [{ id: 'u1', aId: 'dad', bId: 'mum', kind: 'marriage', startDate: '1975', endDate, place: '', certainty: 'family' }],
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
