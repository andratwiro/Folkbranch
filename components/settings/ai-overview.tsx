'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AudioLines, ChevronRight, Cpu, ExternalLink, KeyRound, MessageSquare, Plug, Plus, ScanFace, Trash2 } from 'lucide-react'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { DataTerms } from './data-terms'
import { CustomProviderForm, type OwnProvider } from './custom-provider'
import { formatMoney } from '@/lib/ai/format'
import { api, useApp } from '@/lib/client'
import type { AiSettingsFile } from '@/lib/ops/ai-config'
import { applyChoices, chosen, currentChoices, type Pack } from '@/lib/smart/models'
import { sttPreset } from '@/lib/transcribe/presets'
import { facePreset } from '@/lib/faces/presets'
import { cn } from '@/lib/utils'

interface Applied { applied: string[]; skipped: { what: string; why: string }[]; onDevice: Partial<Record<Pack, string>> | null }
interface Provider { custom?: boolean; connected: boolean; provider: string | null; label: string | null; model: string | null; auto: boolean; source: 'server' | 'app' | null; tokensToday: number; dailyLimit: number; month: Spend & { input: number; cached: number; output: number } }
interface Tally { requests: number; tokens: number; seconds: number; dollars: number; unpriced: number }
interface Report { totals: Record<'assistant' | 'speech' | 'faces' | 'mcp', Tally>; people: ({ id: string; name: string | null } & Record<'assistant' | 'speech' | 'faces', Tally>)[]; tokens: ({ id: string; name: string | null } & Tally)[] }
interface Choice { provider: string; label: string; model: string; modelLabel: string; current: boolean; autoPossible: boolean; custom?: boolean }
interface KeyRow { service: string; label: string; keyEnding: string; can: { assistant: boolean; speech: boolean }; usedBy: { assistant: boolean; speech: boolean } }
interface Keys { keys: KeyRow[]; available: { service: string; label: string; keysUrl: string | null; can: { assistant: boolean; speech: boolean }; needsFolder: boolean }[] }
/** A month's spend as the providers stated it; unpriced counts requests whose provider stated no cost. */
interface Spend { dollars: number; unpriced: number }
interface Speech { current: { provider: string; model: string; sameKey: boolean; limitMinutes: number; source: 'server' | 'app' } | null; usage: Spend & { minutes: number } }
interface Faces { current: { provider: string; limitRequests: number } | null; usage: Spend & { requests: number } }
interface Token { id: string; name: string; role: 'reader' | 'editor'; review: boolean; revokedAt: number | null; expiresAt: number | null; lastUsedAt: number | null }
type Go = (to: 'assistant' | 'speech' | 'faces' | 'smart' | 'agents') => void

/** One card of rows, as in the system settings of a phone: a hairline between rows, nothing else. */
const Card = ({ children }: { children: ReactNode }) => <div className="overflow-hidden rounded-xl border border-border bg-white divide-y divide-border">{children}</div>
const Head = ({ children, right }: { children: ReactNode; right?: ReactNode }) => <div className="mb-2 flex items-baseline gap-2 px-0.5"><h3 className="text-[15px] font-semibold">{children}</h3>{right && <div className="ml-auto text-sm">{right}</div>}</div>
const Chip = ({ children, warn }: { children: ReactNode; warn?: boolean }) => <span className={cn('flex-none rounded-full px-2 py-0.5 text-xs', warn ? 'bg-[#f8eedc] text-[#a8691b]' : 'bg-[#edf3ea] text-[#4d7a4a]')}>{children}</span>

/** A row: an icon, the name, one short line of what it uses, and what can be done; the whole row opens its page. */
function Row({ icon, title, meta, right, onOpen, accent, control }: { icon: ReactNode; title: ReactNode; meta?: ReactNode; right?: ReactNode; onOpen?: () => void; accent?: boolean; control?: ReactNode }) {
  const body = (
    <>
      <span className={cn('grid size-7 flex-none place-items-center rounded-lg bg-[#f4ede0]', accent ? 'text-accent' : 'text-[#a4502e]')}>{icon}</span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <span className={cn('min-w-0 shrink-0 truncate font-medium max-sm:shrink', accent && 'text-[#a4502e]')}>{title}</span>
        {meta && <span className="truncate text-[13.5px] text-ink-faint">{meta}</span>}
      </span>
    </>
  )
  return (
    <div className="px-4">
      <div className="flex min-h-[52px] items-center gap-3">
        {onOpen ? <button type="button" className="flex min-w-0 flex-1 items-center gap-3 self-stretch text-left" onClick={onOpen}>{body}</button> : <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>}
        {right}
        {onOpen && <ChevronRight size={16} className="flex-none text-ink-faint" aria-hidden />}
      </div>
      {/* A picker sits under the name, in line with it, so neither is cut short. */}
      {control && <div className="-mt-2 pb-3 pl-10">{control}</div>}
    </div>
  )
}

