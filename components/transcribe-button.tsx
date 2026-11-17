'use client'
import { useRef, useState } from 'react'
import { AudioLines, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/client'
import { useModel } from '@/lib/smart/models'
import { ModelPrompt } from './model-prompt'
import { useSmart } from '@/lib/smart/settings'
import { CloudError, useCloud } from '@/lib/smart/cloud'
import type { SpeechProgress } from '@/lib/smart/speech'

/** Turns a recording into text in this browser. The text lands in the field beside it, for a person to correct. */
export function TranscribeButton({ getAudio, current, onText }: { getAudio: () => Promise<Blob>; current: string; onText: (text: string) => void }) {
  const { t, archiveLang } = useApp()
  const [on] = useSmart('speech')
  const model = useModel('speech')
  const cloud = useCloud()
  const [progress, setProgress] = useState<SpeechProgress | null>(null)
  const [problem, setProblem] = useState('')
  const stop = useRef<AbortController | null>(null)
  if (!on) return null
  if (!cloud.use && model.status !== 'ready') return (
    <div className="flex flex-col gap-2">
      {cloud.enabled && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-muted px-3 py-2">
          <p className="text-xs text-ink-soft">{t('The archive\'s owner connected cloud transcription. The recording goes to the archive\'s server and on to')} {cloud.info?.where}. {t('The owner pays; you need not download anything.')}</p>
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => cloud.set(true)}>{t('Transcribe in the cloud')}</Button>
        </div>
      )}
      <ModelPrompt pack="speech">{t('To turn a recording into text, download the model. It runs in this browser, and your voice goes nowhere.')}</ModelPrompt>
    </div>
  )
  const start = async () => {
    setProblem('')
    stop.current = new AbortController()
    const before = current.trim()
    const join = (text: string) => (before ? `${before}\n\n${text}` : text)
    setProgress({ stage: 'preparing' })
    try {
      const { transcribe } = await import('@/lib/smart/speech')
      const text = await transcribe(await getAudio(), archiveLang, (p) => { setProgress(p); if (p.stage === 'reading' && p.text) onText(join(p.text)) }, stop.current.signal)
      onText(join(text))
      if (!text.trim()) setProblem(t('No speech could be made out in the recording'))
    } catch (e) {
      if ((e as Error).name !== 'AbortError') { console.error(e); setProblem(e instanceof CloudError ? e.message : t('Could not transcribe the recording.')) }
    }
    setProgress(null)
  }
  const words = !progress ? '' : progress.stage === 'preparing' ? t('Getting ready…') : progress.stage === 'download' ? t('Starting the model…') : `${t('Transcribing')}: ${Math.round(progress.share * 100)}%`
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
      {progress
        ? <><span role="status">{words}</span><Button type="button" variant="outline" size="sm" onClick={() => stop.current?.abort()}><Square /> {t('Stop')}</Button></>
        : <><Button type="button" variant="outline" size="sm" onClick={start}><AudioLines /> {t('Transcribe recording')}</Button><span>{t('Runs on this device. Check the text: the network gets names wrong.')}</span></>}
      {problem && <p role="alert" className="w-full text-destructive">{problem}</p>}
    </div>
  )
}
