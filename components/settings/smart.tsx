'use client'
import { useEffect, useState } from 'react'
import { Check, Download, Square, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { SwitchRow } from '@/components/ui/switch'
import { useApp } from '@/lib/client'
import { readDevice, type Device, type Tier } from '@/lib/smart/device'
import { cancelVariant, choose, downloadVariant, recommended, removeVariant, useChosen, useVariant, variantSize, variantsFor, type Pack, type Variant } from '@/lib/smart/models'
import { useSmart } from '@/lib/smart/settings'
import { useCloud } from '@/lib/smart/cloud'
import { useFaceCloud } from '@/lib/smart/face-cloud'

const TIER: Record<Tier, string> = { weak: 'A modest device: take only what you need, it will run more slowly', normal: 'An average device: everything will run, without hurry', strong: 'A powerful device: it can run the most accurate models' }
const mb = (n: number) => Math.ceil(n / 1024 / 1024)

function ModelRow({ v, inUse, only }: { v: Variant; inUse: boolean; only: boolean }) {
  const { t, confirm: ask } = useApp()
  const m = useVariant(v.id)
  const ready = m.status === 'ready'
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 rounded-lg border p-2.5 ${inUse && ready ? 'border-ink' : 'border-border'}`}>
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium">{t(v.name)}</span>
        {recommended(v) && !only && <span className="text-xs text-ink-soft">{t('Recommended for this device')}</span>}
      </div>
      <p className="text-xs leading-snug text-ink-soft">{t(v.facts)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {m.status === 'busy' && (
          <div className="flex min-w-48 flex-1 items-center gap-2" role="status">
            <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-input"><div className="h-full bg-ink transition-[width]" style={{ width: `${m.total ? Math.min(100, (m.loaded / m.total) * 100) : 4}%` }} /></div>
            <span className="text-xs tabular-nums text-ink-soft">{m.total ? `${mb(m.loaded)} ${t('of')} ${mb(m.total)} ${t('MB')}` : t('Getting ready…')}</span>
            <Button variant="ghost" size="sm" onClick={() => cancelVariant(v.id)}><Square /> {t('Stop')}</Button>
          </div>
        )}
        {m.status === 'none' && <Button variant="outline" size="sm" onClick={() => downloadVariant(v.id)}><Download /> {t('Download model')}, {variantSize(v.id)} {t('MB')}</Button>}
        {ready && !only && (inUse ? <span className="flex items-center gap-1 pr-1 text-xs"><Check size={13} /> {t('In use')}</span> : <Button variant="outline" size="sm" onClick={() => choose(v.id)}>{t('Use')}</Button>)}
        {ready && <Button variant="ghost" size="sm" onClick={async () => { if (await ask(t('Remove model: {name}?').replace('{name}', () => t(v.name)), t('Delete'), t('You can download it again.'))) removeVariant(v.id) }}><Trash2 /> {t('Remove model')}, {variantSize(v.id)} {t('MB')}</Button>}
        {m.status === 'unavailable' && <span className="text-xs text-ink-soft">{t('Models can only be downloaded on a secure address (https) or on this computer.')}</span>}
      </div>
      {m.failed && <p role="alert" className="text-xs text-destructive">{t('Could not download the model. Check your connection and try again.')}</p>}
    </div>
  )
}

function Feature({ feature, title, about }: { feature: Pack; title: string; about: string }) {
  const { t } = useApp()
  const [on, setOn] = useSmart(feature)
  const current = useChosen(feature)
  const list = variantsFor(feature)
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <SwitchRow title={t(title)} description={t(about)} checked={on} onChange={setOn} />
      {on && <div className="flex flex-col gap-1.5">{list.map((v) => <ModelRow key={v.id} v={v} inUse={v.id === current.id} only={list.length === 1} />)}</div>}
    </div>
  )
}

/** What this device runs by itself. Nothing downloads or starts on its own. */
export function SmartSettings() {
  const { t } = useApp()
  const cloud = useCloud()
  const faces = useFaceCloud()
  const [device, setDevice] = useState<Device | null>(null)
  useEffect(() => { setDevice(readDevice()) }, [])
  const facts = device && [device.cores && `${t('cores')}: ${device.cores}`, device.memoryGB && `${t('memory')}: ${device.memoryGB}${device.memoryGB >= 8 ? '+' : ''} ${t('GB')}`, device.saveData && t('data saver is on')].filter(Boolean).join(' · ')
  return (
    <div className="flex flex-col gap-6 text-sm">
      {device && (
        <div className="rounded-lg bg-muted px-3 py-2">
          <p className="font-medium">{t(TIER[device.tier])}</p>
          <p className="text-xs text-ink-soft">{facts}</p>
        </div>
      )}
      {cloud.enabled && (
        <Section title={t('Cloud transcription')} description={t('The archive\'s owner connected a speech recognition service and pays for it. Nothing to download; it works on any device and is usually more accurate.')}>
          <SwitchRow title={t('Transcribe in the cloud on this device')} description={`${t('The recording goes to the archive\'s server and on to')} ${t(cloud.info?.where ?? '')}. ${t('If off, the voice stays on the device and is read by the model below.')}`} checked={cloud.chosen} onChange={cloud.set} />
        </Section>
      )}
      {faces.enabled && (
        <Section title={t('Cloud faces')} description={t('The archive\'s owner connected a face recognition service and pays for it. No model to download; it works on any device.')}>
          <SwitchRow title={t('Find and recognise faces in the cloud on this device')} description={`${t('The photo goes to the archive\'s server and on to')} ${t(faces.info?.where ?? '')}. ${faces.info?.keeps ? t(faces.info.keeps) : ''} ${t('If off, faces stay on the device and are read by the model below.')}`.replace(/\s+/g, ' ').trim()} checked={faces.chosen} onChange={faces.set} />
        </Section>
      )}
      <Section title={t('Models on this device')} description={t('Nothing downloads by itself. Models run in this browser, and your photos and voice stay with you. Another device downloads its own.')}>
        <div className="flex flex-col gap-4">
          <Feature feature="faces" title={'Finding faces in photos'} about={'Finds faces, even in old group photos, so you need not outline them by hand.'} />
          <Feature feature="recognize" title={'Recognising relatives in photos'} about={'Suggests who is in a new photo from faces already tagged. A name appears only once you confirm it.'} />
          <Feature feature="speech" title={'Voice to text_transcription'} about={'Turns a recorded story into text and lets you speak to the assistant. You can keep using the app while it runs.'} />
        </div>
        <p className="text-xs text-ink-soft">{t('Figures from our measurements on old photos and Russian recordings, on a 12-core computer. Your device will differ in speed.')}</p>
      </Section>
    </div>
  )
}
