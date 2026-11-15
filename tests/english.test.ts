// The repository is in English. Russian lives in the Russian readme and guide (*.ru.md) and in strings: the Russian
// interface, and the Russian names, words and phrases the app has to understand. Comments and docs are English.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const CYRILLIC = /[\u0400-\u04FF]/
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => fs.existsSync(f))
const CODE = /\.(ts|tsx|mjs|js|cjs|sh|ps1|yml|yaml|css)$/
const DOCS = /\.md$/

/** Lines with Cyrillic outside string, template and regular expression literals: in a comment, or in code itself. */
export function cyrillicOutsideStrings(text: string) {
  const bad = new Set<number>()
  let line = 1, i = 0
  const n = text.length
  // After one of these, a slash starts a regular expression rather than a division.
  const regexBefore = /[(,=:[!&|?{};+\-*%<>~^]$|^$|\b(return|typeof|case|in|of)$/
  let last = ''
  const skipTo = (end: string) => { while (i < n && text[i] !== end) { if (text[i] === '\\') i++; else if (text[i] === '\n') line++; i++ } i++ }
  // A template literal may hold ${…} with strings and templates of its own inside.
  const skipTemplate = (): void => {
    while (i < n && text[i] !== '`') {
      if (text[i] === '\\') { i += 2; continue }
      if (text[i] === '\n') line++
      if (text.startsWith('${', i)) {
        i += 2
        let depth = 1
        while (i < n && depth) {
          const d = text[i]
          if (d === '`') { i++; skipTemplate(); continue }
          if (d === '"' || d === "'") { i++; skipTo(d); continue }
          if (d === '\n') line++
          if (d === '{') depth++
          if (d === '}') depth--
          i++
        }
        continue
      }
      i++
    }
    i++
  }
  // Russian quoted inside a comment is an example of data: "Соколовы", «дед», `иван`.
  const unquoted = (comment: string) => comment.replace(/"[^"]*"|«[^»]*»|`[^`]*`/g, '')
  while (i < n) {
    const c = text[i]
    if (c === '\n') { line++; i++; continue }
    if (text.startsWith('//', i) || (c === '#' && /(^|\n)[ \t]*$/.test(text.slice(Math.max(0, i - 80), i)))) {
      const eol = text.indexOf('\n', i)
      const comment = text.slice(i, eol < 0 ? n : eol)
      if (CYRILLIC.test(unquoted(comment))) bad.add(line)
      i = eol < 0 ? n : eol
      continue
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      const body = text.slice(i, end < 0 ? n : end)
      body.split('\n').forEach((l, k) => { if (CYRILLIC.test(unquoted(l))) bad.add(line + k) })
      line += body.split('\n').length - 1
      i = end < 0 ? n : end + 2
      continue
    }
    if (c === '`') { i++; skipTemplate(); last = 'x'; continue }
    if (c === '"' || c === "'") { i++; skipTo(c); last = 'x'; continue }
    // A Russian word as an object key is data too: { отец: 'father' }.
    const key = /^[\u0400-\u04FF][\u0400-\u04FF\w]*(?=\s*:)/.exec(text.slice(i, i + 40))
    if (key) { i += key[0].length; last = 'x'; continue }
    if (c === '/' && regexBefore.test(last.trimEnd())) {
      i++
      let cls = false
      while (i < n && text[i] !== '\n' && (cls || text[i] !== '/')) { if (text[i] === '\\') i++; else if (text[i] === '[') cls = true; else if (text[i] === ']') cls = false; i++ }
      i++
      last = 'x'
      continue
    }
    if (/[\u0400-\u04FF]/.test(c)) bad.add(line)
    if (!/\s/.test(c)) last = (last + c).slice(-12); else last += c
    i++
  }
  return [...bad]
}

describe('the repository is in English', () => {
  it('in documentation, except the Russian readme and guides', () => {
    const bad = files.filter((f) => DOCS.test(f) && !f.endsWith('.ru.md') && CYRILLIC.test(fs.readFileSync(f, 'utf8')
      // A Russian example of what a person types may be quoted: «…», "…" or `…`.
      .replace(/«[^»\n]*»|"[^"\n]*"|`[^`\n]*`/g, '')
      // A link to the Russian version is named in Russian, as people look for it.
      .replace(/\[[^\]]*\]\([^)]*\.ru\.md\)/g, '')))
    expect(bad).toEqual([])
  })
  it('in comments and code, while strings may hold Russian', () => {
    const bad = files.filter((f) => CODE.test(f) && f !== 'lib/i18n.ts').flatMap((f) => cyrillicOutsideStrings(fs.readFileSync(f, 'utf8')).map((n) => `${f}:${n}`))
    expect(bad).toEqual([])
  })
  it('the check notices a Russian comment', () => {
    expect(cyrillicOutsideStrings("const a = 'Иван' // имя")).toEqual([1])
    expect(cyrillicOutsideStrings("/* заметка */\nconst b = `Мария`")).toEqual([1])
    expect(cyrillicOutsideStrings("t('Сохранить')\n# shell, no Russian")).toEqual([])
  })
})
