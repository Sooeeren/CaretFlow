// Computes how many lines of Folio were written by AI, using `git blame`.
// A line counts as AI-written when the commit that last touched it carries a
// "Co-Authored-By: Claude" trailer, or is listed in scripts/ai-attribution.json.
// Blank lines, lock files and binary assets are not counted.
// Output: src/ai-stats.json (read by the About dialog). Run automatically by `npm run build`.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'src', 'ai-stats.json')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const AREAS = [
  ['Editor & app (JavaScript)', (f) => /^src\/.*\.(js|mjs)$/.test(f) || f === 'index.html'],
  ['Styles (CSS)', (f) => f.endsWith('.css')],
  ['Native backend (Rust)', (f) => f.endsWith('.rs')],
  ['Build scripts', (f) => /^scripts\//.test(f) || f === 'vite.config.js'],
  ['Configuration', (f) => /\.(json|toml)$/.test(f) || f.startsWith('.git')],
  ['Docs & guide', (f) => f.endsWith('.md')],
]
const SKIP = (f) =>
  /(^|\/)(package-lock\.json|Cargo\.lock)$/.test(f) || /\.(png|ico|icns|jpg|gif|webp|svg)$/i.test(f) || f === 'src/ai-stats.json'

function compute() {
  const head = git('rev-parse', 'HEAD').trim()
  const extra = JSON.parse(readFileSync(join(root, 'scripts', 'ai-attribution.json'), 'utf8')).aiCommits || {}
  // sha -> isAI
  const isAI = new Map()
  const log = git('log', '--format=%H%x00%B%x1e')
  for (const rec of log.split('\x1e')) {
    const [sha, body = ''] = rec.trim().split('\x00')
    if (sha) isAI.set(sha, /co-authored-by:\s*claude/i.test(body) || sha in extra)
  }
  const files = git('ls-files').split('\n').filter((f) => f && !SKIP(f))
  const areas = new Map(AREAS.map(([name]) => [name, { area: name, total: 0, ai: 0 }]))
  let total = 0
  let ai = 0
  let uncommitted = 0
  for (const f of files) {
    if (!existsSync(join(root, f))) continue
    const area = (AREAS.find(([, test]) => test(f)) || ['Configuration'])[0]
    // blame the working tree so uncommitted edits show up as such
    const out = git('blame', '--line-porcelain', '--', f)
    let sha = null
    for (const line of out.split('\n')) {
      if (/^[0-9a-f]{40} \d+ \d+/.test(line)) sha = line.slice(0, 40)
      else if (line.startsWith('\t')) {
        if (!line.slice(1).trim()) continue // blank line
        const a = areas.get(area)
        total++
        a.total++
        if (/^0{40}$/.test(sha)) uncommitted++
        else if (isAI.get(sha)) {
          ai++
          a.ai++
        }
      }
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    commit: head.slice(0, 7),
    total,
    ai,
    human: total - ai - uncommitted,
    uncommitted,
    commits: isAI.size,
    aiCommits: [...isAI.values()].filter(Boolean).length,
    files: files.length,
    byArea: [...areas.values()].filter((a) => a.total > 0),
  }
}

try {
  const stats = compute()
  writeFileSync(outFile, JSON.stringify(stats, null, 2) + '\n')
  const pct = stats.total ? ((stats.ai / stats.total) * 100).toFixed(1) : '0'
  console.log(`ai-stats: ${stats.ai} of ${stats.total} lines written by AI (${pct}%), ${stats.uncommitted} uncommitted`)
} catch (e) {
  // e.g. building from a copy without .git (the Linux build in WSL): keep the existing file
  if (!existsSync(outFile)) writeFileSync(outFile, JSON.stringify({ unavailable: true }) + '\n')
  console.log('ai-stats: git not available, keeping existing stats (' + (e.message || e).split('\n')[0] + ')')
}
