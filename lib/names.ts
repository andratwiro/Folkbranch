// Russian patronymics, so nobody has to type what the father's name already says.
import { translate } from './i18n'
import type { Lang, Sex } from './types'

const IRREGULAR: Record<string, [string, string]> = {
  'Илья': ['Ильич', 'Ильинична'], 'Никита': ['Никитич', 'Никитична'], 'Лука': ['Лукич', 'Лукинична'], 'Фома': ['Фомич', 'Фоминична'], 'Кузьма': ['Кузьмич', 'Кузьминична'],
  'Пётр': ['Петрович', 'Петровна'], 'Петр': ['Петрович', 'Петровна'], 'Лев': ['Львович', 'Львовна'], 'Павел': ['Павлович', 'Павловна'],
  'Юрий': ['Юрьевич', 'Юрьевна'], 'Григорий': ['Григорьевич', 'Григорьевна'], 'Яков': ['Яковлевич', 'Яковлевна'],
}

/** The patronymic for a child of this father, or '' when the name gives no safe answer. */
export function patronymicFrom(father: string, sex: Sex): string {
  const name = father.trim().split(/\s+/)[0] ?? ''
  if (sex === 'U' || !/^[А-ЯЁ][а-яё]+$/.test(name)) return ''
  const f = sex === 'F'
  if (IRREGULAR[name]) return IRREGULAR[name][f ? 1 : 0]
  if (/[ая]$/.test(name)) return ''
  if (/ий$/.test(name)) return name.slice(0, -1) + (f ? 'евна' : 'евич')
  if (/[йь]$/.test(name)) return name.slice(0, -1) + (f ? 'евна' : 'евич')
  if (/[жчшщц]$/.test(name)) return name + (f ? 'евна' : 'евич')
  return name + (f ? 'овна' : 'ович')
}

/** "Иван Петрович" from an old import becomes the name and the patronymic; "Анна Мария" stays. */
export function splitPatronymic(given: string): [string, string] {
  const parts = given.trim().split(/\s+/)
  if (parts.length === 2 && /(ович|евич|ьич|ична|овна|евна|инична)$/.test(parts[1])) return [parts[0], parts[1]]
  return [given.trim(), '']
}

/** A name typed in one line: the last word is the surname, unless the line is a name and a patronymic ("Oleg Petrovich"). */
export function parseTypedName(s: string) {
  if (splitPatronymic(s)[1]) return { givenName: s.trim(), surname: '' }
  const parts = s.trim().split(/\s+/)
  if (parts.length < 2) return { givenName: parts[0] ?? '', surname: '' }
  return { givenName: parts.slice(0, -1).join(' '), surname: parts.at(-1)! }
}

/**
 * A Russian surname in the form for a man or a woman: Petrov / Petrova, Kovalsky / Kovalskaya, Tolstoy / Tolstaya.
 * Names that do not change (Shevchenko, Tsoi, Whitlock) and forms it cannot be sure of come back as they are.
 */
export function surnameFor(surname: string, sex: Sex): string {
  const s = surname.trim()
  if (sex === 'U' || !/^[А-ЯЁ][а-яё-]+$/.test(s)) return s
  if (sex === 'F') {
    if (/(ов|ев|ёв|ин|ын)$/.test(s)) return s + 'а'
    if (/(ский|цкий)$/.test(s)) return s.slice(0, -2) + 'ая'
    if (/[^аеиоуыэюя]ой$/.test(s) && s.length > 4) return s.slice(0, -2) + 'ая'
    return s
  }
  if (/(ова|ева|ёва|ина|ына)$/.test(s)) return s.slice(0, -1)
  if (/(ская|цкая)$/.test(s)) return s.slice(0, -2) + 'ий'
  return s
}

/**
 * The surname a new child takes when none was typed: the father's, in the child's own form. With only a mother it is
 * hers, again in the child's form; a son of Anna Petrova is Petrov, not Petrova.
 */
export function childSurname(parents: { surname: string; sex: Sex }[], childSex: Sex): string {
  const from = parents.find((p) => p.sex === 'M' && p.surname.trim()) ?? parents.find((p) => p.surname.trim())
  return from ? surnameFor(from.surname, childSex) : ''
}

/** "72 года" / "72 years" / "72 años": the form of the noun follows the language's own plural rules (Intl.PluralRules, through i18next). */
export const ageWords = (n: number, lang: Lang) => translate(lang, '{count} years', { count: n })

/** "1 человек", "3 семьи" / "1 person", "3 families" / "3 personas" / "3 famílies". */
export const peopleWords = (n: number, lang: Lang) => translate(lang, '{count} people', { count: n })
export const familyWords = (n: number, lang: Lang) => translate(lang, '{count} families', { count: n })
