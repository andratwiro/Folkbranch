'use client'
import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { api, useApp, useWrite } from '@/lib/client'
import { lifeYears, personName, type Certainty, type Person, type Union } from '@/lib/types'
import { Mini } from './person-pickers'
import { Field, CERTAINTY, DateField, Segmented } from './person-fields'
import { Select } from '@/components/ui/select'

/** A big family shows its first few; the rest are one press away. */
const SHOWN = 8

export function FamilyTab({ person }: { person: Person }) {
  const app = useApp()
  const { t, family, byId, graph, canEdit, quickAdd, focus, lang, notify, undoLast } = app
  const [open, setOpen] = useState<string[]>([])
  // One small press takes a link away, so it can be given back at once from the note it leaves.
  const remove = useWrite(async ({ type, id }: { type: string; id: string }) => {
    await api(`relations/${type}/${id}`, { method: 'DELETE' })
    notify(t('Link removed'), [{ label: t('Restore'), run: () => void undoLast() }])
  })
  const setCertainty = useWrite(({ type, id, certainty, kind }: { type: string; id: string; certainty?: string; kind?: string }) => api(`relations/${type}/${id}`, { method: 'PATCH', json: { certainty, kind } }))
  const parents = graph.parentChild.filter((l) => l.childId === person.id)
  const children = graph.parentChild.filter((l) => l.parentId === person.id)
  const unions = graph.unions.filter((u) => u.aId === person.id || u.bId === person.id)
  const siblings = [...new Set((family.parents.get(person.id) ?? []).flatMap((p) => family.children.get(p) ?? []))].filter((s) => s !== person.id)

  const chip = (id: string, onRemove?: () => void, extra?: React.ReactNode, saysRelation = false) => {
    const p = byId.get(id)
    if (!p) return null
    return (
      <div key={id} className="group flex items-center gap-1.5 rounded-2xl bg-muted pl-1 pr-2 min-h-7 py-0.5 max-w-full min-w-0 [&:has(select)]:flex-wrap [&_select]:order-2 max-sm:[&_select]:!min-h-8 [&_select]:max-w-full [&_select]:[field-sizing:content] max-sm:flex-wrap max-sm:h-auto max-sm:rounded-2xl max-sm:py-1">
        <button className="flex items-center gap-1.5 min-w-0 text-left" onClick={() => focus(id, { center: true })}>
          <Mini person={p} size={22} />
          <span className="break-anywhere min-w-0">{p.hidden ? t('Living relative') : personName(p) || t('Untitled')}</span>
        </button>
        <span className="text-xs text-ink-faint break-anywhere min-w-0">{[!p.hidden && lifeYears(p), saysRelation && family.relation(person.id, id, lang)?.label].filter(Boolean).join(' · ')}</span>
        {extra}
        {canEdit && onRemove && <button className="order-1 ml-auto max-sm:p-2 max-sm:-m-1 text-ink-faint hover:text-destructive opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity" title={t('Remove relation')} aria-label={`${t('Remove relation')}: ${p.hidden ? t('Living relative') : personName(p) || t('Untitled')}`} onClick={onRemove}><X size={12} /></button>}
      </div>
    )
  }
  const kindToggle = (l: { id: string; kind: string; certainty: string }, female: boolean, stepWord = 'step') => canEdit && (
    <Select look="quiet" title={t('Relationship')} aria-label={t('Relationship')} value={`${l.kind}:${l.certainty}`} onChange={(v) => {
      const [kind, certainty] = v.split(':')
      setCertainty.mutate({ type: 'parent', id: l.id, kind, certainty })
    }} options={(['birth', 'adopted', 'step'] as const).flatMap((k) => (Object.keys(CERTAINTY) as Certainty[]).map((c) => ({ value: `${k}:${c}`, label: `${t(k === 'birth' ? (female ? 'birth_feminine' : 'birth_masculine') : k === 'adopted' ? (female ? 'adopted' : 'adopted_masculine') : stepWord)} · ${t(CERTAINTY[c])}` })))} />
  )
  const group = (title: string, items: React.ReactNode[], add?: [string, string]) => (!canEdit && !items.length ? null : (
    <section className="mb-4">
      <h4 className="text-base font-medium mb-1.5">{t(title)}</h4>
      <div className="flex flex-wrap gap-1.5 items-center">
        {(open.includes(title) ? items : items.slice(0, SHOWN))}
        {items.length > SHOWN && !open.includes(title) && <button className="add-btn" onClick={() => setOpen([...open, title])}>{t('Show everyone')}: {items.length}</button>}
        {canEdit && add && (
          <button className="add-btn" onClick={() => quickAdd(add[0] as never, person.id)}><Plus size={14} /> {t(add[1])}</button>
        )}
      </div>
    </section>
  ))
  const save = useWrite((json: Partial<Person>) => api(`persons/${person.id}`, { method: 'PATCH', json }))
  // "None" known is different from "none recorded": said here, and the review stops asking.
  const none = (key: 'noChildren' | 'neverMarried', label: string, empty: boolean) => (!empty && !person[key] ? null : canEdit
    ? <label className="mb-4 -mt-2 flex items-center gap-2 cursor-pointer min-h-7 text-ink-soft"><input type="checkbox" className="accent-[var(--ink)] size-4" checked={!!person[key]} onChange={(e) => save.mutate({ [key]: e.target.checked })} />{t(label)}</label>
    : person[key] ? <p className="mb-4 -mt-2 text-ink-soft">{t(label)}</p> : null)
  return (
    <div className="px-4 py-4 text-sm">
      {group('Parents', parents.map((l) => chip(l.parentId, () => remove.mutate({ type: 'parent', id: l.id }), kindToggle(l, byId.get(l.parentId)?.sex === 'F'))), parents.length < 2 ? ['parent', 'Add parent'] : undefined)}
      {group('Spouses', unions.map((u) => (
        <div key={u.id} className="w-full flex flex-col gap-1.5 items-start">
          {chip(u.aId === person.id ? u.bId : u.aId, () => remove.mutate({ type: 'union', id: u.id }), undefined, true)}
          <UnionDetails union={u} />
        </div>
      )), ['spouse', 'Add spouse'])}
      {none('neverMarried', person.sex === 'F' ? 'Never married_female' : 'Never married', !unions.length)}
      {group('Children', children.map((l) => chip(l.childId, () => remove.mutate({ type: 'parent', id: l.id }), kindToggle(l, byId.get(l.childId)?.sex === 'F', 'stepchild'))), ['child', 'Add child'])}
      {none('noChildren', 'Had no children', !children.length)}
      {siblings.length > 0 && group('Siblings', siblings.map((s) => chip(s, undefined, undefined, true)))}
    </div>
  )
}

