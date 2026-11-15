// An agent's draft accepted after someone changed the same card: lists merge, and a value changed meanwhile is not
// written over in silence. The draft stays, with the reason, for a person to decide.
import { beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '../lib/ops/core'
import { getPersonRow, updatePerson } from '../lib/ops/people'
import { acceptProposal, dispatch, listProposals } from '../lib/ops/proposals'
import { loadFamily, owner } from './fixture-family'

const agent: Actor = { userId: 'u-owner', name: 'Агент', role: 'editor', personId: null, tokenId: 'tok-review', review: true } as Actor
let f: Awaited<ReturnType<typeof loadFamily>>
beforeAll(async () => { f = await loadFamily() })
const draft = (id: string) => listProposals(owner).find((d) => d.id === id) as { id: string; error?: string | null } | undefined
const queue = async (a: Actor, args: unknown) => ((await dispatch(a, 'update_person', args)) as { proposalId: string }).proposalId

describe('a draft accepted after the card changed', () => {
  it('a value changed meanwhile stays, and the draft waits with a reason', async () => {
    updatePerson(owner, f.ivan.id, { deathPlace: 'Вологда' })
    const id = await queue(agent, { id: f.ivan.id, patch: { deathPlace: 'Соль' } })
    updatePerson(owner, f.ivan.id, { deathPlace: 'Тотьма' })
    expect(() => acceptProposal(owner, id)).toThrow()
    expect(getPersonRow(f.ivan.id).deathPlace).toBe('Тотьма')
    expect(draft(id)?.error).toBeTruthy()
  })
  it('with nothing changed meanwhile, it applies', async () => {
    const id = await queue({ ...agent, tokenId: 'tok-two' } as Actor, { id: f.pyotr.id, patch: { deathPlace: 'Ярославль' } })
    acceptProposal(owner, id)
    expect(getPersonRow(f.pyotr.id).deathPlace).toBe('Ярославль')
  })
  it('facts added by both are all kept', async () => {
    const id = await queue({ ...agent, tokenId: 'tok-three' } as Actor, { id: f.maria.id, patch: { facts: [{ kind: 'Служба', date: '1941', place: '', note: '', source: '' }] } })
    updatePerson(owner, f.maria.id, { facts: [{ kind: 'Награда', date: '1945', place: '', note: '', source: '' }] }, { facts: [] })
    acceptProposal(owner, id)
    const kinds = (JSON.parse(String(getPersonRow(f.maria.id).facts)) as { kind: string }[]).map((x) => x.kind)
    expect(kinds).toEqual(expect.arrayContaining(['Служба', 'Награда']))
  })
})
