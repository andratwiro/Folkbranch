// What the i18n scripts share: reading the locale files and finding the phrases the code asks for.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const localesDir = path.join(root, 'locales')
export type Table = Record<string, string>

export const readTable = (code: string): Table => {
  const file = path.join(localesDir, `${code}.json`)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
}

/** Keys that appear twice in one file: JSON.parse keeps the last, silently. The files are written one entry to a line. */
export function duplicateKeys(code: string): string[] {
  const file = path.join(localesDir, `${code}.json`)
  if (!existsSync(file)) return []
  const seen = new Set<string>()
  const dup: string[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^ {2}("(?:[^"\\]|\\.)*"):/.exec(line)
    if (!m) continue
    const key = JSON.parse(m[1]) as string
    if (seen.has(key)) dup.push(key)
    seen.add(key)
  }
  return dup
}

export const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    if (name === 'node_modules' || name === '.next') return []
    if (statSync(p).isDirectory()) return walk(p)
    return /\.tsx?$/.test(name) ? [p] : []
  })

/** The functions whose first string argument (after the language, for translate) is a phrase. */
const PHRASE_CALLS: Record<string, number> = { t: 0, tr: 0, tell: 0, say: 0, translate: 1, translatePair: 2, i18n: 0 }

export type Call = { file: string; line: number; name: string; key: string | null; text: string }
export type Scan = {
  /** Literal phrases asked for by a call. */
  calls: Call[]
  /** Calls whose phrase is not a literal: the extractor cannot see them. */
  nonLiteral: Call[]
  /** Every string literal in the code, to tell which locale lines are still used. */
  literals: Set<string>
}

/** Reads app/, components/ and lib/ (not tests, not the codemod's inputs) and lists the phrases the code asks for. */
export function scanSources(): Scan {
  const calls: Call[] = []
  const nonLiteral: Call[] = []
  const literals = new Set<string>()
  for (const abs of ['app', 'components', 'lib'].flatMap((d) => walk(path.join(root, d)))) {
    const rel = path.relative(root, abs)
    if (rel === 'lib/i18n-legacy.ts' || rel === 'lib/i18n.ts') continue
    const source = readFileSync(abs, 'utf8')
    const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.Latest, true, abs.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (n: ts.Node) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) literals.add(n.text)
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text in PHRASE_CALLS) {
        const name = n.expression.text
        const arg = n.arguments[PHRASE_CALLS[name]]
        // `t` is also a variable in math and in tests of other code: only a call with an argument that could be a phrase counts.
        if (arg) {
          const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
          const where = { file: rel, line, name, text: n.getText(sf).slice(0, 100) }
          if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) calls.push({ ...where, key: arg.text })
          else if (!(ts.isNumericLiteral(arg)) && name !== 'translatePair') nonLiteral.push({ ...where, key: null })
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return { calls, nonLiteral, literals }
}

/** {name}, {count}, ${x}, %s: what the code fills in, sorted. */
export const slots = (s: string) => [...s.matchAll(/\$?\{[^{}]*\}|%[sd]/g)].map((m) => m[0]).sort()
/** The «guillemets» a phrase carries: a translation keeps those its English has (the English may write its own quotes “like this”). */
export const quotes = (s: string) => [...s].filter((c) => '«»'.includes(c)).length

/** The plural categories a language needs, from its own rules. */
export const pluralCategories = (locale: string) => new Intl.PluralRules(locale).resolvedOptions().pluralCategories

/** A key is a plural form when its base is another key: "{count} years_one". */
export const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

/**
 * Every phrase the code asks for: the literal phrase of a call, every string in the code that is a known phrase (data tables whose
 * words reach t() later), and the English key of each Russian phrase an archive holds (lib/i18n-legacy.ts).
 */
export function askedPhrases(scan: Scan): Set<string> {
  const known = new Set([...Object.keys(readTable('ru')), ...Object.keys(readTable('en'))])
  const asked = new Set<string>(scan.calls.map((c) => c.key!))
  for (const l of scan.literals) if (known.has(l)) asked.add(l)
  for (const m of readFileSync(path.join(root, 'lib/i18n-legacy.ts'), 'utf8').matchAll(/^ {2}"(?:[^"\\]|\\.)*": ("(?:[^"\\]|\\.)*"),$/gm)) asked.add(JSON.parse(m[1]))
  return asked
}
