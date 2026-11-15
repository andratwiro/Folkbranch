// Where each person was, year by year, for the map with a timeline: every dated event with a place that has a point
// on a map, in order. What has no place, no point or no year is listed apart, so the gaps in the archive show.
// lib/places.ts's lifeStops is the Places map's version of this; it cannot be shared: it drops what has no point or no
// year without saying why, merges repeat visits, and keeps no kinds, years or life-span rules, which all of this needs.
import { along, easeInOut, easeInOutInverse, legPath, wrapLon, type Path } from './map-motion'
import { findPlace, onMap } from './places'
import { personName, yearOf, type Graph, type Place } from './types'

/** What kind of event, for its small mark on the map. */
export type EventKind = 'birth' | 'death' | 'union' | 'move' | 'work' | 'other'
export interface TimedStop {
  lat: number; lon: number; place: string; year: number; date: string; what: string; kind: EventKind
  /** When it is shown: its year, or a share into it when several places fall in one year, so each is seen. */
  time: number
  /** The union a marriage stop stands for: it is a stop for both partners but one event. */
  union?: string
}
export interface Track { personId: string; name: string; born: number | null; died: number | null; living: boolean; stops: TimedStop[] }
export type Gap = 'no-place' | 'no-coords' | 'no-date' | 'outside-span'
export interface Unplaced { personId: string; name: string; what: string; date: string; place: string; gap: Gap }
/** Someone with nowhere to stand: not one event with both a place that has a point and a year. */
export interface Absent { personId: string; name: string; gaps: Unplaced[] }
export interface MapTimeline { tracks: Track[]; missing: Unplaced[]; absent: Absent[]; min: number; max: number }

/**
 * Spanish and Catalan fact names, as the tables write the fact menu and the GEDCOM kinds (lib/i18n-es.ts,
 * lib/i18n-ca.ts), plus the usual other words for them; folded (no accents, lower case) and matched as whole words.
 */
const ES_CA: Record<Exclude<EventKind, 'other'>, string[]> = {
  move: ['residencia', 'domicilio', 'domicili', 'mudanza', 'traslado', 'trasllat', 'emigracion', 'emigracio', 'inmigracion', 'immigracio', 'exilio', 'exili', 'censo', 'cens', 'padron', 'padro'],
  work: ['profesion', 'professio', 'ocupacion', 'ocupacio', 'ofici', 'oficio', 'trabajo', 'treball', 'feina', 'empleo', 'estudios', 'estudis', 'graduacion', 'escuela', 'escola', 'servicio militar', 'servei militar'],
  birth: ['nacimiento', 'naixement', 'bautismo', 'bautizo', 'bateig'],
  death: ['defuncion', 'defuncio', 'muerte', 'mort', 'entierro', 'enterrament', 'sepultura', 'sepelio'],
  union: ['matrimonio', 'matrimoni', 'boda', 'casamiento', 'casament', 'noces'],
}
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const wholeWords = (words: string[]) => new RegExp(`(?<![\\p{L}\\d])(?:${words.join('|')})(?![\\p{L}\\d])`, 'u')
const ES_CA_RE = Object.fromEntries(Object.entries(ES_CA).map(([k, w]) => [k, wholeWords(w)])) as Record<keyof typeof ES_CA, RegExp>
/** Whether a Spanish or Catalan kind is of this sort. Russian and English go by the stems below, as before. */
const esCa = (kind: string, sort: keyof typeof ES_CA) => ES_CA_RE[sort].test(fold(kind))

