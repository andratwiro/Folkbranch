// Attacks on a throwaway instance, never on an archive you care about: it writes junk and logs people out.
// node scripts/attack-check.mjs http://127.0.0.1:3432 <one-time owner invite token>
const B = process.argv[2]
const out = []
const say = (ok, name, detail = '') => { out.push(ok); console.log(`${ok ? 'ok    ' : 'HOLE  '} ${name}${detail ? ` — ${String(detail).slice(0, 170)}` : ''}`) }
const note = (name, detail = '') => console.log(`info   ${name}${detail ? ` — ${String(detail).slice(0, 170)}` : ''}`)
const jar = () => { let c = ''; const f = async (p, i = {}) => {
  const body = i.json !== undefined ? JSON.stringify(i.json) : i.body
  const r = await fetch(B + p, { method: i.method ?? (body ? 'POST' : 'GET'), redirect: 'manual', body, headers: { ...(i.noOrigin ? {} : { origin: i.origin ?? B }), ...(i.json !== undefined ? { 'content-type': 'application/json' } : {}), ...(c && !i.anon ? { cookie: c } : {}), ...i.headers } })
  const set = r.headers.getSetCookie().map((x) => x.split(';')[0])
  if (set.length) { f.raw = r.headers.getSetCookie(); c = [...new Set([...c.split('; ').filter((x) => x && !set.some((s) => s.split('=')[0] === x.split('=')[0])), ...set])].join('; ') }
  return r
}; f.cookie = () => c; f.setCookie = (v) => { c = v }; return f }
const anon = jar(), owner = jar(), editor = jar(), reader = jar()
const js = (r) => r.json().catch(() => null)
const denied = (r) => [401, 403, 404, 400].includes(r.status) || (r.status >= 300 && r.status < 400)

// ---- Without an account
for (const p of ['/api/v1/graph', '/api/v1/me', '/api/v1/settings', '/api/v1/history', '/api/v1/media', '/api/v1/users', '/api/v1/tokens', '/api/v1/invites', '/api/v1/assistant/provider', '/api/v1/text/export', '/api/v1/gedcom/export']) {
  const r = await anon(p, { anon: true })
  say(denied(r), `without sign-in ${p}`, r.status)
}
for (const p of ['/.env', '/data/family.db', '/family.db', '/auth-secret', '/setup-code', '/.git/config', '/START_PROMPT.md', '/package.json', '/api/../.env', '/_next/../../.env', '/%2e%2e/%2e%2e/etc/passwd', '/api/v1/media/..%2f..%2f..%2fetc%2fpasswd/file']) {
  const r = await anon(p, { anon: true })
  const t = await r.text()
  say(!/BETTER_AUTH|root:|\[core\]|"dependencies"|SQLite format/.test(t), `foreign file ${p}`, r.status)
}
for (const p of ['/api/agent', '/api/agent/files']) { const r = await anon(p, { anon: true, json: { messages: [] } }); say(denied(r), `without sign-in POST ${p}`, r.status) }
{ const r = await anon('/api/health', { anon: true }); note('/api/health visible to all', (await r.text())) }
{ const r = await anon('/api/v1/openapi.json', { anon: true }); note('/api/v1/openapi.json without sign-in', r.status) }
{ const r = await anon('/api/mcp', { anon: true, json: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }); say(r.status === 401, 'MCP without a token', r.status) }
{ const r = await anon('/api/mcp', { anon: true, headers: { authorization: 'Bearer fb_fake' }, json: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }); say(r.status === 401, 'MCP with a forged token', r.status) }

