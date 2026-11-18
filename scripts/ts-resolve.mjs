import { existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXT = ['.ts', '.tsx', '/index.ts', '/index.tsx']

function find(base) {
  if (existsSync(base) && statSync(base).isFile()) return base
  for (const e of EXT) if (existsSync(base + e) && statSync(base + e).isFile()) return base + e
  return null
}

export async function resolve(specifier, context, next) {
  let base = null
  if (specifier.startsWith('@/')) base = path.join(root, specifier.slice(2))
  else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
  const hit = base && find(base)
  if (hit && hit.endsWith('.json')) return { url: pathToFileURL(hit).href, importAttributes: { type: 'json' }, shortCircuit: true }
  if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true }
  return next(specifier, context)
}