/** A fact's kind as written, in any of the four languages, sorted into the few marks the map draws. */
export const factKind = (kind: string): EventKind =>
  /жит|переезд|переселен|эмигр|resid|lived|moved|move|emigra|immigra|exil|census|перепис|domicil|vivi/i.test(kind) || esCa(kind, 'move') ? 'move'
    : /работ|служб|професс|должн|occupa|work|job|employ|militar|service|trabaj|ofici|educa|учёб|учеб|school/i.test(kind) || esCa(kind, 'work') ? 'work'
      : /крещ|рожд|baptis|christen|birth/i.test(kind) || esCa(kind, 'birth') ? 'birth'
        : /смерт|похор|death|burial|buried|defunc/i.test(kind) || esCa(kind, 'death') ? 'death'
          : /брак|венч|marri|wedding|boda|matrimon/i.test(kind) || esCa(kind, 'union') ? 'union' : 'other'

/** A year from a free-text date: "1937–1942", "c. 1850", "h. 1902", "julio de 1936", "1936-07-18". The first year wins. */
export const eventYear = (date: string): number | null => inYears(yearOf(date ?? ''))
/** A year the map can stand on: "0000" or "850" in a field is a typing slip, not the year 850. */
const inYears = (y: number | null | undefined): number | null => (y != null && y >= 1000 && y <= 2200 ? y : null)

export function mapTimeline(graph: Graph, places: Place[], t: (k: string) => string = (k) => k): MapTimeline {
  const byId = new Map(graph.persons.map((p) => [p.id, p]))
  const now = new Date().getFullYear()
  const tracks: Track[] = []
  const missing: Unplaced[] = []
  const absent: Absent[] = []
  for (const p of graph.persons) {
    if (p.hidden) continue
    const name = personName(p) || t('Без имени')
    const born = inYears(p.birthYear) ?? eventYear(p.birthDate)
    const died = inYears(p.deathYear) ?? eventYear(p.deathDate)
    const stops: TimedStop[] = []
    const add = (text: string, date: string, what: string, fallbackYear: number | null = null, kind: EventKind = 'other', union?: string) => {
      const year = eventYear(date) ?? fallbackYear
      if (!text.trim()) { if (year !== null || what === t('Рождение')) missing.push({ personId: p.id, name, what, date, place: '', gap: 'no-place' }); return }
      const place = findPlace(text, places)
      if (!onMap(place)) return void missing.push({ personId: p.id, name, what, date, place: text, gap: 'no-coords' })
      if (year === null) return void missing.push({ personId: p.id, name, what, date, place: text, gap: 'no-date' })
      stops.push({ lat: place.lat, lon: place.lon, place: text.trim(), year, date: date || String(year), what, kind, time: year, ...(union ? { union } : {}) })
    }
    add(p.birthPlace, p.birthDate, t('Рождение'), born, 'birth')
    for (const u of graph.unions) {
      if (u.aId !== p.id && u.bId !== p.id) continue
      const other = byId.get(u.aId === p.id ? u.bId : u.aId)
      // A partner hidden from this reader hides the marriage too, as the Places list and the life chronology do.
      if (other?.hidden) continue
      const label = t(u.kind === 'civil' ? 'Союз' : 'Брак')
      add(u.place, u.startDate, other ? `${label}: ${personName(other)}` : label, null, 'union', u.id)
    }
    for (const f of p.facts) add(f.place, f.date, t(f.kind), null, factKind(f.kind))
    if (p.deathPlace || died !== null) add(p.deathPlace, p.deathDate, t('Смерть'), died, 'death')
    // A fact outside this life (more than 90 years before a death with no birth, before a birth, after a death
    // unless it is a burial or a will, or still to come) is a data error: it neither places the person nor stretches
    // the timeline.
    const lo = born ?? (died !== null ? died - SPAN_YEARS : -Infinity)
    const hi = Math.min(now, died ?? (born !== null ? born + MAX_AGE : Infinity))
    for (let i = stops.length - 1; i >= 0; i--) {
      const st = stops[i]
      const afterDeathOk = died !== null && st.year > died && st.year <= now && (st.kind === 'death' || afterDeath(st.what))
      if (st.year >= lo && (st.year <= hi || afterDeathOk)) continue
      missing.push({ personId: p.id, name, what: st.what, date: st.date, place: st.place, gap: 'outside-span' })
      stops.splice(i, 1)
    }
    // Same year: birth first, death last, the rest as written.
    const rank = (s: TimedStop) => (s.what === t('Рождение') ? -1 : s.what === t('Смерть') ? 1 : 0)
    stops.sort((a, b) => a.year - b.year || rank(a) - rank(b))
    // Several places in one year share it out, so each is stood at for a while instead of passed in no time.
    for (let i = 0; i < stops.length;) {
      let j = i
      while (j < stops.length && stops[j].year === stops[i].year) j++
      const places = new Set(stops.slice(i, j).map((s) => `${s.lat},${s.lon}`)).size
      if (places > 1) for (let k = i; k < j; k++) stops[k].time = stops[k].year + (k - i) / (j - i)
      i = j
    }
    if (stops.length) tracks.push({ personId: p.id, name, born, died, living: p.living, stops })
    else absent.push({ personId: p.id, name, gaps: missing.filter((m) => m.personId === p.id) })
  }
  // The slider spans people's lives, not raw facts, in whole decades; never past this year, and never backwards.
  const spans = tracks.map(lifeSpan)
  const max = spans.length ? Math.min(now, Math.ceil(Math.max(...spans.map((x) => Math.min(x[1], now))) / 10) * 10) : now
  const min = Math.min(max, spans.length ? Math.floor(Math.min(...spans.map((x) => x[0])) / 10) * 10 : now - 100)
  return { tracks, missing, absent, min, max }
}

