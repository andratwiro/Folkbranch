import { describe, expect, it } from 'vitest'
import { Family, yourTerm, genitive } from '../lib/kinship'
import type { Graph, Person, Sex } from '../lib/types'

const P = (id: string, sex: Sex) => ({ id, sex } as Person)
const sexes: Record<string, Sex> = { ded: 'M', bab: 'F', otec: 'M', mat: 'F', dyad: 'M', tet: 'F', ya: 'M', sis: 'F', half: 'M', mach: 'F', kuz: 'F', zhena: 'F', tes: 'M', sva: 'F', syn: 'M', vnuk: 'M', kuz2: 'M', ple: 'F', pra: 'F', adop: 'M', zyat: 'M' }
const pc: [string, string, string?][] = [['pra', 'ded'], ['ded', 'otec'], ['bab', 'otec'], ['ded', 'dyad'], ['bab', 'dyad'], ['otec', 'ya'], ['mat', 'ya'], ['otec', 'sis'], ['mat', 'sis'], ['otec', 'half'], ['mach', 'half'], ['dyad', 'kuz'], ['tet', 'kuz'], ['kuz', 'kuz2'], ['tes', 'zhena'], ['tes', 'sva'], ['ya', 'syn'], ['zhena', 'syn'], ['syn', 'vnuk'], ['sis', 'ple'], ['ya', 'adop', 'adopted']]
const un = [['ded', 'bab'], ['otec', 'mat'], ['otec', 'mach'], ['dyad', 'tet'], ['ya', 'zhena'], ['sis', 'zyat']]
const graph = {
  persons: Object.entries(sexes).map(([id, s]) => P(id, s)),
  parentChild: pc.map(([parentId, childId, kind = 'birth'], i) => ({ id: `${i}`, parentId, childId, kind })),
  unions: un.map(([aId, bId], i) => ({ id: `u${i}`, aId, bId })),
} as unknown as Graph
const f = new Family(graph)
const ru = (to: string) => f.relation('ya', to)?.label

describe('kinship (ru)', () => {
  it.each([
    ['otec', 'отец'], ['mat', 'мать'], ['ded', 'дед'], ['bab', 'бабушка'], ['pra', 'прабабушка'],
    ['sis', 'сестра'], ['half', 'сводный брат'], ['dyad', 'дядя'], ['kuz', 'двоюродная сестра'], ['kuz2', 'двоюродный племянник'],
    ['syn', 'сын'], ['vnuk', 'внук'], ['ple', 'племянница'], ['zhena', 'жена'], ['tes', 'тесть'], ['sva', 'свояченица'],
    ['mach', 'мачеха'], ['adop', 'приёмный сын'], ['zyat', 'зять'],
  ])('%s → %s', (to, label) => expect(ru(to)).toBe(label))

  it('names a relative by marriage without calling them your spouse', () => {
    expect(ru('tet')).toBe('жена дяди')
    expect(yourTerm('жена дяди', 'F', 'ru')).toBe('жена дяди')
    expect(yourTerm('жена', 'F', 'ru')).toBe('ваша жена')
  })
  it.each([
    ['внук', 'внука'], ['внучка', 'внучки'], ['правнучка', 'правнучки'], ['дядя', 'дяди'], ['тётя', 'тёти'], ['сестра', 'сестры'],
    ['двоюродный брат', 'двоюродного брата'], ['двоюродная сестра', 'двоюродной сестры'], ['сводная сестра', 'сводной сестры'],
    ['племянница', 'племянницы'], ['внучатый племянник', 'внучатого племянника'], ['внук/внучка', 'внука/внучки'], ['родитель', 'родителя'],
  ])('%s → %s', (term, want) => expect(genitive(term)).toBe(want))
  it('path runs from one person to the other', () => {
    const k = f.relation('ya', 'kuz')!
    expect(k.path[0]).toBe('ya')
    expect(k.path.at(-1)).toBe('kuz')
    expect(k.path).toContain('ded')
  })
  it('possessive form', () => expect(yourTerm('бабушка', 'F', 'ru')).toBe('ваша бабушка'))
})

describe('kinship (en)', () => {
  it.each([['kuz', 'first cousin'], ['kuz2', 'first cousin once removed'], ['pra', 'great-grandmother'], ['tes', 'father-in-law'], ['mach', 'stepmother']])('%s → %s', (to, label) =>
    expect(f.relation('ya', to, 'en')?.label).toBe(label))
})

describe('a child with one parent on record', () => {
  const g = (links: [string, string][]) => new Family({
    persons: [P('pavel', 'M'), P('elena', 'F'), P('ilya', 'M')],
    parentChild: links.map(([parentId, childId], i) => ({ id: `${i}`, parentId, childId, kind: 'birth' })),
    unions: [{ id: 'u', aId: 'pavel', bId: 'elena' }],
  } as unknown as Graph)
  it('is no one\'s stepchild: the partner of the only parent may be the other parent', () => {
    const one = g([['pavel', 'ilya']])
    expect(one.relation('elena', 'ilya')?.label).toBe('сын мужа')
    expect(one.relation('ilya', 'elena')?.label).toBe('жена отца')
    expect(one.relation('elena', 'ilya', 'en')?.label).toBe("husband's son")
  })
  it('has its own words in Spanish and Catalan, and the reader\'s possessive lands on the nearest relative', () => {
    const one = g([['pavel', 'ilya']])
    const es = [one.relation('elena', 'ilya', 'es')!.label, one.relation('ilya', 'elena', 'es')!.label]
    const ca = [one.relation('elena', 'ilya', 'ca')!.label, one.relation('ilya', 'elena', 'ca')!.label]
    expect(es).toEqual(['hijo del esposo', 'esposa del padre'])
    expect(ca).toEqual(["fill de l'espòs", 'esposa del pare'])
    expect([yourTerm(es[0], 'M', 'es'), yourTerm(es[1], 'F', 'es')]).toEqual(['el hijo de tu esposo', 'la esposa de tu padre'])
    expect([yourTerm(ca[0], 'M', 'ca'), yourTerm(ca[1], 'F', 'ca')]).toEqual(["el fill del teu espòs", "l'esposa del teu pare"])
  })
  it('is a stepchild only when the other parent is on record as someone else', () => {
    const both = new Family({
      persons: [P('pavel', 'M'), P('elena', 'F'), P('ilya', 'M'), P('other', 'F')],
      parentChild: [['pavel', 'ilya'], ['other', 'ilya']].map(([parentId, childId], i) => ({ id: `${i}`, parentId, childId, kind: 'birth' })),
      unions: [{ id: 'u', aId: 'pavel', bId: 'elena' }],
    } as unknown as Graph)
    expect(both.relation('elena', 'ilya')?.label).toBe('пасынок')
  })
  it('is a son once the mother is on record', () => expect(g([['pavel', 'ilya'], ['elena', 'ilya']]).relation('elena', 'ilya')?.label).toBe('сын'))
})
