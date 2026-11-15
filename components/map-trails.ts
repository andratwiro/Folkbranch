// Where people have been, on one canvas for everyone. The last years of a journey are drawn in ink, thick at the
// traveller and thinning to a hairline behind, so the way of travel shows without arrows. Everything older stays as
// a faint ghost of the same curves; where many took the same way, the ghosts overlap and read darker, and the
// family's routes build up as the years play. A short ring marks an event as it happens.
import type { Thread, ThreadSeg } from '@/lib/map-line'
import { along, easeInOut, mercator, type World } from '@/lib/map-motion'
import { trackLegs, type Leg, type Position, type Track } from '@/lib/map-timeline'
import type { View } from './map-canvas'

/** How many years a trail stays in full ink behind its traveller. */
export const RECENT_YEARS = 12
/** Ink of the ghost of older trails. */
const GHOST = 0.3
const HEAD_PX = 2.5, TAIL_PX = 0.35
/** The dot where a finished journey arrived. */
const END_PX = 1.8
/** The recent stretch is drawn in this many steps of width and ink, each one stroke, so nothing is inked twice. */
const BANDS = 12
/** While someone is followed, everyone else's ink is this much quieter. */
const QUIET = 0.4
/** How long the ring of an event lasts, in ms. */
export const PULSE_MS = 700

export interface Pulse { at: World; t0: number }
/** A traveller's point on their journey's own way (not put back on the one world), so the line meets the face. */
const headOf = (pos: Position): World => mercator(pos.leg ? along(pos.leg.path, pos.progress) : [pos.lat, pos.lon])
/** A line of descent followed: its thread, everyone in it, and a key that changes with it (for the ghost cache). */
export interface LineDraw { thread: Thread; ids: Set<string>; key: string }
export interface TrailState { tracks: Track[]; year: number; positions: Map<string, Position | null>; pulses: Pulse[]; ink: string; accent?: string; focus: Track | null; line?: LineDraw | null }

/** The thread: ahead of the clock a faint outline, behind it full ink; an assumed link is dashed in both. */
const THREAD_AHEAD = 0.2, THREAD_INK = 0.9, THREAD_PX = 2.4, LINK_PX = 1.6, DASH = [5, 5]
/** What a bearer did after handing over, quieter than the thread but plainly theirs. */
const BRANCH = 0.42
/** A segment's points in world pixels, worked out once. */
const worlds = new WeakMap<ThreadSeg, World[]>()
const worldOf = (seg: ThreadSeg) => { let w = worlds.get(seg); if (!w) { w = seg.pts.map(mercator); worlds.set(seg, w) } return w }

/** World width at zoom 0, for drawing a journey over the 180° meridian once more, one world over. */
const WORLD = 256

/** The finished journeys' ghosts, drawn once into a canvas of their own per trails canvas, and reused every frame. */
const ghosts = new WeakMap<HTMLCanvasElement, { canvas: HTMLCanvasElement; key: string; tracks: Track[]; done: number }>()

