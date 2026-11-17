// Where faces and words go on the map's screen: which towns share one stack of faces, and which labels fit.
// Pure, in screen pixels, so the rules are tested without a map.

/** A town on screen with people resting there. */
export interface Spot { key: string; x: number; y: number; n: number }

/** Towns closer than this on screen share one stack. */
export const JOIN_PX = 34
/** A town already in a stack stays in it until it is this far away: a small zoom does not make faces hop. */
export const KEEP_PX = 52

/**
 * Which stack each town belongs to: town key → the key of the town the stack stands on. The busiest towns anchor
 * stacks; a town joins the nearest anchor within JOIN_PX, or keeps its stack from last time within KEEP_PX.
 */
export function stackSpots(spots: Spot[], prev: ReadonlyMap<string, string> = new Map(), join = JOIN_PX, keep = KEEP_PX): Map<string, string> {
  const order = [...spots].sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const byKey = new Map(spots.map((s) => [s.key, s]))
  const out = new Map<string, string>()
  const anchors: Spot[] = []
  const d = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.y - b.y)
  // Last time's anchors anchor again while they are still there, so a stack does not change its face.
  const wasAnchor = new Set([...prev.values()].filter((k) => byKey.has(k)))
  for (const s of order.filter((s) => wasAnchor.has(s.key)).concat(order.filter((s) => !wasAnchor.has(s.key)))) {
    const before = prev.get(s.key)
    const kept = before !== undefined && before !== s.key ? anchors.find((a) => a.key === before && d(a, s) < keep) : undefined
    let near: Spot | undefined
    if (!kept) for (const a of anchors) if (d(a, s) < join && (!near || d(a, s) < d(near, s))) near = a
    const to = kept ?? near
    if (to) out.set(s.key, to.key)
    else { anchors.push(s); out.set(s.key, s.key) }
  }
  return out
}

/** A box on screen: left, top, right, bottom. */
export type Box = [number, number, number, number]

/** Boxes already taken on screen, for placing labels greedily so none overlap. */
export class Taken {
  boxes: Box[] = []
  hit = (b: Box) => this.boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])
  add = (b: Box) => { this.boxes.push(b) }
  /** Takes the first box that is free and says which; nothing taken when none is. */
  first = (choices: Box[]): number => {
    const i = choices.findIndex((b) => !this.hit(b))
    if (i >= 0) this.add(choices[i])
    return i
  }
}

/** Faces of one town spread in a ring when the map is close enough: where face i of n goes, in pixels from the town. */
export function ringOffset(i: number, n: number, face = 28): [number, number] {
  if (n <= 1) return [0, 0]
  const r = Math.max(face * 0.75, (n * face) / (2 * Math.PI))
  const a = -Math.PI / 2 + (2 * Math.PI * i) / n
  return [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]
}

/**
 * Where a small mark goes when its own place is already covered by another mark (two towns a few pixels apart at
 * this zoom): the nearest free spot above, below, then beside, as an offset in pixels; [0, 0] when its place is free
 * or nothing near is. The mark is displaced, as on a printed map, rather than hidden under the other.
 */
export function freeOffset(taken: Taken, box: Box): [number, number] {
  if (!taken.hit(box)) return [0, 0]
  const w = box[2] - box[0] + 4, h = box[3] - box[1] + 4
  for (const [dx, dy] of [[0, -h], [0, h], [w, 0], [-w, 0], [0, -2 * h], [0, 2 * h]] as const)
    if (!taken.hit([box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy])) return [dx, dy]
  return [0, 0]
}