/** How long a move takes on the map, at most: people stay put, then travel in the last stretch before the next stop. */
export const MOVE_YEARS = 1.5

/** One journey between two stops at different places: when it starts and ends, and the way it takes. */
export interface Leg { from: TimedStop; to: TimedStop; leave: number; arrive: number; path: Path; /** The year each point of the path is passed. */ at: number[] }

const legsOf = new WeakMap<Track, Leg[]>()
/** A track's journeys, worked out once per track. A stop at the same place as the one before is no journey. */
export function trackLegs(track: Track): Leg[] {
  let legs = legsOf.get(track)
  if (legs) return legs
  legs = []
  for (let i = 1; i < track.stops.length; i++) {
    const a = track.stops[i - 1], b = track.stops[i]
    if (a.lat === b.lat && a.lon === b.lon) continue
    // Close stops share the time between them: half stood at the first, half on the way, so neither is skipped.
    const leave = Math.max((a.time + b.time) / 2, b.time - MOVE_YEARS), arrive = b.time
    const path = legPath([a.lat, a.lon], [b.lat, b.lon])
    legs.push({ from: a, to: b, leave, arrive, path, at: path.cum.map((c) => leave + (arrive - leave) * easeInOutInverse(c)) })
  }
  legsOf.set(track, legs)
  return legs
}

export interface Position { lat: number; lon: number; at: TimedStop; moving: TimedStop | null; /** The journey under way, and how far along it (0–1, eased). */ leg: Leg | null; progress: number }

/** How far back from a death a life is taken to reach when the birth is unknown, and forward from a birth. */
const SPAN_YEARS = 90
/** Facts later than this after a birth, with no death written, cannot be about the same person. */
const MAX_AGE = 120
/** Kinds that may come after a death: burial, a will, an estate. Spanish and Catalan as folded whole words too. */
const AFTER_DEATH = /burial|buried|probate|will|testament|estate|похор|завещ|наслед|entierro|sepel|testam|sucesi/i
const AFTER_DEATH_ES_CA = wholeWords(['entierro', 'enterrament', 'sepultura', 'sepelio', 'cremacion', 'cremacio', 'testamento', 'testament', 'herencia', 'sucesion', 'successio'])
const afterDeath = (what: string) => AFTER_DEATH.test(what) || AFTER_DEATH_ES_CA.test(fold(what))

