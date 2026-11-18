// What the search looks through for each person, seen as this person is allowed to see it.
import { factWords } from '../fact-kinds'
import { dataStamp, getDb, schema } from '../db'
import { blocksToMarkdown } from '../markdown'
import { buildIndex, search, type SearchDoc, type SearchField, type SearchIndex, type SearchResult } from '../search/engine'
import { normal } from '../search/words'
import { placeWords } from '../places'
import { personName, shownTags, type Person, type Place, type Sex } from '../types'
import { listPlaces } from './places'
import { archiveLang, tell, viewerLangNow } from './app-config'
import { seesOnlyPublic, type Actor } from './core'
import { listAllMedia } from './media'
import { readablePages } from './pages'
import { getGraph } from './people'
import { listStories } from './stories'

/** A web address is full of letters and numbers nobody means: "1" would find every page with a link. */
const noLinks = (text: string) => text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ').replace(/\s+/g, ' ').trim()
const plain = (markdown: string) => noLinks(markdown.replace(/!?\[([^\]]*)\]\([^)]*\)/g, (_, label: string) => label).replace(/[#*_`>]+/g, ' ')).replace(/(^|\s)@/g, '$1').replace(/\s+/g, ' ').trim()

function personFields(p: Person, places: Place[]): SearchField[] {
  const field = (key: string, label: string, raw: string, weight: number, target?: string, refId?: string): SearchField[] => {
    const text = noLinks(raw)
    return text ? [{ key, label: tell(label), text, tab: 'details', weight, target, refId }] : []
  }
  const shown = new Set([p.givenName, p.surname, p.patronymic, p.maidenName, p.birthDate, p.birthPlace, p.deathDate, p.deathPlace].map(normal))
  return [
    ...field('givenName', 'Given name', p.givenName, 1),
    ...field('surname', 'Surname', p.surname, 1),
    ...field('patronymic', 'Patronymic', p.patronymic, 0.9, 'f-patronymic'),
    ...field('maidenName', 'Maiden name', p.maidenName, 0.9),
    ...field('otherNames', 'Other names', p.otherNames, 0.85),
    ...field('birthDate', 'Birth', p.birthDate, 0.95, 'f-birth-date'),
    ...field('birthPlace', 'Birthplace', p.birthPlace, 0.8, 'f-birth-place'),
    ...field('deathDate', 'Death', p.deathDate, 0.95, 'f-death-date'),
    ...field('deathPlace', 'Place of death', p.deathPlace, 0.8, 'f-death-place'),
    ...field('tags', 'Groups', shownTags(p.tags).join(', '), 0.75),
    // Older and other names of the places, and what they belonged to: "Тверь" finds someone born in "Калинин".
    ...field('place', 'Place', [...new Set([p.birthPlace, p.deathPlace, ...p.facts.map((f) => f.place)].map((x) => placeWords(x, places)).join(' ').split(' '))].join(' '), 0.6, 'f-birth-place'),
    ...p.facts.flatMap((f) => field('fact', 'Facts', [f.kind, f.date, f.place, factWords(f)].filter(Boolean).join(', '), 0.7)),
    ...p.sources.flatMap((s) => field('source', 'Sources_plural', [s.title, s.ref, s.page].filter(Boolean).join(', '), 0.55, 'f-sources')),
    ...p.claims.flatMap((c) => field('claim', 'Another version', [shown.has(normal(c.value)) ? '' : c.value, c.reason].filter(Boolean).join(', '), 0.5)),
  ]
}

function buildDocs(actor: Actor): SearchDoc[] {
  const people = getGraph(actor).persons.filter((p) => !p.hidden)
  const places = listPlaces(actor)
  const docs = new Map(people.map((p): [string, SearchDoc] => [p.id, { id: p.id, fields: personFields(p, places) }]))
  for (const page of readablePages(actor)) {
    const doc = docs.get(page.personId)
    if (!doc) continue
    if (page.title) doc.fields.push({ key: 'pageTitle', label: tell('Biography'), text: page.title, tab: 'pages', weight: 0.6, refId: page.id })
    const text = plain(blocksToMarkdown(JSON.parse(page.content)))
    if (text) doc.fields.push({ key: 'page', label: tell('Biography'), text, tab: 'pages', weight: 0.5, refId: page.id })
  }
  for (const m of listAllMedia(actor, 100_000)) {
    const text = noLinks([m.caption, m.date, m.place].filter(Boolean).join(', '))
    if (!text) continue
    for (const t of m.tags) docs.get(t.personId ?? '')?.fields.push({ key: 'photo', label: tell('Photos_short'), text, tab: 'photos', weight: 0.5, refId: m.id })
  }
  // Someone's own words stay among people, as they do in the card.
  if (!actor.tokenId && !actor.assistant) {
    const sp = schema.storyPeople
    const about = new Set(getDb().select({ id: sp.personId, role: sp.role }).from(sp).all().filter((r) => r.role === 'about').map((r) => r.id))
    for (const id of about) {
      const doc = docs.get(id)
      if (!doc) continue
      for (const s of listStories(actor, id)) {
        const text = noLinks([s.title, s.body, s.tellerName, s.toldOn].filter(Boolean).join('. '))
        if (text) doc.fields.push({ key: 'story', label: tell('Stories'), text, tab: 'stories', weight: 0.5, refId: s.id })
      }
    }
  }
  return [...docs.values()]
}

interface Indexes { index: SearchIndex; names: SearchIndex }
const shared = globalThis as unknown as { __folkbranchSearch?: Indexes & { stamp: string } }
const NAME_KEYS = new Set(['givenName', 'surname', 'patronymic', 'maidenName', 'otherNames'])

/** Readers and links see less, so only the full view is kept between searches. */
function indexFor(actor: Actor): Indexes {
  const stamp = dataStamp()
  const full = !seesOnlyPublic(actor) && !actor.guest && !actor.tokenId && !actor.assistant
  // The field labels read in the viewer's language, so a kept index belongs to one language too.
  const key = stamp && `${stamp}:${viewerLangNow()}`
  if (full && key && shared.__folkbranchSearch?.stamp === key) return shared.__folkbranchSearch
  const docs = buildDocs(actor)
  const indexes = { index: buildIndex(docs), names: buildIndex(docs.map((d) => ({ id: d.id, fields: d.fields.filter((f) => NAME_KEYS.has(f.key)) }))) }
  if (full && key) shared.__folkbranchSearch = { stamp: key, ...indexes }
  return indexes
}

type Who = (id: string) => string[]
const ROLES: [RegExp, 'parents' | 'children' | 'spouses' | 'siblings' | 'grandchildren' | 'grandparents', Sex | null, string][] = [
  [/^(жен[аыуе]|женой|супруга|супруги|wife)$/, 'spouses', 'F', 'wife'], [/^(муж|мужа|мужу|мужем|супруг|husband)$/, 'spouses', 'M', 'husband'],
  [/^(мать|матери|матерью|мама|мамы|маме|mother)$/, 'parents', 'F', 'mother'], [/^(отец|отца|отцу|отцом|папа|папы|father)$/, 'parents', 'M', 'father'], [/^(родители|родителей|родителя|родитель|parents)$/, 'parents', null, 'parent'],
  [/^(сын|сына|сыну|сыном|сыновья|son)$/, 'children', 'M', 'son'], [/^(дочь|дочери|дочка|дочки|дочерью|daughter)$/, 'children', 'F', 'daughter'], [/^(дети|детей|ребенок|ребенка|children)$/, 'children', null, 'child'],
  [/^(брат|брата|брату|братом|brother)$/, 'siblings', 'M', 'brother'], [/^(сестра|сестры|сестре|сестру|sister)$/, 'siblings', 'F', 'sister'],
  [/^(внучка|внучки|granddaughter)$/, 'grandchildren', 'F', 'granddaughter'], [/^(внук|внука|grandson)$/, 'grandchildren', 'M', 'grandson'],
  [/^(бабушка|бабушки|бабка|grandmother)$/, 'grandparents', 'F', 'grandmother'], [/^(дед|деда|дедушка|дедушки|grandfather)$/, 'grandparents', 'M', 'grandfather'],
]

/** The same relatives in Spanish and Catalan, as normal() leaves the words (germà as germa). Only an archive in either language reads them. */
const ROLES_ES_CA: typeof ROLES = [
  [/^(esposa|mujer|dona|muller)$/, 'spouses', 'F', 'wife'], [/^(esposo|marido|marit|espos|home)$/, 'spouses', 'M', 'husband'],
  [/^(madre|mare)$/, 'parents', 'F', 'mother'], [/^(padre|pare)$/, 'parents', 'M', 'father'], [/^(padres|pares)$/, 'parents', null, 'parent'],
  [/^(hijo|fill)$/, 'children', 'M', 'son'], [/^(hija|filla)$/, 'children', 'F', 'daughter'], [/^(hijos|fills)$/, 'children', null, 'child'],
  [/^(hermano|germa)$/, 'siblings', 'M', 'brother'], [/^(hermana|germana)$/, 'siblings', 'F', 'sister'],
  [/^(nieta|neta)$/, 'grandchildren', 'F', 'granddaughter'], [/^(nieto|net)$/, 'grandchildren', 'M', 'grandson'],
  [/^(abuela|avia)$/, 'grandparents', 'F', 'grandmother'], [/^(abuelo|avi)$/, 'grandparents', 'M', 'grandfather'],
]
/** "la esposa de Iván", "l'avi d'en Joan": [article] relative, de / del / d', [personal article] name. */
const OF_NAME = /^(?:(?:el|la|los|las|els|les)\s+|l')?(\p{L}+)\s+(?:del?\s+|d')(?:(?:en|na|el|la)\s+|l')?(.+)$/u

/** "жена Ивана" / "Ivan's wife": the relative's word and the rest, the name. */
function relationIn(query: string) {
  const words = normal(query).trim().split(/\s+/)
  if (words.length < 2) return null
  const at = words.findIndex((w) => ROLES.some(([re]) => re.test(w)))
  if (at >= 0) return { role: ROLES.find(([re]) => re.test(words[at]))!, name: words.filter((_, i) => i !== at).join(' ') }
  if (!['es', 'ca'].includes(archiveLang())) return null
  const m = normal(query).trim().replace(/’/g, "'").replace(/\s+/g, ' ').match(OF_NAME)
  const role = m && ROLES_ES_CA.find(([re]) => re.test(m[1]))
  return role ? { role, name: m[2] } : null
}

/** "жена Ивана": finds Ivan, then answers with his wife. */
function byRelation(actor: Actor, names: SearchIndex, query: string): SearchResult[] {
  const asked = relationIn(query)
  if (!asked) return []
  const [, kind, sex, word] = asked.role
  const sure = search(names, asked.name, 10, archiveLang()).filter((r) => !r.partial)
  if (!sure.length) return []
  const g = getGraph(actor)
  const people = new Map(g.persons.filter((p) => !p.hidden).map((p) => [p.id, p]))
  const parents: Who = (id) => g.parentChild.filter((l) => l.childId === id).map((l) => l.parentId)
  const children: Who = (id) => g.parentChild.filter((l) => l.parentId === id).map((l) => l.childId)
  const related: Record<typeof kind, Who> = {
    parents, children,
    spouses: (id) => g.unions.flatMap((u) => (u.aId === id ? [u.bId] : u.bId === id ? [u.aId] : [])),
    siblings: (id) => parents(id).flatMap(children).filter((c) => c !== id),
    grandchildren: (id) => children(id).flatMap(children),
    grandparents: (id) => parents(id).flatMap(parents),
  }
  const out = new Map<string, SearchResult>()
  for (const base of sure) {
    const baseName = personName(people.get(base.personId)!)
    for (const id of related[kind](base.personId)) {
      const p = people.get(id)
      if (!p || (sex && p.sex !== sex) || out.has(id)) continue
      const text = `${tell(word)}: ${baseName}`
      out.set(id, { personId: id, score: 3 + base.score, partial: false, terms: [baseName], matches: [{ key: 'relation', label: tell('Family'), tab: 'family', text, ranges: [[0, text.length]] }] })
    }
  }
  return [...out.values()]
}

export function searchPeople(actor: Actor, query: string, limit = 30): SearchResult[] {
  const { index, names } = indexFor(actor)
  const related = byRelation(actor, names, query)
  const found = search(index, query, limit, archiveLang())
  if (!related.length) return found
  // The answer to "whose wife" comes alone, with only what really has all the words after it.
  const seen = new Set(related.map((r) => r.personId))
  return [...related, ...found.filter((r) => !r.partial && !seen.has(r.personId))].slice(0, limit)
}

