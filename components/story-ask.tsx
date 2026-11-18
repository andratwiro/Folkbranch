'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Link2, Mic, RefreshCw, Share2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyField } from '@/components/ui/copy'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api, useApp, useLinkOrigin } from '@/lib/client'
import { READY, toggleLine } from '@/lib/story-questions'
import { personName, type Person } from '@/lib/types'

export interface StoryRequest {
  id: string
  personId: string
  about: string
  tellerName: string
  question: string
  received: number
  expiresAt: number | null
  createdAt: number
  waiting: { proposalId: string; createdAt: number; title: string }[]
}

/** Ready questions to press and a box for one's own, one a line. */
export function QuestionPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useApp()
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-xs text-ink-soft">
      <span>{t('Questions, up to five (optional). The person chooses which to answer.')}</span>
      <div className="flex flex-wrap gap-1.5">
        {READY.map((q) => {
          const on = value.split('\n').map((x) => x.trim()).includes(t(q))
          return <button key={q} type="button" aria-pressed={on} className={`min-h-8 rounded-full border px-2.5 py-1 text-left text-xs ${on ? 'border-ink bg-ink text-white' : 'border-border bg-white text-ink hover:bg-muted'}`} onClick={() => onChange(toggleLine(value, t(q)))}>{t(q)}</button>
        })}
      </div>
      <Textarea rows={3} maxLength={1200} aria-label={t('Questions')} placeholder={t('Your own questions, one per line')} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

/** The new link: to copy, and on a phone to hand straight to a messenger. */
export function LinkResult({ link, about }: { link: string; about: string }) {
  const { t } = useApp()
  const origin = useLinkOrigin()
  const hereOnly = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  return (
    <div className="flex flex-col gap-2">
      <CopyField value={link} primary />
      {canShare && <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => navigator.share({ title: t('Tell us about someone dear'), text: `${t('Record a story')}: ${about}`, url: link }).catch(() => {})}><Share2 /> {t('Share')}</Button>}
      {hereOnly && <p role="status" className="text-xs leading-snug text-ink-soft">{t('This address works only on this computer for now. For a relative to open the link, the app must be reachable from outside: on a server or through ./folkbranch share.')}</p>}
    </div>
  )
}

