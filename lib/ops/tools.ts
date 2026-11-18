// Every tool an agent can use, described once. MCP and the built-in assistant are both built from
// this list, so what one can do and what the ops layer allows never drift apart.
import { LANG_ENUM } from '../languages'
import { z } from 'zod'
import { blocksToMarkdown } from '../markdown'
import { Family, RELATIVE_KINDS, type KinKind } from '../kinship'
import { parseFamilyText, planFamilyText, serializeFamilyText } from '../textformat'
import { summary } from '../claims'
import { guessMapping, parseCsv, rowsToText, type Mapping } from '../import-formats'
import { lifeYears, personName, unionEnd, type Lang, type Person, type Role } from '../types'
import { Actor, can, OpError } from './core'
import { attachmentBytes, findAttachment, readAttachmentText } from '../agent/attachments'
import { exportGedcom, importGedcom, previewGedcom } from './gedcom'
import sharp from 'sharp'
import { getMedia, listAllMedia, listPersonMedia, readMediaFile, updateMedia, uploadMedia } from './media'
import { getPage, listPages } from './pages'
import { findGaps, GAP_FIELDS } from './gaps'
import { getGraph } from './people'
import { listPlaces } from './places'
import { OUTPUTS } from './outputs'
import { describeOp, dispatch, myProposals } from './proposals'
import { OPS } from './registry'
import { duplicateCandidates, previewMerge } from './merge-people'
import { placePointGuesses } from './place-guesses'
import { closeRequest, createRequest, listRequests } from './story-requests'
import { similarPlaces } from '../places'
import { publicUrl } from '../public-url'
import { findPeople, queryPeople, queryInput, searchArchive } from './search'
import { archiveLang, createInvite, getSetting, tell, listHistory, listInvites, listUsers, revokeInvite, setSetting, setUserRole } from './settings'

/**
 * read and ui run on their own; write asks unless the person allowed it for this conversation;
 * danger and admin always ask. admin is for the owner's settings.
 */
export type Risk = 'read' | 'ui' | 'write' | 'danger' | 'admin'
export type Surface = 'mcp' | 'assistant'
export interface ToolDef {
  name: string
  description: string
  input: z.ZodObject
  risk: Risk
  minRole: Role
  surfaces: Surface[]
  run: (actor: Actor, args: any) => unknown
  /** In words, for the person asked to allow it. */
  describe?: (actor: Actor, args: any) => string
  /** The type of the answer: run returns only these fields, or fails. */
  output: z.ZodType
  /** What the model gets instead of the output, when the output holds a secret only the person may see. */
  forModel?: (output: any) => unknown
  /** A picture or document the model looks at, fetched for it alone: the chat keeps only the answer. */
  /** A long list in `ids` is read this many at a time, reporting progress between the parts. */
  slices?: number
  shown?: (actor: Actor, output: any) => Promise<{ file: Buffer; mediaType: string; name: string }>
}

const lang = (): Lang => archiveLang()
const brief = (p: Person) => (p.hidden ? { id: p.id, hidden: true } : { id: p.id, name: fullName(p), years: lifeYears(p), sex: p.sex, living: p.living, place: p.birthPlace })
const fullName = (p: Person) => [p.givenName, p.patronymic, p.surname].filter(Boolean).join(' ')

function visiblePerson(actor: Actor, id: string) {
  const g = getGraph(actor)
  const p = g.persons.find((x) => x.id === id)
  if (!p || p.hidden) throw new OpError(404, `person ${id} not found`)
  return { g, p }
}

