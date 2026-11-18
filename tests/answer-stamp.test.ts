import { describe, expect, it } from 'vitest'
import { stampDetail, stampLine, stampMaker, stampOf } from '../lib/agent/stamp'
import { translate } from '../lib/i18n'

const t = (lang: 'en' | 'ru' | 'es' | 'ca') => (k: string) => translate(lang, k)

describe('the stamp under an answer', () => {
  it('measures from the start to the finish and counts steps', () => {
    let clock = 1_000
    const make = stampMaker(() => clock)
    expect(make({ type: 'start' })).toEqual({ at: 1_000 })
    clock = 4_000; make({ type: 'finish-step' })
    clock = 13_000; make({ type: 'finish-step' })
    expect(make({ type: 'finish', totalUsage: { totalTokens: 300 } as never })).toMatchObject({ ms: 12_000, steps: 2, tokens: 300 })
    expect(make({ type: 'text-delta' })).toBeUndefined()
  })

  it('shows nothing for an old message without it, and ignores junk', () => {
    expect(stampOf(undefined)).toBeNull()
    expect(stampOf({ usage: { inputTokens: 1 } })).toBeNull()
    expect(stampOf({ at: 'yesterday', ms: -5 })).toBeNull()
  })

  it('writes the time in the viewer\'s own way and the duration in their language', () => {
    const at = new Date(2026, 10, 17, 14, 32).getTime()
    expect(stampLine({ at, ms: 12_000 }, 'ru', t('ru'))).toBe('14:32 · 12 сек')
    expect(stampLine({ at, ms: 65_000 }, 'en', t('en'))).toMatch(/^(14:32|02:32 pm) · 1 min 5 s$/i)
    expect(stampLine({ at, ms: 12_000 }, 'es', t('es'))).toBe('14:32 · 12 s')
    expect(stampLine({ at }, 'ca', t('ca'))).toBe('14:32')
  })

  it('opens steps and tokens only on a long answer, in all four languages', () => {
    const s = { at: 1, ms: 5000, steps: 4, tokens: 12345 }
    expect(stampDetail({ ...s, steps: 1 }, 'en', t('en'))).toBe('')
    expect(stampDetail(s, 'en', t('en'))).toBe('steps: 4 · tokens: 12,345')
    expect(stampDetail(s, 'es', t('es'))).toBe('pasos: 4 · tokens: 12.345')
    expect(stampDetail(s, 'ca', t('ca'))).toMatch(/^passos: 4 · tokens: 12\.345$/)
    expect(stampDetail(s, 'ru', t('ru'))).toMatch(/^шагов: 4 · токенов: 12.345$/)
  })
})
