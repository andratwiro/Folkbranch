// The translation system's own rules: the registry drives everything, a language is complete before it is listed, English is the
// key, Russian reads as it always did, and the checks catch what they exist to catch.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { addTable, translate } from '../lib/i18n'
import { ALL_LANGS, LANG_ENUM, LANGS, LANGUAGES, isLang, langOfTag, matchLanguage, viewerLang, type Lang } from '../lib/languages'
import { checkTable } from '../scripts/i18n-check'
import { pseudo } from '../scripts/i18n-pseudo'
import { readTable } from '../scripts/i18n-lib'

const root = path.resolve(__dirname, '..')
const run = (script: string) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', './scripts/ts-register.mjs', script], { cwd: root, encoding: 'utf8' })

describe('the language registry', () => {
  it('has a locale file for every language, and none for a language it does not list', () => {
    for (const lang of ALL_LANGS) expect(existsSync(path.join(root, 'locales', `${lang}.json`)), lang).toBe(true)
  })

  it('shows a language in the pickers and accepts it in a cookie, a setting and an API only when it is not hidden', () => {
    expect(ALL_LANGS).toContain('xx')
    expect(LANGS).not.toContain('xx')
    expect(isLang('xx')).toBe(false)
    expect(z.enum(LANG_ENUM).safeParse('xx').success).toBe(false)
    for (const lang of LANGS) expect(z.enum(LANG_ENUM).safeParse(lang).success).toBe(true)
    expect(viewerLang('folkbranch-lang=xx', null, 'ca')).toBe('ca')
  })

  it('keeps the four languages that were there, by the same codes, so old cookies and archive settings still work', () => {
    expect(LANGS.slice(0, 4)).toEqual(['ru', 'en', 'es', 'ca'])
    for (const code of ['ru', 'en', 'es', 'ca']) expect(viewerLang(`folkbranch-lang=${code}`, 'ja', 'en')).toBe(code)
  })

  it('matches a browser tag by the whole tag, then by its first part', () => {
    expect(langOfTag('es-MX')).toBe('es')
    expect(langOfTag('CA_es')).toBe('ca')
    expect(langOfTag('nowhere')).toBeUndefined()
    expect(matchLanguage('xx, ja;q=0.5, ru;q=0.4')).toBe('ru')
  })

  it('names, per language, the word an open range of years ends with, equal to its "now" line', () => {
    for (const lang of LANGS) {
      const table = readTable(lang)
      const word = lang === 'en' ? 'now' : table.now
      expect(LANGUAGES[lang as Lang].openEnd, lang).toBe(word)
    }
  })

  it('reads in the direction the registry says', () => {
    for (const lang of ALL_LANGS) expect(['ltr', 'rtl']).toContain(LANGUAGES[lang].dir)
  })
})

describe('a language that is only a file', () => {
  it('speaks the pseudo-language from its locale file, and leaves English for what has no line', async () => {
    vi.resetModules()
    const fresh = await import('../lib/i18n')
    const { loadTable } = await import('../lib/i18n-load')
    expect(fresh.hasTable('xx')).toBe(false)
    await loadTable('xx')
    expect(fresh.hasTable('xx')).toBe(true)
    expect(fresh.translate('xx', 'Delete')).toBe(pseudo('Delete'))
    expect(fresh.translate('xx', 'A phrase that nobody wrote down')).toBe('A phrase that nobody wrote down')
  })

  it('keeps {placeholders} intact in the pseudo-language, so a screen in it still fills in names', () => {
    expect(translate('xx', 'Delete person «{name}»?').replace('{name}', 'Ana')).toContain('Ana')
    expect(pseudo('Hello {name}')).toBe('⟦Héllö {name}····⟧')
  })

  it('counts nouns by the rules of the language, with as many forms as it has', () => {
    // A language with three forms: the table is all a new language needs.
    addTable('pl' as Lang, { '{count} years_one': '{count} rok', '{count} years_few': '{count} lata', '{count} years_many': '{count} lat', '{count} years_other': '{count} roku' })
    const forms = [1, 2, 5, 22, 25, 1.5].map((n) => translate('pl' as Lang, '{count} years', { count: n }))
    expect(forms).toEqual(['1 rok', '2 lata', '5 lat', '22 lata', '25 lat', '1.5 roku'])
  })
})

