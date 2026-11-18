import { describe, expect, it } from 'vitest'
import { drawGhost, ghostKey, type TrailState } from '../components/map-trails'
import { mercator } from '../lib/map-motion'
import type { Track, TimedStop } from '../lib/map-timeline'

/** A canvas context that logs every call and every globalAlpha change, in order, so two passes can be compared exactly. */
function logger() {
  const log: unknown[] = []
  let alpha = 1
  const ctx = {
    setTransform(...a: unknown[]) { log.push(['setTransform', ...a]) },
    clearRect(...a: unknown[]) { log.push(['clearRect', ...a]) },
    beginPath() { log.push(['beginPath']) },
    closePath() { log.push(['closePath']) },
    moveTo(x: number, y: number) { log.push(['moveTo', x, y]) },
    lineTo(x: number, y: number) { log.push(['lineTo', x, y]) },
    arc(x: number, y: number, r: number, a0: number, a1: number) { log.push(['arc', x, y, r, a0, a1]) },
    stroke() { log.push(['stroke', alpha]) },
    fill() { log.push(['fill', alpha]) },
    strokeStyle: '', fillStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    get globalAlpha() { return alpha },
    set globalAlpha(v: number) { alpha = v; log.push(['globalAlpha', v]) },
  }
  return { ctx, log }
}

const view = (ctx: unknown, zoom: number, at: [number, number] = [0, 0]) => {
  const scale = 2 ** zoom
  const center = mercator(at)
  return { ctx: ctx as CanvasRenderingContext2D, scale, ox: center[0] * scale - 720, oy: center[1] * scale - 450, w: 1440, h: 900, dpr: 1 }
}

// Invented places, far apart; the coordinates are made up.
const P: [number, number][] = [[10, -60], [-20, 40], [35, 95], [-45, -10], [5, 150], [60, -120], [-5, 20], [25, 70], [-30, 125], [48, 5]]

const stop = (at: [number, number], year: number, kind: TimedStop['kind'], place: string): TimedStop =>
  ({ lat: at[0], lon: at[1], place, year, date: String(year), what: kind, kind, time: year })

/** Six invented lives: some ended with a death year, some with the death unknown, one still living, one with no birth year. */
const tracks: Track[] = [
  { personId: 'ant', name: 'Ant', born: 1880, died: 1930, living: false, stops: [stop(P[0], 1880, 'birth', 'Velmar'), stop(P[1], 1905, 'move', 'Corbiny'), stop(P[2], 1921, 'move', 'Tessaly')] },
  { personId: 'bea', name: 'Bea', born: 1890, died: null, living: false, stops: [stop(P[3], 1890, 'birth', 'Oddmere'), stop(P[4], 1912, 'move', 'Lanoy'), stop(P[5], 1940, 'move', 'Quendra')] },
  { personId: 'cal', name: 'Cal', born: 1900, died: 1945, living: false, stops: [stop(P[6], 1900, 'birth', 'Hesk'), stop(P[7], 1933, 'move', 'Ardwen')] },
  { personId: 'dov', name: 'Dov', born: null, died: 1950, living: false, stops: [stop(P[8], 1930, 'move', 'Brisk'), stop(P[9], 1938, 'move', 'Mirelle'), stop(P[0], 1948, 'move', 'Velmar')] },
  { personId: 'eli', name: 'Eli', born: 1950, died: null, living: true, stops: [stop(P[1], 1950, 'birth', 'Corbiny'), stop(P[4], 1968, 'move', 'Lanoy'), stop(P[6], 1975, 'move', 'Hesk'), stop(P[7], 1982, 'move', 'Ardwen')] },
  { personId: 'fay', name: 'Fay', born: 1915, died: 1975, living: false, stops: [stop(P[2], 1915, 'birth', 'Tessaly'), stop(P[5], 1930, 'move', 'Quendra'), stop(P[3], 1948, 'move', 'Oddmere'), stop(P[8], 1960, 'move', 'Pellin')] },
]

const state = (year: number, extra: Partial<TrailState> = {}): TrailState =>
  ({ tracks, year, positions: new Map(), pulses: [], ink: '#2a2620', focus: null, line: null, ...extra })

/** The grid of years: 0.5-year steps over the span of the six lives, with the first and last year outside any life too. */
const YEARS: number[] = []
for (let y = 1870; y <= 1990; y += 0.5) YEARS.push(y)

/** Every pair of years with equal keys is compared: the drawings must match, in both orders (i before j and j before i). */
function purityFailures(departed: boolean, zoom: number): string[] {
  const drawings = YEARS.map((year) => {
    const { ctx, log } = logger()
    drawGhost(view(ctx, zoom), state(year, { departed }))
    return JSON.stringify(log)
  })
  const keys = YEARS.map((year) => ghostKey(state(year, { departed })))
  const failures: string[] = []
  for (let i = 0; i < YEARS.length; i++) {
    for (let j = 0; j < YEARS.length; j++) {
      if (i === j || keys[i] !== keys[j]) continue
      if (drawings[i] !== drawings[j]) failures.push(`${departed ? 'dead kept' : 'recent'} zoom ${zoom}: ${YEARS[i]} vs ${YEARS[j]}`)
    }
  }
  return failures
}

describe('the ghost canvas is a pure function of its cache key', () => {
  // Zoom 2 shows the whole world, so every invented life is on the canvas and its line can change between years.
  it('draws identically for any two years with the same ghostKey, in both orders', () => {
    const failures = [...purityFailures(false, 2), ...purityFailures(true, 2)]
    expect(failures.slice(0, 3)).toEqual([])
    expect(failures.length).toBe(0)
  })

  it('is not vacuous: the drawings do change across years, and some years share a key', () => {
    const keys = YEARS.map((year) => ghostKey(state(year)))
    expect(new Set(keys).size).toBeGreaterThan(1)
    expect(new Set(keys).size).toBeLessThan(YEARS.length)
    const drawn = YEARS.map((year) => { const { ctx, log } = logger(); drawGhost(view(ctx, 2), state(year)); return JSON.stringify(log) })
    expect(new Set(drawn).size).toBeGreaterThan(1)
  })
})

describe('one line for a traveller, and none for the gone', () => {
  const only = (id: string): Track[] => tracks.filter((t) => t.personId === id)
  const segs = (id: string, year: number) => { const { ctx, log } = logger(); drawGhost(view(ctx, 2), state(year, { tracks: only(id) })); return log.filter((c) => (c as unknown[])[0] === 'lineTo').length }
  it('lets the earlier journey go while a new one is under way, and brings it back when the clock turns back', () => {
    // Ant arrives at Corbiny in 1905 and sets out for Tessaly in 1919.5.
    const before = segs('ant', 1915), under = segs('ant', 1920), after = segs('ant', 1922)
    expect(before).toBeGreaterThan(0)
    expect(under).toBe(0)
    expect(after).toBeGreaterThan(0)
    expect(segs('ant', 1915)).toBe(before)
  })
  it('draws nothing of a life that has ended, forward or back, and the same again on the way back', () => {
    const years = [1925, 1930.9, 1931, 1940, 1931, 1930.9, 1925]
    const got = years.map((y) => segs('ant', y))
    expect(got[2]).toBe(0)
    expect(got[3]).toBe(0)
    expect(got[0]).toBeGreaterThan(0)
    expect(got.slice(4)).toEqual([got[2], got[1], got[0]].map((_, i) => [0, got[1], got[0]][i]))
  })
})
