// Counts how many lines of CaretFlow each model (and each person) wrote, using `git blame`.
// Every non-blank line is credited to the commit that last touched it. That commit's author is:
//   1. the model named in scripts/ai-attribution.json for that commit, if listed, else
//   2. the first AI co-author trailer, e.g. "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>", else
//   3. the human git author of the commit.
// Lock files, binary assets and the generated stats file are not counted.
// Output: src/ai-stats.json (read by the About dialog). Run automatically by `npm run build`.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'src', 'ai-stats.json')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

const SKIP = (f) =>
  /(^|\/)(package-lock\.json|Cargo\.lock)$/.test(f) || /\.(png|ico|icns|jpg|gif|webp|svg|wasm)$/i.test(f) || f === 'src/ai-stats.json'

// Names / e-mail domains that identify an AI co-author
const AI_NAME = /\b(claude|gpt|chatgpt|codex|openai|gemini|bard|copilot|cursor|devin|llama|mistral|grok|deepseek|qwen|jules|windsurf|aider|ai assistant)\b/i
const AI_MAIL = /@(anthropic\.com|openai\.com|google\.com|cursor\.(sh|com)|github\.com|x\.ai|mistral\.ai|deepseek\.com)$|noreply.*(anthropic|openai|cursor|gemini)/i

/** First AI co-author trailer of a commit message, or null. */
function aiCoAuthor(body) {
  for (const m of body.matchAll(/^co-authored-by:\s*(.+?)\s*<([^>]*)>\s*$/gim)) {
    const [, name, mail] = m
    if (AI_NAME.test(name) || AI_MAIL.test(mail)) return name.trim()
  }
  return null
}

function compute() {
  const head = git('rev-parse', 'HEAD').trim()
  const manual = JSON.parse(readFileSync(join(root, 'scripts', 'ai-attribution.json'), 'utf8')).commits || {}
  // sha -> { name, kind }
  const authorOf = new Map()
  for (const rec of git('log', '--format=%H%x00%an%x00%B%x1e').split('\x1e')) {
    const [sha, human = '', body = ''] = rec.trim().split('\x00')
    if (!sha) continue
    const model = manual[sha]?.model || aiCoAuthor(body)
    authorOf.set(sha, model ? { name: model, kind: 'ai' } : { name: human || 'Unknown', kind: 'human' })
  }

  const files = git('ls-files').split('\n').filter((f) => f && !SKIP(f))
  const authors = new Map() // name -> { name, kind, lines, commits:Set }
  let total = 0
  let uncommitted = 0
  for (const f of files) {
    if (!existsSync(join(root, f))) continue
    // blame the working tree so uncommitted edits show up as such
    const out = git('blame', '--line-porcelain', '--', f)
    let sha = null
    for (const line of out.split('\n')) {
      if (/^[0-9a-f]{40} \d+ \d+/.test(line)) sha = line.slice(0, 40)
      else if (line.startsWith('\t')) {
        if (!line.slice(1).trim()) continue // blank line
        total++
        if (/^0{40}$/.test(sha)) {
          uncommitted++
          continue
        }
        const who = authorOf.get(sha) || { name: 'Unknown', kind: 'human' }
        const a = authors.get(who.name) || authors.set(who.name, { ...who, lines: 0, commits: new Set() }).get(who.name)
        a.lines++
        a.commits.add(sha)
      }
    }
  }
  const byAuthor = [...authors.values()]
    .map((a) => ({ name: a.name, kind: a.kind, lines: a.lines, commits: a.commits.size }))
    .sort((a, b) => b.lines - a.lines)
  const ai = byAuthor.filter((a) => a.kind === 'ai').reduce((s, a) => s + a.lines, 0)
  return {
    generatedAt: new Date().toISOString(),
    commit: head.slice(0, 7),
    total,
    ai,
    human: total - ai - uncommitted,
    uncommitted,
    commits: authorOf.size,
    files: files.length,
    byAuthor,
  }
}

try {
  const stats = compute()
  writeFileSync(outFile, JSON.stringify(stats, null, 2) + '\n')
  const pct = stats.total ? ((stats.ai / stats.total) * 100).toFixed(1) : '0'
  console.log(`ai-stats: ${stats.total} lines, ${pct}% by AI`)
  for (const a of stats.byAuthor) console.log(`  ${a.name.padEnd(32)} ${String(a.lines).padStart(6)}  (${a.kind})`)
  if (stats.uncommitted) console.log(`  ${'not committed yet'.padEnd(32)} ${String(stats.uncommitted).padStart(6)}`)
} catch (e) {
  // e.g. building from a copy without .git (the Linux build in WSL): keep the existing file
  if (!existsSync(outFile)) writeFileSync(outFile, JSON.stringify({ unavailable: true }) + '\n')
  console.log('ai-stats: git not available, keeping existing stats (' + (e.message || e).split('\n')[0] + ')')
}
