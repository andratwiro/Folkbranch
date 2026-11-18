'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mic, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { List, ListRow, Section } from '@/components/ui/section'
import { api, useApp, useLinkOrigin } from '@/lib/client'
import { personName } from '@/lib/types'
import { PersonPopover } from '../person-pickers'
import { LinkResult, QuestionPicker } from '../story-ask'

interface Request { id: string; about: string; tellerName: string; received: number }

/** For a relative who will never sign up: a link with one button, and what they send waits for review. */
export function StoryRequests() {
  const { t, graph, confirm: ask } = useApp()
  const qc = useQueryClient()
  const { data: rows = [] } = useQuery({ queryKey: ['story-requests'], queryFn: () => api<Request[]>('story-requests') })
  const [personId, setPersonId] = useState('')
  const [tellerName, setTellerName] = useState('')
  const [question, setQuestion] = useState('')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const person = graph.persons.find((p) => p.id === personId)
  const refresh = () => qc.invalidateQueries({ queryKey: ['story-requests'] })
  const origin = useLinkOrigin()
  return (
    <Section title={t('Ask for a story')} description={t('A link for one person: open it on a phone, press one big button and talk. No account, the archive stays out of sight, and the recording waits for your review.')}>
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault()
        setError('')
        try {
          const { token } = await api<{ token: string }>('story-requests', { json: { personId, tellerName: tellerName.trim(), question: question.trim() } })
          setLink(`${origin}/tell/${token}`)
          setTellerName('')
          setQuestion('')
          refresh()
        } catch (x) {
          setError(String((x as Error).message ?? x))
        }
      }}>
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-1 text-xs text-ink-soft">{t('Who the story is about')}
            <PersonPopover onPick={setPersonId}><button type="button" className="flex h-9 min-w-0 items-center rounded-lg border border-input bg-white px-3 text-left text-sm text-ink"><span className="truncate">{person ? personName(person) : t('Choose a card')}</span></button></PersonPopover>
          </div>
          <Field label={t('Who you are asking')}><Input maxLength={120} placeholder={t('For example, Grandma Nina')} value={tellerName} onChange={(e) => setTellerName(e.target.value)} /></Field>
        </div>
        <QuestionPicker value={question} onChange={setQuestion} />
        <Button className="self-start" disabled={!personId}><Mic /> {t('Create a story link')}</Button>
      </form>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {link && <LinkResult link={link} about={person ? personName(person) : ''} />}
      {rows.length > 0 && (
        <List>
          {rows.map((r) => <ListRow key={r.id} title={`${r.tellerName || t('No name')}: ${r.about}`} meta={`${t('Recordings received')}: ${r.received}`} actions={<Button size="sm" variant="danger" title={`${t('Close the link')}: ${r.about}`} onClick={async () => { if (await ask(t('Close the link? No more recordings can be sent with it.'), t('Close'))) { await api(`story-requests/${r.id}`, { method: 'DELETE' }); refresh() } }}><X /> {t('Close')}</Button>} />)}
        </List>
      )}
    </Section>
  )
}
