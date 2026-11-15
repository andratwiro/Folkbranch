// One canvas on the map that we draw ourselves: the atlas under everything, the trails above it. It is redrawn
// whenever the view changes, including every frame of a long flight or a pinch, so the land never shows as a
// stretched rectangle. A short zoom animation scales it with the markers, as Leaflet's own renderer does.
import type * as Leaflet from 'leaflet'

/** How to put a world point (Web Mercator pixels at zoom 0) on the canvas: x × scale − ox, in CSS pixels. */
export interface View { ctx: CanvasRenderingContext2D; scale: number; ox: number; oy: number; w: number; h: number; dpr: number }

export interface CanvasLayer { layer: Leaflet.Layer; redraw: () => void }

/** Room drawn around the view, as a share of its size: what a short zoom-out animation shows at its edges. */
const PAD = 0.25
/** The most pixels one canvas holds (about 48 MB): a big window on a sharp screen draws a little softer instead. */
const MAX_PIXELS = 12e6

export function canvasLayer(L: typeof Leaflet, pane: string, draw: (v: View) => void): CanvasLayer {
  let map: Leaflet.Map | null = null
  const canvas = document.createElement('canvas')
  canvas.className = 'leaflet-zoom-animated map-canvas'
  canvas.style.pointerEvents = 'none'
  let view: View | null = null
  let drawnZoom = NaN, drawnCenter: Leaflet.LatLng | null = null
  let box = { x0: 0, y0: 0, x1: 0, y1: 0 } // what the canvas covers, in layer points

  const paint = () => {
    if (!view) return
    view.ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
    view.ctx.clearRect(0, 0, view.w, view.h)
    draw(view)
  }
  /** Sizes and places the canvas around the view as it is now, then draws. */
  const reset = () => {
    if (!map) return
    const size = map.getSize()
    const tl = map.containerPointToLayerPoint([-size.x * PAD, -size.y * PAD]).round()
    const w = Math.round(size.x * (1 + 2 * PAD)), h = Math.round(size.y * (1 + 2 * PAD))
    const dpr = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (w * h)))
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw; canvas.height = ph
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
    }
    L.DomUtil.setPosition(canvas, tl)
    const origin = map.getPixelOrigin()
    drawnZoom = map.getZoom(); drawnCenter = map.getCenter()
    box = { x0: tl.x, y0: tl.y, x1: tl.x + w, y1: tl.y + h }
    view = { ctx: canvas.getContext('2d')!, scale: 2 ** drawnZoom, ox: tl.x + origin.x, oy: tl.y + origin.y, w, h, dpr }
    paint()
  }
  /** A pan alone moves the canvas with the map; it is redrawn only when the view runs past what it covers. */
  const moved = () => {
    if (!map) return
    if (map.getZoom() !== drawnZoom) return reset()
    const size = map.getSize(), a = map.containerPointToLayerPoint([0, 0])
    if (a.x < box.x0 || a.y < box.y0 || a.x + size.x > box.x1 || a.y + size.y > box.y1) reset()
  }
  const zoomanim = (e: Leaflet.ZoomAnimEvent) => {
    if (!map || !drawnCenter) return
    const m = map as Leaflet.Map & { _getNewPixelOrigin(c: Leaflet.LatLng, z: number): Leaflet.Point }
    const scale = m.getZoomScale(e.zoom, drawnZoom)
    const half = m.getSize().multiplyBy(0.5 + PAD)
    const tl = half.multiplyBy(-scale).add(m.project(drawnCenter, e.zoom)).subtract(m._getNewPixelOrigin(e.center, e.zoom))
    L.DomUtil.setTransform(canvas, tl, scale)
  }

  // Dragged to a screen of another density (or zoomed in the browser): drawn again at the new one.
  let density: MediaQueryList | null = null
  const watchDensity = () => {
    density?.removeEventListener('change', onDensity)
    density = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    density.addEventListener('change', onDensity)
  }
  function onDensity() { watchDensity(); reset() }

  const Layer = L.Layer.extend({
    onAdd(m: Leaflet.Map) {
      map = m
      m.getPane(pane)!.appendChild(canvas)
      watchDensity()
      reset()
    },
    onRemove() { canvas.remove(); density?.removeEventListener('change', onDensity); density = null; map = null; view = null },
    getEvents() { return { viewreset: reset, zoom: reset, move: moved, moveend: reset, resize: reset, zoomanim } },
  })
  return { layer: new Layer(), redraw: paint }
}