// ---- Sign-in
for (const [p, json] of [['/api/auth/sign-up/email', { email: 'x@evil.test', password: 'Passw0rd!Passw0rd', name: 'x' }], ['/api/auth/sign-in/email', { email: 'x@evil.test', password: 'Passw0rd!Passw0rd' }], ['/api/auth/family/setup', { name: 'x', familyName: 'x', language: 'ru', demo: true, code: 'demo-code' }], ['/api/auth/family/setup', { name: 'x', familyName: 'x', language: 'ru', demo: true }], ['/api/auth/family/accept', { token: 'nope' }]]) {
  const j = jar()
  const r = await j(p, { json })
  const session = await j('/api/v1/me')
  say(session.status === 401, `sign-in via ${p} ${json.code ? 'with a code' : ''}`, `${r.status}, /me ${session.status}`)
}
{ const fake = jar(); fake.setCookie('better-auth.session_token=abc.def'); say((await fake('/api/v1/me')).status === 401, 'forged cookie') }

await new Promise((r) => setTimeout(r, 62000))
const r0 = await owner('/api/auth/family/accept', { json: { token: process.argv[3] } })
say(r0.ok, 'owner signs in by invite', r0.status)
const flags = (owner.raw ?? []).join(' | ')
say(/HttpOnly/i.test(flags), 'cookie HttpOnly', flags.slice(0, 120))
say(/SameSite=Lax|SameSite=Strict/i.test(flags), 'cookie SameSite')
note('no Secure cookie over http, check over https', /Secure/i.test(flags))
const expire = /Max-Age=(\d+)/i.exec(flags)?.[1]; note('session lifetime, days', expire && Math.round(expire / 86400))
{ const again = jar(); const r = await again('/api/auth/family/accept', { json: { token: process.argv[3] } }); say(!r.ok, 'invite is one-time', r.status) }
const invite = async (role, extra = {}) => (await js(await owner('/api/v1/invites', { json: { name: role, role, ...extra } }))).token
await editor('/api/auth/family/accept', { json: { token: await invite('editor') } })
await reader('/api/auth/family/accept', { json: { token: await invite('reader') } })
say((await js(await editor('/api/v1/me'))).role === 'editor' && (await js(await reader('/api/v1/me'))).role === 'reader', 'roles created')

// ---- Raising one's own rights
for (const [who, j] of [['editor', editor], ['reader', reader]]) {
  for (const [m, p, json] of [['POST', '/api/auth/update-user', { role: 'owner' }], ['POST', '/api/auth/update-user', { personId: 'x', role: 'owner', name: 'hacked' }], ['PATCH', '/api/v1/settings', { familyName: 'Взлом' }], ['POST', '/api/v1/invites', { name: 'x', role: 'owner' }], ['GET', '/api/v1/users'], ['GET', '/api/v1/tokens'], ['POST', '/api/v1/tokens', { name: 'x', role: 'editor', review: false }], ['GET', '/api/v1/assistant/provider'], ['PUT', '/api/v1/assistant/provider', { provider: 'openrouter', key: 'fake-key-1234567' }], ['DELETE', '/api/v1/assistant/provider']]) {
    const r = await j(p, { method: m, ...(json ? { json } : {}) })
    if (p.endsWith('update-user')) { const me = await js(await j('/api/v1/me')); say(me.role !== 'owner', `${who}: make self the owner`, `${r.status}, role ${me.role}`) } else say(r.status === 403 || r.status === 401, `${who}: ${m} ${p}`, r.status)
  }
}
{ const u = await js(await owner('/api/v1/users')); const victim = u.find((x) => x.role === 'owner').id; say((await editor(`/api/v1/users/${victim}`, { method: 'DELETE' })).status === 403, 'editor deletes the owner'); say((await editor(`/api/v1/users/${victim}`, { method: 'PATCH', json: { role: 'reader' } })).status === 403, 'editor demotes the owner') }

