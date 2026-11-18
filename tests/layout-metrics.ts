// Numbers that say how tidy the lines of a finished chart are, read off the paths themselves. The same
// numbers are measured before and after a change to routing or placement, so a change can be judged by them.
import { CARD_W, layoutFamily, PITCH, type Layout } from '../lib/graph/layout'
import type { Graph } from '../lib/types'
import { PEOPLE, UNIONS } from '../lib/demo'
import type { Person } from '../lib/types'
import { buildGraph, nearLines, quality } from './layout-quality'

/** The corner radius the routing draws (lib/graph/layout.ts, CORNER). */
const CORNER = 8
/** A straight run between two bends shorter than this reads as a jog, not as a line. */
const JOG = 3 * CORNER

type Pt = [number, number]
/** The corner points of a path made by `orthogonal`: where it starts, bends and ends, and the radius each bend was drawn with. */
export function corners(d: string) {
  const tokens = [...d.matchAll(/([MLHVQ])([-\d. ]+)/g)].map((m) => ({ c: m[1], n: m[2].trim().split(/\s+/).map(Number) }))
  const vertices: Pt[] = []
  const radii: number[] = []
  let last: Pt = [0, 0]
  tokens.forEach((t, i) => {
    if (t.c === 'M') { last = [t.n[0], t.n[1]]; vertices.push(last) }
    else if (t.c === 'Q') { vertices.push([t.n[0], t.n[1]]); radii.push(Math.hypot(t.n[0] - last[0], t.n[1] - last[1])); last = [t.n[2], t.n[3]] }
    else {
      last = t.c === 'L' ? [t.n[0], t.n[1]] : t.c === 'H' ? [t.n[0], last[1]] : [last[0], t.n[0]]
      if (tokens[i + 1]?.c !== 'Q') vertices.push(last)
    }
  })
  return { vertices, radii }
}

const round = (n: number, k = 2) => +n.toFixed(k)
const percentile = (xs: number[], p: number) => (xs.length ? xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : 0)

