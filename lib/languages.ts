// The one list of the languages the interface speaks. The `Lang` type, the pickers, the zod enums, the loaders and the
// tests all read it, so adding a language is one line here plus its file `locales/<code>.json` (docs/TRANSLATING.md).

/** `source` is the language the phrases are written in; `reviewed` has been signed off by a native reader; `draft` is machine-translated and shown as "beta". */
export type LangStatus = 'source' | 'reviewed' | 'draft'

export type LanguageDef = {
  /** The language named in itself, as the picker shows it. */
  name: string
  /** The BCP 47 tag `Intl` formats dates, numbers, plurals and sorting with. */
  locale: string
  dir: 'ltr' | 'rtl'
  /** Which name a list is sorted and a line is written by: "Anna Petrova" or "Petrova Anna" (Chinese, Japanese, Korean, Vietnamese, Hungarian). */
  nameOrder: 'given-first' | 'surname-first'
  /** Whether people carry a patronymic that belongs in a full name ("Anna Petrovna Ivanova"). */
  patronymic: boolean
  status: LangStatus
  /** Other codes a browser may send for this language ("pt", "zh-cn"). The code itself always matches. */
  aliases?: string[]
  /** How an open range of years ends for a living person ("1950–now"): the browser reads it without the language's table, and a test keeps it equal to the phrase `now` in locales/<code>.json. */
  openEnd: string
  /** The language as Whisper names it, for speech to text; omitted, Whisper detects the language itself. */
  whisper?: string
  /** Shown to developers and tests only: never in a picker, a cookie or an Accept-Language match. */
  hidden?: boolean
}

const given = { nameOrder: 'given-first', patronymic: false } as const

export const LANGUAGES = {
  ru: { name: 'Русский', openEnd: 'н. в.', locale: 'ru', dir: 'ltr', nameOrder: 'given-first', patronymic: true, status: 'reviewed', whisper: 'russian' },
  en: { name: 'English', openEnd: 'now', locale: 'en', dir: 'ltr', ...given, status: 'source', whisper: 'english' },
  es: { name: 'Español', openEnd: 'hoy', locale: 'es', dir: 'ltr', ...given, status: 'reviewed', whisper: 'spanish' },
  ca: { name: 'Català', openEnd: 'avui', locale: 'ca', dir: 'ltr', ...given, status: 'reviewed', whisper: 'catalan' },
  'pt-BR': { aliases: ['pt'], name: 'Português (Brasil)', openEnd: 'hoje', locale: 'pt-BR', dir: 'ltr', nameOrder: 'given-first', patronymic: false, status: 'draft', whisper: 'portuguese', hidden: true },
  fr: { name: 'Français', openEnd: 'aujourd’hui', locale: 'fr', dir: 'ltr', nameOrder: 'given-first', patronymic: false, status: 'draft', whisper: 'french', hidden: true },
  de: { name: 'Deutsch', openEnd: 'heute', locale: 'de', dir: 'ltr', nameOrder: 'given-first', patronymic: false, status: 'draft', whisper: 'german', hidden: true },
  it: { name: 'Italiano', openEnd: 'oggi', locale: 'it', dir: 'ltr', nameOrder: 'given-first', patronymic: false, status: 'draft', whisper: 'italian', hidden: true },
  uk: { name: 'Українська', openEnd: 'дотепер', locale: 'uk', dir: 'ltr', nameOrder: 'given-first', patronymic: true, status: 'draft', whisper: 'ukrainian', hidden: true },
  pl: { name: 'Polski', openEnd: 'obecnie', locale: 'pl', dir: 'ltr', nameOrder: 'given-first', patronymic: false, status: 'draft', whisper: 'polish', hidden: true },
  // The pseudo-language: every phrase wrapped and accented, so a screen that still shows plain English is a phrase nobody wrapped in t().
  xx: { name: 'Pseudo', openEnd: 'now', locale: 'en', dir: 'ltr', ...given, status: 'draft', hidden: true },
} as const satisfies Record<string, LanguageDef>

/** Every code in the registry. */
export type Lang = keyof typeof LANGUAGES

/** Every language the interface can read, hidden ones included: the tests and the loaders walk this. */
export const ALL_LANGS = Object.keys(LANGUAGES) as Lang[]
/** The languages people can choose: the pickers, the zod enums and the cookie accept these. */
export const LANGS = ALL_LANGS.filter((l) => !(LANGUAGES[l] as LanguageDef).hidden)

