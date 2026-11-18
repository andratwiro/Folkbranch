// A language comes as a chunk of its own, fetched only by a page that reads in it: a reader never downloads the other languages.
// Until the table is here, translate() shows English. Importing `locales/<code>.json` by a template lets the bundler cut one chunk per file.
import { use } from 'react'
import { addTable, hasTable, type Table } from './i18n'
import { SOURCE_LANG, type Lang } from './languages'

/** A promise React reads at once, without waiting, when it is marked as done. */
type Tracked = Promise<void> & { status?: 'fulfilled'; value?: void }
const done = (): Tracked => Object.assign(Promise.resolve(), { status: 'fulfilled' as const, value: undefined })
const loading = new Map<Lang, Tracked>()

/** Resolves once `lang` can be translated, at once if it already can. */
export function loadTable(lang: Lang): Promise<void> {
  let p = loading.get(lang)
  if (!p) {
    p = hasTable(lang) || lang === SOURCE_LANG
      ? done()
      : import(`../locales/${lang}.json`).then((m: { default: Table }) => { addTable(lang, m.default); Object.assign(p!, { status: 'fulfilled', value: undefined }) })
    loading.set(lang, p)
  }
  return p
}

/** Waits for the table during render, so the first paint is already in the reader's language. Called on every render, the same way. */
export const useTable = (lang: Lang) => use(loadTable(lang))
