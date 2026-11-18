// What a step is about: the people it touches, how far a long step has got, and which fact or link it writes. Read from
// the step's own input (what the model asked for) and the progress a long step streams while it runs, so the panel can
// say "Reading cards: 12 of 40" instead of one label for a minute. Plain data: the browser uses it too.
export interface Subject {
  /** Person ids the step reads or changes, in the order given. */
  ids: string[]
  /** How many people the whole step covers. */
  total: number
  /** How many are done, while a long step runs; undefined when it does not report. */
  done?: number
  /** The fact kind, link type or fields being written. */
  what?: string
}

/** A progress report a long step sends before its answer. */
export const progressOf = (output: unknown): { done: number; total: number } | null => {
  const p = (output as { progress?: { done?: unknown; total?: unknown } } | null)?.progress
  return p && typeof p.done === 'number' && typeof p.total === 'number' ? { done: p.done, total: p.total } : null
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const one = (v: unknown) => (typeof v === 'string' && v ? [v] : [])

export function subjectOf(name: string, input: unknown, output?: unknown): Subject {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const ids = [...new Set([
    ...one(i.id), ...one(i.personId), ...strings(i.ids), ...strings(i.personIds), ...one(i.from), ...one(i.to), ...one(i.other),
    ...(Array.isArray(i.changes) ? i.changes.flatMap((c) => one((c as { id?: unknown })?.id)) : []),
  ])]
  const fact = (i.fact as { kind?: unknown } | undefined)?.kind
  const patch = i.patch && typeof i.patch === 'object' ? Object.keys(i.patch) : Array.isArray(i.changes) ? [...new Set(i.changes.flatMap((c) => Object.keys((c as { patch?: object })?.patch ?? {})))] : []
  const what = typeof fact === 'string' ? fact : name === 'add_relation' || name === 'update_relation' || name === 'remove_relation' ? (typeof i.type === 'string' ? i.type : undefined) : patch.length ? patch.slice(0, 3).join(', ') : undefined
  const progress = progressOf(output)
  return { ids, total: progress?.total ?? ids.length, ...(progress ? { done: progress.done } : {}), ...(what ? { what } : {}) }
}
