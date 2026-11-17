'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { ASSISTANT_PLANS } from '@/lib/agent/plans'
import { PRESETS, type Preset, type PresetId } from '@/lib/agent/presets'
import { recommended, resultFor } from '@/lib/agent/tested'
import { PayChoice, PlanLines, type Pay } from './plan-badge'
import { api, useApp } from '@/lib/client'
import type { AssistantState } from '@/lib/types'
import { Brand } from './brand-icons'
import { PanelEdge } from './panel-size'
import { Select } from '@/components/ui/select'
import { inputClass } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export interface ProviderStatus { auto?: boolean; autoPossible?: boolean; connected: boolean; provider: PresetId | 'local' | null; label: string | null; model: string | null; source: 'server' | 'app' | null; keyEnding: string | null }
export const useProviderStatus = () => useQuery({ queryKey: ['provider'], queryFn: () => api<ProviderStatus>('assistant/provider') })

const CUSTOM = '__custom'
const REGIONS: [Preset['region'], string][] = [['world', 'Europe and America'], ['ru', 'Russia'], ['cn', 'China']]

/** The provider's cheap models, cheapest good one first; any other can be typed in. */
export function ModelSelect({ presetId, value, onChange }: { presetId: PresetId; value: string; onChange: (model: string) => void }) {
  const { t } = useApp()
  const { models } = PRESETS.find((p) => p.id === presetId)!
  const listed = !value || models.some((m) => m.id === value)
  const [custom, setCustom] = useState(!listed)
  const current = models.find((m) => m.id === (value || models[0].id))
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-soft">
      {t('Model')}
      <Select aria-label={t('Model')} value={custom ? CUSTOM : value || models[0].id} onChange={(v) => { const c = v === CUSTOM; setCustom(c); onChange(c ? '' : v) }} options={[...models.map((m) => ({ value: m.id, label: m.price ? `${m.label}, ${m.price}` : m.label })), { value: CUSTOM, label: t('Another model…') }]} />
      {custom && <input aria-label={t('Model name')} placeholder={t('Model name')} className={`${inputClass} font-mono`} value={value} onChange={(e) => onChange(e.target.value)} />}
      {!custom && current?.note && <span>{t(current.note)}</span>}
      {!custom && current && (() => {
        const r = resultFor(presetId, current.id)
        return r
          ? <span className={recommended(r) ? 'text-[#2f7d4f]' : 'text-rust'}>{t(recommended(r) ? 'Tested' : 'Not recommended')}</span>
          : <span className="text-rust">{t('Not tested')}</span>
      })()}
      <span className="text-ink-faint">{t('Price per million tokens: input / output')}</span>
    </label>
  )
}

interface ModelChoices { current: string | null; models: { id: string; label: string; price: string | null; vision: boolean | null }[] }

/** What the connected provider lists today, newest first; nothing is kept in the app. Models that take pictures can be asked for alone. */
export function LiveModelSelect({ value, onChange }: { value: string; onChange: (model: string) => void }) {
  const { t } = useApp()
  const [sightOnly, setSightOnly] = useState(false)
  const { data, isLoading, isError } = useQuery({ queryKey: ['provider-models'], queryFn: () => api<ModelChoices>('assistant/provider/models'), staleTime: 5 * 60_000 })
  if (isLoading) return <p className="text-xs text-ink-soft">{t('Loading the list of models…')}</p>
  if (isError || !data?.models.length) return null
  const shown = data.models.filter((m) => !sightOnly || m.vision || m.id === value)
  const current = data.models.find((m) => m.id === value)
  return (
    <div className="flex flex-col gap-1.5 text-xs text-ink-soft">
      <label className="flex flex-col gap-1">
        {t('Every model your key can use, newest first')}
        <Select aria-label={t('Model')} value={value} onChange={onChange} options={shown.map((m) => ({ value: m.id, label: `${m.label}${m.price ? `, ${m.price}` : ''}${m.vision ? ` · ${t('sees pictures')}` : ''}` }))} />
      </label>
      <label className="flex items-center gap-1.5"><input type="checkbox" className="accent-[var(--ink)]" checked={sightOnly} onChange={(e) => setSightOnly(e.target.checked)} />{t('Only models that see pictures')}</label>
      {current?.vision === false && <p role="status" className="text-destructive">{t('This model cannot see pictures, so the assistant will not read scans, letters or photos. Choose another marked “sees pictures”.')}</p>}
      {current && current.vision === null && <p>{t('The service does not say whether this model sees pictures. If the assistant cannot read scans, choose another.')}</p>}
    </div>
  )
}

