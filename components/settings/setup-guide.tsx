'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Check, ChevronDown, Circle, Download, Upload, UserPlus, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyField } from '@/components/ui/copy'
import { api, useApp } from '@/lib/client'
import { ProviderForm } from '../assistant-setup'
import { Brand, type BrandName } from '../brand-icons'
import { Access } from './access'
import { TokensTab } from './tokens'
import { UpdateNotice } from './update-notice'

interface Status { address: string; addressWrong: string | null; insecure: boolean; dataDir: string; freeBytes: number | null; lowDisk: boolean; people: number; users: number; agents: number; assistant: string | null; assistantOn: boolean; signIn: boolean; mcpUrl: string }

type State = 'done' | 'todo' | 'problem' | 'optional'
const MARK: Record<State, [LucideIcon, string, string]> = { done: [Check, 'text-[#2f7d4f]', 'Done'], problem: [AlertTriangle, 'text-destructive', 'Needs fixing'], todo: [Circle, 'text-ink-faint', 'Not done yet'], optional: [Circle, 'text-ink-faint', ''] }

function Step({ title, state, logos = [], open, onToggle, children }: { title: string; state: State; logos?: BrandName[]; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const { t } = useApp()
  const [Icon, color, word] = MARK[state]
  return (
    <section className="rounded-lg border border-border bg-white min-w-0">
      <div className="flex items-center gap-2 pr-3 min-h-11">
        <button type="button" aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 self-stretch pl-3 text-left" onClick={onToggle}>
          <Icon size={15} className={`flex-none ${color}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 font-medium break-anywhere">{t(title)}</span>
          <ChevronDown size={14} className={`flex-none text-ink-soft transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {logos.map((l) => <Brand key={l} name={l} size={15} className="max-sm:hidden text-ink-soft" />)}
        {word && <span className={`text-xs flex-none ${state === 'problem' ? 'text-destructive' : 'text-ink-soft'}`}>{t(word)}</span>}
      </div>
      {open && <div className="flex flex-col gap-2 px-3 pb-3 text-sm">{children}</div>}
    </section>
  )
}

/** Everything the app needs, one step each, with what is missing saying so. Each step can be skipped and come back to. */
export function SetupGuide({ onImport, onFirstPerson, onGo }: { onImport?: () => void; onFirstPerson?: () => void; onGo?: (section: 'people' | 'signin' | 'assistant' | 'agents' | 'data') => void }) {
  const { t, lang } = useApp()
  const qc = useQueryClient()
  const { data: s } = useQuery({ queryKey: ['setup'], queryFn: () => api<Status>('setup/status') })
  const [open, setOpen] = useState<string | null>(null)
  if (!s) return <div className="h-40" />
  const toggle = (id: string) => () => setOpen(open === id ? null : id)
  // In the settings a step leads to its own screen; the same form is not repeated here.
  const go = (section: 'people' | 'signin' | 'assistant' | 'agents' | 'data', label: string) => <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => onGo!(section)}>{t(label)} <ArrowRight /></Button>
  const addressState: State = s.addressWrong || s.insecure || s.lowDisk ? 'problem' : 'done'
  const gb = s.freeBytes === null ? null : new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(s.freeBytes / 1024 ** 3)
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm">
      <UpdateNotice />
      <Step title={'Your family'} state={s.people ? 'done' : 'todo'} open={open === 'family'} onToggle={toggle('family')}>
        <p className="text-ink-soft">{s.people ? `${t('People in the archive')}: ${s.people}.` : t('Add the first person, or load a GEDCOM, Gramps, Excel, CSV or plain text file.')}</p>
        <div className="flex flex-wrap gap-2">
          {onFirstPerson && <button type="button" className="add-btn" onClick={onFirstPerson}><UserPlus size={14} /> {t('Add a person')}</button>}
          {onImport && <button type="button" className="add-btn" onClick={onImport}><Upload size={14} /> {t('Load a file')}</button>}
        </div>
      </Step>
      <Step title={'Invite relatives_relatives'} state={s.users > 1 ? 'done' : 'optional'} open={open === 'people'} onToggle={toggle('people')}>
        {onGo ? <><p className="text-ink-soft">{t('Invite relatives by link so they can view the archive and add to it.')}</p>{go('people', 'Invite someone')}</> : <Access />}
      </Step>
      <Step title={'Make a copy'} state="optional" open={open === 'copy'} onToggle={toggle('copy')}>
        <p className="text-ink-soft">{t('One file with the whole archive and its photos. A new install can be restored from it.')}</p>
        <Button asChild size="sm" variant="outline" className="self-start"><a href="/api/archive" download><Download /> {t('Download the whole archive')}</a></Button>
      </Step>
      <Step title={'Ways to sign in'} state={s.signIn ? 'done' : 'optional'} logos={['yandex', 'vk', 'telegram', 'google']} open={open === 'signin'} onToggle={toggle('signin')}>
        <p className="text-ink-soft">{t('Without this, relatives sign in with an invitation link. Turn on Yandex ID, VK ID, Telegram, Google or a code by email, and they can come back by themselves.')}</p>
        {onGo ? go('signin', 'Choose ways to sign in') : <p>{t('They are switched on under Settings → Ways to sign in.')}</p>}
      </Step>
      <Step title={'AI assistant'} state={s.assistant ? (s.assistantOn ? 'done' : 'todo') : 'optional'} logos={['openrouter', 'anthropic', 'openai', 'gemini']} open={open === 'assistant'} onToggle={toggle('assistant')}>
        {onGo ? <><p className="text-ink-soft">{s.assistant ? `${t('Connected_masculine')}: ${s.assistant}.` : t('Answers questions about the archive and makes changes. It needs a key from one of these services, which you pay yourself. What it reads goes there.')}</p>{go('assistant', 'Open assistant settings')}</> : s.assistant
          ? <p className="flex flex-wrap items-center gap-2">{t('Connected_masculine')}: {s.assistant}. {!s.assistantOn && <button type="button" className="bar-btn border border-border" onClick={async () => { await api('settings', { method: 'PATCH', json: { assistantEnabled: '1' } }); qc.invalidateQueries({ queryKey: ['setup'] }) }}>{t('Turn on')}</button>}</p>
          : <><p className="text-ink-soft">{t('Answers questions about the archive and makes changes. It needs a key from one of these services, which you pay yourself. What it reads goes there.')}</p><ProviderForm onDone={async () => { await api('settings', { method: 'PATCH', json: { assistantEnabled: '1' } }); qc.invalidateQueries({ queryKey: ['setup'] }) }} /></>}
      </Step>
      <Step title={'Connect an outside program'} state={s.agents ? 'done' : 'optional'} logos={['claudecode', 'codex', 'cursor', 'mcp']} open={open === 'mcp'} onToggle={toggle('mcp')}>
        <p className="text-ink-soft">{t('The program can read the archive and suggest changes. Create a key and copy the command for your program. On the computer running the app one command is enough:')} <code>./folkbranch connect</code></p>
        {onGo ? go('agents', 'Make a key') : <><CopyField label={t('Address to connect to')} value={s.mcpUrl} /><TokensTab /></>}
      </Step>
      <Step title={'Address and storage'} state={addressState} open={open === 'address' || addressState === 'problem'} onToggle={toggle('address')}>
        <p><span className="text-ink-soft">{t('Address')}:</span> <code className="break-all">{s.address}</code></p>
        {s.addressWrong && <p role="alert" className="text-destructive break-anywhere">{t('The settings name another address, so sign-in will not work')}: <b>{s.addressWrong}</b>. {t('Change BETTER_AUTH_URL and restart the app.')}</p>}
        {s.insecure && <p role="alert" className="text-destructive">{t('No https: sign-in links travel in the open. On a server, install with --domain.')}</p>}
        <p><span className="text-ink-soft">{t('Data is in')}:</span> <code className="break-all">{s.dataDir}</code>{gb && ` · ${t('free_available')} ${gb} ${t('GB')}`}</p>
        {s.lowDisk && <p role="alert" className="text-destructive">{t('The disk is almost full. Free some room or new files will not be saved.')}</p>}
      </Step>
    </div>
  )
}