/** The marriage itself: which kind, when it began and ended, where. */
function UnionDetails({ union: u }: { union: Union }) {
  const { t, canEdit, graph } = useApp()
  const edit = useWrite((json: Partial<Union>) => api(`relations/union/${u.id}`, { method: 'PATCH', json }))
  const ro = !canEdit
  // "?" keeps an ended union whose date nobody knows.
  const ended = !!u.endDate
  const places = useMemo(() => [...new Set(graph.persons.flatMap((p) => [p.birthPlace, p.deathPlace]).concat(graph.unions.map((x) => x.place)).filter(Boolean))].sort().slice(0, 300), [graph])
  if (ro && !u.startDate && !u.endDate && !u.place) return null
  return (
    <div className="pl-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 items-center justify-items-start w-full">
      <span className="text-ink-soft">{t('Union')}</span>
      <Segmented label={t('Union')} disabled={ro} value={u.kind} onChange={(kind) => edit.mutate({ kind })} options={[['marriage', t('Marriage')], ['civil', t('Unregistered')]]} />
      <span className="text-ink-soft">{t('Began')}</span>
      <DateField readOnly={ro} value={u.startDate} placeholder={t('e.g. 1945')} onSave={(startDate) => edit.mutate({ startDate })} />
      <span className="text-ink-soft">{t('Place')}</span>
      <Field suggestions={places} readOnly={ro} value={u.place} placeholder={t('e.g. Paris')} onSave={(place) => edit.mutate({ place })} />
      {!ro && (
        <label className="col-span-2 flex items-center gap-2 cursor-pointer min-h-7">
          <input type="checkbox" className="accent-[var(--ink)] size-4" checked={ended} onChange={(e) => edit.mutate({ endDate: e.target.checked ? '?' : '' })} />
          {t('The union ended')}
        </label>
      )}
      {ended && (
        <>
          <span className="text-ink-soft">{t('Ended')}</span>
          <DateField readOnly={ro} value={u.endDate === '?' ? '' : u.endDate} placeholder={ro ? t('date unknown') : t('e.g. 1960')} onSave={(endDate) => edit.mutate({ endDate: endDate || '?' })} />
        </>
      )}
    </div>
  )
}
