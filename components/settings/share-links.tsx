'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Link2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyField } from '@/components/ui/copy'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { List, ListRow, Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { api, useApp, useLinkOrigin } from '@/lib/client'
import { useViews } from '@/components/chart-scope'
import { StoryRequests } from './story-requests'

interface Share { id: string; name: string; viewId: string | null; hasPassword: boolean; expiresAt: number | null; opens: number }

/** One file to send to relatives: it opens anywhere, with no server, so a home install can share too. */
function FamilyFile() {
  const { t } = useApp()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  const make = async () => {
    setBusy(true)
    setDone('')
    setError('')
    try {
      const r = await fetch('/api/family-file')
      if (!r.ok) throw new Error(t('Could not prepare the file'))
      const stats = JSON.parse(r.headers.get('X-Family-File') ?? '{}')
      const name = decodeURIComponent(r.headers.get('Content-Disposition')?.split("''")[1] ?? 'family.html')
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setDone(`${t('People_count')}: ${stats.people}. ${t('Living hidden')}: ${stats.hidden}. ${t('Photos_count')}: ${stats.photos}${stats.photosLeftOut ? `, ${t('did not fit')}: ${stats.photosLeftOut}` : ''}. ${stats.bytes < 1048576 ? `${Math.ceil(stats.bytes / 1024)} ${t('KB')}` : `${(stats.bytes / 1048576).toFixed(1)} ${t('MB')}`}.`)
    } catch (x) {
      setError(String((x as Error).message ?? x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('A file for relatives')} description={t('One file with the chart, cards and photos. Send it in a messenger: relatives open it with no internet and no account. Living relatives are hidden, but biographies and photo captions go in as written, so check them for the names of the living.')}>
      <Button className="self-start" disabled={busy} onClick={make}><Download /> {busy ? t('Preparing the file…') : t('Download the file for relatives')}</Button>
      {done && <p role="status" className="text-xs text-ink-soft">{done}</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </Section>
  )
}

/** Viewing without an account: for a relative who will never sign up. */
export function ShareLinks() {
  const { t, lang, confirm: ask } = useApp()
  const qc = useQueryClient()
  const { data: links = [] } = useQuery({ queryKey: ['shares'], queryFn: () => api<Share[]>('shares') })
  const { data: views = [] } = useViews()
  const named = views.filter((v) => v.id !== 'main')
  const [name, setName] = useState('')
  const [viewId, setViewId] = useState('')
  const [days, setDays] = useState('30')
  const [password, setPassword] = useState('')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const origin = useLinkOrigin()
  const refresh = () => qc.invalidateQueries({ queryKey: ['shares'] })
  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <FamilyFile />
      <StoryRequests />
      <Section title={t('Link for viewing')} description={t('For those who need no account: view only, no sign-up. Living relatives are hidden, as for a reader.')}>
        <form className="flex flex-col gap-3" onSubmit={async (e) => {
          e.preventDefault()
          setError('')
          try {
            const { token } = await api<{ token: string }>('shares', { json: { name: name.trim(), viewId: viewId || null, expiresInDays: days ? Number(days) : null, ...(password ? { password } : {}) } })
            setLink(`${origin}/share/${token}`)
            setName('')
            setPassword('')
            refresh()
          } catch (x) {
            setError(String((x as Error).message ?? x))
          }
        }}>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label={t('Who it is for')}><Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={t('What the link shows')}><Select aria-label={t('What the link shows')} value={viewId} onChange={setViewId} options={[{ value: '', label: t('The whole family') }, ...named.map((v) => ({ value: v.id, label: v.name }))]} /></Field>
            <Field label={t('Lasts')}><Select aria-label={t('Lasts')} value={days} onChange={setDays} options={[{ value: '7', label: t('7 days') }, { value: '30', label: t('30 days') }, { value: '90', label: t('90 days') }, { value: '', label: t('Until I close it') }]} /></Field>
            <Field label={t('Password (optional)')}><Input type="text" autoComplete="off" minLength={4} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          </div>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <Button className="self-start" disabled={!name.trim()}><Link2 /> {t('Create a link')}</Button>
          {link && <CopyField label={t('Send this link to the person')} value={link} primary />}
        </form>
      </Section>
      <Section title={t('Open links')}>
        {!links.length && <p className="text-xs text-ink-soft">{t('None yet.')}</p>}
        <List>
          {links.map((l) => <ListRow key={l.id} title={l.name} meta={[l.viewId ? (named.find((v) => v.id === l.viewId)?.name ?? '') : t('The whole family'), l.hasPassword && t('with a password'), l.expiresAt ? t('before {date}').replace('{date}', date.format(l.expiresAt)) : t('Until I close it'), `${t('opened')}: ${l.opens}`].filter(Boolean).join(' · ')} actions={<Button size="sm" variant="danger" onClick={async () => { if (await ask(t('Close the link: {name}?').replace('{name}', () => l.name), t('Close the link'))) { await api(`shares/${l.id}`, { method: 'DELETE' }); refresh() } }}><X /> {t('Close the link')}</Button>} />)}
        </List>
      </Section>
    </div>
  )
}
