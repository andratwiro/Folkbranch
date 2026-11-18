// The [Russian, English] pairs that sit beside the code (GEDCOM kinds, the assistant's step names): the English is their key.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

export const PAIR_FILES = ['lib/gedcom.ts', 'lib/agent/labels.ts']

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    if (name === 'node_modules' || name === '.next') return []
    if (statSync(p).isDirectory()) return walk(p)
    return /\.tsx?$/.test(name) ? [p] : []
  })

const Q = String.raw`(['"])((?:(?!\%N)[^\\\n])*)\%N`
const quoted = (n: number) => Q.replaceAll('%N', String(n)).replace('(?!\\' + n + ')', `(?!\\${n})`)
// a pair array in the pair files: [russian, english]
const ARRAY = new RegExp(String.raw`\[\s*` + quoted(1) + String.raw`,\s*` + quoted(3) + String.raw`\s*\]`, 'g')
// translatePair(lang, russian, english) anywhere
const CALL = new RegExp(String.raw`translatePair\(\s*[^,()]+,\s*` + quoted(1) + String.raw`,\s*` + quoted(3) + String.raw`\s*\)`, 'g')
const cyrillic = /[\u0400-\u04FF]/

/** Every distinct Russian + English pair: the arrays of PAIR_FILES, and every translatePair call that spells both out. */
export function pairsOf(root: string): [string, string][] {
  const out: [string, string][] = []
  const take = (ru: string, en: string) => { if (cyrillic.test(ru) && !out.some(([r, e]) => r === ru && e === en)) out.push([ru, en]) }
  for (const f of PAIR_FILES) for (const m of readFileSync(path.join(root, f), 'utf8').matchAll(ARRAY)) take(m[2], m[4])
  for (const d of ['app', 'components', 'lib']) for (const f of walk(path.join(root, d))) {
    const source = readFileSync(f, 'utf8')
    if (source.includes('translatePair(')) for (const m of source.matchAll(CALL)) take(m[2], m[4])
  }
  // Pairs found on an earlier run: once translatePair(lang, 'ru', 'en') is rewritten to translate(lang, 'en') the call is gone, but the phrase's Russian is not.
  const kept = path.join(root, 'scripts/legacy/pairs.json')
  if (existsSync(kept)) for (const [ru, en] of JSON.parse(readFileSync(kept, 'utf8')) as [string, string][]) take(ru, en)
  return out
}
