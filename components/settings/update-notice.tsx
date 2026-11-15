'use client'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy'
import { api, useApp } from '@/lib/client'

export interface UpdateInfo {
  current: string
  latest: string | null
  url?: string
  newer: boolean
  how: { kind: string; button: boolean; command?: string; steps?: string } | null
  updating?: boolean
}

export const useUpdate = (enabled = true) => useQuery({ queryKey: ['update'], queryFn: () => api<UpdateInfo>('update'), staleTime: 3_600_000, enabled })

const MINUTES = 10

/** A new release: what is in it, and the one step that updates this install, or a button where it can update itself. */
export function UpdateNotice() {
  const { t, confirm, notify } = useApp()
  const { data } = useUpdate()
  const [phase, setPhase] = useState<'idle' | 'starting' | 'running' | 'failed' | 'stuck'>('idle')
  const [backup, setBackup] = useState('')

  // While the installer swaps the program the server is away; the page comes back by itself on the new version.
  useEffect(() => {
    if (phase !== 'running' || !data?.latest) return
    const until = Date.now() + MINUTES * 60_000
    const timer = setInterval(async () => {
      if (Date.now() > until) { setPhase('stuck'); return }
      const now = await fetch('/api/v1/update', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      if (now?.current === data.latest) location.reload()
      // The installer ended and the server still runs the old version: it stopped before touching anything.
      else if (now && !now.updating) setPhase('failed')
    }, 3000)
    return () => clearInterval(timer)
  }, [phase, data?.latest])

  if (!data?.newer || !data.latest) return null
  const start = async () => {
    if (!await confirm(t('Перед обновлением сервер сохранит копию базы и проверит её. Приложение будет недоступно около минуты, данные останутся на месте.'), t('Обновить'))) return
    setPhase('starting')
    try {
      const r = await api<{ backup: string }>('update', { method: 'POST' })
      setBackup(r.backup)
      setPhase('running')
    } catch (e) {
      setPhase('idle')
      notify((e as Error).message)
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-white px-3 py-2.5">
      <p className="font-medium">{t('Вышла версия')} {data.latest} <span className="font-normal text-ink-soft">({t('у вас')} {data.current})</span></p>
      {data.url && <a href={data.url} target="_blank" rel="noreferrer" className="self-start underline">{t('Что нового в этой версии')}</a>}
      {phase === 'running' && <p role="status" className="text-ink-soft">{t('Обновляется. Копия базы сохранена')}: <span className="break-anywhere">{backup}</span>. {t('Страница обновится сама, когда новая версия запустится.')}</p>}
      {phase === 'failed' && <p role="alert" className="text-destructive">{t('Обновление не удалось, и ничего не изменилось: работает прежняя версия, данные на месте. Что случилось, написано в logs/update.log в папке установки.')}</p>}
      {phase === 'stuck' && <p role="alert" className="text-destructive">{t('Новая версия не запустилась за 10 минут. Данные на месте. Что случилось, написано в logs/update.log в папке установки, а прежняя версия лежит рядом в app.old.')}</p>}
      {data.how?.button && (phase === 'idle' || phase === 'starting' || phase === 'failed') && (
        <Button type="button" className="self-start" disabled={phase === 'starting'} onClick={start}><Download /> {t('Обновить сейчас')}</Button>
      )}
      {data.how && !data.how.button && data.how.command && (
        <div className="flex flex-col gap-1.5">
          <p className="text-ink-soft">{t('Чтобы обновить, выполните на сервере, где стоит архив:')}</p>
          <code className="rounded bg-muted px-2 py-1 text-xs break-anywhere">{data.how.command}</code>
          <div><CopyButton value={data.how.command} /></div>
        </div>
      )}
      {data.how && !data.how.button && data.how.steps && <p className="text-ink-soft">{data.how.steps}</p>}
    </div>
  )
}
