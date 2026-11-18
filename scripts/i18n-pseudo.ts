// Writes locales/xx.json, the pseudo-language: every phrase accented and wrapped in ⟦ ⟧, placeholders and «quotes» untouched.
// A screen that still shows plain English in it holds a phrase nobody wrapped in t(); the brackets show where a phrase starts and ends,
// and the longer text shows what a long translation does to the layout. Hidden from every picker.
//   pnpm i18n:pseudo
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { askedPhrases, localesDir, PLURAL_SUFFIX, pluralCategories, readTable, scanSources } from './i18n-lib'

const MAP: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ö', u: 'ú', c: 'ç', n: 'ñ', y: 'ý', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' }

/** Accents the vowels, leaves what the code fills in as it is, and stretches the text by about a third. */
export const pseudo = (text: string) => {
  const parts = text.split(/(\$?\{[^{}]*\}|%[sd]|«|»)/)
  const body = parts.map((p, i) => (i % 2 ? p : p.replace(/[aeiouAEIOUcny]/g, (c) => MAP[c] ?? c))).join('')
  return `⟦${body}${'·'.repeat(Math.ceil(text.length / 3))}⟧`
}

if (process.argv[1]?.endsWith('i18n-pseudo.ts')) {
  const scan = scanSources()
  const known = new Set([...Object.keys(readTable('ru')), ...Object.keys(readTable('en'))])
  const asked = askedPhrases(scan)
  const out: Record<string, string> = {}
  const en = readTable('en')
  const bases = [...known].filter((k) => PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, ''))
  for (const key of [...asked].sort()) if (!bases.includes(key)) out[key] = pseudo(en[key] ?? key)
  for (const base of new Set(bases)) for (const cat of pluralCategories('en')) out[`${base}_${cat}`] = pseudo(en[`${base}_${cat}`] ?? base)
  writeFileSync(path.join(localesDir, 'xx.json'), JSON.stringify(out, null, 2) + '\n')
  console.log(`locales/xx.json: ${Object.keys(out).length} lines`)
}