/** Everything about AI in the archive on one screen: what it cost, what it does, through whom, and who else connects. */
export function AiOverview({ onGo }: { onGo: Go }) {
  const { t, notify, confirm, lang } = useApp()
  const qc = useQueryClient()
  const { data: file } = useQuery({ queryKey: ['ai-settings'], queryFn: () => api<AiSettingsFile>('ai-settings') })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api<{ assistantEnabled: boolean }>('settings') })
  const { data: provider } = useQuery({ queryKey: ['provider'], queryFn: () => api<Provider>('assistant/provider') })
  const { data: speech } = useQuery({ queryKey: ['stt'], queryFn: () => api<Speech>('transcription') })
  const { data: faces } = useQuery({ queryKey: ['faces'], queryFn: () => api<Faces>('faces') })
  const { data: tokens = [] } = useQuery({ queryKey: ['tokens'], queryFn: () => api<Token[]>('tokens') })
  const { data: keys } = useQuery({ queryKey: ['ai-keys'], queryFn: () => api<Keys>('ai/keys') })
  const { data: report } = useQuery({ queryKey: ['ai-usage'], queryFn: () => api<Report>('ai/usage') })
  const { data: own = [] } = useQuery({ queryKey: ['ai-custom'], queryFn: () => api<OwnProvider[]>('ai/custom') })
  const { data: choices = [] } = useQuery({ queryKey: ['assistant-choices'], queryFn: () => api<Choice[]>('assistant/choices') })
  const refresh = () => Promise.all(['ai-keys', 'ai-custom', 'assistant-choices', 'provider', 'stt', 'settings', 'ai-usage'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  /** A change from a picker: the error, if any, said where it happened. */
  const apply = async (call: () => Promise<unknown>) => {
    try { await call(); await refresh() } catch (e) { notify((e as Error).message) }
  }
  const [result, setResult] = useState<Applied | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const { data: balance } = useQuery({ queryKey: ['provider-balance'], queryFn: () => api<{ remaining: number | null; spentThisMonth: number | null } | null>('assistant/provider/balance'), enabled: provider?.provider === 'openrouter', staleTime: 60_000 })
  // A real cost can be a fraction of a cent: shown to the digit it has, never rounded to zero.
  const money = (d: number) => formatMoney(d, lang)
  /** Never $0 for a price nobody knows; ≈ where the figure is ours, not the provider's. */
  const spend = (u: Spend) => (u.dollars === 0 && u.unpriced > 0 ? '—' : `${money(u.dollars)}${u.unpriced > 0 ? '+' : ''}`)
  /** Said under the figure: part of it, or all of it, has no price we know. */
  const unknown = (u: Spend) => (u.unpriced > 0 ? (u.dollars === 0 ? t('price unknown') : t('some unpriced')) : null)
  const line = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' · ')
  const [now] = useState(() => Date.now())
  // A straight line from the days gone; before the 5th there is too little to draw it.
  const at = new Date(now)
  const monthDays = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate()
  const spent = ([provider?.month, speech?.current ? speech.usage : null, faces?.current ? faces.usage : null] as (Spend | null | undefined)[]).filter((u): u is Spend => !!u)
  const forecast = at.getUTCDate() >= 5 && spent.some((u) => u.dollars > 0) ? (spent.reduce((a, u) => a + u.dollars, 0) / (at.getUTCDate() - 1 + at.getUTCHours() / 24)) * monthDays : null
  const priced = !!provider && provider.month.dollars > 0
  const live = tokens.filter((k) => !k.revokedAt && (!k.expiresAt || k.expiresAt > now))
  const speechName = speech?.current ? t(sttPreset(speech.current.provider as never)?.label ?? speech.current.provider) : null
  const facesName = faces?.current ? t(facePreset(faces.current.provider as never)?.label ?? faces.current.provider) : null

  // What each function can be switched to: a service from the list of keys and one of its models.
  const [adding, setAdding] = useState<string | null>(null)
  // The form for a provider of your own: closed, a new one, or one being changed.
  const [form, setForm] = useState<'new' | OwnProvider | null>(null)
  const withoutKey = (what: 'assistant' | 'speech') => (keys?.available ?? []).filter((a) => a.can[what] && !keys!.keys.some((k) => k.service === a.service)).map((a) => ({ value: `add|${a.service}`, label: `${t(a.label)} · ${t('add a key')}` }))
  const speechOptions = [{ value: 'device', label: t('On this device, free') }, ...withoutKey('speech'), ...(keys?.keys ?? []).filter((k) => k.can.speech).flatMap((k) => [{ value: `${k.service}|auto`, label: `${t(k.label)} · ${t('newest tested')}` }, ...(sttPreset(k.service as never)?.models ?? []).map((m) => ({ value: `${k.service}|${m.id}`, label: `${t(k.label)} · ${t(m.label)}` }))])]
  const speechValue = speech?.current ? `${speech.current.provider}|${speech.current.model}` : 'device'
  const assistantValue = provider?.connected ? (provider.auto ? `${provider.provider}|auto` : `${provider.provider}|${provider.model}`) : ''
  // "auto" keeps moving to the newest tested model of the line; a named model stays as chosen.
  const pickAssistant = (v: string) => {
    if (v.startsWith('add|')) return setAdding(v.slice(4))
    const [p, ...m] = v.split('|')
    const model = m.join('|')
    void apply(async () => {
      if (p !== provider?.provider) await api('assistant/provider', { method: 'PATCH', json: { provider: p, ...(model === 'auto' ? {} : { model }) } })
      else await api('assistant/provider', { method: 'PATCH', json: model === 'auto' ? { auto: true } : { model } })
    })
  }
  const assistantOptions = [...new Set(choices.map((c) => c.provider))].flatMap((p) => {
    const of = choices.filter((c) => c.provider === p)
    return [...(of[0].autoPossible ? [{ value: `${p}|auto`, label: `${t(of[0].label)} · ${t('newest tested')}` }] : []), ...of.map((c) => ({ value: `${c.provider}|${c.model}`, label: c.custom ? `${c.label} · ${c.modelLabel} · ${t('your provider')}` : `${t(c.label)} · ${c.modelLabel}` }))]
  }).concat(withoutKey('assistant'))
  const pickSpeech = (v: string) => {
    if (v.startsWith('add|')) return setAdding(v.slice(4))
    if (v === 'device') {
      return void (async () => {
        if (speech?.current && !await confirm(t('Disconnect cloud transcription?'), t('Disconnect'), t('Editors go back to the models on their devices. The chosen model and the minute limit will be forgotten.'))) return
        await apply(() => api('transcription', { method: 'DELETE' }))
      })()
    }
    const [p, ...m] = v.split('|')
    void apply(() => api('transcription', { method: 'PUT', json: { provider: p, model: m.join('|'), sameKey: true } }))
  }
  const removeKey = async (k: KeyRow) => {
    const uses = [k.usedBy.assistant && t('assistant'), k.usedBy.speech && t('speech recognition')].filter(Boolean).join(', ')
    const note = `${t('The key will be removed from the archive: to bring it back, paste it again.')}${uses ? ` ${t('Will be switched off')}: ${uses}.` : ''}`
    if (!await confirm(`${t('Remove the key')} ${t(k.label)}?`, t('Remove the key'), note)) return
    await apply(() => api(`ai/keys/${k.service}`, { method: 'DELETE' }))
  }

  const switchToOwn = (p: OwnProvider) => void apply(() => api('assistant/provider', { method: 'PATCH', json: { provider: p.id } }))
  const removeOwn = async (p: OwnProvider) => {
    const note = `${t('The key will be removed from the archive: to bring it back, paste it again.')}${p.active ? ` ${t('Will be switched off')}: ${t('assistant')}.` : ''}`
    if (!await confirm(`${t('Remove the provider')} ${p.name}?`, t('Remove the provider'), note)) return
    await apply(() => api(`ai/custom/${p.id}`, { method: 'DELETE' }))
  }
  const hostOf = (u: string) => { try { return new URL(u).host } catch { return u } }

  const switchAssistant = async (on: boolean) => {
    await api('settings', { method: 'PATCH', json: { assistantEnabled: on ? '1' : '0' } })
    await qc.invalidateQueries({ queryKey: ['settings'] })
    location.reload()
  }
  const download = () => {
    if (!file) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ ...file, onDevice: currentChoices() }, null, 2)], { type: 'application/json' }))
    a.download = 'folkbranch-ai-settings.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const upload = async (f: File) => {
    try {
      const out = await api<Applied>('ai-settings', { method: 'PUT', json: JSON.parse(await f.text()) })
      const device = out.onDevice ? applyChoices(out.onDevice) : []
      setResult({ ...out, applied: [...out.applied, ...(device.length ? [t('Models on this device')] : [])] })
      await qc.invalidateQueries()
    } catch (e) {
      notify(e instanceof SyntaxError ? t('This is not an AI settings file of the app') : (e as Error).message)
    }
  }
  const mcpUrl = typeof location === 'undefined' ? '/api/mcp' : `${location.origin}/api/mcp`

  return (
    <div className="flex min-w-0 flex-col gap-6 text-sm">
      <section>
        <Head right={forecast != null ? <span className="text-ink-faint">{t('By month end')} ≈{money(forecast)}</span> : undefined}>{t('Usage')}</Head>
        <div className="grid grid-cols-3 gap-3 max-[520px]:grid-cols-1">
          <Usage icon={<MessageSquare size={14} />} label={t('Assistant')} value={provider ? (priced ? spend(provider.month) : provider.tokensToday.toLocaleString(lang)) : '…'}
            unit={!provider ? '' : priced ? t('this month') : t('tokens today')}
            used={provider?.connected ? [provider.tokensToday, provider.dailyLimit] : null} limitLabel={provider ? (priced ? `${t('today')} ${provider.tokensToday.toLocaleString(lang)} ${t('of')} ${provider.dailyLimit.toLocaleString(lang)} ${t('tokens')}` : `${t('of')} ${provider.dailyLimit.toLocaleString(lang)} ${t('tokens')}`) : ''}
            sub={provider ? line(unknown(provider.month), balance?.remaining != null && `${t('left on the key')} ${money(balance.remaining)}`, !provider.connected && t('not connected')) : ''} />
          <Usage icon={<AudioLines size={14} />} label={t('Speech recognition')} value={speech ? (speech.current ? spend(speech.usage) : money(0)) : '…'} unit={speech?.current ? t('this month') : ''}
            used={speech?.current?.limitMinutes ? [speech.usage.minutes, speech.current.limitMinutes] : null} limitLabel={speech?.current ? `${speech.usage.minutes} ${t('of')} ${speech.current.limitMinutes || '∞'} ${t('min')}` : ''}
            sub={speech?.current ? line(unknown(speech.usage)) : t('on the device, free')} />
          <Usage icon={<ScanFace size={14} />} label={t('Face recognition')} value={faces ? (faces.current ? spend(faces.usage) : money(0)) : '…'} unit={faces?.current ? t('this month') : ''}
            used={faces?.current?.limitRequests ? [faces.usage.requests, faces.current.limitRequests] : null} limitLabel={faces?.current ? `${faces.usage.requests} ${t('of')} ${faces.current.limitRequests || '∞'} ${t('requests')}` : ''}
            sub={faces?.current ? line(unknown(faces.usage)) : t('on the device, free')} />
        </div>
      </section>

      {report && report.people.length > 0 && (
        <section>
          <Head>{t('Who used how much')}</Head>
          <Card>
            {report.people.map((p) => {
              const cost = (x: Tally) => (x.dollars > 0 ? money(x.dollars) : x.unpriced > 0 ? t('price unknown') : '')
              const parts = [
                p.assistant.requests > 0 && `${t('Assistant')} — ${t('requests')}: ${p.assistant.requests}, ${t('tokens')}: ${p.assistant.tokens.toLocaleString(lang)}${cost(p.assistant) ? `, ${cost(p.assistant)}` : ''}`,
                p.speech.requests > 0 && `${t('Speech recognition')} — ${t('minutes')}: ${Math.round(p.speech.seconds / 6) / 10}${cost(p.speech) ? `, ${cost(p.speech)}` : ''}`,
                p.faces.requests > 0 && `${t('Face recognition')} — ${t('requests')}: ${p.faces.requests}`,
              ].filter(Boolean)
              const total = p.assistant.dollars + p.speech.dollars + p.faces.dollars
              return <Row key={p.id} icon={<MessageSquare size={15} />} title={p.name ?? t('No name')} control={<div className="flex flex-col gap-0.5 text-xs text-ink-soft">{parts.map((x) => <span key={x as string}>{x}</span>)}</div>} right={total > 0 ? <span className="flex-none tabular-nums">{money(total)}</span> : undefined} />
            })}
          </Card>
          <p className="mt-1.5 px-0.5 text-xs text-ink-faint">{t('Money is only what the provider itself stated. Where it states no price, you see the number of requests; the sum is in its account.')}</p>
        </section>
      )}

      <section>
        <Head>{t('AI features')}</Head>
        <Card>
          <Row icon={<MessageSquare size={15} />} title={t('Assistant')} onOpen={() => onGo('assistant')}
            meta={provider?.source === 'server' ? `${provider.label} · ${provider.model} · ${t('set on the server_masculine')}` : undefined}
            control={provider?.source !== 'server' && keys && <Select look="small" className="max-w-xs" aria-label={t('The assistant\'s service and model')} value={assistantValue} placeholder={t('Not chosen: the assistant is off')} onChange={pickAssistant}
              options={assistantOptions} />}
            right={settings && provider?.connected ? <Toggle on={settings.assistantEnabled} label={t('Assistant')} onChange={switchAssistant} /> : undefined} />
          <Row icon={<AudioLines size={15} />} title={t('Speech recognition')} onOpen={() => onGo('speech')}
            meta={speech?.current?.source === 'server' ? `${speechName} · ${t('set on the server')}` : speech?.current?.provider === 'custom' ? speechName : undefined}
            control={speech?.current?.provider !== 'custom' && speech?.current?.source !== 'server' && <Select look="small" className="max-w-xs" aria-label={t('Service and model for speech recognition')} value={speechValue} onChange={pickSpeech} options={speechOptions} />} />
          <Row icon={<ScanFace size={15} />} title={t('Face recognition')} onOpen={() => onGo('faces')}
            meta={faces?.current ? facesName : t('local model in the browser')} />
          <Row icon={<Cpu size={15} />} title={t('Models on this device')} onOpen={() => onGo('smart')}
            meta={`${t(chosen('faces').name)} · ${t(chosen('speech').name)}`} />
        </Card>
      </section>

      <section>
        <Head>{t('Providers and API keys')}</Head>
        <Card>
          {keys?.keys.map((k) => (
            <Row key={k.service} icon={<KeyRound size={15} />} title={t(k.label)}
              meta={`…${k.keyEnding}`} control={<DataTerms service={k.service} />}
              right={<>
                {k.usedBy.assistant && <Chip>{t('assistant')}</Chip>}
                {k.usedBy.speech && <Chip>{t('speech')}</Chip>}
                {!k.usedBy.assistant && !k.usedBy.speech && <span className="text-xs text-ink-faint">{t('not in use')}</span>}
                <button type="button" className="grid size-7 flex-none place-items-center rounded-md text-ink-faint hover:bg-black/5 hover:text-destructive" aria-label={`${t('Remove the key')} ${t(k.label)}`} onClick={() => void removeKey(k)}><Trash2 size={14} /></button>
              </>} />
          ))}
          {provider?.source === 'server' && <Row icon={<KeyRound size={15} />} title={provider.label} meta={t('key in the server settings')} right={<Chip>{t('assistant')}</Chip>} />}
          {faces?.current && <Row icon={<ScanFace size={15} />} title={facesName} meta={t('its own key, for faces')} onOpen={() => onGo('faces')} right={<Chip>{t('faces')}</Chip>} control={<DataTerms service={faces.current.provider} />} />}
          {own.map((p) => (
            <Row key={p.id} icon={<KeyRound size={15} />} title={p.name}
              meta={`${hostOf(p.baseUrl)} · ${p.model}`}
              control={<span className="text-xs text-ink-faint break-anywhere">{p.keyNeeded ? t('Needs its key again: edit the provider and paste it') : p.hasKey ? t('Key saved for this address') : t('No key: a server on your own network')}</span>}
              right={<>
                <Chip>{t('your provider')}</Chip>
                {p.active ? <Chip>{t('assistant')}</Chip> : <button type="button" className="flex-none text-xs font-medium text-[#a4502e] disabled:opacity-40" disabled={p.keyNeeded} onClick={() => switchToOwn(p)}>{t('Use')}</button>}
                <button type="button" className="flex-none text-xs font-medium text-[#a4502e]" onClick={() => setForm(p)} aria-label={`${t('Edit')} ${p.name}`}>{t('Edit')}</button>
                <button type="button" className="grid size-7 flex-none place-items-center rounded-md text-ink-faint hover:bg-black/5 hover:text-destructive" aria-label={`${t('Remove the provider')} ${p.name}`} onClick={() => void removeOwn(p)}><Trash2 size={14} /></button>
              </>} />
          ))}
          {form
            ? <CustomProviderForm key={form === 'new' ? 'new' : form.id} initial={form === 'new' ? null : form} onCancel={() => setForm(null)} onSaved={async () => { setForm(null); await refresh() }} />
            : <Row icon={<Plus size={15} />} accent title={t('Add your own provider')} meta={t('any service that speaks the OpenAI protocol')} onOpen={() => setForm('new')} />}
          {keys && <AddKey key={adding ?? ''} initial={adding} available={keys.available.filter((a) => !keys.keys.some((k) => k.service === a.service))} onAdded={() => { setAdding(null); return refresh() }} onCancel={() => setAdding(null)} onFaces={() => onGo('faces')} />}
        </Card>
      </section>

      <section>
        <Head>{t('MCP server and access tokens')}</Head>
        <Card>
          {live.map((k) => (
            <Row key={k.id} icon={<Plug size={15} />} title={k.name} onOpen={() => onGo('agents')}
              meta={[k.role === 'reader' ? t('read only') : k.review ? t('edits for review') : t('edits applied at once'), k.expiresAt ? `${t('before')} ${new Date(k.expiresAt).toLocaleDateString(lang)}` : t('no expiry')].join(' · ')}
              right={<span className="flex-none text-xs tabular-nums text-ink-soft">{t('calls this month')}: {report?.tokens.find((x) => x.id === k.id)?.requests ?? 0}</span>} />
          ))}
          <Row icon={<Plug size={15} />} title={t('Server URL')} meta={<span className="font-mono text-[12.5px]">{mcpUrl}</span>}
            right={<button type="button" className="flex-none font-medium text-[#a4502e]" onClick={() => navigator.clipboard.writeText(mcpUrl).then(() => notify(t('Copied')))}>{t('Copy_infinitive')}</button>} />
          <Row icon={<Plus size={15} />} accent title={t('Create an access token')} meta={t('for Claude, ChatGPT, Cursor and others')} onOpen={() => onGo('agents')} />
        </Card>
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-ink-soft">
        <span>{t('AI configuration')}:</span>
        <button type="button" className="font-medium text-[#a4502e] disabled:opacity-50" disabled={!file} onClick={download}>{t('Download')}</button>
        <button type="button" className="font-medium text-[#a4502e]" onClick={() => pick.current?.click()}>{t('Load')}</button>
        <span className="ml-auto text-xs text-ink-faint">{t('exported without keys or tokens')}</span>
        <input ref={pick} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f) }} />
      </div>
      {result && (
        <div role="status" className="flex flex-col gap-1">
          {result.applied.length > 0 && <p>{t('Applied')}: {result.applied.join(', ')}.</p>}
          {result.skipped.map((s) => <p key={s.what} className="text-destructive break-anywhere">{s.what}: {s.why}</p>)}
          {!result.applied.length && !result.skipped.length && <p>{t('There is nothing to change in the file.')}</p>}
        </div>
      )}
    </div>
  )
}

