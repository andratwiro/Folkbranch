'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronsUpDown, LogOut, MonitorX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { api, useApp } from '@/lib/client'
import { draftsLeft } from '@/lib/autosave'
import { signOut } from '@/lib/sign-out'
import { LANG_NAMES, LANGS, setLangCookie, setPageLang } from '@/lib/languages'
import { personName, type Lang } from '@/lib/types'
import type { SignInMethods } from '@/lib/sign-in-methods'
import { MailCode, OAuthButtons, TelegramButton, authPost } from '../sign-in-buttons'
import { PersonPopover } from '../person-pickers'
import { roleHelp, roleName } from './roles'

/** Who I am here: my card on the chart, how I get back in, where I am signed in. */
export function Account({ providers }: { providers: SignInMethods }) {
  const { t, me, byId, notify, confirm, lang } = useApp()
  const router = useRouter()
  const mine = me.personId ? byId.get(me.personId) : null
  const chooseLang = (next: Lang) => {
    setLangCookie(next)
    setPageLang(next)
    router.refresh()
  }
  const claim = async (personId: string | null) => {
    try {
      await api('me', { method: 'PATCH', json: { personId } })
      location.reload()
    } catch (e) {
      notify((e as Error).message)
    }
  }
  const canLink = !me.guest && !!(providers.google || providers.yandex || providers.vk || providers.telegram || providers.email)
  const leave = async () => {
    if (draftsLeft().length && !(await confirm(t('This device has text that has not reached the server yet. It will be gone after you sign out.'), t('Sign out')))) return
    // Someone who came in by an invitation link and linked no other way has no road back but a new link.
    const [accounts, session] = await Promise.all([
      fetch('/api/auth/list-accounts').then((r) => r.json()).catch(() => null) as Promise<unknown[] | null>,
      fetch('/api/auth/get-session').then((r) => r.json()).catch(() => null) as Promise<{ user?: { email?: string } } | null>,
    ])
    const mail = session?.user?.email ?? ''
    const noWayBack = Array.isArray(accounts) && !accounts.length && (!mail || mail.endsWith('.invalid'))
    if (noWayBack && !(await confirm(t('You came in by an invitation and linked no email or account. After signing out, you can only come back with a new link from the owner.'), t('Sign out anyway'), canLink ? t('You can link an email or account above, under Sign in without a link.') : undefined))) return
    await signOut()
  }
  return (
    <div className="flex min-w-0 flex-col gap-7 text-sm">
      <Section title={`${me.name} · ${t(roleName[me.role])}`} description={t(roleHelp[me.role])} />
      <Section title={t('Interface language')} description={t('For you on this device only. The archive keeps its own language.')}>
        <Select aria-label={t('Interface language')} value={lang} onChange={(next) => chooseLang(next as Lang)} options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))} />
      </Section>
      {me.role !== 'reader' && (
        <Section title={t('My card on the chart')} description={t('The chart will then show how each person is related to you. Only a living person can be chosen.')}>
          <div className="flex flex-wrap items-center gap-2">
            <PersonPopover onPick={claim} exclude={[...byId.values()].filter((p) => !p.living || p.deathDate).map((p) => p.id)}>
              <button type="button" className="flex h-9 min-w-48 max-w-64 items-center justify-between gap-1.5 rounded-lg border border-input bg-white pl-3 pr-2.5 text-left"><span className="truncate">{mine ? personName(mine) : t('Choose yourself')}</span><ChevronsUpDown size={14} className="flex-none text-ink-soft" /></button>
            </PersonPopover>
            {mine && <Button type="button" size="sm" variant="ghost" onClick={() => claim(null)}><X /> {t('Remove')}</Button>}
          </div>
        </Section>
      )}
      {canLink && <SignInWays providers={providers} />}
      <Section title={t('Devices')} description={t('If you lost a phone or signed in on someone else\'s computer, sign out of other devices. You can come back with a new link or a linked account.')}>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={async () => { await fetch('/api/auth/revoke-other-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); notify(t('Other devices are signed out')) }}><MonitorX /> {t('Sign out on other devices')}</Button>
          <Button type="button" variant="outline" onClick={leave}><LogOut /> {t('Sign out on this device')}</Button>
        </div>
      </Section>
    </div>
  )
}

/** What this account can come back in with, besides a new link. */
function SignInWays({ providers }: { providers: SignInMethods }) {
  const { t, notify } = useApp()
  const qc = useQueryClient()
  const { data: accounts = [] } = useQuery({ queryKey: ['my-accounts'], queryFn: async () => ((await (await fetch('/api/auth/list-accounts')).json()) as { providerId: string }[]).map((a) => a.providerId) })
  const { data: email } = useQuery({ queryKey: ['my-email'], queryFn: async () => ((await (await fetch('/api/auth/get-session')).json())?.user?.email as string | undefined) ?? '' })
  // Relatives who came by a link have a stand-in address; it is not shown as theirs.
  const realEmail = email && !/\.invalid$/.test(email) ? email : ''
  const [mailOpen, setMailOpen] = useState(false)
  const [telegramError, setTelegramError] = useState('')
  const telegram = async (data: Record<string, unknown>) => {
    const r = await authPost('/api/auth/family/telegram/link', data)
    if (r.ok) { notify(t('Telegram linked')); void qc.invalidateQueries({ queryKey: ['my-accounts'] }) }
    else setTelegramError(r.status === 409 ? t('This Telegram is already linked to someone else in the archive.') : t('Telegram did not confirm the sign-in. Please try again.'))
  }
  return (
    <Section title={t('Sign in without a link')} description={t('Link a convenient way to sign in again without a new link.')}>
      <div className="flex flex-wrap gap-2">
        <OAuthButtons methods={providers} t={t} link linked={accounts} />
      </div>
      {providers.telegram && (
        <div className="flex flex-col items-start gap-1">
          {accounts.includes('telegram') ? <p className="text-sm">Telegram: {t('linked')}</p> : <TelegramButton bot={providers.telegram} onAuth={telegram} />}
          {telegramError && <p role="alert" className="text-sm text-destructive">{telegramError}</p>}
        </div>
      )}
      {providers.email && (
        <div className="flex max-w-sm flex-col gap-2">
          <p className="text-sm break-anywhere">{realEmail ? `${t('Email for signing in')}: ${realEmail}` : t('Add an email, and a sign-in code will come to it.')}</p>
          {mailOpen
            ? <MailCode t={t} mode="change" onDone={() => { setMailOpen(false); notify(t('Email saved')); void qc.invalidateQueries({ queryKey: ['my-email'] }) }} />
            : <Button type="button" variant="outline" className="self-start" onClick={() => setMailOpen(true)}>{realEmail ? t('Change the email') : t('Add an email')}</Button>}
        </div>
      )}
    </Section>
  )
}
