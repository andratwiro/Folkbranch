'use client'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AVATAR_CY, type Layout } from '@/lib/graph/layout'
import { api, lastChangeId, useApp, type QuickType } from '@/lib/client'
import { personName } from '@/lib/types'

type Source = { person: string } | { parents: [string, string] }

/** Drawing a link: drag from an avatar, a plus or a family dot. */
export function useLinkDrawing(layout: Layout, toChart: (cx: number, cy: number) => { x: number; y: number }, onDragStart: () => void) {
  const app = useApp()
  const { family, byId, t } = app
  const qc = useQueryClient()
  const rowOf = (id: string) => layout.cards.get(id)?.y ?? 0
  const nameOf = (id: string) => personName(byId.get(id)!) || t('Hidden_neuter')

  const [draft, setDraft] = useState<{ x1: number; y1: number; x2: number; y2: number; target: string | null; label: string; cx: number; cy: number } | null>(null)

  /** What the target becomes for the source, judged by where it stands on the chart. */
  const relationFor = (source: Source, target: string): { type: QuickType; to: string; other: string; otherParentId: string | null; label: string } | null => {
    const sex = byId.get(target)?.sex
    const childType: QuickType = sex === 'F' ? 'daughter' : 'son'
    const childLabel = sex === 'F' ? 'daughter' : sex === 'M' ? 'son' : 'child'
    if ('parents' in source) {
      if (source.parents.includes(target) || (family.parents.get(target) ?? []).length) return null
      return { type: childType, to: source.parents[0], other: target, otherParentId: source.parents[1], label: childLabel }
    }
    const s = source.person
    if (s === target) return null
    const related = (family.parents.get(s) ?? []).includes(target) || (family.parents.get(target) ?? []).includes(s) || (family.spouses.get(s) ?? []).includes(target)
    if (related) return null
    // Positive means the target stands on a younger row.
    const dy = (rowOf(target) - rowOf(s)) * (app.rootsBelow ? -1 : 1)
    if (dy < 0) return { type: sex === 'F' ? 'mother' : 'father', to: s, other: target, otherParentId: null, label: sex === 'F' ? 'mother' : sex === 'M' ? 'father' : 'parent' }
    if (dy > 0) {
      // A child with no parents yet belongs to the couple, if there is exactly one.
      const spouses = family.spouses.get(s) ?? []
      const other = spouses.length === 1 && !(family.parents.get(target) ?? []).length ? spouses[0] : null
      return { type: childType, to: s, other: target, otherParentId: other, label: childLabel }
    }
    return { type: 'spouse', to: s, other: target, otherParentId: null, label: 'spouse' }
  }

  /** Runs a link change and offers to take it back; `extra` are other ways to read the same drag. */
  const linkAndTell = async (rel: { type: string; to: string; other: string; otherParentId?: string | null }, text: string, extra: { label: string; rel: typeof rel; text: string }[]) => {
    try {
      await api('relations', { json: rel })
    } catch (e) {
      app.notify(`${t('Could not save')}: ${(e as Error).message}`)
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
      { label: t('Undo'), run: back },
    ])
  }

  const finishLink = (source: Source, target: string) => {
    const rel = relationFor(source, target)
    if (!rel) return app.notify(t('These people are already linked'))
    const a = 'person' in source ? source.person : source.parents[0]
    const sex = byId.get(target)?.sex
    const say = (label: string) => `${nameOf(target)} — ${t(label)}: ${'person' in source ? nameOf(a) : `${nameOf(source.parents[0])}, ${nameOf(source.parents[1])}`}`
    const others: { label: string; rel: { type: string; to: string; other: string; otherParentId?: string | null }; text: string }[] = 'person' in source ? [
      { label: t('Parent'), rel: { type: sex === 'F' ? 'mother' : 'father', to: a, other: target }, text: say(sex === 'F' ? 'mother' : sex === 'M' ? 'father' : 'parent') },
      { label: t('Child'), rel: { type: sex === 'F' ? 'daughter' : 'son', to: a, other: target }, text: say(sex === 'F' ? 'daughter' : sex === 'M' ? 'son' : 'child') },
      { label: t('Spouse'), rel: { type: 'spouse', to: a, other: target }, text: say('spouse') },
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
        label: target && !sameAsSource ? (rel ? t(rel.label) : t('These people are already linked')) : t('Release to add someone new'),
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
  const startFromPerson = (e: React.PointerEvent, id: string) => {
    const c = layout.cards.get(id)
    if (!c) return
    startLink(e, { person: id }, c.x, c.y + AVATAR_CY, (dir) => {
      const type = dir === 'side' ? 'spouse' : (dir === 'up') === app.rootsBelow ? 'child' : 'parent'
      if (type === 'parent' && (family.parents.get(id) ?? []).length >= 2) return app.notify(t('This person already has two parents'))
      app.quickAdd(type, id)
    })
  }

  return { draft, startLink, startFromPerson }
}
