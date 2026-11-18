// Proves the English-source codemod changed no word: every phrase, in every language it had (Russian, English, Spanish, Catalan),
// reads exactly as the old tables made it read, and the counted nouns agree for every number.
//
//   node --disable-warning=ExperimentalWarning --import ./scripts/ts-register.mjs scripts/i18n-parity.ts
//
// Inputs: scripts/legacy/{en,es,ca}.ts (the old tables), scripts/legacy/keys.json (old Russian key → new key, written by the codemod).
// Exits 1 on the first kind of difference and lists them.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { translate, translatePair } from '../lib/i18n'
import { ageWords, familyWords, peopleWords } from '../lib/names'
import { eventWords, generationWords } from '../lib/map-scrub'
import type { Lang } from '../lib/languages'
import { pairsOf } from './i18n-pairs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const old = { en: (await import('./legacy/en')).default, es: (await import('./legacy/es')).default, ca: (await import('./legacy/ca')).default } as Record<string, Record<string, string>>
const added = JSON.parse(readFileSync(path.join(root, 'scripts/i18n-added.json'), 'utf8')) as Record<string, Record<string, string>>
const keys: [string, string, string][] = JSON.parse(readFileSync(path.join(root, 'scripts/legacy/keys.json'), 'utf8'))

const problems: string[] = []
// Russian lines reworded in plain words since the codemod (no technical terms on screen); the key is the English phrase.
const reworded: Record<string, string> = {
  'Money is only what the provider itself stated. Where it states no price, you see the number of requests; the sum is in its account.': 'Деньги — только те, что назвал сам сервис. Где он цену не сообщает, видно число запросов, а сумму смотрите в его кабинете.',
  'Providers and API keys': 'Сервисы и ключи',
  'Server URL': 'Адрес сервера',
  'Create an access token': 'Создать ключ доступа',
  'The provider could not find the model set on the server. Set another in AGENT_MODEL and restart the server': 'Сервис не нашёл модель из настроек сервера. Укажите другую в AGENT_MODEL и перезапустите сервер',
}
let compared = 0
let pruned = 0
const ruFile = JSON.parse(readFileSync(path.join(root, 'locales/ru.json'), 'utf8')) as Record<string, string>
for (const [ru, id, text] of keys) {
  // A line the old tables had but nothing in the code asked for was removed (`pnpm i18n:check --prune`).
  if (!(id in ruFile)) { pruned++; continue }
  for (const lang of ['ru', 'en', 'es', 'ca'] as Lang[]) {
    // Old rule: Russian is the key; English falls back to the key; Spanish and Catalan to English. A pair kept beside its code (only English given) has no English table line.
    const was = lang === 'en' ? text : lang === 'ru' ? ru : (old[lang][ru] ?? text)
    const now = translate(lang, id)
    compared++
    // A Spanish or Catalan line written since (the assistant's step names had no line and showed English) is an improvement, not a change.
    if ((lang === 'es' || lang === 'ca') && was === text && added[lang]?.[id] === now) continue
    if (lang === 'ru' && reworded[id] === now) continue
    if (was !== now) problems.push(`${lang} "${ru}": was "${was}", now "${now}" (key "${id}")`)
  }
}

// translatePair(lang, ru, en) now looks the English up as a key: that holds only while the pair's key is its English.
for (const [ru, en] of pairsOf(root)) {
  if (!keys.some(([r, i]) => r === ru && i === en)) problems.push(`pair "${ru}" / "${en}" has no key of its own`)
  for (const lang of ['ru', 'en', 'es', 'ca'] as Lang[]) {
    const was = lang === 'ru' ? ru : lang === 'en' ? en : (old[lang][ru] ?? en)
    compared++
    const now = translatePair(lang, ru, en)
    if ((lang === 'es' || lang === 'ca') && was === en && added[lang]?.[en] === now) continue
    if (now !== was) problems.push(`pair ${lang} "${ru}" / "${en}": was "${was}", now "${now}"`)
  }
}

// The counted nouns, as the old code wrote them.
const ruForm = (n: number, one: string, few: string, many: string) => { const a = n % 100, b = n % 10; return a >= 11 && a <= 14 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many }
const two = (n: number, [one, many]: [string, string]) => `${n} ${n === 1 ? one : many}`
const OTHER = {
  en: { year: ['year', 'years'], person: ['person', 'people'], family: ['family', 'families'], event: ['event', 'events'], generation: ['generation', 'generations'] },
  es: { year: ['año', 'años'], person: ['persona', 'personas'], family: ['familia', 'familias'], event: ['hecho', 'hechos'], generation: ['generación', 'generaciones'] },
  ca: { year: ['any', 'anys'], person: ['persona', 'persones'], family: ['família', 'famílies'], event: ['fet', 'fets'], generation: ['generació', 'generacions'] },
} as Record<string, Record<string, [string, string]>>
const RU = {
  year: (n: number) => `${n} ${(() => { const a = n % 100, b = n % 10; return a >= 11 && a <= 14 ? 'лет' : b === 1 ? 'год' : b >= 2 && b <= 4 ? 'года' : 'лет' })()}`,
  person: (n: number) => `${n} ${ruForm(n, 'человек', 'человека', 'человек')}`,
  family: (n: number) => `${n} ${ruForm(n, 'семья', 'семьи', 'семей')}`,
  event: (n: number) => `${n} ${ruForm(n, 'событие', 'события', 'событий')}`,
  generation: (n: number) => `${n} ${ruForm(n, 'поколение', 'поколения', 'поколений')}`,
}
const NOW = { year: ageWords, person: peopleWords, family: familyWords, event: eventWords, generation: generationWords }
let counted = 0
for (const lang of ['ru', 'en', 'es', 'ca'] as Lang[])
  for (const word of ['year', 'person', 'family', 'event', 'generation'] as const)
    for (let n = 0; n <= 1200; n++) {
      const was = lang === 'ru' ? RU[word](n) : two(n, OTHER[lang][word])
      const now = NOW[word](n, lang)
      counted++
      if (was !== now) problems.push(`${lang} ${word} ${n}: was "${was}", now "${now}"`)
    }

console.log(`${compared} phrase lines compared (${keys.length - pruned} phrases the code still asks for, in 4 languages; ${pruned} lines no code asked for were pruned), ${counted} counted nouns compared`)
if (problems.length) {
  console.error(`${problems.length} differences:\n${problems.slice(0, 80).join('\n')}`)
  process.exit(1)
}
console.log('Every phrase and every counted noun reads exactly as before.')
