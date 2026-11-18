// What each tool answers. An agent gets exactly these fields: anything else a function returns stays
// behind, and an answer of the wrong shape is an error rather than garbage in the conversation.
import { z } from 'zod'

const id = z.string()
const text = z.string()
/** A place a write named that the map cannot show; the reply keeps it, so the model can say why and fix it. */
const placeNote = z.object({ name: text, problem: z.enum(['unknown', 'no-coords', 'ambiguous']), message: text, choices: z.array(z.object({ id, name: text })).optional() })
const ok = z.object({ ok: z.literal(true), places: z.array(placeNote).optional() })

const brief = z.object({ id, hidden: z.literal(true).optional(), name: text.optional(), years: text.optional(), sex: text.optional(), living: z.boolean().optional(), place: text.optional() })
const fact = z.object({ kind: text, date: text, place: text, note: text, source: text }).partial()
const source = z.object({ id, title: text, ref: text, page: text, url: text, reliability: text }).partial()
const claim = z.object({ id, field: text, value: text, sourceId: id.nullable(), status: text, reason: text, at: z.number() })
const fullPerson = z.object({
  id, givenName: text, surname: text, maidenName: text, patronymic: text, otherNames: text, sex: text,
  birthDate: text, birthPlace: text, deathDate: text, deathPlace: text, living: z.boolean(), certainty: text, avatarMediaId: id.nullable(), updatedAt: z.number(),
  tags: z.array(text), facts: z.array(fact), sources: z.array(source), claims: z.array(claim),
})
/** A write answers with what was written, short: the model already knows the rest. */
const written = z.object({ id, givenName: text, surname: text, birthDate: text, deathDate: text, living: z.boolean(), factId: id.optional(), places: z.array(placeNote).optional() })
const relative = z.object({ name: text.optional() })
const pageMeta = z.object({ id, personId: id, parentPageId: id.nullable(), title: text, icon: text, updatedAt: z.number() })
const photo = z.object({ id, kind: text, originalName: text, caption: text, date: text, place: text, tags: z.array(z.object({ id, personId: id.nullable(), label: text.nullable() })).optional() })
const proposal = z.object({ id, status: text, error: text.nullable(), ops: z.array(z.object({ op: text, text, details: z.array(text).optional() })) })
const applied = z.object({ applied: z.number(), ids: z.record(z.string(), z.string()), people: z.array(z.object({ name: text, id, parents: z.array(text).optional(), spouses: z.array(text).optional() })).optional(), check: z.object({ unlinked: z.array(text) }).optional(), places: z.array(placeNote).optional() })
const importCount = z.object({ persons: z.number(), ids: z.record(z.string(), z.string()).optional() })

/** A token's write can wait for a person instead of running. */
const pending = z.object({ status: z.literal('pending_review'), proposalId: id, tempId: id.optional(), id: id.optional(), tempIds: z.array(id).optional(), message: text, places: z.array(placeNote).optional() })
const write = (shape: z.ZodType) => z.union([pending, shape])

