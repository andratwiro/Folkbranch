// What a drag on the chart means: which relation the person under the pointer becomes. Kept apart from the React hook so tests can run it.
import type { Sex } from '../types'

export type LinkType = 'parent' | 'father' | 'mother' | 'child' | 'son' | 'daughter' | 'spouse'
export type LinkSource = { person: string } | { parents: [string, string] }
export interface LinkWorld {
  parents: Map<string, string[]>
  spouses: Map<string, string[]>
  sexOf: (id: string) => Sex | undefined
  rowOf: (id: string) => number
  rootsBelow: boolean
}
export interface Relation { type: LinkType; to: string; other: string; otherParentId: string | null; label: string }
/** The drag is allowed, is refused with a reason to show, or means nothing because the two are already linked. */
export type LinkVerdict = Relation | { refuse: string } | null

const TWO_PARENTS = 'This person already has two parents'
const OTHER_PARENT = 'This person already has a parent outside this couple. To replace them, remove that link first'

export function relationFor(w: LinkWorld, source: LinkSource, target: string): LinkVerdict {
  const sex = w.sexOf(target)
  const childType: LinkType = sex === 'F' ? 'daughter' : 'son'
  const childLabel = sex === 'F' ? 'daughter' : sex === 'M' ? 'son' : 'child'
  const parentsOf = (id: string) => w.parents.get(id) ?? []
  if ('parents' in source) {
    const [a, b] = source.parents
    if (a === target || b === target) return null
    const have = parentsOf(target)
    if (!have.length) return { type: childType, to: a, other: target, otherParentId: b, label: childLabel }
    if (have.includes(a) && have.includes(b)) return null
    if (have.length >= 2) return { refuse: TWO_PARENTS }
    // A child with one parent of this couple gets the other one; the pair then forms a family.
    const missing = have.includes(a) ? b : have.includes(b) ? a : null
    if (!missing) return { refuse: OTHER_PARENT }
    return { type: w.sexOf(missing) === 'F' ? 'mother' : 'father', to: target, other: missing, otherParentId: null, label: childLabel }
  }
  const s = source.person
  if (s === target) return null
  if (parentsOf(s).includes(target) || parentsOf(target).includes(s) || (w.spouses.get(s) ?? []).includes(target)) return null
  // Positive means the target stands on a younger row.
  const dy = (w.rowOf(target) - w.rowOf(s)) * (w.rootsBelow ? -1 : 1)
  if (dy < 0) {
    if (parentsOf(s).length >= 2) return { refuse: TWO_PARENTS }
    return { type: sex === 'F' ? 'mother' : 'father', to: s, other: target, otherParentId: null, label: sex === 'F' ? 'mother' : sex === 'M' ? 'father' : 'parent' }
  }
  if (dy > 0) {
    // A child with no parents yet belongs to the couple, if there is exactly one.
    const spouses = w.spouses.get(s) ?? []
    const other = spouses.length === 1 && !parentsOf(target).length ? spouses[0] : null
    if (parentsOf(target).length >= 2) return { refuse: TWO_PARENTS }
    return { type: childType, to: s, other: target, otherParentId: other, label: childLabel }
  }
  return { type: 'spouse', to: s, other: target, otherParentId: null, label: 'spouse' }
}