/** Read tools: what each returns is already limited by the caller's role in the ops layer. */
const READS: Record<string, { description: string; input: z.ZodObject; run: (a: Actor, x: any) => unknown; slices?: number }> = {
  get_overview: {
    description: 'Start here. Who you are in this archive, whether your writes go to review, how many people there are, how much is unsourced or in conflict, and how many of your drafts wait.',
    input: z.object({}),
    run: (a) => {
      const g = getGraph(a)
      const visible = g.persons.filter((p) => !p.hidden)
      const seen = new Set(visible.map((p) => p.id))
      const cards = visible.map(summary)
      const count = (key: keyof ReturnType<typeof summary>) => cards.reduce((n, c) => n + c[key], 0)
      return {
        family: getSetting('familyName') ?? '',
        you: { role: a.role, writes: a.role === 'reader' ? 'not allowed' : a.assistant ? 'call the tool: the app asks the person when needed' : a.review ? 'go to review: a person accepts the draft first' : `apply at once, except ${a.trustBulk ? 'imports' : 'bulk tools and imports'} (${Object.entries(OPS).filter(([, d]) => d.bulk && !(a.trustBulk && d.trustable)).map(([n]) => n).join(', ')}), which wait for a person to accept the draft; the answer gives the draft id and my_proposals lists what is in it` },
        // What is hidden from you is not counted either: a number that drops by one would tell you someone is there.
        people: { total: visible.length, links: g.parentChild.filter((l) => seen.has(l.parentId) && seen.has(l.childId)).length, unions: g.unions.filter((u) => seen.has(u.aId) && seen.has(u.bId)).length },
        values: { documented: count('documented'), told: count('told'), unsourced: count('unsourced'), conflicts: count('conflict') },
        yourDrafts: a.tokenId ? myProposals(a).filter((d) => d.status === 'pending').length : 0,
        next: a.role === 'reader' ? 'Read with search_people, get_person, how_related.' : 'Call find_gaps, research one person, record results with add_version.',
      }
    },
  },
  find_gaps: {
    description: 'What is unfinished, person by person: missing dates and places, no parents, values without a source, conflicting versions. People with conflicts come first. Good as a work queue.',
    input: z.strictObject({ limit: z.number().int().min(1).max(500).default(30), onlyConflicts: z.boolean().default(false), field: z.enum(GAP_FIELDS).optional().describe('Only people who lack this'), sort: z.enum(['gaps', 'birth', 'name']).default('gaps') }),
    run: (a, x) => findGaps(a, x).map(({ person, ...r }) => ({ ...brief(person), ...r })),
  },
  parse_table: {
    description: 'Turn a CSV table into the text format, ready for preview_text and import_text. Columns are guessed from the headers (Russian or English: name, surname, born, died, father, mother, spouse...). Pass `columns` to override, one field per column: id, name, given, patronymic, surname, maiden, sex, birthDate, birthPlace, deathDate, deathPlace, residencePlace, residenceDate, residencePlace2, residenceDate2, residencePlace3, residenceDate3, father, mother, spouse, or empty to skip.',
    input: z.object({ csv: z.string().min(1), columns: z.array(z.string()).optional() }),
    run: (_a, x) => {
      const rows = parseCsv(x.csv)
      if (rows.length < 2) throw new OpError(400, 'the table has no rows with people')
      const mapping = (x.columns ?? guessMapping(rows[0])) as Mapping
      if (!mapping.some((m) => m === 'name' || m === 'given' || m === 'surname')) throw new OpError(400, `no name column among: ${rows[0].join(', ')}. Pass columns.`)
      return { columns: Object.fromEntries(rows[0].map((h, i) => [h, mapping[i] ?? ''])), ...rowsToText(rows.slice(1), mapping, getSetting('familyName') ?? '', rows[0]) }
    },
  },
  search_people: {
    description: 'Find people by parts of a name in any order, patronymic, maiden name, place, group or fact. Forgives typos. An empty query lists people; get_overview has the total. Use before creating anyone.',
    input: z.object({ query: z.string().default(''), limit: z.number().int().min(1).max(500).default(20) }),
    run: (a, x) => findPeople(a, x.query, x.limit).map(brief),
  },
  get_person: {
    description: 'All fields of a person, their parents, children and spouses by name with link ids, and their pages.',
    input: z.object({ id: z.string() }),
    run: (a, x) => {
      const { g, p } = visiblePerson(a, x.id)
      const named = (personId: string) => {
        const other = g.persons.find((q) => q.id === personId)
        return { personId, ...(other && !other.hidden ? { name: fullName(other) } : {}) }
      }
      return {
        person: p,
        parents: g.parentChild.filter((l) => l.childId === x.id).map((l) => ({ ...l, linkId: l.id, ...named(l.parentId) })),
        children: g.parentChild.filter((l) => l.parentId === x.id).map((l) => ({ ...l, linkId: l.id, ...named(l.childId) })),
        unions: g.unions.filter((u) => u.aId === x.id || u.bId === x.id).map((u) => ({ ...u, endKind: unionEnd(u), linkId: u.id, ...named(u.aId === x.id ? u.bId : u.aId) })),
        pages: listPages(a, x.id),
      }
    },
  },
  get_people: {
    description: 'Up to 60 people at once, trimmed: names, dates, places, certainty, facts (kind, date, place) and the ids of parents, children and spouses. Use it instead of many get_person calls; get_person has sources, versions and pages.',
    input: z.object({ ids: z.array(z.string()).min(1).max(60) }),
    slices: 10,
    run: (a, x) => {
      const g = getGraph(a)
      const byId = new Map(g.persons.map((q) => [q.id, q]))
      return x.ids.map((id: string) => {
        const q = byId.get(id)
        // A person you may not see answers exactly as one that is not there.
        if (!q || q.hidden) return { id, missing: true as const }

        return {
          id, name: fullName(q), maidenName: q.maidenName, sex: q.sex, years: lifeYears(q), living: q.living, birthDate: q.birthDate, birthPlace: q.birthPlace, deathDate: q.deathDate, deathPlace: q.deathPlace, certainty: q.certainty, tags: q.tags,
          facts: q.facts.map((f) => ({ kind: f.kind, date: f.date, place: f.place })),
          parentIds: g.parentChild.filter((l) => l.childId === id).map((l) => l.parentId), childIds: g.parentChild.filter((l) => l.parentId === id).map((l) => l.childId),
          spouseIds: g.unions.filter((u) => u.aId === id || u.bId === id).map((u) => (u.aId === id ? u.bId : u.aId)),
        }
      })
    },
  },
  get_relatives: {
    description: 'Everyone related to a person, one row each with the kinship term. Long for a big family: for a count or a summary use count_relatives instead.',
    input: z.object({ id: z.string() }),
    run: (a, x) => {
      const { g } = visiblePerson(a, x.id)
      const byId = new Map(g.persons.map((p) => [p.id, p]))
      return [...new Family(g).relatives(x.id, lang())].filter(([id]) => !byId.get(id)!.hidden).map(([id, k]) => ({ ...brief(byId.get(id)!), relation: k.label, blood: k.kind === 'blood', kind: k.kind }))
    },
  },
  count_relatives: {
    description: 'Relatives of one person as counts: total, by kind (blood, adopted, step, spouse, marriage), blood by degree (steps up plus steps down: 1 parent or child, 2 sibling or grandparent, 3 uncle or aunt, 4 first cousin, 5 first cousin once removed), and the immediate family by name. Use it for "how many relatives"; pass kind or maxDegree to list names.',
    input: z.object({ id: z.string().optional(), name: z.string().optional(), kind: z.enum(RELATIVE_KINDS).optional(), maxDegree: z.number().int().min(1).max(30).optional(), limit: z.number().int().min(1).max(200).default(25) }),
    run: (a, x) => {
      if (!x.id) {
        // A name saves the search step; a name that fits several people is handed back for the person to choose.
        if (!x.name?.trim()) throw new OpError(400, 'pass id or name')
        const found = findPeople(a, x.name, 6).filter((q) => !q.hidden)
        if (!found.length) throw new OpError(404, `nobody is called ${x.name}`)
        if (found.length > 1) return { ambiguous: found.map(brief), note: 'The name fits more than one person: ask which one, with years and places. Do not choose.' }
        x = { ...x, id: found[0].id }
      }
      const { g, p } = visiblePerson(a, x.id)
      const byId = new Map(g.persons.map((q) => [q.id, q]))
      const fam = new Family(g)
      // Someone you may not see is not counted, and nothing says how many there are.
      const all = [...fam.relatives(x.id, lang())].filter(([id]) => !byId.get(id)!.hidden)
      const entry = ([id, k]: (typeof all)[number]) => {
        const q = byId.get(id)!
        return { id, name: fullName(q), years: lifeYears(q), relation: k.label, kind: k.kind, ...(k.degree ? { degree: k.degree } : {}) }
      }
      const byKind = Object.fromEntries(RELATIVE_KINDS.map((k) => [k, all.filter(([, r]) => r.kind === k).length])) as Record<KinKind, number>
      const bloodByDegree: Record<string, number> = {}
      for (const [, r] of all) if (r.kind === 'blood') bloodByDegree[r.degree!] = (bloodByDegree[r.degree!] ?? 0) + 1
      const base = { person: { id: p.id, name: fullName(p) }, total: all.length, byKind, bloodByDegree, definition: 'A relative is anyone connected by a birth parent, an adoption, a step relation or a marriage, at any distance. The spouse of a blood relative counts as a relative by marriage, not as a blood relative. "Blood" excludes adopted, step, spouse and by marriage.' }
      if (x.kind || x.maxDegree) {
        const picked = all.filter(([, r]) => (!x.kind || r.kind === x.kind) && (!x.maxDegree || (r.degree !== undefined && r.degree <= x.maxDegree)))
          .sort((m, n) => (m[1].degree ?? 99) - (n[1].degree ?? 99) || m[1].label.localeCompare(n[1].label))
        return { ...base, matching: picked.length, list: picked.slice(0, x.limit).map(entry), ...(picked.length > x.limit ? { more: picked.length - x.limit } : {}) }
      }
      // The immediate family by name; everyone else is a count until asked for.
      const near = new Set([...(fam.spouses.get(x.id) ?? []), ...(fam.spouses.get(x.id) ?? []).flatMap((q) => fam.children.get(q) ?? []), ...(fam.parents.get(x.id) ?? []), ...(fam.children.get(x.id) ?? []), ...(fam.parents.get(x.id) ?? []).flatMap((q) => fam.children.get(q) ?? [])])
      near.delete(x.id)
      return { ...base, immediateFamily: all.filter(([id]) => near.has(id)).map(entry) }
    },
  },
  get_statistics: {
    description: 'Numbers about the whole archive, grouped by decade of birth, birth place, generation (0 = people with no recorded parents) or sex: people, how many have died, the average age at death (only where both years are known), and marriages with how many ended in divorce. For "average age at death by generation" and the like.',
    input: z.strictObject({ by: z.enum(['decade', 'place', 'generation', 'sex']).default('decade'), limit: z.number().int().min(1).max(200).default(40) }),
    run: (a, x) => {
      const g = getGraph(a)
      const people = g.persons.filter((p) => !p.hidden)
      const seen = new Set(people.map((p) => p.id))
      const parents = new Map<string, string[]>()
      for (const l of g.parentChild) if (seen.has(l.parentId) && seen.has(l.childId)) parents.set(l.childId, [...(parents.get(l.childId) ?? []), l.parentId])
      const depth = new Map<string, number>()
      const gen = (id: string, guard = 0): number => { if (depth.has(id)) return depth.get(id)!; const ps = parents.get(id) ?? []; const d = guard > 60 || !ps.length ? 0 : 1 + Math.max(...ps.map((p) => gen(p, guard + 1))); depth.set(id, d); return d }
      const key = (p: Person) => (x.by === 'decade' ? (p.birthYear ? `${Math.floor(p.birthYear / 10) * 10}s` : '') : x.by === 'place' ? p.birthPlace.split(',')[0].trim() : x.by === 'sex' ? p.sex : String(gen(p.id))) || 'unknown'
      const unionsOf = (id: string) => g.unions.filter((u) => (u.aId === id || u.bId === id) && seen.has(u.aId) && seen.has(u.bId))
      const groups = [...Map.groupBy(people, key)].map(([group, list]) => {
        const aged = list.filter((p) => p.birthYear && p.deathYear && p.deathYear >= p.birthYear)
        const unions = new Set(list.flatMap((p) => unionsOf(p.id).map((u) => u.id)))
        const divorced = [...unions].filter((id) => { const u = g.unions.find((q) => q.id === id)!; return unionEnd(u) === 'divorced' }).length
        return { group, people: list.length, died: list.filter((p) => !p.living).length, averageAgeAtDeath: aged.length ? Math.round((aged.reduce((n, p) => n + (p.deathYear! - p.birthYear!), 0) / aged.length) * 10) / 10 : null, ageKnownFor: aged.length, marriages: unions.size, divorced }
      }).sort((m, n) => (x.by === 'decade' || x.by === 'generation' ? m.group.localeCompare(n.group, undefined, { numeric: true }) : n.people - m.people))
      return { by: x.by, people: people.length, groups: groups.slice(0, x.limit) }
    },
  },
  find_overlaps: {
    description: 'Who lived in the same place at the same time: for a place (a part of its name) the people whose birth, death or a fact names it, and the pairs of them whose lifetimes overlap. Without a place, the places with the most such people.',
    input: z.strictObject({ place: z.string().optional(), limit: z.number().int().min(1).max(100).default(20) }),
    run: (a, x) => {
      const people = getGraph(a).persons.filter((p) => !p.hidden)
      const low = (s: string) => s.toLowerCase().replace(/ё/g, 'е')
      const placesOf = (p: Person) => [...new Set([p.birthPlace, p.deathPlace, ...p.facts.map((f) => f.place)].map((s) => s.split(',')[0].trim()).filter(Boolean))]
      const byPlace = new Map<string, Person[]>()
      for (const p of people) for (const pl of placesOf(p)) if (!x.place || low(pl).includes(low(x.place))) byPlace.set(pl, [...(byPlace.get(pl) ?? []), p])
      const span = (p: Person): [number, number] | null => p.birthYear ? [p.birthYear, p.deathYear ?? (p.living ? new Date().getFullYear() : p.birthYear + 80)] : null
      return [...byPlace].filter(([, list]) => list.length > 1).map(([place, list]) => {
        const pairs: { a: string; b: string; from: number; to: number }[] = []
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          const s = span(list[i]), t = span(list[j])
          if (s && t && Math.max(s[0], t[0]) <= Math.min(s[1], t[1])) pairs.push({ a: list[i].id, b: list[j].id, from: Math.max(s[0], t[0]), to: Math.min(s[1], t[1]) })
        }
        return { place, people: list.map((p) => ({ id: p.id, name: fullName(p), years: lifeYears(p) })), overlapping: pairs.length, pairs: pairs.slice(0, 30) }
      }).filter((r) => r.overlapping > 0).sort((m, n) => n.overlapping - m.overlapping).slice(0, x.limit)
    },
  },
  how_related: {
    description: 'How `to` is related to `from`: a kinship term and the path between them.',
    input: z.object({ from: z.string(), to: z.string() }),
    run: (a, x) => {
      const { g } = visiblePerson(a, x.from)
      visiblePerson(a, x.to)
      const k = new Family(g).relation(x.from, x.to, lang())
      const name = (id: string) => { const p = g.persons.find((q) => q.id === id)!; return p.hidden ? 'hidden' : personName(p) }
      return k ? { relation: k.label, blood: k.blood, path: k.path.map((id) => ({ id, name: name(id) })) } : { relation: null }
    },
  },
  list_pages: {
    description: 'The pages about a person, without their text.',
    input: z.object({ personId: z.string() }),
    run: (a, x) => listPages(a, x.personId),
  },
  get_page: {
    description: 'A page as Markdown. Set raw to also get the BlockNote JSON.',
    input: z.object({ id: z.string(), raw: z.boolean().default(false) }),
    run: (a, x) => {
      const { content, ...meta } = getPage(a, x.id)
      const blocks = JSON.parse(content)
      return { ...meta, markdown: blocksToMarkdown(blocks), ...(x.raw ? { content: blocks } : {}) }
    },
  },
  list_photos: {
    description: "Photos with their tags: of one person, or all of them. Fetch a file from /api/v1/media/ID/file with the same token.",
    input: z.object({ personId: z.string().optional() }),
    run: (a, x) => (x.personId ? listPersonMedia(a, x.personId) : listAllMedia(a)),
  },
  list_places: {
    description: 'Places in the archive, with what each was part of, other and old names, and coordinates. Add a missing one with create_place.',
    input: z.object({}),
    run: (a) => listPlaces(a),
  },
  export_text: {
    description: 'The whole graph in the text format: `family Title`, `Name id: x, b: 1880, d: 1950, sex: m`, `A + B m: 1905` with children indented below. Living people are left out unless hideLiving is false. Edit it and send it back with import_text.',
    input: z.strictObject({ hideLiving: z.boolean().default(true).describe('False keeps living people in the text') }),
    run: (a, x) => {
      const g = getGraph(a)
      const out = new Set(g.persons.filter((p) => p.hidden || (x.hideLiving && p.living)).map((p) => p.id))
      return serializeFamilyText(out.size ? { ...g, persons: g.persons.filter((p) => !out.has(p.id)), parentChild: g.parentChild.filter((l) => !out.has(l.parentId) && !out.has(l.childId)), unions: g.unions.filter((u) => !out.has(u.aId) && !out.has(u.bId)) } : g, getSetting('familyName') ?? '')
    },
  },
  preview_text: {
    description: 'What import_text would do with this text, without changing anything.',
    input: z.object({ text: z.string(), resolutions: z.record(z.string(), z.string()).optional() }),
    run: (a, x) => {
      const { ops, ...plan } = planFamilyText(parseFamilyText(x.text), getGraph(a), x.resolutions)
      return { ...plan, operations: ops.length }
    },
  },
  export_gedcom: {
    description: 'The graph as GEDCOM 5.5.1 text.',
    input: z.object({ hideLiving: z.boolean().default(true).describe('False keeps living people in the file') }),
    run: (a, x) => exportGedcom(a, x.hideLiving),
  },
  preview_gedcom: {
    description: 'Counts what a GEDCOM file holds, without importing it.',
    input: z.object({ text: z.string() }),
    run: (a, x) => previewGedcom(a, x.text),
  },
  get_history: {
    description: 'Recent changes, newest first, with ids for undo.',
    input: z.object({ limit: z.number().int().min(1).max(200).default(15) }),
    // Who made a change is a name, never an internal id.
    run: (a, x) => listHistory(a, x.limit).map(({ userId: _u, ...entry }) => entry),
  },
  my_proposals: {
    description: "This token's recent drafts and whether a person accepted them.",
    input: z.object({}),
    run: (a) => myProposals(a),
  },
}