/** Choose a provider, make a key there, paste it here. */
export function ProviderForm({ onDone }: { onDone?: () => void }) {
  const { t } = useApp()
  const qc = useQueryClient()
  const router = useRouter()
  const [id, setId] = useState<PresetId>('openrouter')
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [folder, setFolder] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pay, setPay] = useState<Pay>('paid')
  const preset = PRESETS.find((p) => p.id === id)!
  // Paid fits every service; free only those that have a free plan, and what it costs in data is said on each.
  const shown = (p: Preset) => !p.hidden && (pay !== 'free' || !!ASSISTANT_PLANS[p.id]?.free)
  const connect = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('assistant/provider', { method: 'PUT', json: { provider: id, key, ...(model.trim() ? { model: model.trim() } : {}), ...(preset.folder ? { folder } : {}) } })
      setKey('')
      await qc.invalidateQueries({ queryKey: ['provider'] })
      await qc.invalidateQueries({ queryKey: ['settings'] })
      router.refresh()
      onDone?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="flex flex-col gap-3 text-sm" onSubmit={connect}>
      <PayChoice value={pay} onChange={(v) => { setPay(v); if (v === 'free' && !ASSISTANT_PLANS[id]?.free) { const first = PRESETS.find((p) => ASSISTANT_PLANS[p.id]?.free); if (first) { setId(first.id); setModel('') } } }} />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs text-ink-soft">{t('Choose a provider')}</legend>
        {REGIONS.map(([region, title]) => PRESETS.some((p) => p.region === region && shown(p)) && (
          <div key={region} className="flex flex-col gap-1.5">
            <p className="mt-1 text-xs text-ink-faint">{t(title)}</p>
            {PRESETS.filter((p) => p.region === region && shown(p)).map((p) => (
              <label key={p.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 ${p.id === id ? 'border-ink bg-white' : 'border-border'}`}>
                <input type="radio" name="provider" className="mt-0.5 accent-[var(--ink)]" checked={p.id === id} onChange={() => { setId(p.id); setError(''); setModel('') }} />
                <span className="min-w-0"><span className="flex items-center gap-1.5 font-medium">{p.icon && <Brand name={p.icon} />}{p.label}</span>{p.pitch && <span className="block text-xs text-ink-soft">{t(p.pitch)}</span>}<PlanLines free={ASSISTANT_PLANS[p.id]?.free} paid={ASSISTANT_PLANS[p.id]?.paid} show={pay} /></span>
              </label>
            ))}
          </div>
        ))}
      </fieldset>
      <ol className="flex flex-col gap-2">
        <li><span className="text-ink-soft">1.</span> <a className="inline-flex items-center gap-1 underline" href={preset.keysUrl} target="_blank" rel="noreferrer noopener">{t('Open the keys page of')} {preset.label} <ExternalLink size={12} /></a></li>
        <li><span className="text-ink-soft">2.</span> {t(preset.howTo)}. <span className="text-ink-soft">{t('The service\'s site is in English: look for these words.')}</span></li>
        <li className="flex flex-col gap-1.5"><span><span className="text-ink-soft">3.</span> {t('Copy the key and paste it here')}</span>
          <input type="password" autoComplete="off" spellCheck={false} aria-label={t('Provider key')} placeholder={t('Provider key')} className={`${inputClass} font-mono`} value={key} onChange={(e) => { setKey(e.target.value); setError('') }} />
        </li>
        {preset.folder && <li className="flex flex-col gap-1.5"><span><span className="text-ink-soft">4.</span> {t('Paste the folder ID')}</span>
          <input autoComplete="off" spellCheck={false} aria-label={t('Folder ID')} placeholder={t('Folder ID')} className={`${inputClass} font-mono`} value={folder} onChange={(e) => { setFolder(e.target.value); setError('') }} />
        </li>}
      </ol>
      {!preset.models.some((m) => resultFor(preset.id, m.id)) && <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs text-ink-soft">{t('We have not tested this service\'s models. OpenRouter is the safer pick.')}</p>}
      <details>
        <summary className="cursor-pointer text-ink-soft">{t('For experts: choose the model yourself')}</summary>
        <div className="mt-2"><p className="mb-1 text-xs text-ink-soft">{t('If you do not choose, the app takes a tested model and then moves by itself to the newest one in its line.')}</p><ModelSelect presetId={id} value={model} onChange={setModel} /></div>
      </details>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Button disabled={busy || key.trim().length < 10 || (!!preset.folder && folder.trim().length < 10)}>{t(busy ? 'Checking the key…' : 'Check and connect')}</Button>
    </form>
  )
}

/** In place of the chat while the assistant cannot answer: why, and what to do about it. */
export default function AssistantSetup({ state, open, onClose, width, onWidth }: { state: Extract<AssistantState, { ready: false }>; open: boolean; onClose: () => void; width: number; onWidth: (w: number) => void }) {
  const { t } = useApp()
  const router = useRouter()
  const { reason } = state
  const enable = async () => {
    await api('settings', { method: 'PATCH', json: { assistantEnabled: '1' } })
    router.refresh()
  }
  return (
    <aside hidden={!open} aria-label={t('Assistant')} style={{ width: `min(${width}px, calc(100vw - 24px))` }} className="assistant side-sheet float fixed left-3 top-[60px] bottom-3 z-10 flex flex-col !bg-[#fffdf8] text-sm [&[hidden]]:hidden">
      <PanelEdge width={width} onWidth={onWidth} />
      <header className="flex items-center gap-1 border-b border-border py-1 pl-3 pr-1">
        <h2 className="flex-1 font-serif text-lg font-medium">{t('Assistant')}</h2>
        <button className="bar-btn" title={t('Close')} aria-label={t('Close')} onClick={onClose}><X size={15} /></button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {reason === 'no-key' && !state.canFix && <p>{t('The assistant is not connected yet. The owner of the archive can connect it.')}</p>}
        {reason === 'readers' && <p>{t('The owner has not allowed the assistant for readers yet.')}</p>}
        {reason === 'off' && !state.canFix && <p>{t('The owner has turned the assistant off.')}</p>}
        {reason === 'off' && state.canFix && (
          <>
            <p>{t('The assistant is off. The provider key is already set.')}</p>
            <Button onClick={enable}>{t('Turn on the assistant')}</Button>
          </>
        )}
        {reason === 'no-key' && state.canFix && (
          <>
            <div>
              <h3 className="text-base font-medium mb-1">{t('Connect the assistant')}</h3>
              <p className="text-xs text-ink-soft">{t('It needs a key from an AI provider. This takes a couple of minutes and is done once.')}</p>
            </div>
            <ProviderForm />
          </>
        )}
      </div>
    </aside>
  )
}
