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
    if (!await confirm(t('Before the update the server saves a copy of the database and checks it. The app will be away for about a minute; the data stays where it is.'), t('Update'))) return
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
      <p className="font-medium">{t('Version released:')} {data.latest} <span className="font-normal text-ink-soft">({t('you have')} {data.current})</span></p>
      {data.url && <a href={data.url} target="_blank" rel="noreferrer" className="self-start underline">{t('What\'s new in this version')}</a>}
      {phase === 'running' && <p role="status" className="text-ink-soft">{t('Updating. A copy of the database is saved')}: <span className="break-anywhere">{backup}</span>. {t('The page reloads by itself once the new version is running.')}</p>}
      {phase === 'failed' && <p role="alert" className="text-destructive">{t('The update did not work, and nothing changed: the previous version is running and the data is in place. What happened is in logs/update.log in the install folder.')}</p>}
      {phase === 'stuck' && <p role="alert" className="text-destructive">{t('The new version did not start within 10 minutes. The data is in place. What happened is in logs/update.log in the install folder, and the previous version is next to it in app.old.')}</p>}
      {data.how?.button && (phase === 'idle' || phase === 'starting' || phase === 'failed') && (
        <Button type="button" className="self-start" disabled={phase === 'starting'} onClick={start}><Download /> {t('Update now')}</Button>
      )}
      {data.how && !data.how.button && data.how.command && (
        <div className="flex flex-col gap-1.5">
          <p className="text-ink-soft">{t('To update, run this on the server where the archive is installed:')}</p>
          <code className="rounded bg-muted px-2 py-1 text-xs break-anywhere">{data.how.command}</code>
          <div><CopyButton value={data.how.command} /></div>
        </div>
      )}
      {data.how && !data.how.button && data.how.steps && <p className="text-ink-soft">{data.how.steps}</p>}
    </div>
  )
}