// ---- What a reader can see of the living
const full = await js(await owner('/api/v1/graph'))
const living = full.persons.filter((p) => p.living)
const visible = await js(await reader('/api/v1/graph'))
const someone = living[0]
note('living people in the demo', living.length)
const leak = visible.persons.filter((p) => living.some((l) => l.id === p.id) && (p.givenName || p.surname || p.birthDate || p.birthPlace))
say(leak.length === 0, 'reader: names of the living in the graph', leak.length)
note('reader: links of the living visible as id and structure', visible.parentChild.filter((l) => living.some((p) => p.id === l.childId)).length)
const owned = await js(await owner('/api/v1/pages', { json: { personId: someone.id, title: 'Тайна живого', markdown: 'ТАЙНЫЙ ТЕКСТ' } }))
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const form = (data, name, personId) => { const f = new FormData(); f.set('file', new Blob([data]), name); if (personId) f.set('personId', personId); return f }
const photo = await js(await owner('/api/v1/media', { body: form(png, 'тайное-фото.png', someone.id) }))
for (const p of [`/api/v1/persons/${someone.id}`, `/api/v1/persons/${someone.id}/pages`, `/api/v1/persons/${someone.id}/media`, `/api/v1/pages/${owned.id}`, `/api/v1/media/${photo.id}`, `/api/v1/media/${photo.id}/file?size=orig`, `/api/v1/persons/${someone.id}/avatar`]) {
  const r = await reader(p); const t = await r.text()
  say(!r.ok || !(t.includes(someone.givenName) || t.includes('ТАЙНЫЙ') || t.includes('тайное') || p.includes('/file') || p.endsWith('/media') && t !== '[]' || p.endsWith('/pages') && t !== '[]'), `reader: ${p.replace(someone.id, 'LIVING').replace(owned.id, 'PAGE').replace(photo.id, 'PHOTO')}`, `${r.status} ${t.slice(0, 60)}`)
}
for (const p of ['/api/v1/history?limit=500', '/api/v1/media', '/api/v1/text/export', '/api/v1/gedcom/export', '/api/v1/search?q=' + encodeURIComponent(someone.surname), '/api/v1/openapi.json']) {
  const r = await reader(p); const t = await r.text()
  say(!t.includes(`${someone.givenName} ${someone.surname}`) && !t.includes('ТАЙНЫЙ') && !t.includes('Тайна живого') && !t.includes('тайное-фото'), `reader: ${p.split('?')[0]} without the living`, r.status)
}
// A page of a dead person mentioning the living person
const dead = full.persons.find((p) => !p.living)
const mention = await js(await owner('/api/v1/pages', { json: { personId: dead.id, title: 'Упоминание', markdown: `Про [@${someone.givenName} ${someone.surname}](person:${someone.id}) известно.` } }))
{ const t = await (await reader(`/api/v1/pages/${mention.id}`)).text(); say(!t.includes(someone.surname), 'reader: living person in a mention on a page', t.slice(0, 90)) }

// ---- Writes by a reader, and tokens
for (const [m, p, json] of [['POST', '/api/v1/persons', { person: { givenName: 'Х' } }], ['PATCH', `/api/v1/persons/${dead.id}`, { givenName: 'Взлом' }], ['DELETE', `/api/v1/persons/${dead.id}`], ['POST', '/api/v1/pages', { personId: dead.id, title: 'x' }], ['DELETE', `/api/v1/pages/${mention.id}`], ['DELETE', `/api/v1/media/${photo.id}`], ['POST', '/api/v1/text/import', { text: 'Взлом Взломов' }]]) {
  const r = await reader(p, { method: m, ...(json ? { json } : {}) }); say(r.status === 403, `reader writes: ${m} ${p.split('/').slice(3, 4)}`, r.status)
}
{ const h = await js(await owner('/api/v1/history?limit=1')); const r = await reader(`/api/v1/history/${h[0].id}/undo`, { json: {} }); say(r.status === 403, 'reader undoes', r.status) }
{ const t = await js(await owner('/api/v1/tokens', { json: { name: 'bot', role: 'reader', review: true } }))
  const tok = t.token ?? t.value
  const mcp = (body) => anon('/api/mcp', { anon: true, noOrigin: true, headers: { authorization: `Bearer ${tok}`, accept: 'application/json, text/event-stream' }, json: { jsonrpc: '2.0', id: 1, ...body } })
  const list = await (await mcp({ method: 'tools/list' })).text()
  say(!/create_person|delete_person/.test(list), 'read token: no writing tools')
  const call = await (await mcp({ method: 'tools/call', params: { name: 'delete_person', arguments: { id: dead.id } } })).text()
  say(!!(await js(await owner('/api/v1/graph'))).persons.find((p) => p.id === dead.id), 'read token: delete via MCP', call.slice(0, 70))
  const g = await (await mcp({ method: 'tools/call', params: { name: 'search_people', arguments: { query: someone.surname } } })).text()
  say(!g.includes(`${someone.givenName} ${someone.surname}`), 'read token: living person via MCP')
  const api = await anon('/api/v1/users', { anon: true, headers: { authorization: `Bearer ${tok}` } }); say(api.status === 403, 'token: user list', api.status)
  const agent = await anon('/api/agent', { anon: true, noOrigin: true, headers: { authorization: `Bearer ${tok}` }, json: { messages: [{ id: 'a', role: 'user', parts: [{ type: 'text', text: 'x' }] }] } }); say(agent.status === 401 || agent.status === 403, 'token: chat', agent.status)
  await owner(`/api/v1/tokens/${t.id}`, { method: 'DELETE' })
  const after = await anon('/api/v1/graph', { anon: true, headers: { authorization: `Bearer ${tok}` } }); say(after.status === 401, 'revoked token', after.status)
}