/** Every request carries what its tools look like, so only these go along until the model asks for more. */
export const CORE_TOOLS = ['search_people', 'query_people', 'search_archive', 'get_person', 'get_people', 'how_related', 'count_relatives', 'create_person', 'update_person', 'update_people', 'add_fact', 'delete_person', 'add_relation', 'remove_relation', 'import_text', 'undo', 'get_history', 'set_plan', 'use_tools']
export const TOOL_GROUPS: Record<string, { about: string; tools: string[] }> = {
  people: { about: 'many at once, relatives, gaps, overview, links, tree, tables', tools: ['add_fact_to_people', 'delete_people', 'link_people', 'get_statistics', 'find_overlaps', 'get_relatives', 'find_gaps', 'get_overview', 'update_relation', 'move_relation', 'set_parents', 'remove_parent_links', 'export_text', 'preview_text', 'parse_table'] },
  sources: { about: 'adding or removing a source, versions of values', tools: ['add_source', 'remove_source', 'add_version', 'choose_version', 'reject_version', 'restore_version'] },
  files: { about: 'photos, scans, avatars, attached files, GEDCOM, research cases', tools: ['import_kinship_case', 'list_photos', 'view_photo', 'save_attachment', 'set_avatar', 'tag_photo', 'untag_photo', 'update_photo', 'delete_photo', 'upload_photo', 'read_attachment', 'import_gedcom_attachment', 'export_gedcom', 'preview_gedcom', 'import_gedcom'] },
  pages: { about: 'pages about people', tools: ['list_pages', 'get_page', 'create_page', 'update_page', 'move_page', 'delete_page'] },
  places: { about: 'places, old names, merging places, points for places', tools: ['list_places', 'create_place', 'update_place', 'list_similar_places', 'merge_places', 'get_place_suggestions'] },
  merging: { about: 'duplicate cards, what a merge would do, story links, rolling back', tools: ['find_duplicates', 'preview_merge', 'list_story_requests', 'create_story_request', 'revoke_story_request', 'undo_person', 'rollback_to'] },
  screen: { about: 'show someone, a branch or a path', tools: ['focus_person', 'show_branch', 'show_path', 'set_chart_direction'] },
  admin: { about: 'name, language, access, invitations', tools: ['get_settings', 'update_settings', 'list_users', 'set_user_role', 'list_invites', 'create_invite', 'revoke_invite'] },
}

