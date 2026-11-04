// Writes latest.json, the manifest the in-app updater reads from
// https://github.com/<repo>/releases/latest/download/latest.json
//
// Usage: node scripts/update-manifest.mjs <dir with release files and .sig files> [--out latest.json]
//        [--notes notes.md] [--repo Sooeeren/folio] [--version 1.2.3]
// Only files that have a .sig next to them (signed by `tauri build` with createUpdaterArtifacts)
// end up in the manifest. CaretFlow-portable.exe and the raw Linux binary are left out on purpose:
// they can't be updated in place, so the app only shows them a download link.
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf('--' + name)
  return i >= 0 ? args.splice(i, 2)[1] : def
}
const root = path.resolve(import.meta.dirname, '..')
const out = opt('out', null)
const notesFile = opt('notes', null)
const repo = opt('repo', 'Sooeeren/folio')
const version = opt('version', JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version)
const dir = args[0]
if (!dir) throw new Error('usage: node scripts/update-manifest.mjs <dir> [--out file] [--notes file]')

// file name → updater target ({os}-{arch}-{bundle type}, see tauri-plugin-updater)
const TARGETS = [
  [/-setup\.exe$/i, 'windows-x86_64-nsis'],
  [/\.AppImage$/, 'linux-x86_64-appimage'],
  [/\.deb$/, 'linux-x86_64-deb'],
  [/\.rpm$/, 'linux-x86_64-rpm'],
]

const files = fs.readdirSync(dir, { recursive: true }).map(String)
const platforms = {}
for (const f of files) {
  const t = TARGETS.find(([re]) => re.test(f))
  if (!t || !files.includes(f + '.sig')) continue
  const name = path.basename(f)
  platforms[t[1]] = {
    signature: fs.readFileSync(path.join(dir, f + '.sig'), 'utf8').trim(),
    url: `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(name)}`,
  }
}
if (!Object.keys(platforms).length) throw new Error(`no signed release files (*.sig) in ${dir}`)

let notes = notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8').trim() : ''
if (/^release notes to follow\.?$/i.test(notes)) notes = '' // placeholder from release.yml

const manifest = { version, notes, pub_date: new Date().toISOString(), platforms }
const target = out || path.join(dir, 'latest.json')
fs.writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n')
console.log(`${target}: ${version} for ${Object.keys(platforms).join(', ')}`)
