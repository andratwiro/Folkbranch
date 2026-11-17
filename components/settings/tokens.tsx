'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, KeyRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyField } from '@/components/ui/copy'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { List, ListRow, Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { SwitchRow } from '@/components/ui/switch'
import { api, useApp } from '@/lib/client'
import { Brand, type BrandName } from '../brand-icons'

interface TokenRow { id: string; name: string; role: 'reader' | 'editor'; review: boolean; createdAt: number; lastUsedAt: number | null; revokedAt: number | null; expiresAt: number | null }

type Client = 'claude' | 'codex' | 'cursor' | 'windsurf' | 'json' | 'prompt'

const CLIENTS: [Client, string, BrandName | null][] = [['claude', 'Claude Code', 'claudecode'], ['codex', 'Codex', 'codex'], ['cursor', 'Cursor', 'cursor'], ['windsurf', 'Windsurf', 'windsurf'], ['json', 'Another program', 'mcp'], ['prompt', 'Agent brief', null]]
/** Where each program keeps its connections, for the ones with no command for it. */
const FILES: Partial<Record<Client, string>> = { cursor: '~/.cursor/mcp.json', windsurf: '~/.codeium/windsurf/mcp_config.json' }

export function TokensTab() {
  const { t, lang, confirm: ask } = useApp()
  const qc = useQueryClient()
  const { data = [] } = useQuery({ queryKey: ['tokens'], queryFn: () => api<TokenRow[]>('tokens') })
  const rows = data.filter((r) => !r.revokedAt)
  const [name, setName] = useState('')
  const [role, setRole] = useState<'reader' | 'editor'>('reader')
  const [review, setReview] = useState(true)
  const [days, setDays] = useState('365')
  const [made, setMade] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['tokens'] })
  const origin = typeof location === 'undefined' ? '' : location.origin
  const [client, setClient] = useState<Client>('claude')
  const snippet = client === 'claude'
    ? `claude mcp add --transport http folkbranch ${origin}/api/mcp --header "Authorization: Bearer ${made}"`
    : client === 'codex'
      ? `export FOLKBRANCH_TOKEN=${made}\ncodex mcp add folkbranch --url ${origin}/api/mcp --bearer-token-env-var FOLKBRANCH_TOKEN`
    : client !== 'prompt'
      ? JSON.stringify({ mcpServers: { folkbranch: { type: 'http', url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${made}` } } } }, null, 2)
      : t('Connect to the family archive over MCP. Call get_overview first, then find_gaps. Before creating anyone, look them up with search_people. Record every value you find with add_version, with its source and reliability, rather than overwriting fields.')
  const date = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' })
  const meta = (r: TokenRow) => [
    t(r.role === 'reader' ? 'Read only' : r.review ? 'Changes need review' : 'Changes apply directly'),
    `${t('created')} ${date.format(r.createdAt)}`,
    r.lastUsedAt ? `${t('used')} ${date.format(r.lastUsedAt)}` : t('not used yet'),
    r.expiresAt ? `${t(r.expiresAt < Date.now() ? 'expired' : 'valid until')} ${date.format(r.expiresAt)}` : t('no expiry'),
  ].join(' · ')
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <Section title={t('New key')} description={t('A key is shown once. Give each program its own, so you can revoke one without touching the rest.')}>
        <form className="flex flex-col gap-3" onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim()) return
          const r = await api<{ token: string }>('tokens', { json: { name: name.trim(), role, review, expiresInDays: days ? Number(days) : null } })
          setMade(r.token)
          setName('')
          refresh()
        }}>
          <Field label={t('Token name')}><Input placeholder={t('For example, Claude on my laptop')} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label={t('What they can do')}><Select aria-label={t('What they can do')} value={role} onChange={(v) => setRole(v as 'reader' | 'editor')} options={[{ value: 'reader', label: t('Read only') }, { value: 'editor', label: t('Read and suggest edits') }]} /></Field>
            <Field label={t('Valid for')}><Select aria-label={t('Valid for')} value={days} onChange={setDays} options={[{ value: '1', label: t('one day') }, { value: '30', label: t('one month') }, { value: '365', label: t('one year') }, { value: '', label: t('no expiry') }]} /></Field>
          </div>
          <p className="text-xs leading-snug text-ink-soft">{t(role === 'editor' ? 'An editor token sees living relatives, and this data will reach the AI provider.' : 'A read-only token does not see living relatives.')}</p>
          {role === 'editor' && <SwitchRow title={t('Changes need review')} description={t('Edits wait for your approval under Review.')} checked={review} onChange={setReview} />}
          <Button className="self-start" disabled={!name.trim()}><KeyRound /> {t('Create token')}</Button>
        </form>
        {made && (
          <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-white p-3">
            <p className="font-medium">{t('The token is shown only once, save it.')}</p>
            <div role="radiogroup" aria-label={t('Connect to')} className="inline-flex flex-wrap self-start rounded-lg bg-muted p-0.5 gap-0.5 text-xs">
              {CLIENTS.map(([c, title, logo]) => <button key={c} type="button" role="radio" aria-checked={client === c} className={client === c ? 'inline-flex items-center gap-1 h-7 px-2 rounded-md bg-white shadow-sm font-medium' : 'inline-flex items-center gap-1 h-7 px-2 rounded-md text-ink-soft hover:text-ink'} onClick={() => setClient(c)}>{logo && <Brand name={logo} size={13} />}{title === 'Another program' || title === 'Agent brief' ? t(title) : title}</button>)}
            </div>
            {FILES[client] && <p className="text-xs text-ink-soft">{t('Paste this into the file')} <code>{FILES[client]}</code></p>}
            {client === 'codex' && <p className="text-xs text-ink-soft">{t('Add the first line to your shell settings too, so the key is there on every run.')}</p>}
            <CopyField value={snippet} primary multiline />
          </div>
        )}
      </Section>
      <Section title={t('Keys in use')}>
        {!rows.length && <p className="text-xs text-ink-soft">{t('None yet. No program can reach the archive.')}</p>}
        <List>
          {rows.map((r) => <ListRow key={r.id} title={r.name} meta={meta(r)} actions={<Button size="sm" variant="danger" title={`${t('Revoke')}: ${r.name}`} data-hint={t('The program with this key loses access at once.')} onClick={async () => { if (await ask(`${t('Revoke the key')} «${r.name}»?`, t('Revoke'), t('The program with this key loses access at once. It cannot be brought back, but you can make a new one.'))) { await api(`tokens/${r.id}`, { method: 'DELETE' }); refresh() } }}><X /> {t('Revoke')}</Button>} />)}
        </List>
      </Section>
      <details className="min-w-0">
        <summary className="cursor-pointer text-base font-medium">{t('External agents')}</summary>
        <div className="mt-2 flex min-w-0 flex-col gap-2.5">
          <p className="text-xs leading-snug text-ink-soft">{t('Addresses for connecting to the archive directly.')}</p>
        <CopyField label={t('MCP address')} value={`${origin}/api/mcp`} />
        <div className="flex min-w-0 flex-col gap-1">
          <CopyField label={t('Description for programs in the OpenAPI format')} value={`${origin}/api/v1/openapi.json`} />
          <Button asChild size="sm" variant="ghost" className="self-start"><a href="/api/v1/openapi.json" target="_blank" rel="noreferrer"><ExternalLink /> {t('Open the description')}</a></Button>
        </div>
        </div>
      </details>
    </div>
  )
}
