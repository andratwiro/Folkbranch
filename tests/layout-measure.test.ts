// Prints the line-tidiness numbers of lib/graph/layout.ts on the demo family and on a generated 2,000-person family.
// Off in the normal run; to reproduce the table in a pull request: LINE_METRICS=metrics.json pnpm vitest run tests/layout-measure.test.ts
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { buildGraph, randomFamily } from './layout-quality'
import { demoGraph, lineMetrics } from './layout-metrics'
import type { Person } from '../lib/types'

const year = (s: string) => +(s.match(/\d{4}/)?.[0] ?? NaN) || undefined

/** The GEDCOM from tests/ui/gen-placed-family.py, read for what the chart needs: sex, birth year, parents and unions. */
function generated(n: number) {
  const ged = execFileSync('python3', ['tests/ui/gen-placed-family.py', String(n)], { encoding: 'utf8', maxBuffer: 1 << 28 })
  const people: [string, Person['sex'], number?][] = [], parents: [string, string][] = [], unions: [string, string][] = []
  for (const block of ged.split(/\n(?=0 )/)) {
    const lines = block.split('\n')
    const id = lines[0].match(/@(\w+)@/)?.[1] ?? ''
    if (lines[0].endsWith('INDI')) people.push([id, (block.match(/1 SEX (\w)/)?.[1] ?? 'U') as Person['sex'], year(block.match(/1 BIRT\n2 DATE (\d+)/)?.[1] ?? '')])
    else if (lines[0].endsWith('FAM')) {
      const h = block.match(/1 HUSB @(\w+)@/)?.[1], w = block.match(/1 WIFE @(\w+)@/)?.[1]
      if (h && w) unions.push([h, w])
      for (const c of block.matchAll(/1 CHIL @(\w+)@/g)) for (const p of [h, w]) if (p) parents.push([p, c[1]])
    }
  }
  return buildGraph(people, parents, unions)
}

describe.skipIf(!process.env.LINE_METRICS)('line metrics', () => {
  it('prints the numbers', () => {
    const rows = { 'demo family': lineMetrics(demoGraph()), 'generated 2000': lineMetrics(generated(2000)), 'random 150': lineMetrics(randomFamily(4, 150)), 'random 600': lineMetrics(randomFamily(6, 600)) }
    writeFileSync(process.env.LINE_METRICS!, JSON.stringify(rows, null, 1))
  }, 120_000)
})
