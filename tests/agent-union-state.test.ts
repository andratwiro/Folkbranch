/* eslint-disable @typescript-eslint/no-explicit-any -- the tools' answers are read untyped, as the model reads them */
// What a person can set on a union through the tools, an agent must be able to read back: how it stands.
import { describe, expect, it } from 'vitest'
import { assistantActor } from '../lib/agent/agent'
import { createPerson, linkPeople } from '../lib/ops/people'
import { toolsFor } from '../lib/ops/tools'
import { owner } from './fixture-family'

async function call(surface: 'assistant' | 'mcp', name: string, args: Record<string, unknown> = {}): Promise<any> {
  const actor = surface === 'assistant' ? assistantActor(owner) : { ...owner, tokenId: 't1', name: 'robot' }
  const def = toolsFor(actor, surface).find((t) => t.name === name)!
  return def.run(actor, def.input.parse(args))
}
const add = (givenName: string, sex: 'M' | 'F') => createPerson(owner, { givenName, surname: 'Союзов', sex, birthDate: '1900' }) as { id: string }

describe('a union tells how it stands', () => {
  it.each(['assistant', 'mcp'] as const)('%s: together, separated, divorced, widowed, and an old end date that reads as a divorce', async (surface) => {
    const states = ['', 'separated', 'divorced', 'widowed'] as const
    const man = add('Муж', 'M')
    const seen: string[] = []
    for (const [i, endKind] of states.entries()) {
      const wife = add(`Жена${i}`, 'F')
      linkPeople(owner, 'spouse', man.id, wife.id)
      const link = (await call(surface, 'get_person', { id: man.id })).unions.find((u: any) => u.personId === wife.id).linkId
      if (endKind) await call(surface, 'update_relation', { type: 'union', id: link, endKind })
      seen.push((await call(surface, 'get_person', { id: man.id })).unions.find((u: any) => u.personId === wife.id).endKind)
    }
    expect(seen).toEqual(['', 'separated', 'divorced', 'widowed'])
    // A union an older version ended with a date and no reason is said to be a divorce, as the chart draws it.
    const old = add('Бывшая', 'F')
    linkPeople(owner, 'spouse', man.id, old.id, undefined as never)
    const oldLink = (await call(surface, 'get_person', { id: man.id })).unions.find((u: any) => u.personId === old.id).linkId
    await call(surface, 'update_relation', { type: 'union', id: oldLink, endDate: '1950' })
    expect((await call(surface, 'get_person', { id: man.id })).unions.find((u: any) => u.personId === old.id).endKind).toBe('divorced')
  })
})