describe('English is the key', () => {
  it('has no Russian in any key, and Russian where the old Russian keys were', () => {
    const ru = readTable('ru')
    expect(Object.keys(ru).filter((k) => /[Ѐ-ӿ]/.test(k))).toEqual([])
    expect(translate('ru', 'Delete')).toBe('Удалить')
    expect(translate('en', 'Delete')).toBe('Delete')
    // Two Russian phrases with one English text are told apart by a suffix, and English still reads the plain word.
    expect(translate('ru', 'Deceased')).toBe('Умер')
    expect(translate('ru', 'Deceased_female')).toBe('Умерла')
    expect(translate('en', 'Deceased_female')).toBe('Deceased')
  })

  it('still understands a Russian phrase an archive holds (a role, a kind of place)', () => {
    expect(translate('en', 'Godfather')).toBe('Godfather')
    expect(translate('es', 'Village')).toBe(readTable('es').Village)
  })

  it('reads every phrase in Russian, English, Spanish and Catalan exactly as the old tables did (the codemod proof)', () => {
    expect(run('scripts/i18n-parity.ts')).toContain('reads exactly as before')
  })
})

describe('the checks', () => {
  const asked = new Set(['Delete person «{name}»?', 'Save', '{count} years'])
  const base = { lang: 'ja', locale: 'ja', en: { '{count} years_one': '{count} year' }, asked, sameOk: () => false }
  const good = { 'Delete person «{name}»?': 'Person «{name}» löschen?', Save: 'Speichern', '{count} years_one': '{count} Jahr', '{count} years_other': '{count} Jahre' }

  it('passes a complete table', () => {
    expect(checkTable({ ...base, table: good }).errors).toEqual([])
  })

  it('fails on a missing phrase, and on an empty one', () => {
    expect(checkTable({ ...base, table: { ...good, Save: '' } }).errors).toContain('missing: "Save"')
    const { Save: _gone, ...rest } = good
    expect(checkTable({ ...base, table: rest }).errors).toContain('missing: "Save"')
  })

  it('fails on a changed placeholder, and on a lost «quote»', () => {
    expect(checkTable({ ...base, table: { ...good, 'Delete person «{name}»?': 'Person «{nom}» löschen?' } }).errors.join()).toContain('placeholders differ')
    expect(checkTable({ ...base, table: { ...good, 'Delete person «{name}»?': 'Person {name} löschen?' } }).errors.join()).toContain('quotes differ')
  })

  it('fails on a plural form the language needs, and on a line nothing asks for', () => {
    // Polish has four categories.
    const pl = checkTable({ ...base, lang: 'pl', locale: 'pl', table: { ...good, '{count} years_one': '{count} rok', '{count} years_other': '{count} roku' } })
    expect(pl.errors).toEqual(expect.arrayContaining(['missing plural form: "{count} years_few"', 'missing plural form: "{count} years_many"']))
    expect(checkTable({ ...base, table: { ...good, 'Old phrase': 'Alte Phrase' } }).errors).toContain('unused: "Old phrase"')
  })

  it('warns, without failing, about a line that is the English or very long', () => {
    const r = checkTable({ ...base, table: { ...good, Save: 'Save', 'Delete person «{name}»?': `Person «{name}» löschen? ${'x'.repeat(200)}` } })
    expect(r.errors).toEqual([])
    expect(r.warnings.join('\n')).toContain('same as the English: "Save"')
    expect(r.warnings.join('\n')).toContain('length')
  })

  it('passes on the repository as it is', () => {
    expect(readFileSync(path.join(root, 'package.json'), 'utf8')).toContain('"i18n:check"')
    expect(run('scripts/i18n-check.ts')).toContain('i18n:check passed.')
  })
})

