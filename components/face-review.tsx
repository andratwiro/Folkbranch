'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, RotateCcw, ScanFace, Square, UserRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api, mediaUrl, useApp } from '@/lib/client'
import { squareCrop } from '@/lib/faces'
import { useFaceCloud } from '@/lib/smart/face-cloud'
import { useModel } from '@/lib/smart/models'
import { ModelPrompt } from './model-prompt'
import type { FaceSuggestion } from '@/lib/smart/face-id'
import { personName, type Box, type Media } from '@/lib/types'
import { Mini } from './person-pickers'

const PER_RUN = 20

/** Faces across all the photos: the app suggests who it is, a person says yes or no. Runs only when asked to. */
export function FaceReview() {
  const { t, byId, focus, notify } = useApp()
  const qc = useQueryClient()
  const { data: photos = [] } = useQuery({ queryKey: ['media'], queryFn: () => api<Media[]>('media') })
  const [found, setFound] = useState<FaceSuggestion[]>([])
  const [progress, setProgress] = useState<string | null>(null)
  const [left, setLeft] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const stop = useRef<AbortController | null>(null)
  const model = useModel('recognize')
  const cloud = useFaceCloud()
  const ready = cloud.use || model.status === 'ready'
  useEffect(() => () => stop.current?.abort(), [])

  // People with a framed face and no portrait: nothing to recognise, one press away.
  const noPortrait = useMemo(() => {
    const first = new Map<string, { media: Media; box: Box }>()
    for (const m of photos) for (const tag of m.tags) {
      const p = tag.personId ? byId.get(tag.personId) : undefined
      if (p && !p.avatarMediaId && !p.hidden && tag.x !== null && !first.has(p.id)) first.set(p.id, { media: m, box: tag as Box })
    }
    return [...first]
  }, [photos, byId])

  const setPortrait = async (personId: string, mediaId: string, box: Box, width: number, height: number) => {
    await api(`persons/${personId}/avatar`, { method: 'PUT', json: { mediaId, crop: squareCrop(box, width, height) } })
    await qc.invalidateQueries({ queryKey: ['graph'] })
  }

  const scan = async () => {
    const run = (stop.current = new AbortController())
    setFailed(false)
    setProgress(cloud.use ? t('Preparing faces to compare…') : t('Getting the recognition model ready…'))
    try {
      const { learnCloudFaces, learnFaces, scanPhotos, scanPhotosCloud } = await import('@/lib/smart/face-id')
      const tags = photos.flatMap((m) => m.tags.map((tag) => ({ tag, mediaId: m.id, url: mediaUrl(m.id) })))
      const shots = photos.map((m) => ({ id: m.id, url: mediaUrl(m.id), tags: m.tags }))
      const progress = (done: number, total: number) => setProgress(`${t('Looking through photos')}: ${done} ${t('of')} ${total}`)
      const onFound = (s: FaceSuggestion) => setFound((all) => (all.some((x) => x.key === s.key) ? all : [...all, s]))
      let result: { left: number }
      if (cloud.use) {
        const references = await learnCloudFaces(shots, byId)
        if (!references.length) { setProgress(null); return notify(t('First tag faces on a few photos: the app has nothing to compare with yet.')) }
        result = await scanPhotosCloud(shots, references, { limit: PER_RUN, signal: run.signal, onProgress: progress, onFound })
      } else {
        const known = (await learnFaces(tags, (p) => setProgress(p.stage === 'model' ? t('Getting the recognition model ready…') : `${t('Comparing with tagged faces')}: ${p.done} ${t('of')} ${p.total}`), run.signal)).filter((k) => byId.has(k.personId))
        if (!known.length) { setProgress(null); return notify(t('First tag faces on a few photos: the app has nothing to compare with yet.')) }
        result = await scanPhotos(shots, known, { limit: PER_RUN, signal: run.signal, onProgress: progress, onFound })
      }
      setLeft(result.left)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') { console.error(e); setFailed(true) }
    }
    setProgress(null)
  }

  const accept = async (s: FaceSuggestion, portrait: boolean) => {
    try {
      await api(`media/${s.mediaId}/tags`, { json: { personId: s.personId, box: s.box } })
      if (portrait) await setPortrait(s.personId, s.mediaId, s.box, s.width, s.height)
      await qc.invalidateQueries({ queryKey: ['media'] })
      setFound((all) => all.filter((x) => x.key !== s.key))
    } catch (e) {
      notify(`${t('Could not save')}: ${(e as Error).message}`)
    }
  }
  const refuse = async (s: FaceSuggestion) => {
    setFound((all) => all.filter((x) => x.key !== s.key))
    const { refuseFace } = await import('@/lib/smart/face-id')
    await refuseFace(s)
  }
  const again = async () => {
    const { forgetScans } = await import('@/lib/smart/face-id')
    await forgetScans()
    setFound([])
    setLeft(null)
    scan()
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto px-3 pb-3 text-sm">
      <p className="text-xs text-ink-soft">
        {cloud.use
          ? t('The app looks for people already tagged in photos through the service the archive\'s owner connected. The photo goes to the archive\'s server and on to {where}, and is not kept in the archive. A name appears only after your Yes.').replace('{where}', t(cloud.info?.where ?? ''))
          : t('The app looks for people you already tagged. It all runs in this browser, and a name appears only after your “Yes”.')}
      </p>
      {cloud.enabled && !cloud.chosen && <p className="text-xs text-ink-soft">{t('Cloud face recognition is off on this device. It can be turned on in Settings, Faces and voice.')}</p>}
      {noPortrait.length > 0 && (
        <section className="flex flex-col gap-1">
          <h4 className="font-medium">{t('Portraits you can set')}</h4>
          {noPortrait.map(([id, { media, box }]) => {
            const p = byId.get(id)!
            return (
              <div key={id} className="flex items-center gap-2 py-1">
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => focus(id, { center: true })}><Mini person={p} /> <span className="truncate">{personName(p)}</span></button>
                <Button variant="outline" size="sm" onClick={() => setPortrait(id, media.id, box, media.width, media.height)}><UserRound /> {t('Set')}</Button>
              </div>
            )
          })}
        </section>
      )}
      {!cloud.use && <ModelPrompt pack="recognize">{t('To have the app recognise people in photos, download the model. It runs in this browser, and photos go nowhere.')}</ModelPrompt>}
      <div hidden={!ready} className="flex flex-wrap items-center gap-2 [&[hidden]]:hidden">
        {progress
          ? <><span role="status" className="text-xs text-ink-soft">{progress}</span><Button variant="outline" size="sm" onClick={() => stop.current?.abort()}><Square /> {t('Stop')}</Button></>
          : <Button variant="outline" onClick={scan}><ScanFace /> {t(left ? 'Look through more' : 'Find familiar faces in photos')}</Button>}
        {!progress && left !== null && <Button variant="ghost" size="sm" onClick={again}><RotateCcw /> {t('Look through everything again')}</Button>}
      </div>
      {failed && <p role="alert" className="text-xs text-destructive">{t('Could not start face recognition')}</p>}
      {!progress && left !== null && !found.length && <p className="text-xs text-ink-soft">{t(left ? 'Nobody recognised yet. You can look through more.' : 'No new matches.')}</p>}
      {found.map((s) => {
        const p = byId.get(s.personId)
        if (!p) return null
        return (
          <div key={s.key} className="flex items-center gap-2 border-t border-border pt-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.thumb} alt="" className="size-12 flex-none rounded-md object-cover" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-ink-soft">{t('This looks like')}</div>
              <div className="truncate">{personName(p)}</div>
            </div>
            <Button size="sm" title={t(p.avatarMediaId ? 'Tag on this photo' : 'Tag on this photo and set as portrait')} onClick={() => accept(s, !p.avatarMediaId)}><Check /> {t('Yes')}</Button>
            <Button variant="ghost" size="sm" title={t('This is someone else')} onClick={() => refuse(s)}><X /> {t('No')}</Button>
          </div>
        )
      })}
    </div>
  )
}
