// Spanish and Catalan: their own words where they have them, English where they do not, and never Russian.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { getDb, schema } from '../lib/db'
import { addTable, translate } from '../lib/i18n'
import es from '../locales/es.json'
import ru from '../locales/ru.json'
import { LANG_NAMES, LANGS, langOf } from '../lib/languages'
import { say, setSetting } from '../lib/ops/app-config'
import { readableSummary } from '../lib/ops/history-text'
import { parseGedcom, writeGedcom } from '../lib/gedcom'
import { toolLabel } from '../lib/agent/labels'
import { buildAgent } from '../lib/agent/agent'
import type { Actor } from '../lib/ops/core'
import { MockLanguageModelV4 } from 'ai/test'
import type { Graph } from '../lib/types'

const cyrillic = /[А-Яа-яЁё]/

describe('a language that is not finished', () => {
  it('takes its own line first, then the English, then the key', () => {
    addTable('ca', { Delete: 'Elimina' })
    expect(translate('ca', 'Delete')).toBe('Elimina')
    expect(translate('ca', 'Save')).toBe('Save')
    expect(translate('ca', 'A phrase nobody wrote down')).toBe('A phrase nobody wrote down')
    expect(translate('ru', 'Delete')).toBe('Удалить')
    expect(translate('en', 'Delete')).toBe('Delete')
  })

  it('shows English for every word, never Russian, whatever its table holds', () => {
    const russian = LANGS.filter((l) => l !== 'ru' && l !== 'uk').flatMap((lang) => Object.keys(ru).filter((k) => cyrillic.test(translate(lang, k)) && !cyrillic.test(k)).map((k) => `${lang}: ${k}`))
    expect(russian).toEqual([])
  })

  it('loads its table once, and a finished language at once', async () => {
    // A fresh module graph, so no table has been read yet.
    vi.resetModules()
    const fresh = await import('../lib/i18n')
    const { loadTable: loadFresh } = await import('../lib/i18n-load')
    expect(fresh.hasTable('es')).toBe(false)
    await loadFresh('es')
    expect(fresh.hasTable('es')).toBe(true)
    expect(fresh.translate('es', 'Delete')).toBe((es as Record<string, string>).Delete)
    expect(loadFresh('es')).toBe(loadFresh('es'))
    // Marked as done, so React reads it without waiting: the source language at once, the others once their file is here.
    expect(loadFresh('en')).toMatchObject({ status: 'fulfilled' })
    await loadFresh('ru')
    expect(loadFresh('ru')).toMatchObject({ status: 'fulfilled' })
    expect(loadFresh('es')).toMatchObject({ status: 'fulfilled' })
  })

  it('gives a pair kept beside its code the English one until the table has the Russian', () => {
    addTable('es', { Witness: 'Testigo' })
    expect(translate('es', 'Witness')).toBe('Testigo')
    expect(translate('es', 'Friend')).toBe('Friend')
    expect(translate('ru', 'Friend')).toBe('Друг')
    expect(translate('en', 'Friend')).toBe('Friend')
  })

  it('names each language in itself, and reads a page or browser code', () => {
    expect(LANGS).toEqual(['ru', 'en', 'es', 'ca', 'pt-BR', 'fr', 'de', 'it', 'uk', 'pl'])
    expect(LANG_NAMES).toMatchObject({ ru: 'Русский', en: 'English', es: 'Español', ca: 'Català', 'pt-BR': 'Português (Brasil)', de: 'Deutsch', uk: 'Українська' })
    expect(langOf('es-ES')).toBe('es')
    expect(langOf('ca')).toBe('ca')
    expect(langOf('ja-JP')).toBe('en')
    expect(langOf('')).toBe('en')
  })
})