// ---- Cross-site requests
{ const r = await owner('/api/v1/settings', { method: 'PATCH', origin: 'https://evil.test', json: { familyName: 'CSRF' } }); say(r.status === 403, 'CSRF: foreign Origin', r.status) }
{ const r = await owner('/api/v1/settings', { method: 'PATCH', noOrigin: true, json: { familyName: 'CSRF2' } }); const n = (await js(await owner('/api/v1/settings'))).familyName; say(n !== 'CSRF2', 'CSRF: write with a cookie but no Origin', `${r.status}, name ${n}`) }
{ const r = await owner('/api/v1/persons', { origin: 'null', json: { person: { givenName: 'Nullorigin', deathDate: '1950' } } }); say(r.status === 403, 'CSRF: Origin null', r.status) }
{ const r = await owner('/api/agent', { origin: 'https://evil.test', json: { messages: [{ id: 'a', role: 'user', parts: [{ type: 'text', text: 'x' }] }] } }); say(r.status === 403, 'CSRF: chat from a foreign site', r.status) }
{ const r = await owner('/api/agent/files', { origin: 'https://evil.test', body: form(png, 'a.png') }); say(r.status === 403, 'CSRF: file to chat from a foreign site', r.status) }
{ const r = await anon('/api/auth/family/accept', { anon: true, origin: 'https://evil.test', json: { token: 'nope' } }); note('sign-in from a foreign Origin (login CSRF)', r.status) }
{ const r = await owner('/api/v1/graph', { headers: { origin: 'https://evil.test' } }); note('CORS on reads', r.headers.get('access-control-allow-origin')) }

