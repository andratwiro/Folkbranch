// A language model for browser checks: speaks the OpenAI chat protocol (what the "local model" provider uses), answers
// from a script chosen by the last question, and costs nothing. It sends slowly on purpose, so the screen can be watched
// while the assistant works. Questions it understands:
//   READ:<id>,<id>,...   the model asks for get_people, writing the call out slowly, then says "Done." after the answer
//   anything else         a short answer after a pause
import { createServer } from 'node:http'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: 'stub', object: 'chat.completion.chunk', created: 0, model: 'stub', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const text = (m) => (typeof m?.content === 'string' ? m.content : (m?.content ?? []).map((p) => p.text ?? '').join(''))

/** The Authorization header of every request the stub has answered, so a check can see which key reached it. */
export const seenKeys = []

export function startModelStub(port, { pause = 700, piece = 450 } = {}) {
  const server = createServer(async (req, res) => {
    // The list of models, as an OpenAI-protocol server gives it: what a provider added by address offers to pick from.
    if (req.method === 'GET' && req.url === '/__keys') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(seenKeys)); return }
    if (req.method === 'GET' && req.url?.endsWith('/models')) { seenKeys.push(req.headers.authorization ?? ''); res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'stub-small' }, { id: 'stub-large' }] })); return }
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) { res.writeHead(404).end(); return }
    let raw = ''
    for await (const c of req) raw += c
    const body = JSON.parse(raw)
    seenKeys.push(req.headers.authorization ?? '')
    if (process.env.STUB_LOG) console.log('stub asked:', body.messages.map((m) => m.role).join(','), text(body.messages.at(-1)).slice(0, 60))
    const last = body.messages.at(-1)
    const ask = text([...body.messages].reverse().find((m) => m.role === 'user'))
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const usage = `data: ${JSON.stringify({ id: 'stub', object: 'chat.completion.chunk', created: 0, model: 'stub', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`
    const say = async (s) => { await sleep(pause); res.write(chunk({ role: 'assistant', content: s.slice(0, 4) })); await sleep(80); res.write(chunk({ content: s.slice(4) })) }
    const done = (reason) => { res.write(chunk({}, reason)); res.write(usage); res.end('data: [DONE]\n\n') }
    const ids = /READ:([\w,-]+)/.exec(ask)?.[1]?.split(',')
    if (last.role === 'tool') { await say('Done.'); return done('stop') }
    if (ids) {
      // The call is written out id by id, so the step is on screen, partly written, for seconds.
      await sleep(pause)
      res.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_stub', type: 'function', function: { name: 'get_people', arguments: '{"ids":[' } }] }))
      for (const [i, id] of ids.entries()) { await sleep(piece); res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: `${i ? ',' : ''}${JSON.stringify(id)}` } }] })) }
      res.write(chunk({ tool_calls: [{ index: 0, function: { arguments: ']}' } }] }))
      return done('tool_calls')
    }
    await say('Hello.')
    done('stop')
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${port}`, stop: () => server.close() })))
}