/** `LANGS` as a non-empty tuple, which is what `z.enum` takes. */
export const LANG_ENUM = LANGS as [Lang, ...Lang[]]

/** The language the phrases (the keys) are written in. */
export const SOURCE_LANG: Lang = 'en'

export const langDef = (lang: Lang): LanguageDef => LANGUAGES[lang]

/** Each language named in itself, as the language picker shows it. */
/** What a picker shows: the language's own name, and "beta" while a native reader has not signed the translation off. */
export const langLabel = (l: Lang) => (LANGUAGES[l].status === 'draft' ? `${LANGUAGES[l].name} · beta` : LANGUAGES[l].name)
export const LANG_NAMES = Object.fromEntries(LANGS.map((l) => [l, LANGUAGES[l].name])) as Record<Lang, string>

export const isLang = (s: unknown): s is Lang => typeof s === 'string' && (LANGS as string[]).includes(s)

const byTag = new Map<string, Lang>()
for (const l of LANGS) {
  byTag.set(l.toLowerCase(), l)
  for (const a of (LANGUAGES[l] as LanguageDef).aliases ?? []) byTag.set(a.toLowerCase(), l)
}

/** The language a tag names: "pt-BR" or "es-ES", the whole tag first, then its first part; undefined when the app does not speak it. */
export const langOfTag = (tag: string | null | undefined): Lang | undefined => {
  const lower = (tag ?? '').trim().toLowerCase().replace(/_/g, '-')
  return byTag.get(lower) ?? byTag.get(lower.split('-')[0])
}

/** The language a page or browser names ("es-ES", "ca"), English when the app does not speak it. */
export const langOf = (code: string | null | undefined): Lang => langOfTag(code) ?? 'en'

/** The cookie a person's interface language is kept in, so pages before an account can read it too. */
export const LANG_COOKIE = 'folkbranch-lang'

/**
 * The best language an Accept-Language header offers, or `fallback` when it names none the app speaks.
 * The header's q-values decide the order: "de;q=1, es;q=0.8, ru;q=0.9" picks Russian.
 */
export const matchLanguage = (header: string | null | undefined, fallback: Lang = 'en'): Lang => {
  const choices = (header ?? '').split(',').flatMap((part, order) => {
    const [raw, ...params] = part.split(';')
    const code = raw.trim().toLowerCase()
    if (!code) return []
    const quality = params.map((p) => p.trim()).find((p) => /^q=/i.test(p))
    const weight = quality ? Number(quality.slice(2)) : 1
    if (!Number.isFinite(weight) || weight <= 0) return []
    return [{ code, weight, order }]
  })
  // Stable order: an equal q keeps the order the browser sent.
  choices.sort((a, b) => b.weight - a.weight || a.order - b.order)
  for (const { code } of choices) {
    const hit = langOfTag(code)
    if (hit) return hit
  }
  return fallback
}

/** The language chosen in the cookie, or null when it is absent or not one of ours. */
export const langFromCookie = (cookie: string | null | undefined): Lang | null => {
  const raw = cookie?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${LANG_COOKIE}=`))?.slice(LANG_COOKIE.length + 1)
  if (!raw) return null
  let value = raw
  try { value = decodeURIComponent(raw) } catch {}
  return isLang(value) ? value : null
}

/** The language a viewer reads: their cookie, then the browser's best match, then the archive's. */
export const viewerLang = (cookie: string | null | undefined, acceptLanguage: string | null | undefined, archive: Lang): Lang =>
  langFromCookie(cookie) ?? matchLanguage(acceptLanguage, archive)

/** Keeps a language choice for the next page, including the ones shown before an account. */
export const setLangCookie = (lang: Lang) => {
  if (typeof document !== 'undefined') document.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`
}

/** Sets the page's language and reading direction on the root element, for code that runs outside React. */
export const setPageLang = (lang: Lang) => {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang
  document.documentElement.dir = LANGUAGES[lang].dir
}

/** The language of the page being shown, for code that runs outside React. */
export const pageLang = (): Lang => langOf(typeof document === 'undefined' ? null : document.documentElement.lang)

/** `Intl` options and sorting for a language: one place, so a list sorts by the reader's alphabet and not by the browser's. */
export const collator = (lang: Lang) => new Intl.Collator(LANGUAGES[lang].locale, { sensitivity: 'base', numeric: true })
