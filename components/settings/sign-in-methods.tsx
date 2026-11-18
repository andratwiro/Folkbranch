'use client'
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyField } from '@/components/ui/copy'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Section } from '@/components/ui/section'
import { api, useApp } from '@/lib/client'
import { Brand } from '../brand-icons'

type MethodId = 'google' | 'yandex' | 'vk' | 'telegram' | 'email'
interface Method { id: MethodId; on: boolean; source: 'server' | 'app' | null; values: Record<string, string>; returnAddress: string | null; env: string[] }
interface Status { address: string; domain: string; secure: boolean; methods: Method[] }

const link = (href: string, text: string) => <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">{text}<ExternalLink size={11} /></a>

/** A step of a guide: [words](address) becomes a link, {domain} the archive's own domain. */
function Rich({ text, domain }: { text: string; domain: string }) {
  const parts = text.replace('{domain}', '\u0000').split(/(\[[^\]]+\]\([^)]+\)|\u0000)/)
  return <>{parts.map((p, i) => {
    if (p === '\u0000') return <b key={i} className="font-medium break-anywhere">{domain}</b>
    const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    return m ? <span key={i}>{link(m[2], m[1])}</span> : p
  })}</>
}

/** Who each way suits, the steps on the provider's side, and the fields it needs. Steps are short on purpose. */
const GUIDE: Record<MethodId, { name: string; icon: ReactNode; who: string; steps: string[]; fields: [string, string, string?][] }> = {
  yandex: {
    name: 'Yandex ID', icon: <Brand name="yandex" className="text-[#fc3f1d]" />, who: 'The most familiar sign-in in Russia: almost everyone has a Yandex account.',
    steps: [
      'Open [oauth.yandex.ru](https://oauth.yandex.ru/client/new) and create an app for web services.',
      'Under access, tick “Access to email address” and “Access to username, first name and surname”.',
      'Paste the return address below into the Redirect URI field.',
      'Copy the ClientID and Client secret here.',
    ],
    fields: [['clientId', 'ClientID'], ['clientSecret', 'Client secret', 'secret']],
  },
  vk: {
    name: 'VK ID', icon: <Brand name="vk" className="text-[#0077ff]" />, who: 'Sign in with VK, and also with Mail.ru and Odnoklassniki.',
    steps: [
      'Open [id.vk.com/about/business](https://id.vk.com/about/business/go) and create an app for the Web platform.',
      'Base domain: {domain}. Trusted redirect URL: the return address below.',
      'Copy the app ID and the secure key here.',
    ],
    fields: [['clientId', 'App ID'], ['clientSecret', 'Secure key', 'secret']],
  },
  telegram: {
    name: 'Telegram', icon: <Brand name="telegram" className="text-[#26a5e4]" />, who: 'One button, if Telegram is on the phone. Nothing to remember.',
    steps: [
      'In Telegram, send [@BotFather](https://t.me/BotFather) the command /newbot and give the bot a name.',
      'Send it /setdomain, choose the bot and send the domain {domain}.',
      'Copy the token @BotFather sent here.',
    ],
    fields: [['botToken', 'Bot token', 'secret']],
  },
  google: {
    name: 'Google', icon: <Brand name="google" />, who: 'For those with Gmail or an Android phone.',
    steps: [
      'Open [Google Cloud Console](https://console.cloud.google.com/auth/overview), create a project and fill in the consent screen: a name and your email, type External.',
      'Under Clients, create a Web application client. Paste the return address below into Authorized redirect URIs.',
      'Copy the Client ID and Client secret here.',
      'While the app is in Testing mode, Google lets in only test users. Add them under Audience, or press Publish app.',
    ],
    fields: [['clientId', 'Client ID'], ['clientSecret', 'Client secret', 'secret']],
  },
  email: {
    name: 'Code by email', icon: <Mail size={16} />, who: 'Works for everyone: a six-digit code comes by email. It needs a mailbox the archive will send it from.',
    steps: [
      'Set up a separate mailbox for the archive, or use your own.',
      'Create an app password in it: [in Yandex](https://id.yandex.ru/security/app-passwords), [in Mail.ru](https://account.mail.ru/user/2-step-auth/passwords) or [in Gmail](https://myaccount.google.com/apppasswords). The usual mailbox password will not do.',
      'Choose the mail service below, then enter the mailbox address and this password.',
    ],
    fields: [['user', 'Mailbox address'], ['password', 'App password', 'secret'], ['host', 'SMTP server'], ['port', 'Port']],
  },
}
const ORDER: MethodId[] = ['yandex', 'vk', 'telegram', 'google', 'email']
const pressed = 'aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-white aria-pressed:hover:bg-ink'
const MAIL_PRESETS: [string, string, string][] = [['Yandex', 'smtp.yandex.ru', '465'], ['Mail.ru', 'smtp.mail.ru', '465'], ['Gmail', 'smtp.gmail.com', '465']]

