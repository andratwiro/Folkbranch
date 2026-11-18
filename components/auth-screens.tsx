'use client'
import { startTransition, useEffect, useRef, useState } from 'react'
import { translate } from '@/lib/i18n'
import { useTable } from '@/lib/i18n-load'
import { LANGS, langLabel, setLangCookie, setPageLang } from '@/lib/languages'
import type { Lang } from '@/lib/types'
import { MailCode, OAuthButtons, TelegramButton, authPost } from './sign-in-buttons'
import type { SignInMethods } from '@/lib/sign-in-methods'
import { Logo } from './logo'
import { RestoreForm } from './settings/restore-form'
import { inputClass } from '@/components/ui/input'
import { buttonVariants } from '@/components/ui/button'

const shell = 'canvas !overflow-auto !cursor-default grid place-items-center p-4'
const card = 'float w-full max-w-sm p-6 flex flex-col gap-3'
const field = inputClass
const primary = buttonVariants({ size: 'lg' })

const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** The page itself is built before the archive's language is known. */
const useHtmlLang = (lang: Lang) => useEffect(() => { setPageLang(lang) }, [lang])

export function SetupScreen({ needsCode, initialCode = '', initialLang, wrongAddress }: { needsCode: boolean; initialCode?: string; initialLang: Lang; wrongAddress: string | null }) {
  const [lang, setLang] = useState<Lang>(initialLang)
  useHtmlLang(lang)
  useTable(lang)
  const t = (k: string) => translate(lang, k)
  const [name, setName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [code, setCode] = useState(initialCode)
  const [demo, setDemo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <main className={shell}>
      <form className={card} onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const r = await post('/api/auth/family/setup', { name, familyName, language: lang, demo, code })
        if (r.ok) location.href = '/'
        else { setBusy(false); setError((await r.json().catch(() => null))?.message ?? 'error') }
      }}>
        <div className="flex items-center gap-2 font-serif text-lg font-medium"><Logo size={32} /> Folkbranch</div>
        <h1 className="font-serif text-2xl font-medium">{t('Family archive')}</h1>
        <p className="text-ink-soft -mt-2 text-sm">{t('You will become the owner of this archive.')}</p>
        {wrongAddress && <p role="alert" className="rounded-lg bg-muted px-3 py-2 text-sm text-destructive break-anywhere">{t('This is not the address in the settings, and sign-in will not work. The settings say')}: <b>{wrongAddress}</b>. {t('Open that address or change BETTER_AUTH_URL.')}</p>}
        <div className="flex gap-1">
          {/* A transition: the old words stay on screen while a Spanish or Catalan table arrives. */}
          {LANGS.map((l) => <button type="button" key={l} onClick={() => { setLangCookie(l); startTransition(() => setLang(l)) }} className={lang === l ? 'bar-btn on' : 'bar-btn'}>{langLabel(l)}</button>)}
        </div>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Your name')}<input required autoFocus className={field} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Family name')}<input required className={field} value={familyName} onChange={(e) => setFamilyName(e.target.value)} /></label>
        {needsCode && <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Setup code')}<input required className={field} value={code} onChange={(e) => setCode(e.target.value)} /></label>}
        {needsCode && <p className="text-xs text-ink-soft -mt-1">{t('The program shows it on first start. If you cannot find it, ask whoever installed the archive.')}</p>}
        <label className="flex items-center gap-2 text-ink-soft text-sm"><input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} /> {t('Load the demo family')}</label>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button className={primary} disabled={busy}>{t('Create archive')}</button>
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-soft">{t('I have a copy of an archive')}</summary>
          <div className="mt-2"><RestoreForm t={t} code={code} warning={t('The archive will be created from this file.')} /></div>
        </details>
      </form>
    </main>
  )
}

