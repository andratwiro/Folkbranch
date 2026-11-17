// `pnpm i18n:check`: keeps the translations honest. It fails on
//   - a phrase the code asks for that a listed language has no line for, and a line nothing asks for;
//   - a key that appears twice in a file, a locale file the registry does not know, a registered language with no file;
//   - a {placeholder} or a «quote» that differs from the English, and a plural form a language needs but lacks;
//   - a `t()` call whose phrase is not a literal (the extractor cannot see it), beyond scripts/i18n-nonliteral-baseline.json.
// It warns about a line equal to the English (maybe forgotten) and a line much longer or shorter than the English, and prints a table.
// A language marked `hidden` in the registry (one being translated, or the pseudo-language) is checked and reported, but never fails the run.
//   pnpm i18n:check            everything
//   pnpm i18n:check --all      every warning, not the first fifteen
//   pnpm i18n:check --prune    also removes the lines nothing asks for
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ALL_LANGS, LANGUAGES, SOURCE_LANG, type Lang, type LanguageDef } from '../lib/languages'
import { askedPhrases, duplicateKeys, localesDir, PLURAL_SUFFIX, pluralCategories, quotes, readTable, root, scanSources, slots, type Table } from './i18n-lib'

export type CheckInput = {
  lang: string
  locale: string
  table: Table
  /** The English table: only the lines that differ from the key (plural forms, context keys). */
  en: Table
  /** Every phrase the code asks for. */
  asked: Set<string>
  /** Phrases that read the same in every language, or in this one. */
  sameOk: (key: string) => boolean
}
export type CheckResult = { errors: string[]; warnings: string[]; have: number; total: number; same: number; unused: string[] }

/** A plural form's base: "{count} years_one" belongs to "{count} years". */
const baseOf = (key: string, known: Set<string>) => (PLURAL_SUFFIX.test(key) && known.has(key.replace(PLURAL_SUFFIX, '')) ? key.replace(PLURAL_SUFFIX, '') : key)

/** Judges one language's table. Pure: the tests feed it deliberately broken tables. */
export function checkTable({ lang, locale, table, en, asked, sameOk }: CheckInput): CheckResult {
  const errors: string[] = []
  const warnings: string[] = []
  const unused: string[] = []
  const isSource = lang === SOURCE_LANG
  const pluralBases = new Set(Object.keys({ ...en, ...table }).filter((k) => PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, '')))
  const needed = [...asked].filter((k) => !pluralBases.has(k))
  // A phrase with no letters in it ("1931–1990") reads the same everywhere.
  const readsAlike = (key: string) => !/[\p{L}]/u.test(key) || sameOk(key)

  if (!isSource) {
    for (const key of needed) if (!table[key]?.trim() && !readsAlike(key)) errors.push(`missing: "${key}"`)
    const cats = pluralCategories(locale)
    for (const base of pluralBases)
      for (const cat of cats) {
        const form = `${base}_${cat}`
        if (!table[form]?.trim() && !(cat === 'other' && table[base]?.trim())) errors.push(`missing plural form: "${form}"`)
      }
  }
  const known = new Set([...asked, ...Object.keys(en), ...pluralBases])
  let same = 0
  for (const [key, value] of Object.entries(table)) {
    const isForm = PLURAL_SUFFIX.test(key)
    const base = baseOf(key, known)
    if (!asked.has(key) && !asked.has(base) && !isForm) {
      unused.push(key)
      errors.push(`unused: "${key}"`)
      continue
    }
    if (!value.trim()) continue
    const source = en[key] ?? base
    const want = slots(source), got = slots(value)
    if (want.join() !== got.join() && !(isForm && got.every((g) => want.includes(g)))) errors.push(`placeholders differ in "${key}": ${want.join(' ') || '–'} → ${got.join(' ') || '–'}`)
    // Only a phrase whose English carries «guillemets» holds the translation to them.
    if (quotes(source) > 0 && quotes(source) !== quotes(value)) errors.push(`quotes differ in "${key}" → "${value}"`)
    if (!isSource) {
      if (value === source && !readsAlike(key) && /[A-Za-z]{3}/.test(source) && !isForm) {
        same++
        warnings.push(`same as the English: "${key}"`)
      }
      const ratio = value.length / Math.max(1, source.length)
      // CJK packs a phrase into a third of the letters; elsewhere a line three times as long as its English is suspect.
      if (source.length > 20 && (ratio > 3.2 || ratio < (/^(zh|ja|ko)/.test(lang) ? 0.1 : 0.25))) warnings.push(`length ${value.length} against ${source.length} in "${key}"`)
    }
  }
  const have = isSource ? needed.length : needed.filter((k) => table[k]?.trim() || readsAlike(k)).length
  return { errors, warnings, have, total: needed.length, same, unused }
}

