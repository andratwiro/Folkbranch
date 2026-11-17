'use client'
import { ImportDialog } from '../import-dialog'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DatabaseBackup, Download, FileText, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { SwitchRow } from '@/components/ui/switch'
import { api, useApp } from '@/lib/client'
import { KinshipCase } from './kinship-case'
import { RestoreForm } from './restore-form'

interface BackupStatus { on: boolean; last: number | null; count: number; bytes: number; keep: number; problem: 'disk' | 'failed' | null }

/** The server's own daily copies: when the last one was made, and what they are good for. */
function DailyCopies() {
  const { t, lang } = useApp()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['backups'], queryFn: () => api<BackupStatus>('backups/status') })
  const [busy, setBusy] = useState(false)
  if (!data) return null
  const when = data.last ? new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(data.last) : null
  const mb = new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(data.bytes / 1024 / 1024)
  return (
    <Section title={t('Copies on the server')} description={t('The server copies the database by itself once a day and keeps the latest copies. They guard against mistakes and failed updates. Only a full copy you keep elsewhere guards against a broken disk.')}>
      {!data.on && <p className="text-xs text-ink-soft">{t('Daily copies are turned off in the server settings.')}</p>}
      {data.problem === 'disk' && <p role="alert" className="text-xs text-destructive">{t('No copy was made: the disk is almost full.')}</p>}
      {data.problem === 'failed' && <p role="alert" className="text-xs text-destructive">{t('The last copy failed. The server log says why.')}</p>}
      <p className="text-sm">{when ? `${t('Last copy')}: ${when}, ${mb} ${t('MB')}. ${t('Copies kept')}: ${data.count} ${t('of')} ${data.keep}.` : t('No copies yet. The first comes a few minutes after the start.')}</p>
      <Button variant="outline" className="self-start" disabled={busy} onClick={async () => { setBusy(true); try { qc.setQueryData(['backups'], await api<BackupStatus>('backups/now', { method: 'POST' })) } finally { setBusy(false) } }}><DatabaseBackup /> {t(busy ? 'Copying…' : 'Copy now')}</Button>
    </Section>
  )
}

export function Files({ onText }: { onText: () => void }) {
  const { t, canEdit, me } = useApp()
  const [hide, setHide] = useState(true)
  const [importing, setImporting] = useState(false)
  const { data: voices } = useQuery({ queryKey: ['stories', 'usage'], queryFn: () => api<{ used: number; limit: number }>('stories/usage'), enabled: me.role === 'owner' })
  const mb = (n: number) => Math.ceil(n / 1024 / 1024)
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <WhereDataLives />
      {me.role === 'owner' && <DailyCopies />}
      {me.role === 'owner' && (
        <Section title={t('Full copy of the archive')} description={t('All people, biographies, photos and history in one file. Keep it like family papers: it holds data of living relatives. Keys to AI services and sign-in methods are not in it: add them again after a restore.')}>
            <Button asChild variant="outline" className="self-start"><a href="/api/archive"><Download /> {t('Download a full copy')}</a></Button>
        </Section>
      )}
      {canEdit && (
        <Section title={t('Add people from a file')} description={t('GEDCOM from other programs, an Excel or CSV table, JSON. You will see what changes first. You can also drop a file on the chart.')}>
          <Button variant="outline" className="self-start" onClick={() => setImporting(true)}><Upload /> {t('Choose a file')}</Button>
          <ImportDialog open={importing} onOpenChange={setImporting} />
        </Section>
      )}
      <Section title={t('Download the chart')} description={t('GEDCOM opens in other family tree programs. It holds people and links, not pages or photos.')}>
        {me.role !== 'reader' && <SwitchRow title={t('Hide living relatives')} description={t('They will not be in the file.')} checked={hide} onChange={setHide} />}
        <Button asChild variant="outline" className="self-start"><a href={`/api/v1/gedcom/export?living=${hide ? 'hide' : 'show'}`}><Download /> {t('Download the .ged file')}</a></Button>
      </Section>
      <Section title={t('The chart as text')} description={t('The whole chart as plain text: easy to read, copy or add many people at once.')}>
        <Button variant="outline" className="self-start" onClick={onText}><FileText /> {t('Open text')}</Button>
      </Section>
      {canEdit && <KinshipCase />}
      {me.role === 'owner' && (
        <>
          {voices && (
        <Section title={t('Voice recordings')}>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, (voices.used / voices.limit) * 100)}%` }} /></div>
          <p className="text-xs text-ink-soft">{t('Used')} {mb(voices.used)} {t('MB of')} {mb(voices.limit)} {t('MB')}.</p>
        </Section>
          )}
          <Section danger title={t('Restore from a copy')} description={t('Replaces the whole current archive. We will ask once more first.')}>
            <RestoreForm t={t} warning={t('The current archive will be replaced by this file. The old one stays on the server in the backups folder, but cannot be brought back from the app.')} />
          </Section>
        </>
      )}
    </div>
  )
}

/** Where each kind of data lives, how long, and what happens with time: only what the code does, checked against it. */
function WhereDataLives() {
  const { t } = useApp()
  const items: [string, string][] = [
    ['Archive', 'People, links, biographies, photos, stories and history are kept on your server, in the data folder. They leave it only for the AI service you connected, and only what it reads.'],
    ['History of edits', 'Every edit is kept for good, with who made it: a person, the assistant on their behalf, or a program with an MCP token. An edit can be undone if the same record has not been changed since.'],
    ['Programs over MCP', 'They work only with a token. Edits by a token with review wait for you under Review and change nothing until you accept them.'],
    ['Conversations with the assistant', 'The text of conversations is kept only in this browser, the last 20. Clear the browser or use another device and they are not there. Edits made in a conversation stay in the history.'],
    ['Settings and keys', 'Kept in the database on the server, keys encrypted. Changes to settings are not in the history: the daily copies keep them. Keys are not in the full archive copy.'],
    ['AI usage', 'Requests, tokens and minutes are counted by month and stay in the database.'],
    ['If the app is not updated', 'The archive keeps working as it is. If a service removes the assistant or speech model, the app picks another tested one by itself (except a model set in the server settings). Changes in face services or sign-in methods may need an update. Services change their terms and prices over time: see their pages. Updating from the app first makes a copy of the database.'],
  ]
  return (
    <Section title={t('Where everything is kept')}>
      <dl className="flex flex-col gap-2 text-xs">
        {items.map(([k, v]) => <div key={k}><dt className="font-medium text-ink">{t(k)}</dt><dd className="text-ink-soft">{t(v)}</dd></div>)}
      </dl>
    </Section>
  )
}
