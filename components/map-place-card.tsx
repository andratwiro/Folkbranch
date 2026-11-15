'use client'
// "Who is here": a small card over a stack of faces, with the place, the moment, and everyone standing there now
// (since when), each a button that follows that person; and a way to zoom in until the stack opens into a ring.
// It closes on Escape, a press outside it, or when the map moves.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { X, ZoomIn } from 'lucide-react'
import { useApp } from '@/lib/client'

export interface PlaceCardPerson { id: string; name: string; face: string; since: number }
export interface PlaceCardProps {
  /** Where the stack is, in the page's pixels. */
  x: number; y: number
  place: string; year: number
  people: PlaceCardPerson[]
  onPick: (id: string) => void
  onZoom: () => void
  onClose: () => void
}

export function MapPlaceCard({ x, y, place, year, people, onPick, onZoom, onClose }: PlaceCardProps) {
  const { t } = useApp()
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ left: x + 18, top: y - 20 })
  // Beside the stack, kept on the screen and clear of the bars.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const w = el.offsetWidth, h = el.offsetHeight, vw = innerWidth, vh = innerHeight
    let left = x + 22, top = y - 24
    if (left + w > vw - 8) left = x - 22 - w
    left = Math.max(8, Math.min(vw - w - 8, left))
    top = Math.max(64, Math.min(vh - h - 8, top))
    setAt({ left, top })
  }, [x, y, people.length])
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('li button')?.focus({ preventScroll: true })
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const press = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('keydown', key, true)
    document.addEventListener('pointerdown', press, true)
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', press, true) }
  }, [onClose])
  return (
    <div ref={box} role="dialog" aria-label={`${place}, ${year}`} className="map-place float fixed z-20 w-80 max-w-[calc(100vw-16px)] p-2" style={at}>
      <div className="flex items-baseline gap-2 px-1">
        <h3 className="min-w-0 flex-1 truncate font-serif text-base text-ink">{place}</h3>
        <span className="font-serif text-sm tabular-nums text-ink-soft">{year}</span>
        <button type="button" className="self-center rounded p-1 text-ink-soft hover:bg-muted" aria-label={t('Закрыть')} onClick={onClose}><X size={14} /></button>
      </div>
      <ul className="mt-1 flex max-h-64 flex-col overflow-y-auto">
        {people.map((p) => (
          <li key={p.id}>
            <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted" onClick={() => onPick(p.id)}>
              <img src={p.face} alt="" className="map-place-face" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name}</span>
              <span className="flex-none text-sm text-ink-soft tabular-nums">{t('с')} {p.since}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="bar-btn mt-1 w-full justify-start" onClick={onZoom}><ZoomIn size={14} /> {t('Приблизить')}</button>
    </div>
  )
}
