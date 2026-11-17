// Makes English the source language: the key of a phrase becomes its English text, and Russian becomes a locale file like the others.
//
//   node --disable-warning=ExperimentalWarning --import ./scripts/ts-register.mjs scripts/i18n-codemod.ts [--write]
//
// Input:  scripts/legacy/{en,es,ca}.ts (the old tables, key = Russian text), the [Russian, English] pairs of lib/gedcom.ts and
//         lib/agent/labels.ts, and scripts/i18n-contexts.json (which Russian phrases share an English text).
// Output: locales/{en,ru,es,ca}.json, and every Russian key in app/, components/, lib/ and tests/ rewritten to its English key.
//
// Afterwards run `pnpm i18n:check --prune` to drop the old tables' lines that nothing in the code asks for.
// It is safe to run again on a tree where other branches added Russian phrases: put their versions of the old tables into
// scripts/legacy/, run it, and the new phrases move over too. A run without --write only reports.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { PAIR_FILES, pairsOf } from './i18n-pairs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const write = process.argv.includes('--write')
const cyrillic = /[А-Яа-яЁё]/

const load = async (name: string): Promise<Record<string, string>> => (await import(path.join(root, 'scripts/legacy', `${name}.ts`))).default
const enOld = await load('en')
const esOld = await load('es')
const caOld = await load('ca')
const contexts: Record<string, string> = JSON.parse(readFileSync(path.join(root, 'scripts/i18n-contexts.json'), 'utf8'))
delete contexts._note

/** The [Russian, English] pairs that sit beside the code in these files: the English is their key (translatePair looks it up). */
const pairList = pairsOf(root)

// One key per (Russian, English) meaning. Its id is the English text, plus a context when another phrase already took that English.
type Key = { ru: string; text: string; context?: string; id: string }
const keys = new Map<string, Key>() // by the Russian phrase, as the t() calls and the data literals use it
const pairKeys = new Map<string, Key>() // by Russian + English, as translatePair uses it
const byId = new Map<string, Key>()
const problems: string[] = []
const add = (ru: string, en: string, role: string): Key | undefined => {
  const same = [...byId.values()].find((k) => k.ru === ru && k.text === en)
  if (same) return same
  const taken = byId.get(en)
  let key: Key
  if (!taken) key = { ru, text: en, id: en }
  else if (contexts[ru] && !byId.has(`${en}_${contexts[ru]}`)) key = { ru, text: en, context: contexts[ru], id: `${en}_${contexts[ru]}` }
  else {
    problems.push(`${role} "${ru}" has the same English as "${taken.ru}" ("${en}"): add it to scripts/i18n-contexts.json`)
    return undefined
  }
  byId.set(key.id, key)
  return key
}
// Pairs first: their key must be exactly their English, so translatePair(lang, ru, en) can find it without knowing the Russian.
for (const [ru, en] of pairList) {
  const k = add(ru, en, 'pair')
  if (k) pairKeys.set(`${ru}\u0000${en}`, k)
}
for (const [ru, en] of Object.entries(enOld)) {
  const k = add(ru, en, 'phrase')
  if (k) keys.set(ru, k)
}
// A Russian word kept only in a pair still answers a plain t('…') with the pair's key.
for (const [ru] of pairList) if (!keys.has(ru)) keys.set(ru, [...byId.values()].find((k) => k.ru === ru)!)
for (const ru of Object.keys(contexts)) if (!byId.size || ![...byId.values()].some((k) => k.ru === ru)) problems.push(`scripts/i18n-contexts.json names "${ru}", which is not a phrase`)
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}

// Locale files. English holds only what differs from the key (plural forms, added by hand); the rest read from the key.
// A Spanish or Catalan line follows the Russian: a pair with no line of its own for that Russian stays English.
const table = (old: Record<string, string>) => {
  const out: Record<string, string> = {}
  for (const k of byId.values()) if (old[k.ru] !== undefined) out[k.id] = old[k.ru]
  return out
}
const ruFile: Record<string, string> = {}
for (const k of byId.values()) ruFile[k.id] = k.ru
const outDir = path.join(root, 'locales')
const added: Record<string, Record<string, string>> = JSON.parse(readFileSync(path.join(root, 'scripts/i18n-added.json'), 'utf8'))
const files: [string, Record<string, string>][] = [['ru', { ...ruFile, ...added.ru }], ['es', { ...table(esOld), ...added.es }], ['ca', { ...table(caOld), ...added.ca }]]