/** A life's span on the map: birth to death, guessed when one end is missing (90 years back from a death, or 90 forward from a birth). */
export function lifeSpan(track: Track): [number, number] {
  const now = new Date().getFullYear()
  const first = track.stops[0].year, last = track.stops.at(-1)!.year
  const start = track.born ?? (track.died !== null ? track.died - SPAN_YEARS : first)
  const end = track.died ?? (track.living ? Infinity : Math.max(last, track.born !== null ? Math.min(track.born + SPAN_YEARS, now) : last))
  return [Math.min(start, first), end]
}

/**
 * Where a person is at a moment (a year with a fraction: 1888.5 is the middle of 1888), or null outside their life.
 * Before their first placed event they stand at its place, after the last at the last: someone with one known place
 * stays there all their life, so the map is not empty. At a stop's own year they are exactly at the stop.
 */
export function positionAt(track: Track, year: number): Position | null {
  const [start, end] = lifeSpan(track)
  // A life ends at the end of its last year, so the death year is still shown whole.
  if (year < start || year >= end + 1) return null
  const first = track.stops[0]
  const still = (at: TimedStop): Position => ({ lat: at.lat, lon: at.lon, at, moving: null, leg: null, progress: 0 })
  if (year < first.time) return still(first)
  let i = 0
  while (i + 1 < track.stops.length && track.stops[i + 1].time <= year) i++
  const at = track.stops[i], next = track.stops[i + 1]
  if (!next) return still(at)
  const leg = trackLegs(track).find((l) => l.to === next)
  if (!leg || year <= leg.leave) return still(at)
  const progress = easeInOut((year - leg.leave) / (leg.arrive - leg.leave))
  const [lat, lon] = along(leg.path, progress)
  // A journey over the 180° meridian is worked out in one piece; the face itself stays on the one world drawn.
  return { lat, lon: wrapLon(lon), at, moving: next, leg, progress }
}

/** Since when someone stands where they are at a moment: the first year of their run of stops at that place. */
export function sinceAt(track: Track, pos: Position): number {
  const i = track.stops.indexOf(pos.at)
  if (i < 0) return pos.at.year
  // Before their first placed event they are taken to have stood there from the start of their life.
  if (i === 0) return Math.min(pos.at.year, lifeSpan(track)[0])
  let j = i
  while (j > 0 && track.stops[j - 1].lat === pos.at.lat && track.stops[j - 1].lon === pos.at.lon) j--
  return j === 0 ? Math.min(track.stops[0].year, lifeSpan(track)[0]) : track.stops[j].year
}

/** One place on a life's route: the numbers of the visits made there (1, 2, 3 … in time) and the year each began. */
export interface RouteStop { lat: number; lon: number; place: string; visits: number[]; years: number[] }

/** A life as a route: each run of stops at one place is a visit, numbered in time; a place visited twice is one mark. */
export function routeStops(track: Track): RouteStop[] {
  const out: RouteStop[] = []
  let n = 0, prev: TimedStop | null = null
  for (const st of track.stops) {
    if (prev && prev.lat === st.lat && prev.lon === st.lon) continue
    prev = st
    n++
    const same = out.find((r) => r.lat === st.lat && r.lon === st.lon)
    if (same) { same.visits.push(n); same.years.push(st.year) }
    else out.push({ lat: st.lat, lon: st.lon, place: st.place, visits: [n], years: [st.year] })
  }
  return out
}

/** Points that frame a whole route: every stop, and points along each journey (a great circle bulges past its ends). */
export function routePoints(track: Track): [number, number][] {
  const out: [number, number][] = track.stops.map((s) => [s.lat, s.lon])
  for (const leg of trackLegs(track)) for (const f of [0.25, 0.5, 0.75]) { const [lat, lon] = along(leg.path, f); out.push([lat, wrapLon(lon)]) }
  return out
}
