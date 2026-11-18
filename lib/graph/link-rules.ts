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
/** The child's parents become exactly `parentIds`; any other parent link goes. `name` is the person a label speaks of. */
export interface SetParents { set: { childId: string; parentIds: string[] }; label: string; name: string }
/** The drag is allowed, is refused with a reason to show, or means nothing because the two are already linked. */
export type LinkVerdict = Relation | SetParents | { refuse: string } | null

/** Marks a phrase for the translation extractor; the shown text is looked up where the label is used. */
const i18n = (phrase: string) => phrase
const TWO_PARENTS = 'This person already has two parents'
const SEX_UNKNOWN = i18n('Cannot tell which of the two parents to replace: the new parent\'s sex is not set')
const ONLY_PARENT = i18n('This person is already the only parent')
const BOTH = i18n('This person is already a child of both')

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
    if (have.length === 2 && have.includes(a) && have.includes(b)) return null
    // A child with one parent of this couple gets the other one; the pair then forms a family.
    const missing = have.length === 1 ? (have.includes(a) ? b : have.includes(b) ? a : null) : null
    // Any other parents are replaced by the couple.
    if (!missing) return { set: { childId: target, parentIds: [a, b] }, label: i18n('Make a child of both'), name: '' }
    return { type: w.sexOf(missing) === 'F' ? 'mother' : 'father', to: target, other: missing, otherParentId: null, label: childLabel }
  }
  const s = source.person
  if (s === target) return null
  const mine = parentsOf(s)
  if (mine.includes(target)) {
    // Dropped on a parent the person already has: the other parent link goes, so this one is the only parent.
    if (mine.length === 1) return { refuse: ONLY_PARENT }
    return { set: { childId: s, parentIds: [target] }, label: i18n('Make a child of {name} only'), name: target }
  }
  if (parentsOf(target).includes(s) || (w.spouses.get(s) ?? []).includes(target)) return null
  // Positive means the target stands on a younger row.
  const dy = (w.rowOf(target) - w.rowOf(s)) * (w.rootsBelow ? -1 : 1)
  if (dy < 0) {
    if (mine.length >= 2) {
      // A third parent takes the place of the one of the same sex.
      if (!sex || sex === 'U') return { refuse: SEX_UNKNOWN }
      const same = mine.filter((id) => w.sexOf(id) === sex)
      if (same.length !== 1) return { refuse: TWO_PARENTS }
      return { set: { childId: s, parentIds: [target, mine.find((id) => id !== same[0])!] }, label: i18n('Replace the parent of the same sex'), name: target }
    }
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

/** A child dragged onto the dot of a couple: their parents become exactly the two. */
export function dropOnCouple(w: LinkWorld, child: string, couple: [string, string]): LinkVerdict {
  const [a, b] = couple
  if (child === a || child === b) return null
  const have = w.parents.get(child) ?? []
  if (have.length === 2 && have.includes(a) && have.includes(b)) return { refuse: BOTH }
  return { set: { childId: child, parentIds: [a, b] }, label: i18n('Make a child of both'), name: '' }
}