// Rewriting the sources.
const SKIP = new Set(['lib/i18n.ts', 'lib/i18n-load.ts', 'lib/i18n-errors.ts'])
// Russian here is data matched against what people typed or older archives hold, or Russian grammar handled by the plural and kinship work: left as it is.
const DATA = new Set(['lib/ops/registry.ts', 'lib/import-formats.ts', 'lib/textformat.ts', 'lib/markdown.ts', 'lib/names.ts', 'lib/map-scrub.ts', 'lib/kinship.ts', 'lib/kinship-case.ts', 'lib/kinship-words.ts', 'lib/kinship-es.ts', 'lib/kinship-ca.ts', 'lib/demo.ts'])
const CALLS = new Set(['t', 'translate', 'translatePair', 'tr'])
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    if (name === 'node_modules' || name === '.next') return []
    if (statSync(p).isDirectory()) return walk(p)
    return /\.tsx?$/.test(name) ? [p] : []
  })

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`

/**
 * A Russian literal the code picks for Russian readers by itself — `ru: '…'` in a per-language object, or the Russian branch of
 * `lang === 'ru' ? '…' : '…'` — is the Russian text, not a key: it stays.
 */
function languageSpecific(n: ts.Node): boolean {
  const p = n.parent
  // Anywhere inside the value of a `ru:` property (through objects and arrays, not through functions).
  for (let a: ts.Node | undefined = n.parent; a && (ts.isObjectLiteralExpression(a) || ts.isArrayLiteralExpression(a) || ts.isPropertyAssignment(a) || ts.isParenthesizedExpression(a)); a = a.parent)
    if (ts.isPropertyAssignment(a) && (ts.isIdentifier(a.name) ? a.name.text : ts.isStringLiteral(a.name) ? a.name.text : '') === 'ru') return true
  if (p && ts.isConditionalExpression(p)) {
    const c = p.condition.getText()
    if (/(===|==)\s*['"]ru['"]/.test(c) && p.whenTrue === n) return true
    if (/(!==|!=)\s*['"]ru['"]/.test(c) && p.whenFalse === n) return true
  }
  if (p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && p.right === n && /===\s*['"]ru['"]/.test(p.left.getText())) return true
  return false
}

/** Russian lists whose values are stored in people's archives (roles, kinds of place): they stay Russian, and display looks them up through lib/i18n-legacy.ts. */
const STORED = new Set(['ROLES', 'PLACE_KINDS', 'KINDS'])
// Files whose Russian is the stored form throughout (kinds of fact and their roles, with an identity `t` by default): nothing in them is rewritten.
const STORED_FILES = new Set(['lib/fact-kinds.ts'])
const isStored = (n: ts.Node) => {
  for (let a: ts.Node | undefined = n.parent; a; a = a.parent) if (ts.isVariableDeclaration(a) && ts.isIdentifier(a.name) && STORED.has(a.name.text)) return true
  return false
}

const kept: string[] = []
const left = new Set<string>()
let replaced = 0
const manual: string[] = []
const changes: { file: string; from: string; to: string }[] = []

for (const abs of ['app', 'components', 'lib', 'tests'].flatMap((d) => (existsSync(path.join(root, d)) ? walk(path.join(root, d)) : []))) {
  const rel = path.relative(root, abs)
  if (SKIP.has(rel)) continue
  const storedFile = STORED_FILES.has(rel)
  const source = readFileSync(abs, 'utf8')
  if (!cyrillic.test(source)) continue
  const isTest = rel.startsWith('tests/')
  const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.Latest, true, abs.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const edits: { start: number; end: number; text: string }[] = []
  let needTranslate = false

  const literalValue = (n: ts.Node) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : undefined)
  const emit = (n: ts.Node, text: string) => {
    const inAttribute = n.parent && ts.isJsxAttribute(n.parent)
    edits.push({ start: n.getStart(sf), end: n.getEnd(), text: inAttribute ? `{${quote(text)}}` : quote(text) })
  }

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && CALLS.has(n.expression.text)) {
      const name = n.expression.text
      // translate(lang, key) and translatePair(lang, ru, en) carry the language first; t(key) does not.
      const at = name === 'translate' || name === 'translatePair' ? 1 : 0
      const arg = n.arguments[at]
      const value = arg && literalValue(arg)
      const k = value !== undefined ? (name === 'translatePair' ? pairKeys.get(`${value}\u0000${n.arguments[2] && literalValue(n.arguments[2])}`) : keys.get(value)) : undefined
      if (arg && value !== undefined && k && cyrillic.test(value)) {
        if (storedFile) left.add(value)
        if (name === 'translatePair') {
          // translatePair(lang, ru, en) → translate(lang, en): the Russian is the English key's value in locales/ru.json.
          const en = n.arguments[2]
          edits.push({ start: n.expression.getStart(sf), end: n.expression.getEnd(), text: 'translate' })
          needTranslate = true
          edits.push({ start: arg.getStart(sf), end: n.arguments[2] ? n.arguments[2].getEnd() : arg.getEnd(), text: quote(k.id) })
          if (!en) manual.push(`${rel}: translatePair with one argument`)
        } else emit(arg, k.id)
        changes.push({ file: rel, from: value, to: k.id })
        replaced++
        return
      }
    }
    if (!isTest && !PAIR_FILES.includes(rel)) {
      const value = literalValue(n)
      if (value !== undefined && cyrillic.test(value)) {
        const k = keys.get(value)
        if (k && (DATA.has(rel) || rel.startsWith('lib/search/'))) {
          left.add(value)
          return
        }
        if (k && isStored(n)) {
          left.add(value)
          return
        }
        if (k && languageSpecific(n)) {
          kept.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: "${value}"`)
          ts.forEachChild(n, visit)
          return
        }
        // Not inside an import/export or a type position; and not an object-literal key, which stays a Russian name.
        if (k && !(n.parent && (ts.isPropertyAssignment(n.parent) && n.parent.name === n)) && !(n.parent && ts.isImportDeclaration(n.parent))) {
          emit(n, k.id)
          changes.push({ file: rel, from: value, to: k.id })
          replaced++
        } else if (k) {
          left.add(value)
        } else if (!k) {
          // Only a phrase of the app counts here; names and other Russian data stay untouched.
        } else if (n.parent && ts.isPropertyAssignment(n.parent) && n.parent.name === n) manual.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: "${value}" is an object key`)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  if (storedFile) edits.length = 0
  if (!edits.length) continue
  edits.sort((a, b) => b.start - a.start)
  let out = source
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  if (needTranslate && !/\btranslate\b[^\n]*from '[^']*\/i18n'|import \{[^}]*\btranslate\b[^}]*\} from '[^']*i18n'/.test(out)) {
    // translatePair became translate: the file must import it from the same place.
    out = out.replace(/import \{([^}]*)\} from '([^']*i18n)'/, (_m, names: string, from: string) => `import {${names.replace(/\s+$/, '')}, translate } from '${from}'`)
  }
  if (write) writeFileSync(abs, out)
}

if (write) {
  mkdirSync(outDir, { recursive: true })
  // English reads from the key itself; only the keys that carry a context (and plural forms, added by hand) need a line.
  const enPath = path.join(outDir, 'en.json')
  const enFile: Record<string, string> = existsSync(enPath) ? JSON.parse(readFileSync(enPath, 'utf8')) : {}
  for (const k of byId.values()) if (k.context) enFile[k.id] = k.text
  Object.assign(enFile, added.en)
  writeFileSync(enPath, JSON.stringify(enFile, null, 2) + '\n')
  for (const [code, data] of files) writeFileSync(path.join(outDir, `${code}.json`), JSON.stringify(data, null, 2) + '\n')
}
writeFileSync(path.join(root, 'scripts/legacy/keys.json'), JSON.stringify([...byId.values()].map((k) => [k.ru, k.id, k.text]), null, 1) + '\n')
console.log(`${byId.size} phrases; ${replaced} places ${write ? 'rewritten' : 'would be rewritten'}; locales: ${files.map(([c, d]) => `${c} ${Object.keys(d).length}`).join(', ')}`)
// A Russian word of a pair is stored in archives imported in Russian: it finds its key too.
for (const [ru] of pairList) left.add(ru)
if (write) {
  const rows = [...left].sort().map((ru) => `  ${JSON.stringify(ru)}: ${JSON.stringify(keys.get(ru)!.id)},`)
  writeFileSync(path.join(root, 'lib/i18n-legacy.ts'), `// Russian phrases still written in the code because archives hold them (roles, kinds of place, kinds of fact): a lookup\n// of one finds the phrase's English key. Written by scripts/i18n-codemod.ts; do not edit by hand.\nexport const LEGACY: Record<string, string> = {\n${rows.join('\n')}\n}\n`)
}
if (kept.length) console.log(`Kept as Russian (a per-language branch):\n${kept.join('\n')}`)
if (manual.length) console.log(`Needs a hand:\n${manual.join('\n')}`)
