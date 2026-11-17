// A confirm question has its own line, with {name} where the name goes. Before, the code glued a button's label to the
// name and a question mark; Russian and English must read exactly as that did, character for character.
import { describe, expect, it } from 'vitest'
import { translate } from '../lib/i18n'
import ca from '../locales/ca.json'
import es from '../locales/es.json'

// Each question, and the words of the button label the code glued the name to before: [key, shape, Russian label, English label].
// shape: 'q' is `label «name»?`, 'c' is `label: name?`, 'n' is `label?` with no name.
const QUESTIONS: [string, 'q' | 'c' | 'n', string, string][] = [
  ['Delete person «{name}»?', 'q', 'Удалить человека', 'Delete person'],
  ['Delete «{name}»?', 'q', 'Удалить', 'Delete'],
  ['Delete the story «{name}»?', 'q', 'Удалить рассказ', 'Delete the story'],
  ['Delete the story?', 'n', 'Удалить рассказ', 'Delete the story'],
  ['Delete the place\'s details «{name}»?', 'q', 'Удалить сведения о месте', 'Delete the place\'s details'],
  ['Delete archive «{name}»?', 'q', 'Удалить архив', 'Delete archive'],
  ['Remove model: {name}?', 'c', 'Удалить модель', 'Remove model'],
  ['Remove access: {name}?', 'c', 'Закрыть доступ', 'Remove access'],
  ['Turn off sign-in: {name}?', 'c', 'Выключить вход', 'Turn off sign-in'],
  ['Close the link: {name}?', 'c', 'Закрыть ссылку', 'Close the link'],
]
const built = (shape: 'q' | 'c' | 'n', label: string, name: string) => (shape === 'q' ? `${label} «${name}»?` : shape === 'c' ? `${label}: ${name}?` : `${label}?`)
// Names as the code may meet them, including the characters String.replace would read as patterns.
const NAMES = ['Anna Soler', 'Тётя Лена', 'A $& B $1 $$', '']

describe('confirm questions', () => {
  it.each(['ru', 'en'] as const)('read in %s exactly as before', (lang) => {
    const t = (k: string) => translate(lang, k)
    for (const [key, shape, ru, en] of QUESTIONS) for (const name of NAMES) {
      expect(t(key).replace('{name}', () => name)).toBe(built(shape, lang === 'ru' ? ru : en, name))
    }
  })

  it('ask as a question in Spanish and Catalan', () => {
    for (const [key] of QUESTIONS) {
      expect((es as Record<string, string>)[key]).toMatch(/^¿.*\?$/)
      expect((ca as Record<string, string>)[key]).toMatch(/^Vols .*\?$/)
    }
  })
})