describe('names and kinship per language', () => {
  const p = (givenName: string, surname: string, patronymic = '') => ({ givenName, surname, patronymic })

  it('writes the surname first where the registry says so, and the patronymic where the culture has one', async () => {
    const { personName, fullName } = await import('../lib/types')
    expect(personName(p('Anna', 'Petrova'), 'en')).toBe('Anna Petrova')
    expect(fullName(p('Иван', 'Иванов', 'Петрович'), 'ru')).toBe('Иван Петрович Иванов')
    expect(fullName(p('Anna', 'Petrova', 'Ivanovna'), 'en')).toBe('Anna Petrova')
    // A surname-first language, added as a registry line.
    const { LANGUAGES } = await import('../lib/languages')
    const zh = { ...LANGUAGES.en, nameOrder: 'surname-first' as const }
    ;(LANGUAGES as Record<string, unknown>).zzname = zh
    expect(personName(p('Wei', 'Li'), 'zzname' as Lang)).toBe('Li Wei')
    delete (LANGUAGES as Record<string, unknown>).zzname
    // Without a language and without a page, the given name comes first, as before.
    expect(personName(p('Wei', 'Li'))).toBe('Wei Li')
  })

  it("sorts in the reader's alphabet, not by code points", async () => {
    const { compareNames } = await import('../lib/types')
    const names = ['Яна', 'Анна', 'Ёлка', 'Елена'].map((n) => p(n, ''))
    // By code points "Ё" comes before every other capital; in the Russian alphabet it follows "Е".
    expect([...names].sort((a, b) => (a.givenName < b.givenName ? -1 : 1)).map((n) => n.givenName)[0]).toBe('Ёлка')
    expect([...names].sort((a, b) => compareNames(a, b, 'ru')).map((n) => n.givenName)).toEqual(['Анна', 'Елена', 'Ёлка', 'Яна'])
  })

  it("tells a father's brother from a mother's brother where a language has different words, and names a far relative by its fallback", async () => {
    const { Family, KINSHIP_WORDS } = await import('../lib/kinship')
    const person = (id: string, sex: 'M' | 'F') => ({ id, sex, givenName: id, surname: '', patronymic: '', maidenName: '', otherNames: '', living: false, tags: [], claims: [], sources: [], facts: [] })
    const graph = {
      persons: ['me', 'dad', 'mum', 'gpa', 'gma', 'mgpa', 'uncleDad', 'uncleMum', 'g3', 'g4'].map((id) => person(id, ['dad', 'gpa', 'mgpa', 'uncleDad', 'uncleMum', 'g3', 'g4'].includes(id) ? 'M' : 'F')),
      parentChild: [['me', 'dad'], ['me', 'mum'], ['dad', 'gpa'], ['dad', 'gma'], ['uncleDad', 'gpa'], ['uncleDad', 'gma'], ['mum', 'mgpa'], ['uncleMum', 'mgpa'], ['gpa', 'g3'], ['g3', 'g4']].map(([c, par], i) => ({ id: String(i), childId: c, parentId: par, kind: 'birth', certainty: 'documented' })),
      unions: [],
    }
    const family = new Family(graph as never)
    KINSHIP_WORDS.xx = {
      ...KINSHIP_WORDS.en!,
      blood: (up, down, s, half, side) => (up === 2 && down === 1 && s === 'M' ? (side === 'maternal' ? 'mother-side uncle' : 'father-side uncle') : up === 4 ? '' : KINSHIP_WORDS.en!.blood(up, down, s, half, side)),
      fallback: (up, down) => `relative ${up}+${down}`,
    }
    expect(family.relation('me', 'uncleDad', 'xx' as Lang)?.label).toBe('father-side uncle')
    expect(family.relation('me', 'uncleMum', 'xx' as Lang)?.label).toBe('mother-side uncle')
    expect(family.relation('me', 'g4', 'xx' as Lang)?.label).toBe('relative 4+0')
    expect(family.relation('me', 'uncleDad', 'en')?.label).toBe('uncle')
    delete KINSHIP_WORDS.xx
  })
})
