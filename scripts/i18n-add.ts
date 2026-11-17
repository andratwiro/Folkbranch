// `pnpm i18n:add <code> --name "Native name" [--locale tag] [--dir rtl] [--surname-first] [--patronymic] [--open-end word] [--whisper name]`
// Adds a language: one line in lib/languages.ts (hidden from the pickers until it is finished), locales/<code>.json with a line for
// every phrase the code asks for (empty, so `pnpm i18n:check` lists what is missing), and a glossary to fill in. See docs/TRANSLATING.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { LANGUAGES } from '../lib/languages'
import { askedPhrases, localesDir, PLURAL_SUFFIX, pluralCategories, readTable, root, scanSources } from './i18n-lib'

const args = process.argv.slice(2)
const code = args[0]
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const has = (name: string) => args.includes(`--${name}`)
const usage = 'Usage: pnpm i18n:add <code> --name "Native name" [--locale tag] [--dir rtl] [--surname-first] [--patronymic] [--open-end word] [--whisper name]\nExample: pnpm i18n:add pt-BR --name "Português (Brasil)"'

if (!code || code.startsWith('--') || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) { console.error(usage); process.exit(1) }
const name = flag('name')
if (!name) { console.error(`--name is required: the language written in itself, as the picker shows it.\n${usage}`); process.exit(1) }
if (code in LANGUAGES) { console.error(`"${code}" is already in lib/languages.ts.`); process.exit(1) }
const locale = flag('locale') ?? code
try { new Intl.PluralRules(locale) } catch { console.error(`"${locale}" is not a language tag Intl knows.`); process.exit(1) }
const dir = flag('dir') === 'rtl' ? 'rtl' : 'ltr'

const parts = [`name: ${JSON.stringify(name)}`, `openEnd: ${JSON.stringify(flag('open-end') ?? 'now')}`, `locale: ${JSON.stringify(locale)}`, `dir: '${dir}'`,
  `nameOrder: '${has('surname-first') ? 'surname-first' : 'given-first'}'`, `patronymic: ${has('patronymic')}`, `status: 'needs-review'`]
if (flag('whisper')) parts.push(`whisper: ${JSON.stringify(flag('whisper'))}`)
parts.push('hidden: true')
const registry = path.join(root, 'lib/languages.ts')
const source = readFileSync(registry, 'utf8')
const marker = '  // The pseudo-language:'
if (!source.includes(marker)) { console.error('lib/languages.ts has no pseudo-language marker; add the line by hand.'); process.exit(1) }
writeFileSync(registry, source.replace(marker, `  ${JSON.stringify(code)}: { ${parts.join(', ')} },\n${marker}`))

// Every phrase, empty: an empty line counts as missing.
const asked = askedPhrases(scanSources())
const bases = new Set([...Object.keys(readTable('ru')), ...Object.keys(readTable('en'))].filter((k) => PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, '')))
const table: Record<string, string> = {}
for (const key of [...asked].filter((k) => !bases.has(k) && /\p{L}/u.test(k)).sort()) table[key] = ''
for (const base of [...bases].sort()) for (const cat of pluralCategories(locale)) table[`${base}_${cat}`] = ''
writeFileSync(path.join(localesDir, `${code}.json`), JSON.stringify(table, null, 2) + '\n')

const glossaryDir = path.join(localesDir, 'glossary')
mkdirSync(glossaryDir, { recursive: true })
const glossary = path.join(glossaryDir, `${code}.md`)
if (!existsSync(glossary)) writeFileSync(glossary, readFileSync(path.join(glossaryDir, '_template.md'), 'utf8').replaceAll('<code>', code).replaceAll('<name>', name))

console.log(`Added ${code} (${name}): ${Object.keys(table).length} empty lines in locales/${code}.json, a glossary in locales/glossary/${code}.md,
and a line in lib/languages.ts marked hidden (not in the pickers yet).
Next: fill the glossary, translate the lines, run \`pnpm i18n:check\` until nothing is missing, set openEnd to the word for "now" in ranges
(it must equal the line "now"), then remove \`hidden: true\`. Machine translation stays 'needs-review'.`)
