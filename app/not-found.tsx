import Link from 'next/link'
import { headers } from 'next/headers'
import { Logo } from '@/components/logo'
import { translate } from '@/lib/i18n'
import { viewerLang } from '@/lib/languages'
import { archiveLang } from '@/lib/ops/settings'

export default async function NotFound() {
  const h = await headers()
  const lang = viewerLang(h.get('cookie'), h.get('accept-language'), archiveLang())
  const t = (key: string) => translate(lang, key)
  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <Logo size={40} />
        <h1 className="font-serif text-xl font-medium">{t('There is no such page')}</h1>
        <p className="text-sm text-ink-soft">{t('The link may be incomplete or out of date. Ask whoever sent it for a new one.')}</p>
        <Link href="/" className="bar-btn border border-border">{t('Open the chart')}</Link>
      </div>
    </main>
  )
}