export function lineMetrics(g: Graph, opts: Parameters<typeof layoutFamily>[1] = {}) {
  const started = performance.now()
  const l: Layout = layoutFamily(g, opts)
  const ms = performance.now() - started
  const runs = new Map<string, number>() // every straight run once, however many siblings share it
  const jogs = new Set<string>()
  let cornersAll = 0, cornersClamped = 0
  let bends = 0, maxBends = 0, longest = 0, wide = 0
  const addPath = (d: string, link: boolean) => {
    const { vertices, radii } = corners(d)
    cornersAll += radii.length
    cornersClamped += radii.filter((r) => r < CORNER - 0.01).length
    let travel = 0
    vertices.forEach((v, i) => {
      if (!i) return
      const p = vertices[i - 1]
      const len = Math.abs(v[0] - p[0]) + Math.abs(v[1] - p[1])
      const key = [p, v].map((q) => q.join(',')).sort().join('>')
      runs.set(key, len)
      if (p[1] === v[1]) travel += len
      if (i > 1 && i < vertices.length - 1 && len < JOG) jogs.add(key)
    })
    if (link) {
      bends += radii.length
      maxBends = Math.max(maxBends, radii.length)
      longest = Math.max(longest, travel)
      if (travel > 3 * CARD_W) wide++
    }
  }
  for (const e of l.edges) addPath(e.path, true)
  for (const u of l.unions) addPath(u.path, false)
  const q = quality(l, g)
  // How far each child stands from the middle of its parents, in card widths.
  const parentsOf = Map.groupBy(g.parentChild, (p) => p.childId)
  const span: number[] = []
  for (const [child, ps] of parentsOf) {
    const c = l.cards.get(child), xs = ps.map((p) => l.cards.get(p.parentId)?.x).filter((x): x is number => x !== undefined)
    if (c && xs.length) span.push(Math.abs(c.x - xs.reduce((a, b) => a + b, 0) / xs.length) / CARD_W)
  }
  // Strangers standing under a bar: cards of the bar's row, between its ends, that are neither its children nor their partners.
  const partners = new Map<string, string[]>()
  for (const u of g.unions) { partners.set(u.aId, [...(partners.get(u.aId) ?? []), u.bId]); partners.set(u.bId, [...(partners.get(u.bId) ?? []), u.aId]) }
  let strangers = 0, barsWithStrangers = 0
  for (const members of Map.groupBy(l.edges, (e) => e.group).values()) {
    const kids = new Set(members.map((e) => e.childId))
    const own = new Set([...kids, ...[...kids].flatMap((k) => partners.get(k) ?? [])])
    const xs = [...kids].map((k) => l.cards.get(k)!.x)
    const lo = Math.min(...xs, corners(members[0].shared).vertices[0][0]), hi = Math.max(...xs, corners(members[0].shared).vertices[0][0])
    const y = l.cards.get([...kids][0])!.y
    const inside = [...l.cards.values()].filter((c) => c.y === y && c.x > lo && c.x < hi && !own.has(c.id)).length
    strangers += inside
    if (inside) barsWithStrangers++
  }
  const ys = [...new Set([...l.cards.values()].map((c) => c.y))].sort((a, b) => a - b)
  const pitches = ys.slice(1).map((y, i) => y - ys[i])
  const n = g.persons.length
  return {
    people: n,
    totalLengthPerPerson: round([...runs.values()].reduce((a, b) => a + b, 0) / n / CARD_W),
    longestLinkCards: round(longest / CARD_W),
    linksOver3Cards: wide,
    meanSpanCards: round(span.reduce((a, b) => a + b, 0) / Math.max(1, span.length)),
    p95SpanCards: round(percentile(span, 0.95)),
    maxSpanCards: round(Math.max(0, ...span)),
    barsWithStrangers,
    strangersUnderBars: strangers,
    crossings: q.crossings,
    overlaps: q.overlaps,
    throughCards: q.throughCards,
    nearLines: nearLines(l),
    meanBends: round(bends / Math.max(1, l.edges.length)),
    maxBends,
    jogs: jogs.size,
    clampedCorners: cornersClamped,
    cornersTotal: cornersAll,
    rowPitchMin: Math.round(Math.min(...pitches, Infinity)),
    rowPitchMax: Math.round(Math.max(...pitches, 0)),
    heightPx: q.height,
    widthPx: q.width,
    pitchPx: PITCH,
    layoutMs: Math.round(ms),
  }
}

/** The demo family of lib/demo.ts, as the chart sees it. */
export function demoGraph() {
  const year = (s: string) => +(s.match(/\d{4}/)?.[0] ?? NaN) || undefined
  return buildGraph(
    PEOPLE.map(([id, , , sex, birth]) => [id, sex as Person['sex'], year(birth)]),
    PEOPLE.flatMap(([id, , , , , , , parents]) => (parents ?? []).map((p): [string, string] => [p, id])),
    UNIONS.map(([a, b]): [string, string] => [a, b]),
  )
}

/** Every couple has three children, each of whom marries in: the bushy shape that archives have. */
export function bushyFamily(generations: number) {
  const people: [string, Person['sex'], number?][] = [], parents: [string, string][] = [], unions: [string, string][] = []
  const add = (sex: Person['sex'], y: number) => { const id = `b${people.length}`; people.push([id, sex, y]); return id }
  let couples: [string, string, number][] = [[add('M', 1700), add('F', 1702), 1700]]
  unions.push([couples[0][0], couples[0][1]])
  for (let gen = 1; gen < generations; gen++) {
    const next: [string, string, number][] = []
    for (const [a, b, y] of couples) for (let k = 0; k < 3; k++) {
      const sex = k % 2 ? 'F' : 'M'
      const child = add(sex, y + 25 + k * 2)
      parents.push([a, child], [b, child])
      const spouse = add(sex === 'M' ? 'F' : 'M', y + 26 + k * 2)
      unions.push(sex === 'M' ? [child, spouse] : [spouse, child])
      next.push([child, spouse, y + 25 + k * 2])
    }
    couples = next
  }
  return buildGraph(people, parents, unions)
}
