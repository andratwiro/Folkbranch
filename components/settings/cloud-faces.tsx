'use client'
import { DataTerms } from './data-terms'
import { formatMoney } from '@/lib/ai/format'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, KeyRound, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { api, useApp } from '@/lib/client'
import { FACE_PRESETS, facePreset, type FaceId, type FacePreset } from '@/lib/faces/presets'

interface Status {
  current: { provider: FaceId; baseUrl: string | null; source: 'server' | 'app'; keyEnding: string; secretEnding: string | null; limitRequests: number } | null
  usage: { month: string; requests: number; dollars: number; unpriced: number }
}

const input = 'h-9 w-full rounded-lg border border-input bg-white px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
const price = (p: FacePreset, t: (k: string) => string) => p.perCall === null ? null : p.perCall === 0 ? t('free') : `$${(p.perCall * 1000).toFixed(2)} ${t('per 1000 requests')}`

/** Where the owner connects one face service for everyone and pays for it. Editors only use it. */
export function CloudFaces() {
  const { t, confirm: ask, lang } = useApp()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['faces'], queryFn: () => api<Status>('faces') })
  const [providerPick, setProviderPick] = useState<FaceId | null>(null)
  const [basePick, setBasePick] = useState<string | null>(null)
  const [limitPick, setLimitPick] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)
  const cur = data?.current ?? null
  const provider = providerPick ?? cur?.provider ?? 'facepp'
  const baseUrl = basePick ?? cur?.baseUrl ?? ''
  const limit = limitPick ?? String(cur?.limitRequests ?? 1000)
  if (!data) return null
  const preset = facePreset(provider)!
  const locked = cur?.source === 'server'
  const refresh = () => qc.invalidateQueries({ queryKey: ['faces'] }).then(() => qc.invalidateQueries({ queryKey: ['face-cloud-info'] }))
  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(what); setMessage(null)
    try { await fn(); await refresh(); setKey(''); setSecret(''); setMessage({ text: t(done), bad: false }) } catch (e) { setMessage({ text: (e as Error).message, bad: true }) } finally { setBusy('') }
  }
  const save = () => run('save', () => api('faces', {
    method: 'PUT',
    json: { provider, limitRequests: Number(limit) || 0, ...(preset.needsBase ? { baseUrl } : {}), ...(key ? { key } : {}), ...(secret ? { secret } : {}) },
  }), 'Saved. The key was checked with a free request; no photo was sent')
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <Section title={t('Cloud faces')} description={t('You connect one face recognition service and pay for it yourself. All editors of the archive find and recognise faces without keys of their own; the photo goes through your server and is not kept anywhere in the archive. Anyone who does not want their photo sent out stays with the model on their own device.')}>
        {cur ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-ink-soft" role="status">
            {t('Connected')}: {t(facePreset(cur.provider)!.label)}, {t('key')} …{cur.keyEnding}{cur.secretEnding ? `, ${t('secret')} …${cur.secretEnding}` : ''}{locked ? `. ${t('Set in the server\'s settings_neuter')}` : ''}.
            {' '}{t('This month')}: {data.usage.requests} {t('requests')}, {data.usage.dollars === 0 && data.usage.unpriced > 0 ? t('price unknown') : formatMoney(data.usage.dollars, lang)}{cur.limitRequests ? ` · ${t('limit')} ${cur.limitRequests}` : ''}
          </p>
        ) : <p className="text-xs text-ink-soft">{t('Not connected yet: only the model downloaded to the device finds and recognises faces.')}</p>}
        {!locked && (
          <>
            <div role="radiogroup" aria-label={t('Service')} className="grid gap-2 sm:grid-cols-2">
              {FACE_PRESETS.map((p) => (
                <button key={p.id} role="radio" aria-checked={provider === p.id} type="button" onClick={() => { setProviderPick(p.id); setBasePick(''); setKey(''); setSecret(''); setMessage(null) }} className={`rounded-lg border p-2.5 text-left transition-colors ${provider === p.id ? 'border-ink bg-white' : 'border-border hover:border-ink-faint'}`}>
                  <b className="block font-medium">{t(p.label)}</b>
                  <span className="block text-xs text-ink-soft">{t(p.pitch)}</span>
                  {p.free && <span className="mt-1 block text-xs text-ink-faint">{t(p.free.note)}</span>}
                </button>
              ))}
            </div>
            {preset.needsBase && <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('CompreFace server address')}<input className={input} aria-label={t('CompreFace server address')} value={baseUrl} placeholder="https://faces.example.org" onChange={(e) => setBasePick(e.target.value)} /></label>}
            <label className="flex flex-col gap-1 text-xs text-ink-soft">
              {t(preset.needsSecret ? 'Access key' : 'Service key')}
              <input className={`${input} font-mono`} type="password" autoComplete="off" aria-label={t('Service key')} value={key} placeholder={cur && cur.provider === provider ? `…${cur.keyEnding} (${t('leave empty to keep it')})` : t('Paste the key')} onChange={(e) => setKey(e.target.value)} />
              {preset.keysUrl && <a className="underline" href={preset.keysUrl} target="_blank" rel="noreferrer">{t('Where to get a key')}</a>}
              <a className="underline" href={preset.docs} target="_blank" rel="noreferrer">{t('Service documentation')}</a>
            </label>
            {preset.needsSecret && (
              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                {t('Service secret')}
                <input className={`${input} font-mono`} type="password" autoComplete="off" aria-label={t('Service secret')} value={secret} placeholder={cur && cur.provider === provider && cur.secretEnding ? `…${cur.secretEnding} (${t('leave empty to keep it')})` : t('Paste the secret')} onChange={(e) => setSecret(e.target.value)} />
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-ink-soft">
              {t('Monthly limit, requests to the service (0 for none)')}
              <input className={`${input} max-w-40`} inputMode="numeric" aria-label={t('Monthly limit')} value={limit} onChange={(e) => setLimitPick(e.target.value.replace(/\D/g, ''))} />
            </label>
            <p className="text-xs text-ink-faint">{t('The photo goes to')}: {t(preset.where)}. {price(preset, t) ? `${price(preset, t)}. ` : ''}{t('Service prices change: see their pages.')} {t(preset.tested)}</p>
            <DataTerms service={preset.id} open />
            <div className="flex flex-wrap gap-2">
              <Button type="button" loading={busy === 'save'} onClick={save}><KeyRound /> {cur ? t('Save') : t('Connect')}</Button>
              {cur && <Button type="button" variant="outline" loading={busy === 'test'} onClick={() => run('test', () => api('faces/test', { method: 'POST', json: {} }), 'Works: the service accepted a blank picture. It cost a fraction of a cent')}><FlaskConical /> {t('Test with a blank picture')}</Button>}
              {cur && <Button type="button" variant="danger" onClick={async () => { if (await ask(t('Disconnect cloud faces?'), t('Disconnect'), t('Editors go back to the models on their own devices.'))) run('remove', () => api('faces', { method: 'DELETE' }), 'Disconnected') }}><Trash2 /> {t('Disconnect')}</Button>}
            </div>
          </>
        )}
        {message && <p role={message.bad ? 'alert' : 'status'} className={`text-xs ${message.bad ? 'text-destructive' : 'text-ink-soft'}`}>{message.text}</p>}
      </Section>
    </div>
  )
}
