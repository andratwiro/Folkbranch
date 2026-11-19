// Builds the text of a GitHub release from the changelog, the way well-run open source projects lay it out:
// a plain-language opening, the highlights, how to upgrade, everything that changed, the pull requests that
// were merged, who contributed, and a link to the full comparison.
//
//   node scripts/release-notes.mjs 1.8.0 [previous-tag]   (needs git history and, for the pull requests, GH_TOKEN)
//
// CHANGELOG.md stays the one source. A version's section may hold, in this order: an opening paragraph, then
// `### Highlights`, `### Upgrading` and the usual `### Security / Added / Changed / Fixed / Removed` groups.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const GROUPS = [
  ['Security', '🔒 Security'],
  ['Added', '✨ Added'],
  ['Changed', '🔧 Changed'],
  ['Fixed', '🐛 Fixed'],
  ['Removed', '🗑️ Removed'],
]
const UPGRADE = [
  'Update the way you installed it: run the install command again, or `docker compose pull && docker compose up -d`. Your archive and photos stay where they are.',
  'The server takes a copy of the database before an update that changes it, and the migrations only add.',
]

/** The text of one version's section, without its `## X.Y.Z - date` heading. */
export function sectionOf(changelog, version) {
  const lines = changelog.split('\n')
  const start = lines.findIndex((l) => l.startsWith(`## ${version} `) || l === `## ${version}`)
  if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}`)
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim()
}

/** The opening paragraphs, then each `### Name` block. */
export function parseSection(section) {
  const parts = section.split(/^### /m)
  const blocks = new Map(parts.slice(1).map((p) => { const nl = p.indexOf('\n'); return [p.slice(0, nl).trim(), p.slice(nl + 1).trim()] }))
  return { intro: parts[0].trim(), blocks }
}

/**
 * @param {{ version: string, date?: string, section: string, prs?: { number: number, title: string, author: string }[],
 *   contributors?: { login: string, first?: boolean }[], compare?: string, repo?: string }} input
 */
export function buildNotes({ version, date, section, prs = [], contributors = [], compare, repo }) {
  const { intro, blocks } = parseSection(section)
  const out = []
  out.push(`# Folkbranch ${version}${date ? ` · ${date}` : ''}`, '')
  if (intro) out.push(intro.split('\n\n').map((p) => `> ${p.replace(/\n/g, ' ')}`).join('\n>\n'), '')
  if (blocks.has('Highlights')) out.push('## ✨ What is new for you', '', blocks.get('Highlights'), '')
  out.push('## ⬆️ Upgrading', '', blocks.get('Upgrading') ?? UPGRADE.map((l) => `- ${l}`).join('\n'), '')
  const rest = GROUPS.filter(([name]) => blocks.has(name))
  if (rest.length) {
    out.push('## 📋 Everything that changed', '')
    for (const [name, title] of rest) out.push(`### ${title}`, '', blocks.get(name), '')
  }
  const other = [...blocks.keys()].filter((k) => !['Highlights', 'Upgrading', ...GROUPS.map((g) => g[0])].includes(k))
  for (const name of other) out.push(`### ${name}`, '', blocks.get(name), '')
  if (prs.length) {
    out.push('## 🔀 Merged pull requests', '')
    for (const p of [...prs].sort((a, b) => a.number - b.number)) out.push(`- ${repo ? `${repo}#${p.number}` : `#${p.number}`} ${p.title} by @${p.author}`)
    out.push('')
  }
  if (contributors.length) {
    out.push('## 🙌 Contributors', '')
    out.push(contributors.map((c) => `@${c.login}${c.first ? ' (first contribution)' : ''}`).join(', '), '')
  }
  if (compare) out.push(`**Full changelog**: ${compare}`, '')
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

/** The highest earlier version tag. */
function previousTag(version) {
  const key = (t) => t.replace(/^v/, '').split('.').map(Number)
  const less = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false }
  const now = version.split('.').map(Number)
  return git('tag', '--list', 'v*').split('\n').filter((t) => /^v\d+\.\d+\.\d+$/.test(t) && less(key(t), now))
    .sort((a, b) => (less(key(a), key(b)) ? -1 : 1)).pop()
}

function main() {
  const version = process.argv[2]
  if (!version) throw new Error('usage: release-notes.mjs <version> [previous-tag]')
  const tag = `v${version}`
  const prev = process.argv[3] ?? previousTag(version)
  const repo = process.env.GITHUB_REPOSITORY ?? 'danarkhipov/Folkbranch'
  const changelog = readFileSync('CHANGELOG.md', 'utf8')
  const date = changelog.match(new RegExp(`^## ${version.replace(/\./g, '\\.')} - (\\S+)`, 'm'))?.[1]
  const prs = []
  const contributors = new Map()
  if (prev) {
    try {
      // A pull request is in this release when its last commit is in the tag and was not in the previous one.
      const contains = (oid, ref) => { try { git('merge-base', '--is-ancestor', oid, ref); return true } catch { return false } }
      const merged = JSON.parse(gh('pr', 'list', '--repo', repo, '--state', 'merged', '--limit', '200', '--json', 'number,title,author,headRefOid'))
      for (const p of merged) if (p.headRefOid && contains(p.headRefOid, tag) && !contains(p.headRefOid, prev)) prs.push({ number: p.number, title: p.title, author: p.author.login })
      const before = new Set(JSON.parse(gh('pr', 'list', '--repo', repo, '--state', 'merged', '--limit', '500', '--json', 'number,author')).filter((p) => !prs.some((q) => q.number === p.number)).map((p) => p.author.login))
      for (const p of prs) if (!p.author.endsWith('[bot]') && !p.author.startsWith('app/')) contributors.set(p.author, { login: p.author, first: !before.has(p.author) })
    } catch { /* without GitHub access the notes simply have no pull request list */ }
  }
  const compare = prev ? `https://github.com/${repo}/compare/${prev}...${tag}` : undefined
  process.stdout.write(buildNotes({ version, date, section: sectionOf(changelog, version), prs, contributors: [...contributors.values()], compare, repo: undefined }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
