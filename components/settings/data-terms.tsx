'use client'
import { DATA_TERMS, TERMS_CHECKED } from '@/lib/ai/data-terms'
import { useApp } from '@/lib/client'

/** How a service keeps what is sent to it, folded under one line, with its source and when it was read. */
export function DataTerms({ service, open }: { service: string; open?: boolean }) {
  const { t, lang } = useApp()
  const d = DATA_TERMS[service]
  if (!d) return null
  const row = (label: string, text: string) => <p><span className="text-ink-faint">{t(label)}:</span> {t(text)}</p>
  return (
    <details open={open} className="text-xs text-ink-soft">
      <summary className="cursor-pointer select-none">{t('How the service keeps data')}</summary>
      <div className="mt-1 flex flex-col gap-0.5 border-l-2 border-[#efe8da] pl-2.5">
        {row('Training', d.trains)}
        {row('Keeping', d.keeps)}
        {row('Where', d.where)}
        {d.tip && row('Tip', d.tip)}
        <p className="text-ink-faint">
          <a className="underline" href={d.source} target="_blank" rel="noreferrer">{t('The service\'s terms')}</a>
          {' · '}{t('checked')} {new Date(TERMS_CHECKED).toLocaleDateString(lang)}{'. '}{t('Terms can change.')}
        </p>
      </div>
    </details>
  )
}