export const OUTPUTS: Record<string, z.ZodType> = {
  get_overview: z.object({
    family: text, you: z.object({ role: text, writes: text }),
    people: z.object({ total: z.number(), links: z.number(), unions: z.number() }),
    values: z.object({ documented: z.number(), told: z.number(), unsourced: z.number(), conflicts: z.number() }),
    yourDrafts: z.number(), next: text,
  }),
  find_gaps: z.array(brief.extend({ missing: z.array(text), unsourced: z.number(), conflicts: z.array(text) })),
  parse_table: z.object({ columns: z.record(z.string(), z.string()), text, people: z.number(), warnings: z.array(z.object({ key: text, detail: text.optional() })) }),
  search_people: z.array(brief),
  get_person: z.object({
    person: fullPerson,
    parents: z.array(relative.extend({ linkId: id, personId: id, kind: text, certainty: text })),
    children: z.array(relative.extend({ linkId: id, personId: id, kind: text, certainty: text })),
    unions: z.array(relative.extend({ linkId: id, personId: id, kind: text, startDate: text, endDate: text, /** How it stands: '' together, 'separated', 'divorced' or 'widowed'. */ endKind: text, place: text })),
    pages: z.array(pageMeta),
  }),
  get_people: z.array(z.object({
    id, missing: z.literal(true).optional(), name: text.optional(), maidenName: text.optional(), sex: text.optional(), years: text.optional(), living: z.boolean().optional(),
    birthDate: text.optional(), birthPlace: text.optional(), deathDate: text.optional(), deathPlace: text.optional(), certainty: text.optional(), tags: z.array(text).optional(),
    facts: z.array(z.object({ kind: text, date: text, place: text })).optional(), parentIds: z.array(id).optional(), childIds: z.array(id).optional(), spouseIds: z.array(id).optional(),
  })),
  get_relatives: z.array(brief.extend({ relation: text, blood: z.boolean(), kind: text })),
  count_relatives: z.union([z.object({ ambiguous: z.array(brief), note: text }), z.object({
    person: z.object({ id, name: text }), total: z.number(), byKind: z.record(z.string(), z.number()), bloodByDegree: z.record(z.string(), z.number()), definition: text,
    immediateFamily: z.array(brief.extend({ relation: text, kind: text, degree: z.number().optional() })).optional(),
    matching: z.number().optional(), more: z.number().optional(), list: z.array(brief.extend({ relation: text, kind: text, degree: z.number().optional() })).optional(),
  })]),
  get_statistics: z.object({ by: text, people: z.number(), groups: z.array(z.object({ group: text, people: z.number(), died: z.number(), averageAgeAtDeath: z.number().nullable(), ageKnownFor: z.number(), marriages: z.number(), divorced: z.number() })) }),
  find_overlaps: z.array(z.object({ place: text, people: z.array(z.object({ id, name: text, years: text })), overlapping: z.number(), pairs: z.array(z.object({ a: id, b: id, from: z.number(), to: z.number() })) })),
  how_related: z.object({ relation: text.nullable(), blood: z.boolean().optional(), path: z.array(z.object({ id, name: text })).optional() }),
  list_pages: z.array(pageMeta),
  get_page: pageMeta.extend({ markdown: text, content: z.array(z.unknown()).optional() }),
  list_photos: z.array(photo),
  list_places: z.array(z.object({ id, name: text, kind: text, parentId: id.nullable(), otherNames: z.array(z.object({ name: text, years: text })), lat: z.number().nullable(), lon: z.number().nullable(), note: text })),
  export_text: text,
  preview_text: z.object({ creates: z.array(text), updates: z.array(z.unknown()), relations: z.number(), ambiguous: z.array(z.unknown()), errors: z.array(z.unknown()), operations: z.number() }),
  export_gedcom: text,
  preview_gedcom: z.object({ version: text, persons: z.number(), families: z.number(), sample: z.array(text), existing: z.number() }),
  get_history: z.array(z.object({ id, at: z.number(), actorName: text, byAgent: z.boolean(), summary: text, details: z.array(z.object({ label: text, before: text.nullable(), after: text.nullable() })).optional(), people: z.array(z.object({ id, name: text, change: z.enum(['added', 'updated', 'removed']) })).optional(), personIds: z.array(id), undoOf: id.nullable(), undoneAt: z.number().nullable() })),
  my_proposals: z.array(proposal),
  query_people: z.object({ notes: z.array(text).optional(), total: z.number(), people: z.array(brief.extend({ birthPlace: text.optional(), deathPlace: text.optional() })), groups: z.array(z.object({ key: text, count: z.number() })).optional() }),
  search_archive: z.object({ total: z.number(), results: z.array(z.object({ kind: text, id, personId: id.nullish(), title: text, snippet: text })) }),

  create_person: write(written),
  update_person: write(written),
  add_fact: write(written),
  update_people: write(applied),
  add_fact_to_people: write(applied),
  delete_people: write(applied),
  link_people: write(applied),
  delete_person: write(ok),
  add_relation: write(ok),
  update_relation: write(ok),
  move_relation: write(ok),
  set_parents: write(ok),
  remove_relation: write(ok),
  remove_parent_links: write(ok),
  create_page: write(z.object({ id, title: text })),
  update_page: write(z.object({ updatedAt: z.number() })),
  move_page: write(z.object({ updatedAt: z.number() })),
  delete_page: write(ok),
  upload_photo: write(z.object({ id, kind: text, originalName: text })),
  update_photo: write(ok),
  delete_photo: write(ok),
  tag_photo: write(z.object({ id, mediaId: id, personId: id.nullable(), label: text.nullable() })),
  untag_photo: write(ok),
  set_avatar: write(ok),
  create_place: write(z.object({ id })),
  update_place: write(z.object({ id })),
  add_version: write(written.extend({ claimId: id.optional() })),
  add_source: write(z.object({ sourceId: id })),
  remove_source: write(ok),
  restore_version: write(written),
  choose_version: write(written),
  reject_version: write(written),
  import_text: write(applied),
  import_gedcom: write(importCount),
  import_kinship_case: write(z.object({ persons: z.number(), updated: z.number(), parents: z.number(), unions: z.number() })),
  undo: write(ok.extend({ undone: text.optional() })),
  rollback_to: write(z.object({ count: z.number() })),
  undo_person: write(z.object({ undone: z.boolean(), left: z.number() })),
  merge_places: write(z.object({ id })),
  list_story_requests: z.array(z.object({ id, personId: id, about: text, tellerName: text, question: text, received: z.number(), expiresAt: z.number().nullable(), createdAt: z.number(), waiting: z.number(), state: text })),
  create_story_request: z.object({ created: z.literal(true), link: text, url: text }),
  revoke_story_request: ok,
  find_duplicates: z.array(z.object({ a: z.object({ id, name: text }), b: z.object({ id, name: text }), score: z.number(), why: z.array(text) })),
  preview_merge: (() => {
    const side = z.object({ id, name: text, updatedAt: z.number(), parents: z.number(), children: z.number(), unions: z.number(), pages: z.number(), photos: z.number(), stories: z.number(), contacts: z.number() })
    return z.object({ blocked: text.nullable(), warnings: z.array(text), fields: z.array(z.object({ field: text, keep: text, drop: text })), keep: side, drop: side })
  })(),
  list_similar_places: z.array(z.object({ a: z.object({ id, name: text, kind: text, parentId: id.nullable() }), b: z.object({ id, name: text, kind: text, parentId: id.nullable() }) })),
  get_place_suggestions: z.object({ snapshot: text.nullable(), candidates: z.array(z.object({ geonameId: z.number(), name: text, country: text, region: text, lat: z.number(), lon: z.number(), matched: text, why: z.array(text) })), note: text.optional() }),

  get_settings: z.object({ familyName: text, language: text }),
  update_settings: ok,
  list_users: z.array(z.object({ id, name: text, role: text })),
  set_user_role: ok,
  list_invites: z.array(z.object({ id, name: text, role: text })),
  create_invite: z.object({ link: text }),
  revoke_invite: ok,
  use_tools: z.object({ loaded: z.array(text) }),
  set_plan: z.object({ steps: z.array(z.object({ text, done: z.boolean() })), note: text.optional() }),
  focus_person: z.object({ id, name: text }),
  show_branch: z.object({ id, name: text, scope: text }),
  show_path: z.object({ path: z.array(id), relation: text }),
  set_chart_direction: z.object({ rootsBelow: z.boolean() }),

  view_photo: z.object({ id, name: text, caption: text, date: text, place: text }),
  read_attachment: z.object({ text, total: z.number(), more: z.boolean() }),
  save_attachment: z.object({ id, kind: text, name: text }),
  import_gedcom_attachment: importCount,
}