export function drawTrails({ ctx, scale: s, ox, oy, w: cw, h: ch, dpr }: View, st: TrailState) {
  const { year } = st
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.strokeStyle = st.ink
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  let shift = 0
  const X = (w: World) => (w[0] + shift) * s - ox, Y = (w: World) => w[1] * s - oy
  const focusId = st.focus?.personId
  const line = st.line ?? null
  const quiet = focusId || line ? QUIET : 1
  /** Whose trails are drawn some other way: the person followed, or everyone in the line. */
  const apart = (id: string) => id === focusId || !!line?.ids.has(id)
  /** A journey's way, as one stroke; again one world over when it runs past the 180° meridian. */
  const stroke = (leg: Leg, n: number, head: World | null, g = ctx) => {
    for (const sh of leg.path.wraps ? [0, -leg.path.wraps * WORLD] : [0]) {
      shift = sh
      const { world } = leg.path
      g.beginPath()
      g.moveTo(X(world[0]), Y(world[0]))
      for (let i = 1; i < n; i++) g.lineTo(X(world[i]), Y(world[i]))
      if (head) g.lineTo(X(head), Y(head))
      g.stroke()
    }
    shift = 0
  }

  // The ghost: one stroke per journey, so journeys on the same way add up and shared routes read darker. Finished
  // journeys come from the retained layer, drawn again only when one more finishes or the view changes.
  let done = 0
  for (const tr of st.tracks) {
    if (apart(tr.personId)) continue
    for (const leg of trackLegs(tr)) { if (leg.arrive > year) break; done++ }
  }
  const key = `${s},${ox},${oy},${cw},${ch},${dpr},${focusId},${line?.key},${st.ink}`
  let cache = ghosts.get(ctx.canvas)
  if (!cache || cache.key !== key || cache.tracks !== st.tracks || cache.done !== done) {
    const canvas = cache?.canvas ?? document.createElement('canvas')
    if (canvas.width !== ctx.canvas.width || canvas.height !== ctx.canvas.height) { canvas.width = ctx.canvas.width; canvas.height = ctx.canvas.height }
    const g = canvas.getContext('2d')!
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, canvas.width, canvas.height)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.strokeStyle = g.fillStyle = st.ink
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.lineWidth = 1.2
    g.globalAlpha = GHOST * quiet
    for (const tr of st.tracks) {
      if (apart(tr.personId)) continue
      for (const leg of trackLegs(tr)) {
        if (leg.arrive > year) break
        stroke(leg, leg.path.world.length, null, g)
        // Where it came in, a small dot, so a route whose traveller has gone still ends at a place.
        const end = mercator([leg.to.lat, leg.to.lon])
        g.beginPath()
        g.arc(X(end), Y(end), END_PX, 0, Math.PI * 2)
        g.fill()
      }
    }
    cache = { canvas, key, tracks: st.tracks, done }
    ghosts.set(ctx.canvas, cache)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(cache.canvas, 0, 0)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  for (const tr of st.tracks) {
    if (apart(tr.personId)) continue
    const pos = st.positions.get(tr.personId)
    // Journeys under way: their ghost so far, live.
    ctx.globalAlpha = GHOST * quiet
    ctx.lineWidth = 1.2
    for (const leg of trackLegs(tr)) {
      if (leg.leave >= year) break
      if (leg.arrive <= year) continue
      let n = 0
      while (n < leg.path.world.length && leg.at[n] <= year) n++
      stroke(leg, n, pos?.leg === leg ? headOf(pos) : null)
    }
    recent(tr, pos ?? null, quiet)
  }
  // The person followed: their whole life as one route in ink, and their recent travel over it.
  if (st.focus) {
    ctx.globalAlpha = 0.78
    ctx.lineWidth = 1.7
    for (const leg of trackLegs(st.focus)) stroke(leg, leg.path.world.length, null)
    recent(st.focus, st.positions.get(st.focus.personId) ?? null, 1)
  }

  if (line) drawLine(line.thread)

  /** A piece of the thread up to a year (all of it with Infinity): one stroke, again one world over past ±180°. */
  function seg(sg: ThreadSeg, until: number) {
    const w = worldOf(sg), { at } = sg
    if (at[0] > until) return
    let n = 0
    while (n < w.length && at[n] <= until) n++
    // The point between the last one passed and the next, so the thread meets the traveller.
    let head: World | null = null
    if (n < w.length && n > 0) { const f = (until - at[n - 1]) / (at[n] - at[n - 1] || 1); head = [w[n - 1][0] + (w[n][0] - w[n - 1][0]) * f, w[n - 1][1] + (w[n][1] - w[n - 1][1]) * f] }
    if (n < 2 && !head) return
    const lons = sg.pts.map((p) => p[1])
    const wraps = Math.max(...lons) > 180 ? 1 : Math.min(...lons) < -180 ? -1 : 0
    for (const sh of wraps ? [0, -wraps * WORLD] : [0]) {
      shift = sh
      ctx.beginPath()
      ctx.moveTo(X(w[0]), Y(w[0]))
      for (let i = 1; i < n; i++) ctx.lineTo(X(w[i]), Y(w[i]))
      if (head) ctx.lineTo(X(head), Y(head))
      ctx.stroke()
    }
    shift = 0
  }
  /** A line of descent: side branches quiet, the whole thread faint, and in ink as far as the clock has come. */
  function drawLine(th: Thread) {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.globalAlpha = BRANCH
    ctx.lineWidth = 1.3
    for (const b of th.branches) for (const sg of b.segs) seg(sg, year)
    const all = th.stretches.flatMap((x) => x.segs)
    for (const [alpha, until] of [[THREAD_AHEAD, Infinity], [THREAD_INK, year]] as const) {
      ctx.globalAlpha = alpha
      for (const sg of all) {
        const dashed = sg.kind === 'link'
        ctx.setLineDash(dashed ? DASH : [])
        ctx.lineWidth = dashed ? LINK_PX : THREAD_PX
        seg(sg, until)
      }
    }
    ctx.setLineDash([])
  }

  /**
   * A traveller's last years, thick and dark at them and thinning behind, continuous across journeys: the stretch is
   * cut into bands by age and each band is one stroke with round joins, so where two short journeys meet there is
   * no doubled ink and no kink.
   */
  function recent(tr: Track, pos: Position | null, k0: number) {
    const pts: World[] = [], at: number[] = []
    let wraps = 0
    for (const leg of trackLegs(tr)) {
      if (leg.leave >= year) break
      if (year - leg.arrive > RECENT_YEARS) continue
      const { world } = leg.path
      wraps ||= leg.path.wraps
      for (let i = 0; i < world.length && leg.at[i] <= year; i++) { pts.push(world[i]); at.push(leg.at[i]) }
      if (pos?.leg === leg) { pts.push(headOf(pos)); at.push(year) }
    }
    for (const sh of wraps ? [0, -wraps * WORLD] : [0]) { shift = sh; bands(pts, at, k0) }
    shift = 0
  }
  function bands(pts: World[], at: number[], k0: number) {
    let band = -1, open = false
    const style = (b: number) => {
      const k = ((b + 0.5) / BANDS) ** 2
      ctx.globalAlpha = (0.2 + 0.75 * k) * k0
      ctx.lineWidth = TAIL_PX + (HEAD_PX - TAIL_PX) * k
    }
    ctx.lineCap = 'butt'
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i]
      if (a[0] === b[0] && a[1] === b[1]) continue
      // One journey ran on past the 180° meridian and the next starts back on the world: not a line across it.
      if (Math.abs(a[0] - b[0]) > WORLD / 2) { if (open) ctx.stroke(); open = false; band = -1; continue }
      const age = (year - (at[i - 1] + at[i]) / 2) / RECENT_YEARS
      if (age >= 1) { if (open) ctx.stroke(); open = false; band = -1; continue }
      const nb = Math.min(BANDS - 1, Math.floor((1 - age) * BANDS))
      if (nb !== band || !open) {
        if (open) ctx.stroke()
        band = nb
        style(nb)
        ctx.beginPath()
        ctx.moveTo(X(a), Y(a))
        open = true
      }
      ctx.lineTo(X(b), Y(b))
    }
    // The newest band ends in a round tip at the traveller.
    if (open) { ctx.lineCap = 'round'; ctx.stroke() }
    ctx.lineCap = 'round'
  }

  // Events as they happen: a ring that opens and fades.
  const now = performance.now()
  st.pulses = st.pulses.filter((p) => now - p.t0 < PULSE_MS)
  ctx.lineWidth = 1.25
  for (const p of st.pulses) {
    const e = easeInOut(Math.min(1, (now - p.t0) / PULSE_MS) * 0.5 + 0.5) * 2 - 1 // ease-out half of the curve
    ctx.globalAlpha = 0.7 * (1 - e)
    ctx.beginPath()
    ctx.arc(X(p.at), Y(p.at), 6 + 16 * e, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}