const toModelSafeInvite = () => ({ created: true, note: 'The link is shown to the person in the chat. You do not have it.' })
const roleInput = z.enum(['owner', 'editor', 'reader'])

/** Settings and what is on screen exist only for the assistant: tokens are refused these on purpose. */
const ASSISTANT_ONLY: Omit<ToolDef, 'output'>[] = [
  { name: 'get_settings', risk: 'read', minRole: 'reader', surfaces: ['assistant'], description: "The archive's name and language.", input: z.object({}),
    run: () => ({ familyName: getSetting('familyName') ?? '', language: archiveLang() }) },
  { name: 'update_settings', risk: 'admin', minRole: 'owner', surfaces: ['assistant'], description: "Rename the archive or change its language.", input: z.object({ familyName: z.string().min(1).max(120).optional(), language: z.enum(LANG_ENUM).optional() }),
    describe: (_a, x) => [x.familyName && `${tell('Title_name')}: ${x.familyName}`, x.language && `${tell('Language')}: ${x.language}`].filter(Boolean).join(', '),
    run: (_a, x) => {
      Object.entries(x).forEach(([k, v]) => setSetting(k, v as string))
      return { ok: true }
    } },
  { name: 'list_users', risk: 'read', minRole: 'owner', surfaces: ['assistant'], description: 'Who has access and with what role.', input: z.object({}), run: (a) => listUsers(a) },
  { name: 'set_user_role', risk: 'admin', minRole: 'owner', surfaces: ['assistant'], description: "Change someone's role. Not your own person's.", input: z.object({ id: z.string(), role: roleInput }),
    describe: (a, x) => `${listUsers(a).find((u) => u.id === x.id)?.name ?? x.id}: ${x.role}`,
    run: (a, x) => {
      if (!listUsers(a).some((u) => u.id === x.id)) throw new OpError(404, 'no such user')
      setUserRole(a, x.id, x.role)
      return { ok: true }
    } },
  { name: 'list_invites', risk: 'read', minRole: 'owner', surfaces: ['assistant'], description: 'Invitations still open.', input: z.object({}), run: (a) => listInvites(a) },
  { name: 'create_invite', risk: 'admin', minRole: 'owner', surfaces: ['assistant'], description: 'Invite someone. The person sees the link in the chat; you never get it.', input: z.object({ name: z.string().min(1).max(120), role: roleInput.exclude(['owner']), personId: z.string().nullish() }),
    describe: (_a, x) => `${x.name}: ${x.role}`,
    run: (a, x) => ({ link: `/invite/${createInvite(a, x).token}` }), forModel: toModelSafeInvite },
  { name: 'revoke_invite', risk: 'admin', minRole: 'owner', surfaces: ['assistant'], description: 'Cancel an open invitation.', input: z.object({ id: z.string() }),
    describe: (a, x) => listInvites(a).find((i) => i.id === x.id)?.name ?? x.id,
    run: (a, x) => {
      revokeInvite(a, x.id)
      return { ok: true }
    } },
  { name: 'use_tools', risk: 'ui', minRole: 'reader', surfaces: ['assistant'], description: `Load more tools for the next steps: ${Object.entries(TOOL_GROUPS).map(([g, v]) => `${g} (${v.about})`).join('; ')}.`, input: z.object({ groups: z.array(z.enum(Object.keys(TOOL_GROUPS) as [string, ...string[]])).min(1) }),
    run: (_a, x) => ({ loaded: x.groups }) },
  { name: 'set_plan', risk: 'ui', minRole: 'reader', surfaces: ['assistant'], description: 'Show the person your plan as a checklist and keep it for yourself. Call it first for a task of more than two steps, and again with done marks as you go. `note` keeps what later steps need, such as ids.',
    input: z.object({ steps: z.array(z.object({ text: z.string().min(1).max(200), done: z.boolean().default(false) })).min(1).max(20), note: z.string().max(2000).optional() }),
    run: (_a, x) => x },
  { name: 'focus_person', risk: 'ui', minRole: 'reader', surfaces: ['assistant'], description: 'Open a person on the chart for the one you are talking to.', input: z.object({ id: z.string() }),
    run: (a, x) => {
      const { p } = visiblePerson(a, x.id)
      return { id: p.id, name: fullName(p) }
    } },
  { name: 'show_branch', risk: 'ui', minRole: 'reader', surfaces: ['assistant'], description: "Show on the chart only a person's ancestors, descendants or close family, or everyone again with scope all.", input: z.object({ id: z.string(), scope: z.enum(['ancestors', 'descendants', 'near', 'all']) }),
    run: (a, x) => {
      const { p } = visiblePerson(a, x.id)
      return { id: p.id, name: fullName(p), scope: x.scope }
    } },
  { name: 'show_path', risk: 'ui', minRole: 'reader', surfaces: ['assistant'], description: 'Light up on the chart how two people are connected.', input: z.object({ from: z.string(), to: z.string() }),
    run: (a, x) => {
      const { g } = visiblePerson(a, x.from)
      visiblePerson(a, x.to)
      const k = new Family(g).relation(x.from, x.to, lang())
      if (!k) throw new OpError(404, 'these two are not connected')
      return { path: k.path, relation: k.label }
    } },
  { name: 'set_chart_direction', risk: 'ui', minRole: 'reader', surfaces: ['assistant'], description: 'Draw the chart with elders at the bottom (rootsBelow true) or at the top. Applies to this browser only.', input: z.object({ rootsBelow: z.boolean() }),
    run: (_a, x) => ({ rootsBelow: x.rootsBelow }) },
]