/** One figure as a tile: what it is, the amount, and how far toward its limit, with the bar going amber near the end. */
function Usage({ icon, label, value, unit, sub, used, limitLabel }: { icon: ReactNode; label: string; value: string; unit: string; sub: string; used: [number, number] | null; limitLabel: string }) {
  const share = used && used[1] > 0 ? Math.min(1, used[0] / used[1]) : null
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-white p-3.5">
      <div className="flex items-center gap-2 text-[13px] text-ink-soft"><span className="grid size-6 place-items-center rounded-md bg-[#f4ede0] text-[#a4502e]">{icon}</span>{label}</div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1"><span className="break-anywhere font-serif text-[26px] leading-none tabular-nums">{value}</span>{unit && <span className="break-anywhere text-xs text-ink-faint">{unit}</span>}</div>
      {share !== null && (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#efe8da]" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={used![1]} aria-valuenow={used![0]}>
            <div className={cn('h-full rounded-full', share > 0.8 ? 'bg-[#c98a2b]' : 'bg-[#7a9a6e]')} style={{ width: `${Math.max(share * 100, share > 0 ? 3 : 0)}%` }} />
          </div>
          <div className="break-anywhere mt-1 text-[11.5px] text-ink-faint">{limitLabel}</div>
        </div>
      )}
      {sub && <div className="break-anywhere text-xs text-ink-faint">{sub}</div>}
    </div>
  )
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cn('relative h-[22px] w-[38px] flex-none rounded-full transition-colors', on ? 'bg-[#4d7a4a]' : 'bg-[#d8d0bf]')}>
      <span className={cn('absolute top-0.5 size-[18px] rounded-full bg-white shadow transition-[left]', on ? 'left-[18px]' : 'left-0.5')} />
    </button>
  )
}

