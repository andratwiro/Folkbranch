'use client'
import { memo, useState, type RefObject } from 'react'
import { Plus } from 'lucide-react'
import { type EdgePos, type Layout } from '@/lib/graph/layout'
import { avatarUrl, useApp, type QuickType } from '@/lib/client'
import { cn } from '@/lib/utils'
import { translate } from '@/lib/i18n'
import { lifeYears, personName, unionEnd, type Lang, type Person } from '@/lib/types'

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export type LightMode = 'pairs' | 'both-ends' | 'none'

type UnionItem = Layout['unions'][number]

export interface ChartActions {
  open: (id: string) => void
  center: (id: string) => void
  hover: (id: string | null) => void
  drag: (e: React.PointerEvent, id: string) => void
  move: (e: React.PointerEvent, id: string) => void
  unfold: (id: string) => void
  add: (type: QuickType, id: string) => void
  enterLine: (familyKey: string | null, ids: string[]) => void
  leaveLine: () => void
  tipEdge: (ev: React.MouseEvent, e: EdgePos) => void
  tipUnion: (ev: React.MouseEvent, u: UnionItem) => void
  tipDot: (ev: React.MouseEvent) => void
  hideTip: () => void
  pick: (ev: React.MouseEvent, kind: 'edge' | 'union', ids: string[], ax: number, ay: number) => void
  startDot: (e: React.PointerEvent, u: UnionItem) => void
  addChild: (u: UnionItem) => void
}

type Acts = RefObject<ChartActions>

export type Wave = { depth: Map<string, number>; pairs: Map<string, { d: number; up: boolean }> }
/** How long each step of the glow waits for the one before it. */
/** One generation's line is drawn in this long, and the next starts where it ends: the glow runs down like roots. */
export const WAVE_STEP = 260
const waitFor = (d: number) => `${Math.max(0, Math.min(d, 10) - 1) * WAVE_STEP}ms`

export const Lines = memo(function Lines({ families, unions, active, hotPairs, lightMode, selIds, hoverIds, wave }: { families: [string, EdgePos[]][]; unions: UnionItem[]; active: Set<string> | null; hotPairs: Set<string>; lightMode: LightMode; selIds: Set<string>; hoverIds: string[]; wave: Wave | null }) {
  /** A line is lit when both ends are in the highlighted set; a path is lit pair by pair. */
  const hotEdge = (e: EdgePos) =>
    lightMode === 'pairs' ? e.parentIds.some((p) => hotPairs.has(pairKey(p, e.childId)))
      : lightMode === 'both-ends' && !!active && active.has(e.childId) && e.parentIds.some((p) => active.has(p))
  /** The stretch of a line the glow is running along, drawn over it from one end. */
  const flow = (e: EdgePos) => {
    if (!wave) return null
    const hit = e.parentIds.map((p) => wave.pairs.get(pairKey(p, e.childId))).find((x) => x)
    return hit ? <path key={`f${e.id}`} d={e.path} pathLength={1} className={cn('flow', 'line-flow', hit.up && 'rev')} style={{ '--wd': waitFor(hit.d) } as React.CSSProperties} /> : null
  }
  return (
    <>
      {/* Each family is drawn over a paper-coloured halo, so crossings read as one line passing over another. */}
      {families.map(([key, edges]) => (
        <g key={key}>
          <path d={edges.map((e) => e.path).join('')} className="line-halo" />
          {edges.map((e) => <path key={e.id} d={e.path} className={cn('line', e.style !== 'solid' && e.style, !wave && hotEdge(e) && 'hot', selIds.has(e.id) && 'selected', hoverIds.includes(e.id) && 'hover')} />)}
          {edges.map(flow)}
        </g>
      ))}
      {unions.map((u) => {
        const hot = hotPairs.has(pairKey(u.union.aId, u.union.bId)) || (!!active && active.has(u.union.aId) && active.has(u.union.bId))
        const lit = wave?.pairs.get(pairKey(u.union.aId, u.union.bId))
        return (
          <g key={u.id}>
            <path d={u.path} className={cn('union', u.union.kind === 'civil' && 'civil', u.union.certainty === 'assumed' && 'assumed', !wave && hot && 'hot', selIds.has(u.id) && 'selected', hoverIds.includes(u.id) && 'hover')} />
            {lit && <path d={u.path} pathLength={1} className="flow union-flow" style={{ '--wd': waitFor(lit.d) } as React.CSSProperties} />}
          </g>
        )
      })}
    </>
  )
})

