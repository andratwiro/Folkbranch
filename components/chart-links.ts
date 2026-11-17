'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AVATAR_CY, type EdgePos, type Layout, type UnionPos } from '@/lib/graph/layout'
import { api, lastChangeId, useApp } from '@/lib/client'
import { personName } from '@/lib/types'
import { relationFor as rules, type LinkSource } from '@/lib/graph/link-rules'

type Source = LinkSource
/** Moving one end of a link that is already there: which link and end it is, once the person to move it to is known. */
type MovePlan = { type: 'parent' | 'union'; id: string; also?: string[]; end: 'parent' | 'child' | 'a' | 'b' } | { refuse: string }
export interface MoveHandle { key: string; x: number; y: number; title: string; plan: (target: string) => MovePlan; exclude: string[] }

/** Drawing a link: drag from an avatar, a plus or a family dot. */
export function useLinkDrawing(layout: Layout, toChart: (cx: number, cy: number) => { x: number; y: number }, onDragStart: () => void) {
  const app = useApp()
  const { family, byId, t } = app
  const qc = useQueryClient()
  const rowOf = (id: string) => layout.cards.get(id)?.y ?? 0
  const nameOf = (id: string) => personName(byId.get(id)!) || t('Скрыто')

  const [draft, setDraft] = useState<{ x1: number; y1: number; x2: number; y2: number; target: string | null; label: string; cx: number; cy: number } | null>(null)

  /** What the target becomes for the source, judged by where it stands on the chart. */
  const relationFor = (source: Source, target: string) => rules(
    { parents: family.parents, spouses: family.spouses, sexOf: (id) => byId.get(id)?.sex, rowOf, rootsBelow: !!app.rootsBelow },
    source, target,
  )

  /** Runs a link change and offers to take it back; `extra` are other ways to read the same drag. */
  const linkAndTell = async (rel: { type: string; to: string; other: string; otherParentId?: string | null }, text: string, extra: { label: string; rel: typeof rel; text: string }[]) => {
    try {
      await api('relations', { json: rel })
    } catch (e) {
      app.notify(`${t('Не удалось сохранить')}: ${(e as Error).message}`)
      return
    }
    await qc.invalidateQueries({ queryKey: ['graph'] })
    qc.invalidateQueries({ queryKey: ['history'] })
    const id = await lastChangeId()
    const back = async () => {
      await api(`history/${id}/undo`, { json: {} })
      await qc.invalidateQueries()
    }
    app.notify(text, [
      ...extra.map((x) => ({ label: x.label, run: async () => { await back(); linkAndTell(x.rel, x.text, extra.filter((y) => y !== x)) } })),
      { label: t('Отменить'), run: back },
    ])
  }

  const finishLink = (source: Source, target: string) => {
    const rel = relationFor(source, target)
    if (!rel) return app.notify(t('Эти люди уже связаны'))
    if ('refuse' in rel) return app.notify(t(rel.refuse))
    const a = 'person' in source ? source.person : source.parents[0]
    const sex = byId.get(target)?.sex
    const say = (label: string) => `${nameOf(target)} — ${t(label)}: ${'person' in source ? nameOf(a) : `${nameOf(source.parents[0])}, ${nameOf(source.parents[1])}`}`
    const others: { label: string; rel: { type: string; to: string; other: string; otherParentId?: string | null }; text: string }[] = 'person' in source ? [
      { label: t('Родитель'), rel: { type: sex === 'F' ? 'mother' : 'father', to: a, other: target }, text: say(sex === 'F' ? 'мать' : sex === 'M' ? 'отец' : 'родитель') },
      { label: t('Ребёнок'), rel: { type: sex === 'F' ? 'daughter' : 'son', to: a, other: target }, text: say(sex === 'F' ? 'дочь' : sex === 'M' ? 'сын' : 'ребёнок') },
      { label: t('Супруг'), rel: { type: 'spouse', to: a, other: target }, text: say('супруг') },
    ].filter((x) => x.rel.type !== rel.type) : []
    linkAndTell(rel, say(rel.label), others)
  }

  /** A press becomes a drag only after a few pixels, so plain clicks keep working. */
  const startLink = (e: React.PointerEvent, source: Source, fromX: number, fromY: number, onEmpty: (dir: 'up' | 'down' | 'side') => void) => {
    if (!app.canEdit || e.button) return
    const startX = e.clientX, startY = e.clientY
    let active = false
    const targetAt = (cx: number, cy: number) => {
      const hit = document.elementsFromPoint(cx, cy).find((el) => el.closest('[data-person]'))
      const id = hit?.closest<HTMLElement>('[data-person]')?.dataset.person
      return id && !byId.get(id)?.hidden ? id : null
    }
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return
      active = true
      onDragStart()
      const p = toChart(ev.clientX, ev.clientY)
      const target = targetAt(ev.clientX, ev.clientY)
      const sameAsSource = target && 'person' in source && target === source.person
      const rel = target && !sameAsSource ? relationFor(source, target) : null
      setDraft({
        x1: fromX, y1: fromY, x2: p.x, y2: p.y, target: sameAsSource ? null : target, cx: ev.clientX, cy: ev.clientY,
        label: target && !sameAsSource ? (rel && !('refuse' in rel) ? t(rel.label) : rel ? t(rel.refuse) : t('Эти люди уже связаны')) : t('Отпустите, чтобы добавить нового'),
      })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (!active) return
      setDraft(null)
      // The click that follows this release must not open the panel or a window.
      const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault() }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 200)
      if (ev.type === 'pointercancel') return
      const target = targetAt(ev.clientX, ev.clientY)
      if (target && !('person' in source && target === source.person)) finishLink(source, target)
      else if (!target) {
        const dx = ev.clientX - startX, dy = ev.clientY - startY
        onEmpty(Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 'up' : 'down') : 'side')
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  /** The handles on the ends of the selected link: drag one onto another person to move that end there. */
  const handlesFor = (edges: EdgePos[], union?: UnionPos): MoveHandle[] => {
    if (!app.canEdit) return []
    if (union) return union.ends.map((end, i) => ({
      key: `u${i}`, x: end.x, y: end.y, title: t('Перенести этот конец связи на другого человека'), exclude: union.ends.map((x) => x.id),
      plan: () => ({ type: 'union', id: union.id, end: end.id === union.union.aId ? 'a' : 'b' }),
    }))
    if (edges.length !== 1) return []
    const [e] = edges
    const ids = e.links.map((l) => l.id)
    return [
      { key: 'child', x: e.childAt[0], y: e.childAt[1], title: t('Перенести этот конец связи на другого человека'), exclude: [e.childId], plan: () => ({ type: 'parent', id: ids[0], also: ids.slice(1), end: 'child' }) },
      {
        key: 'parent', x: e.parentAt[0], y: e.parentAt[1], title: t('Перенести этот конец связи на другого человека'), exclude: e.links.map((l) => l.parentId),
        plan: (target) => {
          if (e.links.length === 1) return { type: 'parent', id: ids[0], end: 'parent' }
          // Two parents: the new one takes the place of the one of the same sex.
          const sex = byId.get(target)?.sex
          const same = e.links.filter((l) => sex && sex !== 'U' && byId.get(l.parentId)?.sex === sex)
          if (same.length === 1) return { type: 'parent', id: same[0].id, end: 'parent' }
          return { refuse: sex && sex !== 'U' ? 'У этого человека уже двое родителей. Чтобы заменить одного, сначала удалите связь с ним' : 'Не понять, какого из двух родителей заменить: у нового родителя не указан пол' }
        },
      },
    ]
  }

  const startEndMove = (e: React.PointerEvent, h: MoveHandle) => {
    if (!app.canEdit || e.button) return
    e.stopPropagation()
    const startX = e.clientX, startY = e.clientY
    let active = false
    const targetAt = (cx: number, cy: number) => {
      const id = document.elementsFromPoint(cx, cy).find((el) => el.closest('[data-person]'))?.closest<HTMLElement>('[data-person]')?.dataset.person
      return id && !byId.get(id)?.hidden && !h.exclude.includes(id) ? id : null
    }
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return
      active = true
      onDragStart()
      const p = toChart(ev.clientX, ev.clientY)
      const target = targetAt(ev.clientX, ev.clientY)
      const plan = target ? h.plan(target) : null
      setDraft({ x1: h.x, y1: h.y, x2: p.x, y2: p.y, target: plan && !('refuse' in plan) ? target : null, cx: ev.clientX, cy: ev.clientY,
        label: !target ? t('Отпустите на человеке, чтобы перенести конец связи сюда') : plan && 'refuse' in plan ? t(plan.refuse) : `${t('Перенести к')}: ${nameOf(target)}` })
    }
    const up = async (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (!active) return
      setDraft(null)
      const swallow = (c: Event) => { c.stopPropagation(); c.preventDefault() }
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 200)
      if (ev.type === 'pointercancel') return
      const target = targetAt(ev.clientX, ev.clientY)
      if (!target) return
      const plan = h.plan(target)
      if ('refuse' in plan) return app.notify(t(plan.refuse))
      try {
        await api(`relations/${plan.type}/${plan.id}/move`, { json: { end: plan.end, to: target, also: plan.also } })
      } catch (err) {
        return app.notify(`${t('Не удалось сохранить')}: ${(err as Error).message}`)
      }
      await qc.invalidateQueries({ queryKey: ['graph'] })
      qc.invalidateQueries({ queryKey: ['history'] })
      const id = await lastChangeId()
      app.notify(`${t('Связь перенесена')}: ${nameOf(target)}`, [{ label: t('Отменить'), run: async () => { await api(`history/${id}/undo`, { json: {} }); await qc.invalidateQueries() } }])
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  const startFromPerson = (e: React.PointerEvent, id: string) => {
    const c = layout.cards.get(id)
    if (!c) return
    startLink(e, { person: id }, c.x, c.y + AVATAR_CY, (dir) => {
      const type = dir === 'side' ? 'spouse' : (dir === 'up') === app.rootsBelow ? 'child' : 'parent'
      if (type === 'parent' && (family.parents.get(id) ?? []).length >= 2) return app.notify(t('У этого человека уже двое родителей. Чтобы заменить одного, сначала удалите связь с ним'))
      app.quickAdd(type, id)
    })
  }

  return { draft, startLink, startFromPerson, startEndMove, handlesFor }
}
