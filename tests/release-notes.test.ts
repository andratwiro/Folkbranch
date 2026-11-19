import { describe, expect, it } from 'vitest'
// @ts-expect-error a plain script with no types
import { buildNotes, parseSection, sectionOf } from '../scripts/release-notes.mjs'

const changelog = `# Changelog

## Unreleased

## 2.1.0 - 2026-01-02

Opening for people who do not read changelogs.

### Highlights

- **One thing.** What it does for you.

### Fixed

- A bug.

### Added

- A feature.

## 2.0.0 - 2025-12-01

Old.
`

describe('release notes', () => {
  it('take exactly one version section and split it into its parts', () => {
    const section = sectionOf(changelog, '2.1.0')
    expect(section).not.toContain('Old.')
    const { intro, blocks } = parseSection(section)
    expect(intro).toBe('Opening for people who do not read changelogs.')
    expect([...blocks.keys()]).toEqual(['Highlights', 'Fixed', 'Added'])
    expect(() => sectionOf(changelog, '9.9.9')).toThrow(/no section/)
  })

  it('lead with the opening and highlights, then upgrading, then the groups in a fixed order, then pull requests', () => {
    const text = buildNotes({
      version: '2.1.0', date: '2026-01-02', section: sectionOf(changelog, '2.1.0'),
      prs: [{ number: 9, title: 'second', author: 'bob' }, { number: 3, title: 'first', author: 'ann' }],
      contributors: [{ login: 'ann' }, { login: 'bob', first: true }], compare: 'https://example.test/compare/v2.0.0...v2.1.0',
    })
    const at = (s: string) => text.indexOf(s)
    expect(text.startsWith('# Folkbranch 2.1.0 · 2026-01-02\n\n> Opening')).toBe(true)
    const order = ['What is new for you', 'Upgrading', 'Everything that changed', '### ✨ Added', '### 🐛 Fixed', 'Merged pull requests', 'Contributors', 'Full changelog'].map(at)
    expect(order.every((n) => n >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((x, y) => x - y))
    expect(text.indexOf('#3 first by @ann')).toBeLessThan(text.indexOf('#9 second by @bob'))
    expect(text).toContain('@bob (first contribution)')
    expect(text).toContain('**Full changelog**: https://example.test/compare/v2.0.0...v2.1.0')
  })

  it('leave out the parts a release has nothing for, and still say how to upgrade', () => {
    const text = buildNotes({ version: '2.0.0', section: 'Old.\n\n### Fixed\n\n- x' })
    expect(text).not.toMatch(/What is new|Merged pull requests|Contributors|Full changelog/)
    expect(text).toContain('Upgrading')
  })
})