export const PersonCard = memo(function PersonCard({ p, left, top, wait, className, selected, label, mine, folded, canEdit, rootsBelow, lang, acts }: { p: Person; left: number; top: number; /** Steps from the person under the cursor: when this card's glow starts. */ wait?: number; className: string; selected: boolean; label?: string; mine?: string; folded?: number; canEdit: boolean; rootsBelow: boolean; lang: Lang; acts: Acts }) {
  const t = (key: string) => translate(lang, key)
  const open = () => acts.current.open(p.id)
  // The plus buttons exist only on the card in use: on every card they would be most of the page.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <div
      data-person={p.id}
      className={className}
      style={wait === undefined ? { left, top } : { left, top, '--wd': waitFor(wait + 1) } as React.CSSProperties}
      onClick={open}
      onMouseEnter={() => acts.current.hover(p.id)}
      onMouseLeave={() => acts.current.hover(null)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={(e) => {
        setFocused(true)
        // Tabbing walks along the chart, bringing the next people into view.
        if (e.target.matches('.card-main:focus-visible')) acts.current.center(p.id)
      }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false) }}
    >
      <div className="card-main" role="button" tabIndex={0} aria-label={p.hidden ? t('Living relative') : [personName(p), lifeYears(p), label, mine].filter(Boolean).join(', ')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } }}>
      <div className={cn('ava', canEdit && !p.hidden && 'link-start')} onPointerDown={canEdit && !p.hidden ? (e) => acts.current.drag(e, p.id) : undefined}><img src={avatarUrl(p)} alt="" decoding="async" draggable={false} /></div>
      {/* Opaque, so a line coming from below stops at the text however tall it wraps. */}
      <div className={cn('cap', canEdit && 'movable')} onPointerDown={canEdit ? (e) => acts.current.move(e, p.id) : undefined}>
        <div className="nm" title={p.hidden ? undefined : personName(p) || undefined}>{p.hidden ? t('Living relative') : personName(p) || t('Untitled')}</div>
        {!p.hidden && <div className="yr">{lifeYears(p)}</div>}
        {label && <div className="rel kin" title={label}>{label}</div>}
        {mine && <div className="rel me" title={mine}>{mine}</div>}
      </div>
      </div>
      {folded !== undefined && <button className="folded" onClick={(e) => { e.stopPropagation(); acts.current.unfold(p.id) }}>{t('Show descendants')}: {folded}</button>}
      {canEdit && !p.hidden && (hovered || focused || selected) && <CardTools id={p.id} rootsBelow={rootsBelow} lang={lang} acts={acts} />}
    </div>
  )
})

/** The end of a line under a caption that is shorter than its estimate. Below the cards, so a click on a name still reaches the card. */
export const HitTails = memo(function HitTails({ edges, acts }: { edges: EdgePos[]; acts: Acts }) {
  return (
    <>
      {edges.filter((e) => e.tail).map((e) => (
        <path
          key={`t${e.id}`}
          d={e.tail}
          className="line-hit"
          onMouseEnter={() => acts.current.enterLine(e.familyKey, [e.id])}
          onMouseMove={(ev) => acts.current.tipEdge(ev, e)}
          onMouseLeave={() => acts.current.leaveLine()}
          onClick={(ev) => acts.current.pick(ev, 'edge', [e.id], e.barAt[0], e.barAt[1] - 14)}
        />
      ))}
    </>
  )
})

