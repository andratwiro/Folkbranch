'use client'
import { useEffect, useRef, useState } from 'react'
import { api, useApp } from '@/lib/client'
import { Input } from '@/components/ui/input'

/** A provider the owner added, as the server tells it: never with its key, only whether one is saved for its address. */
export interface OwnProvider { id: string; name: string; baseUrl: string; model: string; note: string; hasKey: boolean; keyNeeded: boolean; active: boolean }

interface Said { ok: boolean; message: string }

/** Any service that speaks the OpenAI protocol: its address, a key if it needs one, a model, and a small test. */
export function CustomProviderForm({ initial, onSaved, onCancel }: { initial: OwnProvider | null; onSaved: (p: OwnProvider) => Promise<unknown> | void; onCancel: () => void }) {
  const { t } = useApp()
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => { form.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [])
  const [name, setName] = useState(initial?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [key, setKey] = useState('')
  const [model, setModel] = useState(initial?.model ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [models, setModels] = useState<string[]>([])
  const [said, setSaid] = useState<Said | null>(null)
  const [busy, setBusy] = useState<'' | 'models' | 'test' | 'save'>('')
  const [error, setError] = useState('')
  const moved = !!initial && initial.baseUrl !== baseUrl.trim().replace(/\/+$/, '') && initial.hasKey && !key.trim()
  const ready = !!name.trim() && !!baseUrl.trim() && !!model.trim() && !moved
  // The saved provider's own key is used only while the address is its own; the server holds to that too.
  const body = () => ({ ...(initial ? { id: initial.id } : {}), baseUrl: baseUrl.trim(), ...(key.trim() ? { key: key.trim() } : {}), model: model.trim() })

  const run = async (what: 'models' | 'test', go: () => Promise<void>) => {
    setBusy(what); setError(''); setSaid(null)
    try { await go() } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  const load = () => run('models', async () => {
    const r = await api<{ models: string[]; listed: boolean }>('ai/custom/models', { method: 'POST', json: body() })
    setModels(r.models)
    setSaid(r.listed ? { ok: true, message: t('{count} models found. Pick one in the Model field').replace('{count}', String(r.models.length)) } : { ok: false, message: t('The list could not be read. Type the model name') })
  })
  const test = () => run('test', async () => setSaid(await api<Said>('ai/custom/test', { method: 'POST', json: body() })))
  const save = async () => {
    setBusy('save'); setError('')
    try {
      const saved = await api<OwnProvider>('ai/custom', { method: 'PUT', json: { ...body(), name: name.trim(), note: note.trim() } })
      setKey('')
      await onSaved(saved)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  return (
    <form ref={form} aria-label={initial ? t('Edit your provider') : t('Add your own provider')} className="flex flex-col gap-3 bg-[#fcfaf5] p-4" onSubmit={(e) => { e.preventDefault(); if (ready) void save() }}>
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Name')}
          <Input name="provider-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t('Shown in the list of providers')} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Address of the API')}
          <Input name="provider-url" value={baseUrl} inputMode="url" autoCapitalize="off" spellCheck={false} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://opencode.ai/zen/go/v1" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('API key')}
          <Input name="provider-key" type="password" autoComplete="new-password" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)}
            placeholder={initial?.hasKey ? t('Saved. Leave empty to keep it') : t('Paste the key')} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Model')}
          <div className="flex items-center gap-2">
            <Input name="provider-model" list="provider-models" value={model} spellCheck={false} className="font-mono" onChange={(e) => setModel(e.target.value)} placeholder={t('Model name')} />
            <button type="button" className="bar-btn flex-none" disabled={!!busy || !baseUrl.trim()} onClick={() => void load()}>{busy === 'models' ? t('Loading…') : t('Load models')}</button>
          </div>
          <datalist id="provider-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Note (optional)')}
        <Input name="provider-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="text-xs text-ink-faint">{t('Any service that speaks the OpenAI protocol: the address usually ends in /v1. The key is stored encrypted, is sent only to this address and is never shown again. Changing the address asks for the key again.')}</p>
      {moved && <p role="alert" className="text-xs text-destructive">{t('The address changed: enter the key again')}</p>}
      {said && <p role="status" data-test="provider-said" className={`text-xs break-anywhere ${said.ok ? 'text-[#4d7a4a]' : 'text-destructive'}`}>{said.message}</p>}
      {error && <p role="alert" className="text-xs text-destructive break-anywhere">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="bar-btn on" disabled={!!busy || !ready}>{busy === 'save' ? t('Saving…') : t('Save')}</button>
        <button type="button" className="bar-btn" disabled={!!busy || !baseUrl.trim() || !model.trim()} onClick={() => void test()}>{busy === 'test' ? t('Testing…') : t('Test')}</button>
        <button type="button" className="bar-btn" onClick={onCancel}>{t('Cancel')}</button>
      </div>
    </form>
  )
}