describe('a Spanish or Catalan archive', () => {
  it('writes its server lines in English where it has no words yet', () => {
    addTable('ca', {})
    setSetting('language', 'ca')
    expect(say('A line nobody translated')).toBe('A line nobody translated')
    getDb().delete(schema.settings).where(eq(schema.settings.key, 'language')).run()
  })

  it('reads an old history line written in any of the four languages', () => {
    setSetting('language', 'en')
    addTable('es', { 'Delete person': 'Eliminar persona' })
    expect(readableSummary('Eliminar persona: Ana', [], (id) => id)).toBe('Person deleted: Ana')
    getDb().delete(schema.settings).where(eq(schema.settings.key, 'language')).run()
  })
})

describe('GEDCOM and the assistant in Spanish and Catalan', () => {
  const ged = '0 HEAD\n0 @I1@ INDI\n1 NAME Ana /Soler/\n1 OCCU Maestra\n1 CENS\n2 DATE 1930\n1 EVEN\n2 DATE 1931\n0 TRLR'

  // One person with what a Spanish archive changes in a file: a date in words, a kind of fact in its own words.
  const person = { id: 'a', givenName: 'Ana', surname: 'Soler', patronymic: '', maidenName: '', otherNames: '', sex: 'F', living: false, birthDate: '12 de marzo de 1890', birthPlace: '', deathDate: '20 марта 1960', deathPlace: '', tags: [], claims: [], sources: [],
    facts: [{ kind: 'Censo', date: '1930', place: '', note: '', source: '' }, { kind: 'Перепись', date: '1931', place: '', note: '', source: '' }, { kind: 'Census', date: '1932', place: '', note: '', source: '' }] }
  const file = (lang?: 'ru' | 'en' | 'es' | 'ca') => writeGedcom({ persons: [person], parentChild: [], unions: [] } as unknown as Graph, { hideLiving: false, source: 'Folkbranch', ...(lang ? { lang } : {}) })

  it('writes a Russian or English archive\'s file exactly as before: no LANG, the same lines', () => {
    expect(file('ru')).toBe(file())
    expect(file('en')).toBe(file())
    expect(file().split('\n').slice(0, 7)).toEqual(['0 HEAD', '1 SOUR Folkbranch', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8', '0 @I1@ INDI'])
    expect(file('ru')).toContain('2 DATE (12 de marzo de 1890)')
    expect(file('ru')).toContain('1 EVEN\n2 TYPE Censo')
  })

  it('names no language in a Spanish or Catalan file either, and writes their dates and kinds of fact', () => {
    addTable('es', { Census: 'Censo' })
    for (const lang of ['es', 'ca'] as const) expect(file(lang)).not.toContain('LANG')
    expect(file('es')).toContain('1 BIRT\n2 DATE 12 MAR 1890')
    expect(file('es')).toContain('1 DEAT\n2 DATE 20 MAR 1960')
    expect(file('es')).toContain('1 CENS\n2 DATE 1930')
    expect(file('es')).not.toContain('TYPE Censo')
  })

  it('reads "fol." and "pág." as the page of a source in a Spanish or Catalan archive only', () => {
    const cited = '0 HEAD\n0 @S1@ SOUR\n1 TITL Libro de bautismos\n0 @I1@ INDI\n1 NAME Ana /Soler/\n1 SOUR @S1@\n2 PAGE Libro 3, fol. 12\n0 TRLR'
    expect(parseGedcom(cited, 'es').persons[0].sources[0]).toMatchObject({ ref: 'Libro 3', page: '12' })
    expect(parseGedcom(cited, 'ca').persons[0].sources[0]).toMatchObject({ ref: 'Libro 3', page: '12' })
    for (const lang of ['ru', 'en'] as const) expect(parseGedcom(cited, lang).persons[0].sources[0]).toMatchObject({ ref: 'Libro 3, fol. 12', page: '' })
  })

  it('names imported facts in English until the table has them, never in Russian', () => {
    addTable('es', { Census: 'Censo' })
    const kinds = parseGedcom(ged, 'es').persons[0].facts.map((f) => f.kind)
    expect(kinds).toContain('Censo')
    expect(kinds).toContain('Event')
    expect(kinds.join()).not.toMatch(cyrillic)
    expect(parseGedcom(ged, 'ru').persons[0].facts.map((f) => f.kind)).toContain('Перепись')
  })

  it("labels the assistant's steps the same way", () => {
    addTable('ca', {})
    expect(toolLabel('get_person', 'ca')).toBe('Reading a card')
    expect(toolLabel('get_person', 'ru')).toBe('Читает карточку')
  })
})

describe("the assistant's instructions", () => {
  const owner: Actor = { userId: 'u-owner', name: 'Ольга', role: 'owner', personId: null }
  const reader: Actor = { userId: 'u-reader', name: 'Роман', role: 'reader', personId: null }
  const parts = (who: Actor, opts: { focusId?: string; sees?: boolean } = {}) => (buildAgent(who, { model: new MockLanguageModelV4(), ...opts }) as unknown as { settings: { instructions: { content: string }[] } }).settings.instructions.map((i: { content: string }) => i.content) as [string, string]
  const SEES = 'The model answering cannot see pictures. Say so when asked to read a scan or photo, and suggest the owner choose a model that can under Settings.'

  it('are exactly what they always were in a Russian or English archive', () => {
    setSetting('language', 'ru')
    const rules = parts(owner)[0]
    for (const lang of ['ru', 'en']) {
      setSetting('language', lang)
      expect(parts(owner)).toEqual([rules, 'The person is Ольга, with the role owner.'])
      expect(parts(reader, { focusId: 'p1', sees: false })[1]).toBe(`The person is Роман, with the role reader. As a reader they do not see living relatives, and neither do you. ${SEES} They have this person open on the chart: id p1.`)
      expect(parts(owner).join()).not.toContain('The archive is kept in')
    }
  })

  it("name a Spanish or Catalan archive's language, and nothing else changes", () => {
    setSetting('language', 'ru')
    const rules = parts(owner)[0]
    setSetting('language', 'es')
    expect(parts(owner)).toEqual([rules, 'The person is Ольга, with the role owner. The archive is kept in Spanish (Spain): write what you add to it in that language, and reply in it unless the person writes in another.'])
    setSetting('language', 'ca')
    expect(parts(owner)[1]).toBe('The person is Ольга, with the role owner. The archive is kept in Catalan: write what you add to it in that language, and reply in it unless the person writes in another.')
  })
})

describe('the words added for Spanish and Catalan', () => {
  // Each replaced Russian and English the code wrote itself; a Russian or English reader must see the same words as before.
  it('read in Russian and English as the code wrote them before', () => {
    const fill = (lang: 'ru' | 'en', key: string, slot: string, value: string) => translate(lang, key).replace(slot, value)
    expect(fill('ru', 'before {date}', '{date}', '12 мая 2026 г.')).toBe(`${translate('ru', 'before')} 12 мая 2026 г.`)
    expect(fill('en', 'before {date}', '{date}', '12 May 2026')).toBe(`${translate('en', 'before')} 12 May 2026`)
    expect(fill('ru', 'by {name}', '{name}', 'Анна')).toBe('от: Анна')
    expect(fill('en', 'by {name}', '{name}', 'Anna')).toBe('by Anna')
    expect(fill('ru', '{price} an hour', '{price}', '$0.36')).toBe('$0.36 в час')
    expect(fill('en', '{price} an hour', '{price}', '$0.36')).toBe('$0.36 an hour')
  })
})

describe('code that picks between two languages', () => {
  // `lang === 'en' ? english : russian` gives a Spanish reader Russian. A choice names Russian (`lang === 'ru' ? russian : english`) or covers all four.
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [] })

  it('never sends a language it does not name to Russian', () => {
    const bad = ['app', 'components', 'lib'].flatMap(files).filter((f) => f !== path.join('lib', 'i18n.ts')).flatMap((f) => readFileSync(f, 'utf8').split('\n')
      .flatMap((l, i) => (/===? ?["']en["']|["']en["'] ?===?|startsWith\(["']en["']\)|\bru: [^,]+, en: [^,]+ \}\[lang\]/.test(l) ? [`${f}:${i + 1}`] : [])))
    expect(bad).toEqual([])
  })
})