function MethodForm({ status, method, onDone }: { status: Status; method: Method; onDone: () => void }) {
  const { t, notify } = useApp()
  const guide = GUIDE[method.id]
  const [values, setValues] = useState<Record<string, string>>(method.id === 'email' ? { host: 'smtp.yandex.ru', port: '465' } : {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }))
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await api(`sign-in-methods/${method.id}`, { method: 'PUT', json: values })
      notify(`${t(guide.name)}: ${t('sign-in is on')}`)
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="flex flex-col gap-3 rounded-lg border border-border bg-white/60 p-3" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <ol className="ml-4 flex list-decimal flex-col gap-1 text-sm leading-snug">
        {guide.steps.map((s, i) => <li key={i}><Rich text={t(s)} domain={status.domain} /></li>)}
      </ol>
      {method.returnAddress && <CopyField label={t('Return address')} value={method.returnAddress} />}
      {method.id === 'telegram' && <CopyField label={t('Domain')} value={status.domain} />}
      {method.id === 'email' && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Email')}>
          {MAIL_PRESETS.map(([name, host, port]) => (
            <Button key={host} type="button" size="sm" variant="outline" className={pressed} aria-pressed={values.host === host} onClick={() => setValues((x) => ({ ...x, host, port }))}>{t(name)}</Button>
          ))}
          <Button type="button" size="sm" variant="outline" className={pressed} aria-pressed={!MAIL_PRESETS.some(([, h]) => h === values.host)} onClick={() => setValues((x) => ({ ...x, host: '' }))}>{t('Other_feminine')}</Button>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {guide.fields.map(([key, label, kind]) => (
          <Field key={key} label={t(label)}>
            <Input value={values[key] ?? ''} onChange={(e) => set(key, e.target.value)} type={kind === 'secret' ? 'password' : key === 'user' ? 'email' : 'text'} autoComplete="off" spellCheck={false} required={key !== 'port'} inputMode={key === 'port' ? 'numeric' : undefined} />
          </Field>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-destructive break-anywhere">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? t('Checking…') : t('Check and turn on')}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>{t('Cancel')}</Button>
      </div>
    </form>
  )
}

/** The owner turns each way into the archive on or off; nobody gets in who was not invited first. */
export function SignInMethods() {
  const { t, confirm: ask, lang } = useApp()
  const qc = useQueryClient()
  const router = useRouter()
  const { data } = useQuery({ queryKey: ['sign-in-methods'], queryFn: () => api<Status>('sign-in-methods') })
  const [open, setOpen] = useState<MethodId | null>(null)
  if (!data) return null
  // The page was drawn with the old list of ways; My account and the sign-in page need the new one.
  const done = () => { setOpen(null); void qc.invalidateQueries({ queryKey: ['sign-in-methods'] }); router.refresh() }
  const off = async (m: Method) => {
    if (!await ask(t('Turn off sign-in: {name}?').replace('{name}', () => t(GUIDE[m.id].name)), t('Turn off'), t('Whoever signed in this way will sign in another way, or with a new link.'))) return
    await api(`sign-in-methods/${m.id}`, { method: 'DELETE' })
    done()
  }
  return (
    <div className="flex min-w-0 flex-col gap-7">
      <Section title={t('How relatives sign in')} description={t('The first time, a person always signs in with an invitation link. Then, under My account, they link a convenient way and sign in with it without links. A stranger cannot get in: every way lets in only people already in the archive.')}>
        {!data.secure && <p className="rounded-lg bg-muted px-3 py-2 text-sm">{t('The archive is open at an address without https now. Yandex, VK, Telegram and Google work only with https: open the archive at your own domain first.')}</p>}
      </Section>
      <div className="flex min-w-0 flex-col divide-y divide-border">
        {ORDER.map((id) => {
          const m = data.methods.find((x) => x.id === id)!
          const g = GUIDE[id]
          return (
            <div key={id} className="flex min-w-0 flex-col gap-2 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="flex min-w-40 flex-1 basis-56 items-start gap-2.5">
                  <span className="mt-0.5 flex-none">{g.icon}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t(g.name)} <span className={m.on ? 'ml-1 text-xs font-normal text-[#2f7a4f]' : 'ml-1 text-xs font-normal text-ink-soft'}>{m.on ? t('on') : t('off')}</span></div>
                    <p className="text-xs leading-snug text-ink-soft">{t(g.who)}</p>
                    {m.source === 'server' && <p className="text-xs text-ink-soft">{t('Set in the server\'s settings')}: {m.env.join(', ')}</p>}
                    {m.source === 'app' && id === 'telegram' && m.values.botName && <p className="text-xs text-ink-soft">@{m.values.botName}</p>}
                    {m.source === 'app' && id === 'email' && <p className="text-xs text-ink-soft break-anywhere">{t('Emails are sent from')} {m.values.from || m.values.user}</p>}
                  </div>
                </div>
                {m.source !== 'server' && open !== id && (
                  <div className="flex flex-none gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setOpen(id)}>{m.on ? t('Replace the keys') : t('Turn on')}</Button>
                    {m.on && <Button size="sm" variant="ghost" onClick={() => off(m)}>{t('Turn off')}</Button>}
                  </div>
                )}
              </div>
              {open === id && <MethodForm status={data} method={m} onDone={done} />}
            </div>
          )
        })}
      </div>
      <p className="text-xs leading-snug text-ink-soft">{t('There is no sign-in by SMS: each message costs money. Telegram and VK ID are tied to a phone number too, and free.')} {link(`https://github.com/danarkhipov/folkbranch/blob/main/docs/${lang === 'ru' ? 'SIGN_IN.ru.md' : 'SIGN_IN.md'}`, t('More about ways to sign in'))}</p>
    </div>
  )
}
