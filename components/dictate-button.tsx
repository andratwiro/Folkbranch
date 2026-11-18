'use client'
import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Square } from 'lucide-react'
import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { useApp } from '@/lib/client'
import { downloadPack, packSize, useModel } from '@/lib/smart/models'
import { useSmart } from '@/lib/smart/settings'
import { CloudError, useCloud } from '@/lib/smart/cloud'
import { clock, useRecorder } from '@/lib/use-recorder'

const NO_MIC = { insecure: 'Voice recording only works on a secure address (https).', unsupported: 'This browser cannot record sound.', denied: 'No access to the microphone. Allow it in the browser.' }

/** Writes what is said into the field of the form it stands in: it reads on this device, and the person sends it. */
export function DictateButton() {
  const { t, archiveLang, notify } = useApp()
  const [on] = useSmart('speech')
  const model = useModel('speech')
  const cloud = useCloud()
  const rec = useRecorder()
  const [reading, setReading] = useState(false)
  const self = useRef<HTMLSpanElement>(null)
  const stopReading = useRef<AbortController | null>(null)
  const { clip, reset, problem } = rec

  useEffect(() => { if (problem) notify(t(NO_MIC[problem])) }, [problem]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopReading.current?.abort(), [])
  useEffect(() => {
    if (!clip) return
    const blob = clip.blob
    reset()
    const stop = (stopReading.current = new AbortController())
    setReading(true)
    const write = (text: string) => {
      const field = self.current?.closest('form')?.querySelector('textarea')
      if (!field) return
      // Through the browser's own setter, so the form sees it as if it were typed.
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, field.value.trim() ? `${field.value.trim()} ${text}` : text)
      field.dispatchEvent(new Event('input', { bubbles: true }))
      field.focus()
    }
    import('@/lib/smart/speech')
      .then(({ transcribe }) => transcribe(blob, archiveLang, () => {}, stop.signal))
      .then((text) => { if (text.trim()) write(text.trim()); else notify(t('No speech could be made out in the recording')) })
      .catch((e) => { if (e.name !== 'AbortError') { console.error(e); notify(e instanceof CloudError ? e.message : t('Could not transcribe the recording.')) } })
      .finally(() => setReading(false))
  }, [clip]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!on || (!cloud.use && (model.status === 'unknown' || model.status === 'unavailable'))) return null
  if (!cloud.use && model.status !== 'ready') {
    const busy = model.status === 'busy'
    return <PromptInputButton aria-label={t('Speak instead of typing')} title={t(busy ? 'The model is downloading' : 'Speak instead of typing')} data-hint={busy ? undefined : `${t('First the model needs downloading')}, ${packSize('speech')} ${t('MB')}.`} onClick={() => { if (!busy) notify(`${t('To speak instead of typing, download the model')}, ${packSize('speech')} ${t('MB')}.`, [{ label: t('Download model'), run: () => downloadPack('speech') }]) }}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} className="opacity-50" />}</PromptInputButton>
  }
  return (
    <span ref={self} className="contents">
      {reading
        ? <PromptInputButton aria-label={t('Stop transcribing')} title={t('Stop transcribing')} onClick={() => stopReading.current?.abort()}><Loader2 size={15} className="animate-spin" /></PromptInputButton>
        : rec.recording
          ? <PromptInputButton aria-label={t('Stop recording')} title={t('Stop recording')} onClick={rec.stop}><Square size={13} className="fill-destructive text-destructive" /> <span className="text-xs tabular-nums">{clock(rec.seconds)}</span></PromptInputButton>
          : <PromptInputButton aria-label={t('Speak instead of typing')} title={t('Speak instead of typing')} data-hint={t('The text is recognised on this device. You can correct it before sending.')} onClick={rec.start}><Mic size={15} /></PromptInputButton>}
    </span>
  )
}