/** Wide invisible strokes on top make thin lines easy to hover. */
export const HitAreas = memo(function HitAreas({ layout, edges, unions, groupHeads, acts }: { layout: Layout; edges: EdgePos[]; unions: UnionItem[]; groupHeads: EdgePos[]; acts: Acts }) {
  return (
    <>
      {groupHeads.map((e) => {
        const ids = () => layout.edges.filter((x) => x.group === e.group).map((x) => x.id)
        return (
          <path
            key={`g${e.group}`}
            d={e.shared}
            className="line-hit"
            onMouseEnter={() => acts.current.enterLine(e.familyKey, ids())}
            onMouseMove={(ev) => acts.current.tipEdge(ev, e)}
            onMouseLeave={() => acts.current.leaveLine()}
            onClick={(ev) => acts.current.pick(ev, 'edge', ids(), e.groupAt[0], e.groupAt[1] - 14)}
          />
        )
      })}
      {edges.map((e) => (
        <path
          key={`o${e.id}`}
          d={e.own}
          data-edge-child={e.childId}
          className="line-hit"
          onMouseEnter={() => acts.current.enterLine(e.familyKey, [e.id])}
          onMouseMove={(ev) => acts.current.tipEdge(ev, e)}
          onMouseLeave={() => acts.current.leaveLine()}
          onClick={(ev) => acts.current.pick(ev, 'edge', [e.id], e.barAt[0], e.barAt[1] - 14)}
        />
      ))}
      {unions.map((u) => (
        <path
          key={u.id}
          d={u.path}
          data-union-hit={u.id}
          onClick={(ev) => acts.current.pick(ev, 'union', [u.id], u.x, u.y - 14)}
          onMouseEnter={() => acts.current.enterLine(null, [u.id])}
          className="line-hit"
          onMouseMove={(ev) => acts.current.tipUnion(ev, u)}
          onMouseLeave={() => acts.current.leaveLine()}
        />
      ))}
    </>
  )
})

/** Slashes across the line of a union that ended, as genograms draw them: two for a divorce, one for a separation. */
export const endMarks = (x: number, y: number, n = 2) => (n === 1 ? [0] : [-3, 3]).map((d) => `M${x + d - 3.5} ${y + 7}L${x + d + 3.5} ${y - 7}`).join('')

export const FamilyDots = memo(function FamilyDots({ unions, active, canEdit, acts, drop }: { unions: UnionItem[]; active: Set<string> | null; canEdit: boolean; acts: Acts; drop: string | null }) {
  return unions.map((u) => {
    const hot = !!active && active.has(u.union.aId) && active.has(u.union.bId)
    return (
      <g key={u.id} data-union={u.union.id} className={cn('dot-group link-start', canEdit && 'can-add', drop === u.union.id && 'drop-target')} onPointerDown={(e) => acts.current.startDot(e, u)} onClick={canEdit ? (e) => { e.stopPropagation(); acts.current.addChild(u) } : undefined} onMouseEnter={(ev) => acts.current.tipDot(ev)} onMouseLeave={() => acts.current.hideTip()}>
        <circle cx={u.x} cy={u.y} r={13} className="dot-hit" />
        <circle cx={u.x} cy={u.y} r={5} className={cn('dot', u.union.kind === 'civil' && 'open', hot && 'hot')} />
        {(unionEnd(u.union) === 'divorced' || unionEnd(u.union) === 'separated') && <path d={endMarks(u.endAt[0], u.endAt[1], unionEnd(u.union) === 'separated' ? 1 : 2)} className="union-end" data-union-end={u.union.id} data-end={unionEnd(u.union)} />}
        {canEdit && <path d={`M${u.x - 4} ${u.y}H${u.x + 4}M${u.x} ${u.y - 4}V${u.y + 4}`} className="dot-plus" />}
      </g>
    )
  })
})

