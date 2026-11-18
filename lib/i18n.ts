// The interface's words. English is the source: the key of a phrase is its English text, and every other language (Russian
// included) is a file `locales/<code>.json` that maps that text to its own. i18next looks the words up; this file wires it to
// the registry (lib/languages.ts) and keeps the app's own calls short: translate(lang, key).
//
//  - A phrase with no line in a language shows in English, never in another language. A line with an empty value counts as missing.
//  - Placeholders are {name} (not i18next's default {{name}}), so the phrases read the same as before.
//  - Plural forms follow i18next's JSON v4 suffixes (`_one`, `_few`, `_many`, `_other`, from Intl.PluralRules): `translate(lang, '{count} years', { count })`.
//  - Two phrases that share an English text are told apart by a suffix (`Deceased_female`); locales/en.json gives such a key its English.
//  - The tables come from locales/: the browser fetches only its language (lib/i18n-load.ts); a server (and a test) reads the file it needs.
import i18next from 'i18next'
import en from '../locales/en.json'
import { LEGACY } from './i18n-legacy'
import { matchLanguage, SOURCE_LANG, type Lang } from './languages'

export type Table = Record<string, string>
export type Options = { count?: number } & Record<string, string | number | undefined>

const i18n = i18next.createInstance()
void i18n.init({
  lng: SOURCE_LANG,
  fallbackLng: SOURCE_LANG,
  resources: { en: { translation: en } },
  keySeparator: false,
  nsSeparator: false,
  returnEmptyString: false,
  returnNull: false,
  initAsync: false,
  interpolation: { prefix: '{', suffix: '}', escapeValue: false, skipOnVariables: false },
  // A {placeholder} the caller fills in afterwards stays as it is.
  missingInterpolationHandler: (_text, match: RegExpExecArray) => match[0],
})

/** Fills in a language's table; the next lookup in that language reads it. */
/** Sets a language's table, replacing what it had. */
export const addTable = (lang: Lang, table: Table) => {
  i18n.removeResourceBundle(lang, 'translation')
  i18n.addResourceBundle(lang, 'translation', table)
}
export const hasTable = (lang: Lang) => lang === SOURCE_LANG || i18n.hasResourceBundle(lang, 'translation')

// On the server a language is read from its file the first time something is written in it: summaries and history lines are
// written there, in the archive's language, and the next call finds the table in memory. Only the languages in use are read.
// `locales/` travels with the build (next.config.ts, outputFileTracingIncludes). Node's own modules are fetched at run time, so no browser bundle sees them.
const readTable = (lang: Lang): Table | undefined => {
  const get = (globalThis as { process?: { getBuiltinModule?: (name: string) => unknown } }).process?.getBuiltinModule
  const fs = get?.('node:fs') as typeof import('node:fs') | undefined
  const path = get?.('node:path') as typeof import('node:path') | undefined
  if (!fs || !path) return undefined
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'locales', `${lang}.json`), 'utf8'))
  } catch {
    return undefined
  }
}

const fixed = new Map<Lang, ReturnType<typeof i18n.getFixedT>>()
/** The phrase in `lang`, or its English when that language has no line for it. */
export function translate(lang: Lang, key: string, options?: Options): string {
  if (!hasTable(lang)) {
    const table = readTable(lang)
    if (table) addTable(lang, table)
  }
  let t = fixed.get(lang)
  if (!t) fixed.set(lang, (t = i18n.getFixedT(lang)))
  // A Russian phrase an archive holds (a role, a kind of place) finds the English key it became.
  return t(LEGACY[key] ?? key, options as never) as unknown as string
}

/** A word kept beside its code as a Russian and English pair: the English is the key; the Russian is its line in locales/ru.json. */
export const translatePair = (lang: Lang, _ru: string, english: string) => translate(lang, english)

/** The language to offer first: the browser's best match, in quality order, or the fallback (English by default). */
export const langFromHeader = (header: string | null, fallback: Lang = SOURCE_LANG): Lang => matchLanguage(header, fallback)
