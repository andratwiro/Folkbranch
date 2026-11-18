// What every MCP session pays before it does anything: the list of tools. It carries only what a model needs; the limits
// it no longer advertises are still enforced, and said in words.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildMcpServer } from '../lib/mcp'
import { type Actor } from '../lib/ops/core'
import { loadFamily } from './fixture-family'

beforeAll(async () => { await loadFamily() })
const editor: Actor = { userId: 'token:e', name: 'Агент', role: 'editor', personId: null, tokenId: 't-e', review: false }
async function client(a: Actor) {
  const [x, y] = InMemoryTransport.createLinkedPair()
  await buildMcpServer(a).connect(y)
  const c = new Client({ name: 'test', version: '1' })
  await c.connect(x)
  return c
}

describe('the list of tools', () => {
  it('stays near what it was with sixteen more tools in it, and has no ornament', async () => {
    const { tools } = await (await client(editor)).listTools()
    const size = JSON.stringify(tools).length
    // Was 45 KB with the new tools in the old shape (36 KB without them); a budget so it cannot creep back.
    expect(size, `${size} bytes for ${tools.length} tools`).toBeLessThan(36_500)
    const text = JSON.stringify(tools)
    expect(text).not.toContain('$schema')
    expect(text).not.toContain('taskSupport')
    expect(text).not.toContain('maxLength')
  })

  it('a read-only token has a short one', async () => {
    const { tools } = await (await client({ ...editor, role: 'reader' })).listTools()
    expect(JSON.stringify(tools).length).toBeLessThan(14_000)
  })

  it('create_person and update_person do not offer what a model should not touch, and are small', async () => {
    const { tools } = await (await client(editor)).listTools()
    for (const name of ['create_person', 'update_person']) {
      const t = JSON.stringify(tools.find((x) => x.name === name))
      expect(t.length, name).toBeLessThan(1900)
      expect(t).not.toMatch(/keepPrivate|claims|birthPlaceId/)
    }
  })

  it('a limit that is no longer advertised is still enforced, in words', async () => {
    const c = await client(editor)
    const r = (await c.callTool({ name: 'create_person', arguments: { person: { givenName: 'Х'.repeat(500), surname: 'Y' } } })) as { isError?: boolean; content: { text: string }[] }
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/The call was not accepted/)
  })

  it('the hints say what each tool is', async () => {
    const { tools } = await (await client(editor)).listTools()
    expect(tools.find((t) => t.name === 'get_person')!.annotations).toMatchObject({ readOnlyHint: true })
    expect(tools.find((t) => t.name === 'delete_person')!.annotations).toMatchObject({ destructiveHint: true })
    expect(tools.find((t) => t.name === 'create_person')!.annotations).toMatchObject({ destructiveHint: false })
  })
})
