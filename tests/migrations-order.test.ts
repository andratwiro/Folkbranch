// The migrator runs only migrations newer than the newest it has applied: one dated earlier than the one before it
// is skipped on an archive that already has the one before, and its tables never appear.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const journal = JSON.parse(fs.readFileSync(path.join(__dirname, '../drizzle/meta/_journal.json'), 'utf8')) as { entries: { idx: number; when: number; tag: string }[] }
// 0010 and 0011 were made out of order and first released together in 1.2.0, so no archive ever had one without the other.
const RELEASED_TOGETHER = new Set(['0011_stories'])

describe('migrations', () => {
  it('each is dated later than the one before it', () => {
    const late = journal.entries.slice(1).filter((e, i) => e.when <= journal.entries[i].when && !RELEASED_TOGETHER.has(e.tag)).map((e) => e.tag)
    expect(late).toEqual([])
  })
  it('each has its SQL file, in order', () => {
    journal.entries.forEach((e, i) => {
      expect(e.idx).toBe(i)
      expect(fs.existsSync(path.join(__dirname, `../drizzle/${e.tag}.sql`))).toBe(true)
    })
  })
})