/** A plus on every side, placed where the relative will stand. A click on the portrait opens the editor. */
function CardTools({ id, rootsBelow, lang, acts }: { id: string; rootsBelow: boolean; lang: Lang; acts: Acts }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const add = (type: QuickType, label: string, side: string, key = side) => (
    <button key={key} className={`tool add ${side}`} title={`${translate(lang, label)}. ${translate(lang, 'Drag to a person to link')}`} aria-label={translate(lang, label)} onPointerDown={(e) => acts.current.drag(e, id)} onClick={() => acts.current.add(type, id)}><Plus strokeWidth={2.5} /></button>
  )
  return (
    <div className="tools" onClick={stop} onPointerDown={stop} onMouseDown={stop} onDoubleClick={stop} onKeyDown={stop}>
      {add('parent', 'Add parent', rootsBelow ? 'bottom' : 'top')}
      {add('spouse', 'Add spouse', 'left')}
      {add('spouse', 'Add spouse', 'right')}
      {add('child', 'Add child', rootsBelow ? 'top' : 'bottom')}
    </div>
  )
}

/** What the marks on the chart mean. */
export function Legend() {
  const { t } = useApp()
  const row = (mark: React.ReactNode, label: string) => (
    <div className="flex items-center gap-3 py-1"><span className="w-10 flex-none flex justify-center">{mark}</span><span>{t(label)}</span></div>
  )
  const line = (cls: string) => <svg width="40" height="12" className="legend-svg"><path d="M2 6H38" className={cls} /></svg>
  const ring = (cls: string) => <span className={`legend-ring ${cls}`} />
  const fine = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches
  return (
    <div>
      <h3 className="text-base font-medium mb-1">{t('Legend')}</h3>
      {row(ring('sex-M'), 'Man')}
      {row(ring('sex-F'), 'Woman')}
      {row(<svg width="40" height="12" className="legend-svg"><path d="M2 6H38" className="union" /><circle cx="20" cy="6" r="5" className="dot" /></svg>, 'Marriage; children come from the dot')}
      {row(<svg width="40" height="12" className="legend-svg"><path d="M2 6H38" className="union civil" /><circle cx="20" cy="6" r="5" className="dot open" /></svg>, 'Unmarried partners: dashed line')}
      {row(line('line'), 'Birth child')}
      {row(<svg width="40" height="12" className="legend-svg"><path d="M2 6H38" className="union" /><path d={endMarks(26, 6)} className="union-end" /></svg>, 'Divorce: two slashes on the line')}
      {row(<svg width="40" height="12" className="legend-svg"><path d="M2 6H38" className="union" /><path d={endMarks(26, 6, 1)} className="union-end" /></svg>, 'Separation: one slash')}
      {row(<svg width="40" height="12" className="legend-svg"><path d="M2 6H38" className="union" /><circle cx="20" cy="6" r="5" className="dot" /></svg>, 'Widowed: the line is not crossed out; the death shows on the card')}
      {row(line('line adopted'), 'Adopted child')}
      {row(line('line foster'), 'Foster child')}
      {row(line('line step'), 'Stepchild')}
      {row(line('line assumed'), 'Uncertain link')}
      {row(ring('assumed'), 'Uncertain person')}
      <ul className="mt-2 pt-2 border-t border-border text-sm flex flex-col gap-2">
        <li>{t('Click a person to open their card.')}</li>
        <li>{t('The + next to a person adds a relative.')}</li>
        {fine && <li>{t('Drag the + to another person to link them.')}</li>}
        {fine && <li>{t('Drag a person\'s caption to move their card.')}</li>}
        {fine && <li>{t('To remove a link, click the line and press Delete.')}</li>}
        {fine && <li>{(/Mac/.test(navigator.platform) ? (k: string) => k : (k: string) => k.replaceAll('⌘', 'Ctrl+'))(t('Keys: ⌘K search, ⌘J assistant, ⌘Z undo.'))}</li>}
      </ul>
      {fine && <>
      <h3 className="text-base font-medium mt-3 mb-1">{t('From the keyboard')}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {([['Tab', 'to the next person'], ['← ↑ → ↓', 'through the family: parents, children, spouse, siblings'], ['Enter', 'open the card'], ['+ − 0', 'larger, smaller, whole chart'], ['⌘K', 'search'], ['⌘J', 'assistant'], ['⌘Z', 'undo the last change']] as const).map(([k, what]) => <div key={k} className="contents"><dt><kbd>{k}</kbd></dt><dd className="text-ink-soft">{t(what)}</dd></div>)}
      </dl>
      </>}
    </div>
  )
}