export function LoginScreen({ lang, familyName, providers, error }: { lang: Lang; familyName: string; providers: SignInMethods; error?: string }) {
  useHtmlLang(lang)
  useTable(lang)
  const t = (k: string) => translate(lang, k)
  const [telegramError, setTelegramError] = useState('')
  const telegram = async (data: Record<string, unknown>) => {
    const r = await authPost('/api/auth/family/telegram', data)
    if (r.ok) location.href = '/'
    else setTelegramError(r.status === 403 ? t('This Telegram is not linked yet. Sign in with the link and link it under My account.') : t('Telegram did not confirm the sign-in. Please try again.'))
  }
  const any = providers.google || providers.yandex || providers.vk || providers.telegram || providers.email
  return (
    <main className={shell}>
      <div className={card}>
        <Logo size={40} />
        <h1 className="font-serif text-2xl font-medium">{familyName || t('Family archive')}</h1>
        <p className="font-medium">{t('Sign-in by invitation only')}</p>
        <p className="text-ink-soft text-sm -mt-2">{any ? t('The first time, sign in with a link from a relative. After that you can sign in like this:') : t('Ask a relative to send you a link.')}</p>
        {/* A provider that refused, or an account not linked yet, comes back here with ?error= */}
        {error && <p role="alert" className="text-sm text-destructive">{t('Could not sign in. If this is your first time signing in this way, open the invitation link first and link this way under My account.')}</p>}
        <OAuthButtons methods={providers} t={t} />
        {providers.telegram && <TelegramButton bot={providers.telegram} onAuth={telegram} />}
        {telegramError && <p role="alert" className="text-sm text-destructive">{telegramError}</p>}
        {providers.email && <details className="text-sm"><summary className="cursor-pointer py-2">{t('Sign in with a code by email')}</summary><div className="pt-1"><MailCode t={t} mode="sign-in" onDone={() => { location.href = '/' }} /></div></details>}
      </div>
    </main>
  )
}

export function InviteScreen({ token, lang, familyName, name, valid, auto }: { token: string; lang: Lang; familyName: string; name: string; valid: boolean; auto?: boolean }) {
  useHtmlLang(lang)
  useTable(lang)
  const t = (k: string) => translate(lang, k)
  const [busy, setBusy] = useState(!!auto)
  const accept = async () => {
    setBusy(true)
    const r = await post('/api/auth/family/accept', { token })
    if (r.ok) location.href = '/'
    else location.reload()
  }
  // Only the owner's own command on this computer asks for it: it comes from no message that a link preview could open.
  const started = useRef(false)
  useEffect(() => {
    if (!auto || !valid || started.current) return
    started.current = true
    void accept()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main className={shell}>
      <div className={card}>
        {valid ? (
          <>
            <Logo size={40} />
            <p className="text-ink-soft text-base">{t('You are invited to the family archive')}</p>
            <h1 className="font-serif text-2xl font-medium -mt-2">{familyName}</h1>
            {name && <p>{t('You will sign in as')}: {name}. {t('If this is not you, ask for a new link.')}</p>}
            {/* A button, not an automatic sign-in: link previews in messengers must not burn the one-time link. */}
            <button className={primary} disabled={busy} onClick={accept}>{t('Accept invitation')}</button>
          </>
        ) : (
          <>
            <Logo size={40} />
            <h1 className="font-serif text-xl font-medium">{t('This invitation no longer works')}</h1>
            <p className="text-ink-soft text-sm">{t('The link is out of date or was already used. Ask whoever sent it for a new one.')}</p>
          </>
        )}
      </div>
    </main>
  )
}

/** A link for viewing: a button first, so a preview in a messenger opens nothing and learns nothing. */
export function ShareScreen({ token, valid, needsPassword, lang }: { token: string; valid: boolean; needsPassword: boolean; lang: Lang }) {
  useHtmlLang(lang)
  useTable(lang)
  const t = (k: string) => translate(lang, k)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <main className={shell}>
      {valid ? (
        <form className={card} onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          const r = await post('/api/share', { token, ...(needsPassword ? { password } : {}) })
          if (r.ok) return location.replace('/')
          setBusy(false)
          setError((await r.json().catch(() => null))?.error ?? 'error')
        }}>
          <Logo size={40} />
          <h1 className="font-serif text-xl font-medium">{t('A family archive has been opened for you to view')}</h1>
          <p className="text-ink-soft text-sm">{t('No sign-up needed. Living relatives are hidden.')}</p>
          {needsPassword && (
            <label className="flex flex-col gap-1 text-sm text-ink-soft">{t('Password')}
              <input className={field} type="password" autoComplete="off" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button className={primary} disabled={busy}>{t('Open the archive')}</button>
        </form>
      ) : (
        <div className={card}>
          <Logo size={40} />
          <h1 className="font-serif text-xl font-medium">{t('This link no longer works')}</h1>
          <p className="text-ink-soft text-sm">{t('It expired, or the archive\'s owner closed it. Ask whoever sent it for a new one.')}</p>
        </div>
      )}
    </main>
  )
}
