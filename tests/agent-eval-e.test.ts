// Errors an agent or a person watching it can read: what a read-only token is told, what a wrong input says in words,
// and what undoing twice says.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildMcpServer } from '../lib/mcp'
import { type Actor } from '../lib/ops/core'
import { loadFamily } from './fixture-family'

beforeAll(async () => { await loadFamily() })
const tokenOf = (role: 'reader' | 'editor'): Actor => ({ userId: `token:${role}`, name: 'Агент', role, personId: null, tokenId: `t-${role}`, review: false })
async function client(a: Actor) {
  const [x, y] = InMemoryTransport.createLinkedPair()
  await buildMcpServer(a).connect(y)
  const c = new Client({ name: 'test', version: '1' })
  await c.connect(x)
  return c
}
const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]).text

describe('over MCP', () => {
  it('a read-only token asking for a writing tool is told why, not that the tool was not found', async () => {
    const c = await client(tokenOf('reader'))
    const r = (await c.callTool({ name: 'create_person', arguments: { person: { givenName: 'X' } } })) as { isError?: boolean }
    expect(r.isError).toBe(true)
    expect(text(r)).toMatch(/read-only: writing needs an editor token/)
    expect(text(r)).not.toMatch(/not found|-32602/)
    // A name that is no tool at all is still an error, in the protocol's own words.
    await expect(c.callTool({ name: 'no_such_tool', arguments: {} })).resolves.toMatchObject({ isError: true })
  })

  it('a wrong input is explained in a sentence first, with the exact issues after it', async () => {
    const c = await client(tokenOf('editor'))
    const a = text(await c.callTool({ name: 'find_gaps', arguments: { limit: 0, sort: 'sideways', surprise: 1 } }))
    expect(a).toMatch(/^The call was not accepted: /)
    expect(a).toMatch(/limit is too small: at least 1 is needed/)
    expect(a).toMatch(/sort must be one of: gaps, birth, name/)
    expect(a).toMatch(/this tool does not have: surprise/)
    expect(a).toMatch(/Details: \[/)
  })

  it('undoing twice says what was undone, and what is already undone', async () => {
    const c = await client(tokenOf('editor'))
    const made = JSON.parse(text(await c.callTool({ name: 'create_person', arguments: { person: { givenName: 'Отменяемый', surname: 'Дважды' } } })))
    expect(made.id).toBeTruthy()
    const history = JSON.parse(text(await c.callTool({ name: 'get_history', arguments: { limit: 3 } })))
    const mine = history.find((h: any) => h.personIds.includes(made.id))
    const first = JSON.parse(text(await c.callTool({ name: 'undo', arguments: { historyId: mine.id } })))
    expect(first.undone).toContain('Отменяемый')
    const second = await c.callTool({ name: 'undo', arguments: { historyId: mine.id } })
    expect((second as { isError?: boolean }).isError).toBe(true)
    expect(text(second)).toMatch(/already undone: .*Отменяемый/)
  })
})
