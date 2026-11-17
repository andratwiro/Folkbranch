'use client'
import { DataTerms } from './data-terms'
import { formatMoney } from '@/lib/ai/format'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, KeyRound, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { api, useApp } from '@/lib/client'
import { PayChoice, PlanLines, type Pay } from '../plan-badge'
import { STT_PRESETS, sttPreset, type SttId, type SttPreset } from '@/lib/transcribe/presets'

interface Status {
  presets: SttPreset[]
  current: { provider: SttId; model: string; baseUrl: string | null; source: 'server' | 'app'; keyEnding: string | null; sameKey: boolean; limitMinutes: number } | null
  assistant: string | null
  usage: { month: string; minutes: number; dollars: number; requests: number; unpriced: number }
}

const input = 'h-9 w-full rounded-lg border border-input bg-white px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
const hour = (p: SttPreset['models'][number], t: (k: string) => string) => (p.perMinute === null ? null : p.perMinute === 0 ? t('free') : t('{price} an hour').replace('{price}', `$${(p.perMinute * 60).toFixed(2)}`))

/** Where the owner connects one speech service for everyone and pays for it. Editors only use it. */
export function CloudSpeech() {
  const { t, confirm: ask, lang } = useApp()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['stt'], queryFn: () => api<Status>('transcription') })
  const [provider, setProvider] = useState<SttId | ''>('')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [same, setSame] = useState(false)
  const [limit, setLimit] = useState('600')
  const [pay, setPay] = useState<Pay>('paid')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)
  const cur = data?.current ?? null
  useEffect(() => {
    if (!cur) return
    setProvider(cur.provider); setModel(cur.model === 'auto' ? '' : cur.model); setBaseUrl(cur.baseUrl ?? ''); setSame(cur.sameKey); setLimit(String(cur.limitMinutes))
  }, [cur?.provider, cur?.model, cur?.baseUrl, cur?.sameKey, cur?.limitMinutes]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null
  const preset = provider ? sttPreset(provider)! : null
  const locked = cur?.source === 'server'
  const refresh = () => qc.invalidateQueries({ queryKey: ['stt'] }).then(() => qc.invalidateQueries({ queryKey: ['stt-info'] }))
  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(what); setMessage(null)
    try { await fn(); await refresh(); setKey(''); setMessage({ text: t(done), bad: false }) } catch (e) { setMessage({ text: (e as Error).message, bad: true }) } finally { setBusy('') }
  }
  const save = () => preset && run('save', () => api('transcription', { method: 'PUT', json: { provider, model: model || 'auto', ...(provider === 'custom' ? { baseUrl } : {}), ...(same ? { sameKey: true } : { key: key || undefined }), limitMinutes: Number(limit) || 0 } }), 'Saved. The key was checked: that request cost nothing')
  // The key already on the list for this service, or the assistant's for the same service, can be used again.
  const canBorrow = (cur?.provider === provider && cur.sameKey) || (!!preset?.assistantKey && data.assistant === preset.assistantKey)
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <Section title={t('Cloud transcription')} description={t('You connect one speech recognition service and pay for it yourself. All editors of the archive use it without keys of their own; the recording goes through your server and is not kept anywhere in the archive. Anyone who does not want their voice sent out stays with the models on their own device.')}>
        {/* What answers now, in one line on top, before anything that could be mistaken for it. */}
        <div className="rounded-xl border border-border bg-white px-4 py-3" role="status">
          <div className="text-xs text-ink-faint">{t('In use now')}</div>
          <div className="font-medium">{cur ? `${t(sttPreset(cur.provider)!.label)} · ${cur.model === 'auto' ? t('newest tested') : cur.model}` : t('On this device, free')}</div>
          {!cur && <div className="text-xs text-ink-soft">{t('Each device recognises speech itself, with the model from “Models on this device”. Nothing leaves it.')}</div>}
        </div>
        {cur ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-ink-soft">
            {t('Connected')}: {t(sttPreset(cur.provider)!.label)}, {cur.model}{cur.keyEnding ? `, ${t('key')} …${cur.keyEnding}` : cur.sameKey ? `, ${t('assistant\'s key')}` : ''}{locked ? `. ${t('Set in the server\'s settings_neuter')}` : ''}.
            {' '}{t('This month')}: {data.usage.minutes} {t('min')}, {data.usage.requests} {t('requests')}, {data.usage.dollars === 0 && data.usage.unpriced > 0 ? t('price unknown') : formatMoney(data.usage.dollars, lang)}{cur.limitMinutes ? ` · ${t('limit')} ${cur.limitMinutes} ${t('min')}` : ''}
          </p>
        ) : null}
        {!locked && (
          <>
            <h3 className="text-[15px] font-semibold">{cur ? t('Change the service') : t('Connect a cloud service')}</h3>
            <PayChoice value={pay} onChange={(v) => { setPay(v); if (v === 'free' && !preset?.free) { const first = STT_PRESETS.find((p) => p.free); if (first) { setProvider(first.id); setModel('') } } }} />
            <div role="radiogroup" aria-label={t('Service')} className="grid gap-2 sm:grid-cols-2">
              {STT_PRESETS.filter((p) => pay !== 'free' || p.free).map((p) => (
                <button key={p.id} role="radio" aria-checked={provider === p.id} type="button" onClick={() => { setProvider(p.id); setModel(''); setSame(!!cur && cur.provider === p.id && cur.sameKey); setMessage(null) }} className={`rounded-lg border p-2.5 text-left transition-colors ${provider === p.id ? 'border-ink bg-white' : 'border-border hover:border-ink-faint'}`}>
                  <b className="block font-medium">{t(p.label)}</b>
                  <span className="block text-xs text-ink-soft">{t(p.pitch)}</span>
                  <PlanLines free={p.free} show={pay} />
                </button>
              ))}
            </div>
            {!preset ? <p className="text-xs text-ink-soft">{t('Choose a service above to set its model and key.')}</p> : <>
            {preset.id === 'custom' ? (
              <label className="flex flex-col gap-1 text-xs text-ink-soft">
              {t('Model_model')}
              {preset.id === 'custom' ? <input className={`${input} font-mono`} aria-label={t('Model_model')} value={model} placeholder="whisper-1" onChange={(e) => setModel(e.target.value)} /> : (
                <Select aria-label={t('Model_model')} value={model} onChange={setModel} options={[...(preset.id === 'custom' ? [] : [{ value: '', label: t('newest tested') }]), ...preset.models.map((m) => ({ value: m.id, label: `${t(m.label)}${hour(m, t) ? ` · ${hour(m, t)}` : ''}` }))]} />
              )}
              {preset.models.find((m) => m.id === model)?.note && <span>{t(preset.models.find((m) => m.id === model)!.note!)}</span>}
            </label>
            ) : (
              <details>
                <summary className="cursor-pointer text-xs text-ink-soft">{t('For experts: choose the model yourself_model')}</summary>
                <div className="mt-2 flex flex-col gap-1">
                  <p className="text-xs text-ink-soft">{t('If you do not choose, the tested model is used, and the app picks up a newer one of the same line by itself.')}</p>
                  <label className="flex flex-col gap-1 text-xs text-ink-soft">
              {t('Model_model')}
              <Select aria-label={t('Model_model')} value={model} onChange={setModel} options={[{ value: '', label: t('newest tested') }, ...preset.models.map((m) => ({ value: m.id, label: `${t(m.label)}${hour(m, t) ? ` · ${hour(m, t)}` : ''}` }))]} />
              {preset.models.find((m) => m.id === model)?.note && <span>{t(preset.models.find((m) => m.id === model)!.note!)}</span>}
            </label>
                </div>
              </details>
            )}
            {preset.id === 'custom' && <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Server address')}<input className={input} aria-label={t('Server address')} value={baseUrl} placeholder="http://192.168.1.10:8000/v1" onChange={(e) => setBaseUrl(e.target.value)} /></label>}
            {canBorrow && <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-[var(--ink)]" checked={same} onChange={(e) => setSame(e.target.checked)} />{t('Use the assistant\'s key: the same service, nothing to paste')}</label>}
            {!same && (
              <label className="flex flex-col gap-1 text-xs text-ink-soft">
                {t('Service key')}
                <input className={`${input} font-mono`} type="password" autoComplete="off" aria-label={t('Service key')} value={key} placeholder={cur && cur.provider === provider && cur.keyEnding ? `…${cur.keyEnding} (${t('leave empty to keep it')})` : t('Paste the key')} onChange={(e) => setKey(e.target.value)} />
                {preset.keysUrl && <a className="underline" href={preset.keysUrl} target="_blank" rel="noreferrer">{t('Where to get a key')}</a>}
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs text-ink-soft">
              {t('Monthly limit, minutes of recording (0 for none)')}
              <input className={`${input} max-w-40`} inputMode="numeric" aria-label={t('Monthly limit')} value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} />
            </label>
            <p className="text-xs text-ink-faint">{t('The recording goes to')}: {t(preset.where)}. {t('Service prices change: see their pages.')} {['openrouter', 'groq'].includes(preset.id) ? t('Tested.') : t('Not tested.')}</p>
            <DataTerms service={preset.id} open />
            <div className="flex flex-wrap gap-2">
              <Button type="button" loading={busy === 'save'} onClick={save}><KeyRound /> {cur ? t('Save') : t('Connect')}</Button>
              {cur && <Button type="button" variant="outline" loading={busy === 'test'} onClick={() => run('test', () => api('transcription/test', { method: 'POST', json: {} }), 'Works: the service accepted a test recording. It cost a fraction of a cent')}><FlaskConical /> {t('Test with a silent recording')}</Button>}
              {cur && <Button type="button" variant="danger" onClick={async () => { if (await ask(t('Disconnect cloud transcription?'), t('Disconnect'), t('Editors go back to the models on their own devices.'))) run('remove', () => api('transcription', { method: 'DELETE' }), 'Disconnected') }}><Trash2 /> {t('Disconnect')}</Button>}
            </div>
            </>}
          </>
        )}
        {message && <p role={message.bad ? 'alert' : 'status'} className={`text-xs ${message.bad ? 'text-destructive' : 'text-ink-soft'}`}>{message.text}</p>}
      </Section>
    </div>
  )
}
