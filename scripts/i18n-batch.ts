// Translation in batches, for a person or a model. The phrases of a language are cut into fixed ranges of the sorted list of what
// the code asks for, so several workers can take a range each without overlapping.
//   pnpm i18n:batch <code> --count                 how many phrases there are, and how many this language still lacks
//   pnpm i18n:batch <code> --from 0 --to 120       prints JSON for the phrases still missing in that range of the sorted list
//   pnpm i18n:batch <code> --apply lines.json [--dry]   merges (with --dry only checks) {"English phrase": "translation"}; a line that loses a {placeholder} or a «quote» is refused
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PLURAL_SUFFIX, askedPhrases, localesDir, pluralCategories, readTable, scanSources, slots, quotes } from './i18n-lib'
import { LANGUAGES, type Lang } from '../lib/languages'

const [code, ...rest] = process.argv.slice(2)
const flag = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined }
if (!code || !(code in LANGUAGES)) { console.error('Usage: pnpm i18n:batch <code> --count | --from N --to M | --apply file.json (the language must be in lib/languages.ts)'); process.exit(1) }

const ru = readTable('ru'), en = readTable('en'), es = readTable('es')
const table = readTable(code)
const asked = askedPhrases(scanSources())
const bases = new Set([...Object.keys(ru), ...Object.keys(en)].filter((k) => PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, '')))
const cats = pluralCategories(LANGUAGES[code as Lang].locale)
// The fixed list: every phrase, then every plural form this language needs.
const all = [...[...asked].filter((k) => !bases.has(k) && /\p{L}/u.test(k)).sort(), ...[...bases].sort().flatMap((b) => cats.map((c) => `${b}_${c}`))]
const missing = (k: string) => !table[k]?.trim()

if (rest.includes('--count')) {
  console.log(JSON.stringify({ total: all.length, missing: all.filter(missing).length }))
} else if (flag('apply')) {
  const lines = JSON.parse(readFileSync(flag('apply')!, 'utf8')) as Record<string, string>
  const rejected: string[] = []
  let added = 0
  for (const [key, value] of Object.entries(lines)) {
    const source = en[key] ?? key.replace(PLURAL_SUFFIX, '')
    if (!all.includes(key)) rejected.push(`${key}: not a phrase of the app`)
    else if (typeof value !== 'string' || !value.trim()) rejected.push(`${key}: empty`)
    else if (slots(source).join() !== slots(value).join() && !(PLURAL_SUFFIX.test(key) && slots(value).every((s) => slots(source).includes(s)))) rejected.push(`${key}: placeholders ${slots(source).join(' ') || '–'} → ${slots(value).join(' ') || '–'}`)
    else if (quotes(source) > 0 && quotes(source) !== quotes(value)) rejected.push(`${key}: the «quotes» of the English are lost`)
    else { table[key] = value; added++ }
  }
  if (!rest.includes('--dry')) writeFileSync(path.join(localesDir, `${code}.json`), JSON.stringify(Object.fromEntries(Object.keys({ ...Object.fromEntries(all.map((k) => [k, ''])), ...table }).map((k) => [k, table[k] ?? ''])), null, 2) + '\n')
  console.log(JSON.stringify({ [rest.includes('--dry') ? 'wouldAdd' : 'added']: added, rejected }, null, 1))
} else {
  const from = Number(flag('from') ?? 0), to = Number(flag('to') ?? all.length)
  const out: Record<string, { english: string; russian?: string; spanish?: string; note?: string }> = {}
  for (const key of all.slice(from, to).filter(missing)) {
    const plural = PLURAL_SUFFIX.exec(key)
    const english = en[key] ?? (plural ? `${key.replace(PLURAL_SUFFIX, '')}` : key)
    out[key] = { english: plural && !en[key] ? english : english, ...(ru[key] ? { russian: ru[key] } : {}), ...(es[key] ? { spanish: es[key] } : {}),
      ...(plural ? { note: `plural form "${plural[1]}" for ${code}: write the noun in the form used for numbers of that category` } : /_[a-z]+$/.test(key) && en[key] ? { note: 'a context variant: translate the English sense shown, the Russian shows which meaning' } : {}) }
  }
  console.log(JSON.stringify(out, null, 1))
}