// ---- Files
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>window.__xss=1</script></svg>')
for (const [name, data, bad] of [['evil.svg', svg, /image\/svg/], ['evil.html', Buffer.from('<script>window.__xss=1</script>'), /text\/html/], ['evil.png', Buffer.from('<html><script>window.__xss=1</script></html>'), /text\/html|image\/png/], ['../../../../tmp/evil.png', png, null], ['a\r\nSet-Cookie: x=1.png', png, null], ['"><img src=x onerror=alert(1)>.png', png, null]]) {
  const m = await owner('/api/v1/media', { body: form(data, name) }); const j = await js(m)
  if (!m.ok) { note(`upload ${name}`, m.status); continue }
  const f = await owner(`/api/v1/media/${j.id}/file?size=orig`)
  const type = f.headers.get('content-type'), disp = f.headers.get('content-disposition')
  say(!(bad && bad.test(type)) && !f.headers.getSetCookie().some((c) => c.startsWith('x=')), `file ${JSON.stringify(name).slice(1, 30)}`, `${type}; ${disp ?? 'shown in the browser'}; nosniff ${f.headers.get('x-content-type-options')}`)
}
{ const t = Date.now(); const bomb = await import('node:zlib').then((z) => { const w = 30000, h = 30000; const crc = (b) => { let c, r = -1; for (const x of b) { c = (r ^ x) & 255; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; r = (r >>> 8) ^ c } return (r ^ -1) >>> 0 }; const ch = (n, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const a = Buffer.concat([Buffer.from(n), d]); const k = Buffer.alloc(4); k.writeUInt32BE(crc(a)); return Buffer.concat([l, a, k]) }; const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', z.deflateSync(Buffer.alloc(1000))), ch('IEND', Buffer.alloc(0))]) })
  const r = await owner('/api/v1/media', { body: form(bomb, 'bomb.png') }); const h = await anon('/api/health', { anon: true }); say(h.ok && Date.now() - t < 20000, 'image bomb 30000×30000', `${r.status} in ${Date.now() - t} ms`) }
{ const up = await editor('/api/agent/files', { body: form(Buffer.from('секрет редактора'), 'личное.txt') }); const j = await js(up); if (j?.url) { for (const [w, x] of [['reader', reader], ['owner', owner]]) { const r = await x(j.url); say(r.status !== 200, `someone else's chat file: ${w}`, r.status) } say((await reader(`/api/agent/files/..%2f..%2f..%2fauth-secret`)).status !== 200, 'chat file: path escape') } else note('chat files are off', up.status) }

// ---- Server-side requests
for (const url of ['http://127.0.0.1:3000/api/health', 'http://localhost:3000/', 'http://[::1]:3000/', 'http://[::ffff:7f00:1]:3000/api/health', 'http://[::ffff:127.0.0.1]:3000/', 'http://169.254.169.254/latest/meta-data/', 'http://2130706433:3000/', 'http://0x7f.0.0.1:3000/', 'http://0/', 'http://127.1:3000/', 'file:///etc/passwd', 'http://[fd00::1]/', 'http://192.168.0.1/', 'http://10.0.0.1/']) {
  const r = await owner('/api/v1/media', { json: { url } }); const t = await r.text()
  say(!r.ok, `SSRF ${url}`, `${r.status} ${t.slice(0, 70)}`)
}

// ---- Stored markup, for the browser to check
const xss = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>'
const stored = await js(await owner('/api/v1/persons', { json: { person: { givenName: xss, surname: '"><svg onload=window.__xss=1>', deathDate: '1950', birthPlace: xss, tags: [xss], facts: [{ kind: xss, date: xss, place: xss, note: xss }], sources: [{ id: 's', title: xss, ref: xss, page: '', url: 'javascript:window.__xss=1' }] } } }))
await owner('/api/v1/pages', { json: { personId: stored.id, title: xss, markdown: `# ${xss}\n\n[клик](javascript:window.__xss=1)\n\n![x](x" onerror="window.__xss=1)\n\n<iframe src="javascript:window.__xss=1"></iframe>` } })
await owner('/api/v1/text/import', { json: { text: `<img src=x onerror=window.__xss=1> Импортов d: 1950` } })
await owner('/api/v1/settings', { method: 'PATCH', json: { familyName: '<img src=x onerror=window.__xss=1>' } })
note('browser markup saved on the person', stored.id)
for (const j of [['GET', `/api/v1/persons/${stored.id}`]]) { const r = await owner(j[1]); note('response type with markup', r.headers.get('content-type')) }

// ---- Injection and overload
for (const q of [`' OR 1=1 --`, `"; DROP TABLE persons; --`, `%' UNION SELECT * FROM user --`]) { const r = await reader(`/api/v1/search?q=${encodeURIComponent(q)}`); const t = await r.text(); say(!/secret|password|@invite/.test(t), `SQL in search ${q.slice(0, 16)}`, r.status) }
{ const n = (await js(await owner('/api/v1/graph'))).persons.length; say(n > 0, 'tables still there', n) }
{ const t = Date.now(); const r = await owner('/api/v1/text/preview', { json: { text: `${'а '.repeat(200000)}b: ${'x,'.repeat(200000)}` } }); say(Date.now() - t < 8000, 'heavy import text', `${r.status} in ${Date.now() - t} ms`) }
{ const t = Date.now(); const r = await owner('/api/v1/text/preview', { json: { text: Array.from({ length: 60000 }, (_, i) => `${' '.repeat(i % 50)}Имя${i} + Жена${i}`).join('\n') } }); say(Date.now() - t < 15000, 'import of 60 thousand lines', `${r.status} in ${Date.now() - t} ms`) }
{ const t = Date.now(); const deep = '['.repeat(100000) + ']'.repeat(100000); const r = await owner('/api/v1/pages', { json: { personId: dead.id, title: 'глубокий' }, body: undefined }); await owner('/api/agent', { headers: { 'content-type': 'application/json' }, body: `{"messages":${deep}}` }); const h = await anon('/api/health', { anon: true }); say(h.ok && Date.now() - t < 8000, 'deeply nested JSON', `in ${Date.now() - t} ms`); void r }
{ const big = 'х'.repeat(6 * 1024 * 1024); const r = await owner('/api/agent', { json: { messages: [{ id: 'a', role: 'user', parts: [{ type: 'text', text: big }] }] } }); say(r.status === 413, 'huge chat message does not reach the model', r.status) }
{ const big = 'х'.repeat(500000); const r = await owner('/api/v1/persons', { json: { person: { givenName: big, deathDate: '1950' } } }); note('name of 500k characters from a person', r.status) }

// ---- Losing access
{ const j = jar(); await j('/api/auth/family/accept', { json: { token: await invite('reader') } }); const me = await js(await j('/api/v1/me')); await owner(`/api/v1/users/${me.id}`, { method: 'DELETE' }); say((await j('/api/v1/me')).status === 401 && (await j('/api/v1/graph')).status === 401, 'deleted user loses access at once', (await j('/api/v1/me')).status) }
{ const j = jar(); await j('/api/auth/family/accept', { json: { token: await invite('editor') } }); const me = await js(await j('/api/v1/me')); await owner(`/api/v1/users/${me.id}`, { method: 'PATCH', json: { role: 'reader' } }); const r = await j('/api/v1/persons', { json: { person: { givenName: 'Понижен', deathDate: '1950' } } }); say(r.status === 403, 'demoted role applies at once', r.status) }
{ const i = await js(await owner('/api/v1/invites')); note('unused invites stored', i.length) }
{ const r = await owner('/api/auth/list-sessions'); note('can one see own sessions', r.status); const rv = await owner('/api/auth/revoke-other-sessions', { json: {} }); note('revoking other sessions', rv.status) }

// ---- Headers
{ const r = await anon('/login', { anon: true }); for (const h of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'strict-transport-security', 'x-powered-by']) note(`header ${h}`, r.headers.get(h)); const csp = r.headers.get('content-security-policy') ?? ''; say(/img-src|default-src/.test(csp), 'CSP limits images', csp); say(/script-src|default-src/.test(csp), 'CSP limits scripts'); say(/connect-src|default-src/.test(csp), 'CSP limits outbound requests'); say(!r.headers.get('x-powered-by'), 'X-Powered-By hidden') }
await new Promise((r) => setTimeout(r, 70000))
{ const t = Date.now(); let limited = 0; for (let i = 0; i < 150; i++) { const r = await anon('/api/auth/family/accept', { anon: true, json: { token: `guess${i}` } }); if (r.status === 429) limited++ } say(limited > 0, 'invite guessing is limited', `150 attempts in ${Date.now() - t} ms, 429 refusals: ${limited}`) }
console.log(`\nchecks ${out.length}, holes ${out.filter((x) => !x).length}`)
