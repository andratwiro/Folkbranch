// The assistant's instructions name tools. A tool that is named there but only loads on request is one a cheap model never
// reaches for: Haiku wrote four update_person calls where the instructions say one update_people call. So every tool the
// instructions tell it to call is sent with every request.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CORE_TOOLS, TOOLS } from '../lib/ops/tools'

describe('the instructions and the tools sent with every request', () => {
  it('every tool the instructions say to call is among them', () => {
    const prompt = readFileSync('lib/agent/agent.ts', 'utf8')
    const named = TOOLS.map((t) => t.name).filter((n) => new RegExp(`\\b${n}\\b`).test(prompt) && n !== 'use_tools')
    expect(named.length).toBeGreaterThan(3)
    // Named on purpose and loaded with use_tools when the task needs them: files and photos, a value from a source, and
    // get_relatives, which the instructions say NOT to call for a count. A tool added here is one the model must ask for.
    const loadedOnRequest = ['get_relatives', 'list_photos', 'view_photo', 'read_attachment', 'save_attachment', 'import_gedcom_attachment', 'set_avatar', 'add_version']
    expect(named.filter((n) => !CORE_TOOLS.includes(n) && !loadedOnRequest.includes(n))).toEqual([])
  })
})