/** A key for one more service, added right here: checked with the service before it is kept. */
function AddKey({ available, onAdded, onCancel, onFaces, initial }: { available: Keys['available']; onAdded: () => Promise<unknown>; onCancel: () => void; onFaces: () => void; initial: string | null }) {
  const { t } = useApp()
  const [open, setOpen] = useState(!!initial)
  const [service, setService] = useState(initial ?? '')
  const form = useRef<HTMLFormElement>(null)
  // Opened from a picker: brought into view, with the key field ready.
  useEffect(() => { if (initial) form.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [initial])
  const [key, setKey] = useState('')
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const chosen = available.find((a) => a.service === service)
  const reset = () => { setOpen(false); setService(''); setKey(''); setFolder(''); setError(''); onCancel() }
  const save = async () => {
    setBusy(true); setError('')
    try {
      await api('ai/keys', { method: 'PUT', json: { service, key: key.trim(), ...(chosen?.needsFolder ? { folder: folder.trim() } : {}) } })
      await onAdded()
      reset()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!open) return <Row icon={<Plus size={15} />} accent title={t('Add a provider')} meta={t('one key serves every function that can use it')} onOpen={() => setOpen(true)} />
  return (
    <form ref={form} className="flex flex-col gap-3 bg-[#fcfaf5] p-4" onSubmit={(e) => { e.preventDefault(); if (service && key.trim()) void save() }}>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Service')}
          <Select aria-label={t('Service')} value={service} onChange={setService}
            options={[{ value: '', label: <span className="text-ink-faint">{t('Choose a provider')}</span>, disabled: true }, ...available.map((a) => ({ value: a.service, label: `${t(a.label)} · ${[a.can.assistant && t('assistant'), a.can.speech && t('speech')].filter(Boolean).join(', ')}` }))]} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('API key')}
          <Input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('Paste the key')} />
        </label>
        {chosen?.needsFolder && (
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Folder ID')}
            <Input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="b1g…" spellCheck={false} />
          </label>
        )}
      </div>
      {chosen && <DataTerms service={chosen.service} open />}
      {chosen?.keysUrl && <a className="inline-flex items-center gap-1 self-start text-xs text-[#a4502e] hover:underline" href={chosen.keysUrl} target="_blank" rel="noreferrer">{t('Where to get a key')} <ExternalLink size={12} /></a>}
      {error && <p role="alert" className="text-xs text-destructive break-anywhere">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="bar-btn on" disabled={busy || !service || !key.trim()}>{busy ? t('Checking the key…_we') : t('Check and add')}</button>
        <button type="button" className="bar-btn" onClick={reset}>{t('Cancel')}</button>
        <button type="button" className="ml-auto text-xs text-ink-soft hover:text-ink" onClick={onFaces}>{t('A service for face recognition')} →</button>
      </div>
    </form>
  )
}