if (process.argv[1]?.endsWith('i18n-check.ts')) {
  const prune = process.argv.includes('--prune')
  const errors: string[] = []
  const warnings: string[] = []
  const scan = scanSources()
  const asked = askedPhrases(scan)
  const en = readTable(SOURCE_LANG)
  const sameFile = JSON.parse(readFileSync(path.join(localesDir, 'same.json'), 'utf8')) as Record<string, string[] | string>

  const files = readdirSync(localesDir).filter((f) => f.endsWith('.json') && f !== 'same.json').map((f) => f.replace(/\.json$/, ''))
  for (const f of files) if (!(f in LANGUAGES)) errors.push(`locales/${f}.json: no language "${f}" in lib/languages.ts`)
  for (const l of ALL_LANGS) if (!files.includes(l)) errors.push(`lib/languages.ts lists "${l}" but locales/${l}.json is missing`)

  const rows: { lang: string; status: string; have: number; total: number; same: number; problems: number }[] = []
  for (const lang of ALL_LANGS.filter((l) => files.includes(l))) {
    const def: LanguageDef = LANGUAGES[lang as Lang]
    const listed = !def.hidden
    const table = readTable(lang)
    const own = (sameFile[lang] as string[] | undefined) ?? []
    const r = checkTable({ lang, locale: def.locale, table, en, asked, sameOk: (k) => ((sameFile['*'] as string[]) ?? []).includes(k) || own.includes(k) })
    const found = [...duplicateKeys(lang).map((k) => `"${k}" appears twice in locales/${lang}.json`), ...r.errors]
    ;(listed ? errors : warnings).push(...found.map((m) => `${lang}: ${m}`))
    warnings.push(...r.warnings.map((m) => `${lang}: ${m}`))
    if (prune && r.unused.length) {
      for (const k of r.unused) delete table[k]
      writeFileSync(path.join(localesDir, `${lang}.json`), JSON.stringify(table, null, 2) + '\n')
    }
    rows.push({ lang, status: (def.hidden ? 'hidden ' : '') + def.status, have: r.have, total: r.total, same: r.same, problems: found.length })
  }

  // Calls the extractor cannot read.
  const baselinePath = path.join(root, 'scripts/i18n-nonliteral-baseline.json')
  const perFile = new Map<string, number>()
  for (const c of scan.nonLiteral) perFile.set(c.file, (perFile.get(c.file) ?? 0) + 1)
  if (process.argv.includes('--baseline')) writeFileSync(baselinePath, JSON.stringify(Object.fromEntries([...perFile].sort()), null, 2) + '\n')
  const baseline: Record<string, number> = JSON.parse(readFileSync(baselinePath, 'utf8'))
  for (const [file, count] of perFile) if (count > (baseline[file] ?? 0)) errors.push(`${file}: ${count} t() calls with a phrase that is not a literal (allowed ${baseline[file] ?? 0}). Write the phrase out, or list the phrases in a table the extractor sees`)
  for (const [file, allowed] of Object.entries(baseline)) if ((perFile.get(file) ?? 0) < allowed) warnings.push(`${file}: now ${perFile.get(file) ?? 0} non-literal calls, baseline says ${allowed}: lower it in scripts/i18n-nonliteral-baseline.json`)

  console.log('language   status                 translated     same  problems')
  for (const r of rows) console.log(`${r.lang.padEnd(10)} ${r.status.padEnd(22)} ${`${r.have}/${r.total}`.padStart(11)} ${String(r.same).padStart(8)} ${String(r.problems).padStart(9)}`)
  console.log(`\n${asked.size} phrases asked for; ${scan.nonLiteral.length} calls with a phrase that is not a literal (baseline ${Object.values(baseline).reduce((a, b) => a + b, 0)}).`)

  const shown = process.argv.includes('--all') ? Infinity : 15
  if (warnings.length) console.log(`\n${warnings.length} warnings${warnings.length > shown ? ` (first ${shown}; --all shows them all)` : ''}:\n${warnings.slice(0, shown).join('\n')}`)
  if (errors.length) {
    console.error(`\n${errors.length} problems${errors.length > shown ? ` (first ${shown}; --all shows them all)` : ''}:\n${errors.slice(0, shown).join('\n')}`)
    process.exit(1)
  }
  console.log('\ni18n:check passed.')
}