/** The person is already the subject: only who is asked and what to ask. */
export function AskDialog({ person, preset, onClose }: { person: Person; preset?: { tellerName: string; question: string }; onClose: () => void }) {
  const { t } = useApp()
  const qc = useQueryClient()
  const origin = useLinkOrigin()
  const [tellerName, setTellerName] = useState(preset?.tellerName ?? '')
  const [question, setQuestion] = useState(preset?.question ?? '')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const about = personName(person)
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md max-h-[calc(100dvh-32px)] overflow-auto">
        <DialogTitle className="font-serif text-lg font-medium">{t('Ask to tell by a link')}</DialogTitle>
        {link ? (
          <div className="flex flex-col gap-3">
            <p className="flex items-start gap-1.5 text-sm"><Check size={15} className="mt-0.5 flex-none" /> {t('The link is ready. Send it to the person: their story will appear on the card and wait for your review.')}</p>
            <LinkResult link={link} about={about} />
            <Button type="button" className="self-start" onClick={onClose}>{t('Done')}</Button>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError('')
            try {
              const { token } = await api<{ token: string }>('story-requests', { json: { personId: person.id, tellerName: tellerName.trim(), question: question.trim() } })
              setLink(`${origin}/tell/${token}`)
              qc.invalidateQueries({ queryKey: ['story-requests'] })
            } catch (x) {
              setError(String((x as Error).message ?? x))
            }
            setBusy(false)
          }}>
            <p className="text-sm text-ink-soft">{t('Who the story is about')}: <b className="font-medium text-ink">{about}</b>. {t('A link for one person: open it on a phone, press one big button and talk. No account, the archive stays out of sight, and the recording waits for your review.')}</p>
            <Field label={t('Who you are asking')}><Input maxLength={120} placeholder={t('For example, Grandma Nina')} value={tellerName} onChange={(e) => setTellerName(e.target.value)} /></Field>
            <QuestionPicker value={question} onChange={setQuestion} />
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <Button className="self-start" disabled={busy}><Mic /> {t('Create a story link')}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

const day = (ms: number, lang: string) => new Date(ms).toLocaleDateString(lang, { day: 'numeric', month: 'numeric' })

/** Open links for this person and what has come back through them. A link cannot be shown twice: only a hash is stored. */
export function PersonRequests({ person }: { person: Person }) {
  const { t, lang, confirm: ask, notify } = useApp()
  const qc = useQueryClient()
  const { data: rows = [] } = useQuery({ queryKey: ['story-requests'], queryFn: () => api<StoryRequest[]>('story-requests') })
  const [again, setAgain] = useState<StoryRequest | null>(null)
  const mine = rows.filter((r) => r.personId === person.id)
  if (!mine.length) return null
  const refresh = () => qc.invalidateQueries({ queryKey: ['story-requests'] })
  const act = async (fn: () => Promise<unknown>) => {
    await fn().catch((e) => notify(String(e.message ?? e)))
    await qc.invalidateQueries({ queryKey: ['stories'] })
    await qc.invalidateQueries({ queryKey: ['proposals'] })
    await qc.invalidateQueries({ queryKey: ['graph'] })
    refresh()
  }
  return (
    <section aria-label={t('Waiting for a story')} className="flex flex-col gap-2 rounded-lg border border-dashed border-border px-3 py-2">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-ink-soft"><Link2 size={12} /> {t('Waiting for a story')}</h4>
      {mine.map((r) => {
        const who = r.tellerName || t('No name')
        return (
          <div key={r.id} className="flex flex-col gap-1.5 text-sm">
            <p className="break-anywhere">{r.waiting.length ? `${who}: ${t('sent a recording')}` : `${t('Waiting for a story from')} ${who}`}{r.expiresAt ? ` · ${t('link valid until')} ${day(r.expiresAt, lang)}` : ''}</p>
            {r.waiting.map((w) => (
              <div key={w.proposalId} className="flex flex-col gap-1.5 rounded-md bg-muted px-2 py-1.5">
                <p className="text-xs text-ink-soft break-anywhere">{`${t('As told by')}: ${who}`}{w.title ? ` · ${w.title}` : ''} · {t('waiting for review')}</p>
                <audio controls preload="none" className="h-8 w-full" src={`/api/v1/proposals/${w.proposalId}/ops/0/audio`} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => act(() => api(`proposals/${w.proposalId}/accept`, { json: {} }))}><Check /> {t('Accept')}</Button>
                  <Button size="sm" variant="outline" onClick={() => act(() => api(`proposals/${w.proposalId}/reject`, { json: {} }))}>{t('Reject')}</Button>
                </div>
              </div>
            ))}
            <div className="flex flex-wrap gap-3 text-xs text-ink-soft">
              <button className="flex items-center gap-1 hover:text-ink" onClick={() => setAgain(r)}><RefreshCw size={12} /> {t('New link')}</button>
              <button className="flex items-center gap-1 hover:text-destructive" aria-label={`${t('Close the link')}: ${who}`} onClick={async () => { if (await ask(t('Close the link? No more recordings can be sent with it.'), t('Close'))) act(() => api(`story-requests/${r.id}`, { method: 'DELETE' })) }}><X size={12} /> {t('Close')}</button>
            </div>
          </div>
        )
      })}
      <p className="text-xs text-ink-faint">{t('The link itself cannot be shown a second time: only its fingerprint is stored. A new link takes one press, and the old one can be closed.')}</p>
      {again && <AskDialog person={person} preset={{ tellerName: again.tellerName, question: again.question }} onClose={() => setAgain(null)} />}
    </section>
  )
}
