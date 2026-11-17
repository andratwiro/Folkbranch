'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronsUpDown, RefreshCw, Trash2, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyField } from '@/components/ui/copy'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { List, ListRow, Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { api, useApp, useLinkOrigin } from '@/lib/client'
import { personName, type Role } from '@/lib/types'
import { PersonPopover } from '../person-pickers'
import { INVITE_ROLES, ROLES, roleHelp, roleName } from './roles'

export function Access() {
  const { t, me, byId, confirm: ask } = useApp()
  const origin = useLinkOrigin()
  const qc = useQueryClient()
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api<{ id: string; name: string; role: Role; personId: string | null }[]>('users') })
  const { data: invites = [] } = useQuery({ queryKey: ['invites'], queryFn: () => api<{ id: string; name: string; role: Role }[]>('invites') })
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [personId, setPersonId] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const refresh = () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['invites'] }) }
  const makeLink = async (json: unknown) => {
    const { token } = await api<{ token: string }>('invites', { json })
    setLink(`${origin}/invite/${token}`)
    refresh()
  }
  const person = personId ? byId.get(personId) : null
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <Section title={t('Invite someone')} description={t('You get a link and send it yourself. It works once and lasts 30 days.')}>
        <form className="flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); if (name.trim()) { await makeLink({ name: name.trim(), role, personId }); setName(''); setPersonId(null) } }}>
          <Field label={t('Given name')}><Input required placeholder={t('For example, Aunt Helen')} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label={t('What they can do')} hint={t(roleHelp[role])}><Select aria-label={t('What they can do')} value={role} onChange={(v) => setRole(v as Role)} options={INVITE_ROLES.map((r) => ({ value: r, label: t(roleName[r]) }))} /></Field>
            <div className="flex min-w-0 flex-col gap-1 text-xs text-ink-soft">{t('Their card on the chart (optional)')}
              <PersonPopover onPick={setPersonId} exclude={[...byId.values()].filter((p) => !p.living || p.deathDate).map((p) => p.id)}>
                <button type="button" className="flex h-9 min-w-0 items-center justify-between gap-1.5 rounded-lg border border-input bg-white pl-3 pr-2.5 text-left text-sm text-ink"><span className="truncate">{person ? personName(person) : t('Choose a card')}</span><ChevronsUpDown size={14} className="flex-none text-ink-soft" /></button>
              </PersonPopover>
              <span className="leading-snug">{t('The chart will show this person how everyone is related to them.')}</span>
            </div>
          </div>
          <Button className="self-start" disabled={!name.trim()} title={name.trim() ? undefined : t('Enter a name first')}><UserPlus /> {t('Create link')}</Button>
          {link && <CopyField label={t('Send this link to the person')} value={link} primary />}
        </form>
      </Section>
      <Section title={t('People with access')}>
        <List>
          {users.map((u) => u.id === me.id
            ? <ListRow key={u.id} title={`${u.name} (${t('you')})`} meta={t(roleName[u.role])} />
            : <ListRow key={u.id} title={u.name} actions={<>
              <Select look="small" className="w-32" aria-label={`${t('What they can do')}: ${u.name}`} value={u.role} onChange={async (v) => { await api(`users/${u.id}`, { method: 'PATCH', json: { role: v } }); refresh() }} options={ROLES.map((r) => ({ value: r, label: t(roleName[r]) }))} />
              <Button size="sm" variant="outline" title={t('New sign-in link')} data-hint={t('If they lost access or changed devices.')} onClick={() => makeLink({ name: u.name, role: u.role, userId: u.id })}><RefreshCw /> {t('New link')}</Button>
              <Button size="icon-sm" variant="danger" title={t('Remove access')} aria-label={`${t('Remove access')}: ${u.name}`} data-hint={t('They can no longer sign in. Their edits stay.')} onClick={async () => { if (await ask(t('Remove access: {name}?').replace('{name}', () => u.name), t('Remove access'))) { await api(`users/${u.id}`, { method: 'DELETE' }); refresh() } }}><Trash2 /></Button>
            </>} />)}
        </List>
      </Section>
      {invites.length > 0 && (
        <Section title={t('Invitations not used yet')}>
          <List>
            {invites.map((i) => <ListRow key={i.id} title={i.name} meta={t(roleName[i.role])} actions={<Button size="sm" variant="outline" onClick={async () => { await api(`invites/${i.id}`, { method: 'DELETE' }); refresh() }}><X /> {t('Cancel invitation')}</Button>} />)}
          </List>
        </Section>
      )}
    </div>
  )
}
