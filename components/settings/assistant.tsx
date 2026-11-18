'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { SwitchRow } from '@/components/ui/switch'
import { api, useApp } from '@/lib/client'
import { LiveModelSelect, ProviderForm, useProviderStatus } from '../assistant-setup'

/** Which provider answers, and changing it. */
function ProviderSettings() {
  const { t, confirm: ask } = useApp()
  const qc = useQueryClient()
  const { data } = useProviderStatus()
  const [changing, setChanging] = useState(false)
  const [modelError, setModelError] = useState('')
  if (!data) return null
  const changeModel = async (model: string) => {
    if (!model.trim()) return
    setModelError('')
    try {
      await api('assistant/provider', { method: 'PATCH', json: { model } })
      await qc.invalidateQueries({ queryKey: ['provider'] })
    } catch (e) {
      setModelError((e as Error).message)
    }
  }
  const remove = async () => {
    if (!await ask(t('Disconnect the assistant from this service?'), t('Disconnect'), t('The key stays in the list of providers on the AI page: the service can be picked there again without pasting the key.'))) return
    await api('assistant/provider', { method: 'DELETE' })
    await qc.invalidateQueries({ queryKey: ['provider'] })
    location.reload()
  }
  return (
    <Section title={t('Service and model')} description={t('The assistant runs on your key: you pay the service yourself, and what the assistant reads goes there.')}>
      {data.connected ? (
        <p className="text-xs text-ink-soft">{t('Service')}: {data.label}{data.keyEnding ? `, ${t('key')} …${data.keyEnding}` : ''}{data.source === 'server' ? `. ${t('The key is set on the server')}` : ''}</p>
      ) : <p className="text-xs text-ink-soft">{t('Connect a key first: without one the assistant cannot answer.')}</p>}
      {data.source === 'app' && !changing && data.auto && <p className="text-xs text-ink-soft" role="status">{t('Model')}: <b className="font-medium text-ink">{data.model}</b>. {t('Chosen by the app: a tested one, and when a newer one of the same line comes out, the app moves to it without you.')}</p>}
      {data.source === 'app' && !changing && (
        <details>
          <summary className="cursor-pointer text-xs text-ink-soft">{t('For experts: choose the model yourself')}</summary>
          <div className="mt-2 flex flex-col gap-2">
            <LiveModelSelect key={`${data.provider}:${data.model}`} value={data.model ?? ''} onChange={changeModel} />
            {!data.auto && data.autoPossible && <Button type="button" variant="outline" size="sm" className="self-start" onClick={async () => { await api('assistant/provider', { method: 'PATCH', json: { auto: true } }); await qc.invalidateQueries({ queryKey: ['provider'] }) }}>{t('Choose automatically again')}</Button>}
          </div>
        </details>
      )}
      {modelError && <p role="alert" className="text-xs text-destructive">{modelError}</p>}
      {data.source !== 'server' && (changing || !data.connected ? <ProviderForm onDone={() => setChanging(false)} /> : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setChanging(true)}><KeyRound /> {t('Change the key')}</Button>
          <Button type="button" variant="outline" onClick={remove}><Trash2 /> {t('Disconnect')}</Button>
        </div>
      ))}
    </Section>
  )
}

/** The built-in assistant: off until the owner connects a provider. */
export function AssistantSettings() {
  const { t } = useApp()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<{ assistantEnabled: boolean; assistantForReaders: boolean; assistantProvider: string | null; assistantModel: string | null }>('settings') })
  if (!data) return null
  const set = async (key: string, on: boolean) => {
    await api('settings', { method: 'PATCH', json: { [key]: on ? '1' : '0' } })
    await qc.invalidateQueries({ queryKey: ['settings'] })
    location.reload()
  }
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <Section title={t('Who can use it')}>
        <SwitchRow title={t('Turn on the assistant')} description={t('Appears for editors and the owner.')} checked={data.assistantEnabled} onChange={(on) => set('assistantEnabled', on)} />
        <SwitchRow title={t('Allow readers')} description={t('Readers can ask but not change anything. The assistant will not show them living relatives.')} disabled={!data.assistantEnabled} checked={data.assistantForReaders} onChange={(on) => set('assistantForReaders', on)} />
      </Section>
      <ProviderSettings />
    </div>
  )
}