/** Only these reach a model as files; anything else it would get as unreadable bytes. */
const MODEL_FILE = 1568
const isPdf = (m: { mime: string; originalName: string }) => m.mime === 'application/pdf' || /\.pdf$/i.test(m.originalName)

/** A photo or scan from the archive, put in front of the model so it can read it. */
const VIEW_PHOTO: Omit<ToolDef, 'output'> = {
  name: 'view_photo', risk: 'read', minRole: 'reader', surfaces: ['mcp', 'assistant'],
  description: 'Look at a photo or a scanned document already in the archive (a picture or a PDF), by its id from list_photos. Read what is written, word for word, and say what you could not read. Propose what it shows with add_source, add_version or a page, never as certain when the reading is not.',
  input: z.object({ id: z.string() }),
  run: (a, x) => {
    const m = getMedia(a, x.id)
    if (m.kind !== 'image' && !isPdf(m)) throw new OpError(400, 'only a picture or a PDF can be looked at')
    return { id: m.id, name: m.originalName, caption: m.caption, date: m.date, place: m.place }
  },
  shown: async (a, out) => {
    const m = getMedia(a, out.id)
    const { data } = await readMediaFile(a, m.id, 'orig')
    if (isPdf(m)) return { file: data, mediaType: 'application/pdf', name: m.originalName }
    const file = await sharp(data, { failOn: 'none' }).rotate().resize({ width: MODEL_FILE, height: MODEL_FILE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
    return { file, mediaType: 'image/jpeg', name: m.originalName }
  },
}

/** Files given to the assistant in the conversation. They belong to the person talking to it. */
const ATTACHMENT_TOOLS: Omit<ToolDef, 'output'>[] = [
  { name: 'read_attachment', risk: 'read', minRole: 'reader', surfaces: ['assistant'], description: 'More of a long text file the person attached.', input: z.object({ id: z.string(), offset: z.number().int().min(0).default(0) }),
    run: async (a, x) => readAttachmentText(a, (await findAttachment(a, x.id)).id, x.offset) },
  { name: 'save_attachment', risk: 'write', minRole: 'editor', surfaces: ['assistant'], description: "Keep a file the person attached in the archive, as a photo or document, optionally on a person's card. The result has an id for set_avatar, tag_photo or a page.",
    input: z.object({ id: z.string(), personId: z.string().nullish(), caption: z.string().max(500).optional(), date: z.string().max(60).optional(), place: z.string().max(120).optional() }),
    describe: (a, x) => [x.caption, x.personId && personNameOf(a, x.personId)].filter(Boolean).join(', '),
    run: async (a, x) => {
      if (x.personId) visiblePerson(a, x.personId)
      const att = await findAttachment(a, x.id)
      const m = await uploadMedia(a, await attachmentBytes(a, att.id), att.name, x.personId)
      if (x.caption || x.date || x.place) updateMedia(a, m.id, { caption: x.caption, date: x.date, place: x.place })
      return { id: m.id, kind: m.kind, name: m.originalName }
    } },
  { name: 'import_gedcom_attachment', risk: 'danger', minRole: 'editor', surfaces: ['assistant'], description: 'Add everyone from a GEDCOM file the person attached. Look at it first with its text in the conversation.', input: z.object({ id: z.string() }),
    run: async (a, x) => importGedcom(a, await fullText(a, (await findAttachment(a, x.id)).id)) },
]

async function fullText(a: Actor, id: string) {
  let text = '', offset = 0
  for (;;) {
    const page = await readAttachmentText(a, id, offset)
    text += page.text
    if (!page.more) return text
    offset += page.text.length
  }
}

const personNameOf = (a: Actor, id: string) => { const p = getGraph(a).persons.find((x) => x.id === id); return p && !p.hidden ? fullName(p) : '' }

const personRef = (a: Actor, id: string) => ({ id, name: personNameOf(a, id) })
const nothingLeft = () => ({ created: true as const, note: 'The link is shown to the person in the chat. You do not have it.' })

/**
 * What the app does for a person on its own pages and an agent can now do too: story links, what a merge would do, places
 * that look alike, and point candidates. Merging two cards stays a person's own action on the page (see mergePeople).
 */
const PARITY: Omit<ToolDef, 'output'>[] = [
  { name: 'list_story_requests', risk: 'read', minRole: 'editor', surfaces: ['mcp', 'assistant'], description: 'Open links that ask a relative to tell a story: who each is about and for, the question, when it expires, how many recordings came and how many wait for review. Never the link itself: it cannot be shown again.', input: z.object({}),
    run: (a) => listRequests(a).map((r) => ({ id: r.id, personId: r.personId, about: r.about, tellerName: r.tellerName, question: r.question, received: r.received, expiresAt: r.expiresAt, createdAt: r.createdAt, waiting: r.waiting.length, state: r.waiting.length ? 'recordings wait for review' : r.received ? 'recordings reviewed' : 'waiting for a recording' })) },
  { name: 'create_story_request', risk: 'danger', minRole: 'editor', surfaces: ['mcp', 'assistant'], description: 'Make a link asking a relative to tell a story about a person, one question a line. Whoever holds the link can only send a recording, which waits for review. In the chat the person sees the link and you never get it; a token gets it in the answer, and only a token whose edits apply at once (not one that goes to review).',
    input: z.object({ personId: z.string(), tellerName: z.string().max(120).default(''), question: z.string().max(1200).default(''), days: z.number().int().min(1).max(365).default(60) }),
    describe: (a, x) => [personNameOf(a, x.personId), x.tellerName].filter(Boolean).join(', '),
    run: (a, x) => {
      // A link is access in its own right: a draft a person has not seen yet cannot make one.
      if (a.tokenId && a.review) throw new OpError(403, 'a token whose edits go to review cannot make a story link: ask a person to make it')
      visiblePerson(a, x.personId)
      const { token } = createRequest(a, { personId: x.personId, tellerName: x.tellerName, question: x.question, expiresInDays: x.days })
      return { created: true, link: `/tell/${token}`, url: `${publicUrl()}/tell/${token}` }
    },
    forModel: nothingLeft },
  { name: 'revoke_story_request', risk: 'write', minRole: 'editor', surfaces: ['mcp', 'assistant'], description: 'Close a story link so nobody can send a recording through it. Recordings already sent stay for review.', input: z.object({ id: z.string() }),
    run: (a, x) => {
      if (!listRequests(a).some((r) => r.id === x.id)) throw new OpError(404, 'no open story link with this id')
      closeRequest(a, x.id)
      return { ok: true }
    } },
  { name: 'find_duplicates', risk: 'read', minRole: 'editor', surfaces: ['mcp', 'assistant'], description: 'Pairs of cards that may be one person, best first, with why. Compare a pair with preview_merge. Merging is done by a person on the card.', input: z.object({}),
    run: (a) => duplicateCandidates(a).map((d) => ({ a: personRef(a, d.a), b: personRef(a, d.b), score: d.score, why: d.why })) },
  { name: 'preview_merge', risk: 'read', minRole: 'editor', surfaces: ['mcp', 'assistant'], description: 'What merging two cards would do: whether it is allowed (and if not, why), warnings, each field of both, and what each card holds. Changes nothing. Tell the person; the merge itself is theirs to do on the card.', input: z.object({ keepId: z.string(), dropId: z.string() }),
    run: (a, x) => previewMerge(a, x.keepId, x.dropId) },
  { name: 'list_similar_places', risk: 'read', minRole: 'editor', surfaces: ['mcp', 'assistant'], description: 'Pairs of place records that look like one place (a shared name and the same parent, or within 2 km). Merge a pair with merge_places.', input: z.object({}),
    run: (a) => similarPlaces(listPlaces(a)).map(([p, q]) => ({ a: { id: p.id, name: p.name, kind: p.kind, parentId: p.parentId }, b: { id: q.id, name: q.name, kind: q.kind, parentId: q.parentId } })) },
  { name: 'get_place_suggestions', risk: 'read', minRole: 'editor', surfaces: ['mcp', 'assistant'], description: 'Up to three candidates for the map point of a place that has none, from the GeoNames extract in the app, with why each ranks where it does. Setting the point is update_place with the lat and lon you choose.',
    input: z.object({ placeId: z.string().optional(), name: z.string().optional() }),
    run: (a, x) => {
      if (!x.placeId && !x.name?.trim()) throw new OpError(400, 'pass placeId or name')
      const loose = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е')
      const { guesses, snapshot } = placePointGuesses(a)
      const found = guesses.find((g) => (x.placeId ? g.placeId === x.placeId : loose(g.text) === loose(x.name ?? '')))
      return { snapshot, candidates: (found?.candidates ?? []).slice(0, 3).map((c) => ({ geonameId: c.id, name: c.ru || c.name, country: c.cc, region: c.regionRu || c.region, lat: c.lat, lon: c.lon, matched: c.matched, why: c.why })), note: found ? undefined : snapshot ? 'This place has a point already, holds other places, or is unknown here.' : 'The GeoNames extract is not installed on this server.' }
    } },
]

/** About a token's own drafts, so it means nothing to the assistant. */
const NOT_FOR_ASSISTANT = new Set(['my_proposals'])
const surfaces = (name: string): Surface[] => (NOT_FOR_ASSISTANT.has(name) ? ['mcp'] : ['mcp', 'assistant'])

/**
 * Every answer passes through its type, for MCP and the assistant alike. A surprise is logged and
 * the answer still goes out: a write has already happened, and an error would make a model repeat it.
 */
function typed(t: Omit<ToolDef, 'output'>): ToolDef {
  const output = OUTPUTS[t.name]
  if (!output) throw new Error(`tool ${t.name} has no output type`)
  return {
    ...t,
    output,
    run: async (actor, args) => {
      const raw = (await t.run(actor, args)) ?? { ok: true }
      const answer = output.safeParse(raw)
      if (answer.success) return answer.data
      console.error(`tool ${t.name} answered outside its type`, answer.error.issues)
      return raw
    },
  }
}

type Untyped = Omit<ToolDef, 'output'>
export const TOOLS: ToolDef[] = ([
  ...Object.entries(READS).map(([name, r]): Untyped => ({ name, ...r, risk: 'read', minRole: 'reader', surfaces: surfaces(name) })),
  { name: 'query_people', risk: 'read', minRole: 'reader', surfaces: surfaces('query_people'), input: queryInput,
    description: 'People by exact conditions, with a total and optional counts: years, place, sex, group, sources, parents. For lists, counts and questions like "who was born in Tula before 1900".',
    run: (a, x) => queryPeople(a, x) },
  { name: 'search_archive', risk: 'read', minRole: 'reader', surfaces: surfaces('search_archive'), input: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(50).default(20) }),
    description: 'Search everything written: people, facts, sources, page text and photo captions. Forgives typos and word endings. Use when you do not know where something is written.',
    run: (a, x) => searchArchive(a, x.query, x.limit) },
  ...Object.entries(OPS).filter(([, d]) => !d.internal).map(([name, d]): Untyped => ({ name, description: d.description, input: (d.agentInput ?? d.input) as z.ZodObject, risk: d.risk, minRole: d.ownerOnly ? 'owner' : 'editor', surfaces: d.ownerOnly ? ['assistant'] : surfaces(name), run: (a, x) => dispatch(a, name, x), describe: (a, x) => describeOp(a, name, x) })),
  ...ASSISTANT_ONLY,
  ...PARITY,
  VIEW_PHOTO,
  ...ATTACHMENT_TOOLS,
] as Untyped[]).map(typed)

export const toolsFor = (actor: Actor, surface: Surface) => TOOLS.filter((t) => t.surfaces.includes(surface) && can(actor, t.minRole))
