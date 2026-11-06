// Cloud Sync (lazy, optional, off by default): two-way sync between a local folder and storage the
// user sets up themselves. CaretFlow has no servers or accounts of its own. Backends:
//   WebDAV  — Nextcloud, ownCloud, Synology/QNAP, pCloud, Koofr, Box, any WebDAV server
//   S3      — AWS, Backblaze B2, Cloudflare R2, Wasabi, MinIO, any S3-compatible storage
//   rclone  — Google Drive, Proton Drive, OneDrive, Dropbox … through the user's own rclone remotes
// The network and file work happens in Rust (src-tauri/src/cloud.rs); file contents never pass
// through here except to compare two versions.
//
// How changes are detected: after every sync the state of each file is remembered (local mtime and
// size, the cloud's ETag or modification stamp). Next time, whichever side differs from that record
// changed. Both changed = conflict; by default both versions are kept. Files deleted on this
// computer by a sync go to CaretFlow's sync trash, never straight to oblivion.
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'
import * as P from './paths.js'

let ctx // { settings, saveSettings, el, toast, dialog, log, customSelect, showContextMenu, openFile, openPrefs, fileChanged, showCloudTab }
const STATE_KEY = 'folio.cloud'
const OPEN_DIRS_KEY = 'folio.cloud.openDirs'

export const PROVIDERS = [
  ['webdav', 'WebDAV (Nextcloud, ownCloud, NAS, …)'],
  ['s3', 'S3-compatible (AWS, B2, R2, MinIO, …)'],
  ['rclone', 'rclone (Google Drive, Proton Drive, OneDrive, …)'],
]

// ════════════════════════════════════════ small helpers
const enc = new TextEncoder()
const dec = new TextDecoder()
const b64 = (bytes) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s) => Uint8Array.from(atob(s || ''), (c) => c.charCodeAt(0))
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
const encPath = (rel) => rel.split('/').map(rfc3986).join('/')
const cleanTag = (t) => (t || '').replace(/^W\//, '').replace(/"/g, '')
const pad = (n) => String(n).padStart(2, '0')
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
const s = () => ctx.settings

function ago(t) {
  if (!t) return 'never'
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(t).toLocaleDateString()
}
const size = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`)

class CloudError extends Error {}
class Cancelled extends Error {}

async function http(req) {
  const r = await invoke('cloud_http', { req })
  r.header = (name) => r.headers.find(([k]) => k.toLowerCase() === name)?.[1] ?? null
  r.text = () => dec.decode(unb64(r.body))
  r.ok = r.status >= 200 && r.status < 300
  return r
}

function httpError(r, what) {
  if (r.status === 401 || r.status === 403) return new CloudError(`${what}: the server refused the login (${r.status}). Check the user name and password.`)
  if (r.status === 404) return new CloudError(`${what}: not found on the server (404). Check the address.`)
  let detail = ''
  try {
    const x = new DOMParser().parseFromString(r.text(), 'application/xml')
    detail = x.querySelector('Message, message')?.textContent || x.querySelector('Code')?.textContent || ''
  } catch {}
  return new CloudError(`${what}: the server answered ${r.status}${detail ? ' — ' + detail : ''}`)
}

/** Exclude patterns, one per line: `*` stays inside a folder, `**` crosses folders; a trailing / means a folder. */
function excluder(text) {
  const res = (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const dir = l.endsWith('/')
      const pat = l.replace(/^\/|\/$/g, '')
      const body = pat
        .split('**')
        .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
        .join('.*')
      // no slash: matches a name at any depth, like .gitignore
      const lead = pat.includes('/') ? '^' : '(^|/)'
      return new RegExp(lead + body + (dir ? '/' : '($|/)'), 'i')
    })
  return (rel) => res.some((r) => r.test(rel))
}

// ════════════════════════════════════════ AWS Signature Version 4 (S3)
async function sha256hex(data) {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data))
}
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(msg))
}

/** Signs one request. `path` is already URI-encoded; returns the headers to send (host is left to the HTTP client). */
export async function sigv4({ method, host, path, query = {}, headers = {}, payloadHash, region, service = 's3', accessKey, secretKey, amzDate }) {
  const day = amzDate.slice(0, 8)
  const h = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v
  const names = Object.keys(h).sort()
  const canonHeaders = names.map((n) => `${n}:${String(h[n]).trim().replace(/\s+/g, ' ')}\n`).join('')
  const signed = names.join(';')
  const qs = Object.keys(query)
    .map((k) => [rfc3986(k), rfc3986(query[k])])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const creq = [method, path, qs, canonHeaders, signed, payloadHash].join('\n')
  const scope = `${day}/${region}/${service}/aws4_request`
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256hex(creq)].join('\n')
  let k = await hmac('AWS4' + secretKey, day)
  for (const part of [region, service, 'aws4_request']) k = await hmac(k, part)
  const sig = hex(await hmac(k, sts))
  delete h.host
  h.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${sig}`
  return { headers: h, qs }
}

// ════════════════════════════════════════ backends
// Each backend: list() → Map(rel → { tag, size, mtime }); download(rel, abs); upload(rel, abs) → tag | null;
// remove(rel); bytes(rel) → Uint8Array; test() → { ok, msg, missing? }; create() (make the cloud folder)

function webdav(cfg) {
  const base = cfg.url.replace(/\/*$/, '/')
  let url
  try {
    url = new URL(base)
  } catch {
    throw new CloudError('The WebDAV address is not a valid URL.')
  }
  if (!/^https?:$/.test(url.protocol)) throw new CloudError('The WebDAV address must start with https:// (or http://).')
  const basePath = decodeURIComponent(url.pathname)
  const auth = cfg.user || cfg.pass ? { Authorization: 'Basic ' + b64(enc.encode(`${cfg.user}:${cfg.pass}`)) } : {}
  const hdrs = (extra = {}) => Object.entries({ ...auth, ...extra })
  const fileUrl = (rel) => base + encPath(rel)
  const dirs = new Set([''])
  const PROPS =
    '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>'

  async function propfind(dirUrl, depth) {
    return http({ method: 'PROPFIND', url: dirUrl, headers: hdrs({ Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' }), body: b64(enc.encode(PROPS)) })
  }
  function parse(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const out = []
    for (const r of doc.getElementsByTagNameNS('DAV:', 'response')) {
      const href = r.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent
      if (!href) continue
      let path
      try {
        path = decodeURIComponent(new URL(href, base).pathname)
      } catch {
        continue
      }
      if (!path.startsWith(basePath)) continue
      const rel = path.slice(basePath.length).replace(/^\/+|\/+$/g, '')
      const prop = (n) => r.getElementsByTagNameNS('DAV:', n)[0]
      const dir = !!prop('resourcetype')?.getElementsByTagNameNS('DAV:', 'collection').length
      const mod = Date.parse(prop('getlastmodified')?.textContent || '') || 0
      const len = +(prop('getcontentlength')?.textContent || 0)
      const etag = cleanTag(prop('getetag')?.textContent)
      out.push({ rel, dir, size: len, mtime: mod, tag: etag || `${mod}-${len}` })
    }
    return out
  }
  async function mkdirs(rel) {
    const parts = rel.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) {
      const d = parts.slice(0, i).join('/')
      if (dirs.has(d)) continue
      const r = await http({ method: 'MKCOL', url: fileUrl(d) + '/', headers: hdrs() })
      // 405 = it exists already
      if (!r.ok && r.status !== 405) throw httpError(r, `Could not create the folder “${d}”`)
      dirs.add(d)
    }
  }
  return {
    label: url.host + basePath.replace(/\/$/, ''),
    async list() {
      const files = new Map()
      const queue = ['']
      while (queue.length) {
        const batch = queue.splice(0, 4)
        const results = await Promise.all(batch.map((d) => propfind(d ? fileUrl(d) + '/' : base, 1).then((r) => [d, r])))
        for (const [d, r] of results) {
          if (r.status !== 207) throw httpError(r, d ? `Listing “${d}”` : 'Listing the cloud folder')
          for (const e of parse(r.text())) {
            if (e.rel === d || !e.rel) continue
            const name = e.rel.split('/').pop()
            if (name.startsWith('.')) continue
            if (e.dir) {
              dirs.add(e.rel)
              queue.push(e.rel)
            } else files.set(e.rel, e)
          }
        }
      }
      return files
    },
    async download(rel, abs) {
      const r = await http({ method: 'GET', url: fileUrl(rel), headers: hdrs(), saveTo: abs })
      if (!r.ok) throw httpError(r, `Downloading “${rel}”`)
    },
    async upload(rel, abs) {
      await mkdirs(rel)
      const r = await http({ method: 'PUT', url: fileUrl(rel), headers: hdrs(), bodyFile: abs, timeoutMs: 300000 })
      if (!r.ok) throw httpError(r, `Uploading “${rel}”`)
      return cleanTag(r.header('etag')) || null
    },
    async remove(rel) {
      const r = await http({ method: 'DELETE', url: fileUrl(rel), headers: hdrs() })
      if (!r.ok && r.status !== 404) throw httpError(r, `Deleting “${rel}” in the cloud`)
    },
    async bytes(rel) {
      const r = await http({ method: 'GET', url: fileUrl(rel), headers: hdrs() })
      if (!r.ok) throw httpError(r, `Downloading “${rel}”`)
      return unb64(r.body)
    },
    async test() {
      const r = await propfind(base, 1)
      if (r.status === 404) return { ok: false, missing: true, msg: 'Connected, but this folder does not exist on the server yet.' }
      if (r.status !== 207) return { ok: false, msg: httpError(r, 'Connection').message }
      const n = parse(r.text()).filter((e) => e.rel).length
      return { ok: true, msg: `Connected. The folder has ${n} item${n === 1 ? '' : 's'} at the top level.` }
    },
    async create() {
      // create every missing level of the configured folder
      const segs = basePath.split('/').filter(Boolean)
      for (let i = 1; i <= segs.length; i++) {
        const u = url.origin + '/' + segs.slice(0, i).map(rfc3986).join('/') + '/'
        const r = await http({ method: 'MKCOL', url: u, headers: hdrs() })
        if (!r.ok && r.status !== 405 && i === segs.length) throw httpError(r, 'Creating the folder')
      }
    },
  }
}

function s3(cfg) {
  let origin
  try {
    origin = new URL(cfg.endpoint.includes('://') ? cfg.endpoint : 'https://' + cfg.endpoint)
  } catch {
    throw new CloudError('The S3 endpoint is not a valid address.')
  }
  if (!cfg.bucket) throw new CloudError('Enter the bucket name.')
  if (!cfg.accessKey || !cfg.secretKey) throw new CloudError('Enter the access key and secret key.')
  const prefix = (cfg.prefix || '').replace(/^\/+|\/+$/g, '')
  const keyOf = (rel) => (prefix ? prefix + '/' : '') + rel
  const region = cfg.region || 'us-east-1'
  // path-style addressing (endpoint/bucket/key) works with every S3-compatible service
  async function req(method, key, { query = {}, saveTo, bodyFile, timeoutMs } = {}) {
    const path = '/' + rfc3986(cfg.bucket) + (key != null ? '/' + encPath(key) : '')
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const { headers, qs } = await sigv4({ method, host: origin.host, path, query, payloadHash: 'UNSIGNED-PAYLOAD', region, accessKey: cfg.accessKey, secretKey: cfg.secretKey, amzDate })
    return http({ method, url: origin.origin + path + (qs ? '?' + qs : ''), headers: Object.entries(headers), saveTo, bodyFile, timeoutMs })
  }
  async function listRaw(maxKeys) {
    const files = new Map()
    let token = null
    do {
      const query = { 'list-type': '2', prefix: prefix ? prefix + '/' : '' }
      if (maxKeys) query['max-keys'] = String(maxKeys)
      if (token) query['continuation-token'] = token
      const r = await req('GET', null, { query })
      if (!r.ok) throw httpError(r, 'Listing the bucket')
      const doc = new DOMParser().parseFromString(r.text(), 'application/xml')
      const t = (n, name) => n.getElementsByTagName(name)[0]?.textContent ?? ''
      for (const c of doc.getElementsByTagName('Contents')) {
        const key = t(c, 'Key')
        const rel = key.slice(prefix ? prefix.length + 1 : 0)
        if (!rel || rel.endsWith('/') || rel.split('/').some((p) => p.startsWith('.'))) continue
        files.set(rel, { rel, size: +t(c, 'Size'), mtime: Date.parse(t(c, 'LastModified')) || 0, tag: cleanTag(t(c, 'ETag')) })
      }
      token = t(doc, 'IsTruncated') === 'true' && !maxKeys ? t(doc, 'NextContinuationToken') : null
    } while (token)
    return files
  }
  return {
    label: `${cfg.bucket}${prefix ? '/' + prefix : ''} · ${origin.host}`,
    list: () => listRaw(0),
    async download(rel, abs) {
      const r = await req('GET', keyOf(rel), { saveTo: abs })
      if (!r.ok) throw httpError(r, `Downloading “${rel}”`)
    },
    async upload(rel, abs) {
      const r = await req('PUT', keyOf(rel), { bodyFile: abs, timeoutMs: 300000 })
      if (!r.ok) throw httpError(r, `Uploading “${rel}”`)
      return cleanTag(r.header('etag')) || null
    },
    async remove(rel) {
      const r = await req('DELETE', keyOf(rel))
      if (!r.ok && r.status !== 404) throw httpError(r, `Deleting “${rel}” in the cloud`)
    },
    async bytes(rel) {
      const r = await req('GET', keyOf(rel))
      if (!r.ok) throw httpError(r, `Downloading “${rel}”`)
      return unb64(r.body)
    },
    async test() {
      const files = await listRaw(10)
      return { ok: true, msg: `Connected to the bucket${files.size ? '' : ' (no files under this folder yet)'}.` }
    },
  }
}

function rclone(cfg) {
  const remote = (cfg.remote || '').trim()
  if (!/^[^:\\/]+:/.test(remote)) throw new CloudError('Enter an rclone remote such as “gdrive:Notes” (set it up first with `rclone config`).')
  const at = (rel) => remote + (/[:/]$/.test(remote) ? '' : '/') + rel
  async function run(args, what, timeoutMs) {
    const r = await invoke('cloud_rclone', { exe: cfg.exe || '', args, timeoutMs })
    if (r.code !== 0) {
      const msg = (r.stderr || '').trim().split('\n').filter(Boolean).pop() || `exit code ${r.code}`
      const err = new CloudError(`${what}: ${msg.replace(/^\S+ \S+ ERROR : /, '')}`)
      err.notFound = /directory not found|object not found|not found/i.test(r.stderr)
      throw err
    }
    return r
  }
  const stat = async (rel) => {
    const r = await run(['lsjson', '--stat', '--no-mimetype', at(rel)], `Checking “${rel}”`, 60000)
    const e = JSON.parse(dec.decode(unb64(r.stdout)) || 'null')
    return e ? `${e.ModTime}|${e.Size}` : null
  }
  return {
    label: remote,
    async list() {
      let r
      try {
        r = await run(['lsjson', '-R', '--files-only', '--no-mimetype', '--fast-list', remote], 'Listing the remote', 600000)
      } catch (e) {
        if (e.notFound) return new Map() // the folder is created by the first upload
        throw e
      }
      const files = new Map()
      for (const e of JSON.parse(dec.decode(unb64(r.stdout)) || '[]')) {
        if (e.Path.split('/').some((p) => p.startsWith('.'))) continue
        files.set(e.Path, { rel: e.Path, size: e.Size, mtime: Date.parse(e.ModTime) || 0, tag: `${e.ModTime}|${e.Size}` })
      }
      return files
    },
    async download(rel, abs) {
      await run(['copyto', at(rel), abs], `Downloading “${rel}”`, 600000)
    },
    async upload(rel, abs) {
      await run(['copyto', abs, at(rel)], `Uploading “${rel}”`, 600000)
      return stat(rel).catch(() => null)
    },
    async remove(rel) {
      try {
        await run(['deletefile', at(rel)], `Deleting “${rel}” in the cloud`)
      } catch (e) {
        if (!e.notFound) throw e
      }
    },
    async bytes(rel) {
      return unb64((await run(['cat', at(rel)], `Downloading “${rel}”`, 600000)).stdout)
    },
    async test() {
      const v = await run(['version'], 'rclone')
      const ver = dec.decode(unb64(v.stdout)).split('\n')[0]
      try {
        await run(['lsf', '--max-depth', '1', remote], 'Connection', 120000)
      } catch (e) {
        if (e.notFound) return { ok: true, msg: `${ver}. The remote works; the folder is created by the first sync.` }
        throw e
      }
      return { ok: true, msg: `${ver}. Connected to ${remote}.` }
    },
  }
}

/** rclone's configured remotes, for the Preferences picker. */
async function rcloneRemotes() {
  try {
    const r = await invoke('cloud_rclone', { exe: s().rclonePath || '', args: ['listremotes'], timeoutMs: 20000 })
    return r.code === 0 ? dec.decode(unb64(r.stdout)).split(/\r?\n/).filter(Boolean) : []
  } catch {
    return []
  }
}

const secretKey = (p) => (p === 's3' ? 's3' : 'webdav')
async function backend() {
  const st = s()
  const p = st.cloudProvider
  if (p === 'rclone') return rclone({ remote: st.rcloneRemote, exe: st.rclonePath })
  const secret = (await invoke('cloud_secret_get', { key: secretKey(p) }).catch(() => null)) || ''
  if (p === 's3') return s3({ endpoint: st.s3Endpoint, region: st.s3Region, bucket: st.s3Bucket, prefix: st.s3Prefix, accessKey: st.s3AccessKey, secretKey: secret })
  if (!st.cloudUrl) throw new CloudError('Enter the WebDAV address of your cloud folder.')
  return webdav({ url: st.cloudUrl, user: st.cloudUser, pass: secret })
}

/** What the sync records are tied to: change any of it and everything is compared afresh. */
function configId() {
  const st = s()
  const where = st.cloudProvider === 'rclone' ? st.rcloneRemote : st.cloudProvider === 's3' ? `${st.s3Endpoint}/${st.s3Bucket}/${st.s3Prefix}` : `${st.cloudUrl}|${st.cloudUser}`
  return `${st.cloudProvider}|${where}|${st.cloudLocal}|${st.cloudFiles}`
}

export const configured = () => {
  const st = s()
  if (!st.cloudEnabled || !st.cloudLocal) return false
  if (st.cloudProvider === 'rclone') return !!st.rcloneRemote
  if (st.cloudProvider === 's3') return !!(st.s3Endpoint && st.s3Bucket && st.s3AccessKey)
  return !!st.cloudUrl
}

// ════════════════════════════════════════ sync state
let state = loadState()
function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY)) || {}
  } catch {
    return {}
  }
}
function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch (e) {
    ctx?.log('cloud state not saved:', e)
  }
}
function currentState() {
  if (state.id !== configId()) state = { id: configId(), files: {}, remote: null, local: null, last: 0, error: null }
  return state
}

/** What a sync would do with one file. */
function classify(L, R, base) {
  const lCh = !!L && (!base || L.mtime !== base.lm || L.size !== base.ls)
  const rCh = !!R && (!base || R.tag !== base.rt)
  if (L && R) {
    if (!base) return 'compare'
    if (lCh && rCh) return 'conflict'
    return lCh ? 'up' : rCh ? 'down' : 'same'
  }
  if (L) return !base || lCh ? 'up' : s().cloudDeletes ? 'del-local' : 'up'
  if (R) return !base || rCh ? 'down' : s().cloudDeletes ? 'del-remote' : 'down'
  return 'forget'
}

const STATUS = {
  same: ['✓', 'Synced'],
  up: ['↑', 'Changed on this computer — will be uploaded'],
  down: ['↓', 'Changed in the cloud — will be downloaded'],
  compare: ['?', 'On both sides — will be compared on the next sync'],
  conflict: ['!', 'Changed on both sides — both versions will be kept'],
  'del-local': ['×', 'Deleted in the cloud — will be moved to the sync trash here'],
  'del-remote': ['×', 'Deleted on this computer — will be deleted in the cloud'],
}

// ════════════════════════════════════════ sync
const listeners = new Set()
let busy = false
let again = false
let progress = ''
const emit = () => listeners.forEach((f) => f())

/** Sync now. auto = started by a timer or a save: no dialogs except the mass-delete question. */
export async function sync({ auto = false } = {}) {
  if (!configured()) {
    if (!auto) {
      ctx.toast('Set up Cloud Sync first', 2000)
      ctx.openPrefs('cloud')
    }
    return
  }
  if (auto && !navigator.onLine) return
  if (busy) {
    again = true
    return
  }
  busy = true
  progress = 'Connecting…'
  emit()
  const st = currentState()
  const summary = { up: 0, down: 0, conflicts: 0, deleted: 0, errors: [] }
  try {
    await runSync(st, summary, auto)
    st.error = summary.errors.length ? summary.errors.slice(0, 5).join('\n') : null
    st.last = Date.now()
  } catch (e) {
    if (e instanceof Cancelled) {
      busy = false
      progress = ''
      emit()
      ctx.toast('Sync cancelled — nothing was deleted', 2500)
      return
    }
    st.error = e instanceof CloudError ? e.message : String(e?.message || e)
    ctx.log('cloud sync failed:', e)
  }
  saveState()
  busy = false
  progress = ''
  emit()
  const n = summary.up + summary.down + summary.deleted
  if (st.error) {
    if (!auto) ctx.toast('Cloud sync: ' + st.error.split('\n')[0], 4000)
  } else if (!auto || summary.down || summary.conflicts) {
    const parts = []
    if (summary.up) parts.push(`${summary.up} uploaded`)
    if (summary.down) parts.push(`${summary.down} downloaded`)
    if (summary.deleted) parts.push(`${summary.deleted} removed`)
    if (summary.conflicts) parts.push(`${summary.conflicts} conflict${summary.conflicts > 1 ? 's' : ''} (both versions kept)`)
    ctx.toast(n || summary.conflicts ? 'Cloud: ' + parts.join(', ') : 'Cloud: everything is up to date', summary.conflicts ? 4000 : 2000)
  }
  if (again) {
    again = false
    setTimeout(() => sync({ auto: true }), 500)
  }
}

async function runSync(st, summary, auto) {
  const root = s().cloudLocal
  const be = await backend()
  progress = 'Looking for changes…'
  emit()
  const excluded = excluder(s().cloudExclude)
  const [localList, remote] = await Promise.all([invoke('cloud_scan', { root, all: s().cloudFiles === 'all' }), be.list()])
  const local = new Map(localList.filter((f) => !excluded(f.rel)).map((f) => [f.rel, f]))
  for (const rel of [...remote.keys()]) {
    if (excluded(rel) || (s().cloudFiles !== 'all' && !/\.(md|markdown|mdown|mkd|mkdn|mdx|txt|png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(rel))) remote.delete(rel)
  }
  st.local = Object.fromEntries([...local].map(([k, v]) => [k, { size: v.size, mtime: v.mtime }]))
  st.remote = Object.fromEntries([...remote].map(([k, v]) => [k, { size: v.size, mtime: v.mtime, tag: v.tag }]))

  const plan = []
  for (const rel of new Set([...local.keys(), ...remote.keys(), ...Object.keys(st.files)])) {
    if (excluded(rel)) continue
    const kind = classify(local.get(rel), remote.get(rel), st.files[rel])
    if (kind === 'forget') delete st.files[rel]
    else if (kind !== 'same') plan.push({ rel, kind })
  }

  // a wrong folder or an emptied server must not delete everything here (or there) in one go
  const dels = plan.filter((p) => p.kind.startsWith('del-'))
  const known = Object.keys(st.files).length
  // one side completely empty usually means a wrong folder or an unplugged drive, not a cleanup
  const emptied = dels.length > 0 && (remote.size === 0 || local.size === 0)
  if ((dels.length >= 5 && dels.length > known * 0.3) || emptied) {
    const where = dels.filter((p) => p.kind === 'del-local').length >= dels.length / 2 ? 'on this computer (they go to the sync trash)' : 'in the cloud'
    const choice = await ctx.dialog({
      title: 'Delete many files?',
      body: `This sync would delete ${dels.length} of ${known} files ${where}, because they were removed on the other side. If that is not what you expect, check the cloud folder in Preferences.`,
      buttons: [
        { label: 'Cancel sync', value: null, cancel: true },
        { label: 'Keep them', value: 'keep' },
        { label: `Delete ${dels.length} files`, value: 'delete', primary: true },
      ],
    })
    if (!choice) throw new Cancelled()
    if (choice === 'keep') for (const p of dels) p.kind = p.kind === 'del-local' ? 'up' : 'down'
  }

  const trashStamp = stamp()
  const abs = (rel) => P.join(root, rel)
  const changedHere = new Set()
  const needTag = new Set()
  const recordUp = (rel, L, tag) => {
    st.files[rel] = { lm: L.mtime, ls: L.size, rt: tag }
    if (!tag) needTag.add(rel)
    st.remote[rel] = { size: L.size, mtime: Date.now(), tag }
  }
  const recordDown = async (rel, R) => {
    const m = await invoke('mtime', { path: abs(rel) })
    st.files[rel] = { lm: m, ls: R.size, rt: R.tag }
    st.local[rel] = { size: R.size, mtime: m }
    changedHere.add(abs(rel))
  }
  const toTrash = (rel) => invoke('cloud_trash', { root, rel, stamp: trashStamp })

  let done = 0
  const step = async ({ rel, kind }) => {
    const L = local.get(rel)
    const R = remote.get(rel)
    if (kind === 'compare') {
      // the same file on both sides before the first sync: only a real difference is a conflict
      const same = L.size === R.size && sameBytes(new Uint8Array(await invoke('read_bytes', { path: abs(rel) })), await be.bytes(rel))
      if (same) st.files[rel] = { lm: L.mtime, ls: L.size, rt: R.tag }
      else kind = 'conflict'
    }
    if (kind === 'up') {
      recordUp(rel, L, await be.upload(rel, abs(rel)))
      summary.up++
    } else if (kind === 'down') {
      await be.download(rel, abs(rel))
      await recordDown(rel, R)
      summary.down++
    } else if (kind === 'del-local') {
      await toTrash(rel)
      delete st.files[rel]
      delete st.local[rel]
      changedHere.add(abs(rel))
      summary.deleted++
    } else if (kind === 'del-remote') {
      await be.remove(rel)
      delete st.files[rel]
      delete st.remote[rel]
      summary.deleted++
    } else if (kind === 'conflict') {
      summary.conflicts++
      const how = s().cloudConflict
      if (how === 'local') {
        recordUp(rel, L, await be.upload(rel, abs(rel)))
      } else if (how === 'remote') {
        await toTrash(rel)
        await be.download(rel, abs(rel))
        await recordDown(rel, R)
      } else {
        // keep both: the cloud's version becomes "name (conflict …).md" next to this computer's
        const d = new Date()
        const ext = rel.match(/\.[^./]+$/)?.[0] || ''
        const copy = `${rel.slice(0, rel.length - ext.length)} (conflict ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())})${ext}`
        await be.download(rel, abs(copy))
        const cm = await invoke('mtime', { path: abs(copy) })
        recordUp(copy, { mtime: cm, size: R.size }, await be.upload(copy, abs(copy)))
        st.local[copy] = { size: R.size, mtime: cm }
        recordUp(rel, L, await be.upload(rel, abs(rel)))
      }
    }
    done++
    progress = `Syncing ${done} of ${plan.length}…`
    emit()
  }

  // a few transfers at a time: fast, without flooding small servers
  const queue = [...plan]
  progress = plan.length ? `Syncing 0 of ${plan.length}…` : 'Up to date'
  emit()
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let p; (p = queue.shift()); ) {
        try {
          await step(p)
        } catch (e) {
          summary.errors.push(e instanceof CloudError ? e.message : `${p.rel}: ${e?.message || e}`)
        }
      }
    }),
  )

  // servers that don't return an ETag on upload: read the new stamps from a fresh listing
  if (needTag.size) {
    const fresh = await be.list()
    for (const rel of needTag) {
      const R = fresh.get(rel)
      if (R && st.files[rel]) {
        st.files[rel].rt = R.tag
        st.remote[rel] = { size: R.size, mtime: R.mtime, tag: R.tag }
      }
    }
  }
  for (const p of changedHere) ctx.fileChanged(p)
}

// ════════════════════════════════════════ automatic sync
let timer = null
let saveTimer = null
let started = false
let startedOnce = false // the startup sync runs once per session, not on every reinstall
const afterSave = () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => sync({ auto: true }), 4000)
}
const onOnline = () => s().cloudAuto && configured() && sync({ auto: true })

/** Called by main.js after CaretFlow saved, created or renamed a file. */
export function noteSaved(path) {
  if (started && s().cloudAuto && configured() && path && P.isInside(path, s().cloudLocal)) afterSave()
}

export function settingsChanged() {
  clearInterval(timer)
  timer = null
  const min = +s().cloudInterval
  if (started && configured() && min > 0) timer = setInterval(() => sync({ auto: true }), min * 60000)
  emit()
}

export function initCloud(c) {
  ctx = c
}

/** Start the automatic syncs (Cloud Sync installed and turned on); the first start syncs once. */
export function start() {
  if (started) return
  const first = !startedOnce
  started = startedOnce = true
  settingsChanged()
  addEventListener('online', onOnline)
  if (first && s().cloudAuto && configured()) setTimeout(() => started && sync({ auto: true }), 3000)
}

/** Stop everything automatic (the extension was removed or sync turned off). A running sync finishes. */
export function stop() {
  started = false
  clearInterval(timer)
  timer = null
  clearTimeout(saveTimer)
  removeEventListener('online', onOnline)
  emit()
}

// ════════════════════════════════════════ status bar button
export function statusButton(btn) {
  const draw = () => {
    const st = currentState()
    btn.hidden = !started || !s().cloudEnabled // stopped = removed or turned off
    const pending = pendingCount()
    btn.classList.toggle('busy', busy)
    btn.classList.toggle('err', !!st.error && !busy)
    btn.querySelector('.n').textContent = !busy && pending ? String(pending) : ''
    btn.title = busy
      ? progress
      : !configured()
        ? 'Cloud Sync is not set up — click to set it up'
        : st.error
          ? `Cloud sync failed (${ago(st.last)}): ${st.error}\nClick to try again`
          : `Cloud: synced ${ago(st.last)}${pending ? ` · ${pending} change${pending > 1 ? 's' : ''} waiting` : ''}\nClick to sync now (Ctrl+Alt+S)`
  }
  listeners.add(draw)
  btn.onclick = () => (configured() ? sync() : ctx.openPrefs('cloud'))
  btn.oncontextmenu = (e) => {
    e.preventDefault()
    ctx.showContextMenu(e.clientX, e.clientY, [
      ['Sync Now', () => sync()],
      ['Show Cloud Files', () => ctx.showCloudTab()],
      '-',
      ['Cloud Sync Settings…', () => ctx.openPrefs('cloud')],
    ])
  }
  draw()
  setInterval(draw, 60000) // keeps "synced 3 min ago" current
}

function entries() {
  const st = currentState()
  const excluded = excluder(s().cloudExclude)
  const out = []
  if (!st.remote && !st.local) return out
  const rels = new Set([...Object.keys(st.remote || {}), ...Object.keys(st.local || {}), ...Object.keys(st.files)])
  for (const rel of rels) {
    if (excluded(rel)) continue
    const L = st.local?.[rel]
    const R = st.remote?.[rel]
    const kind = classify(L, R, st.files[rel])
    if (kind !== 'forget') out.push({ rel, kind, L, R })
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true, sensitivity: 'base' }))
}
const pendingCount = () => entries().filter((e) => e.kind !== 'same').length

// ════════════════════════════════════════ sidebar: Cloud tab
let paneFilter = ''
let paneFlat = false
export function renderPane(box) {
  const { el } = ctx
  const draw = () => {
    if (!box.isConnected) return listeners.delete(draw)
    const focused = document.activeElement?.classList.contains('cl-filter')
    box.innerHTML = ''
    const st = currentState()
    if (!configured()) {
      box.append(
        el('div', { class: 'sb-hint' }, s().cloudEnabled ? 'Cloud Sync is turned on but not set up yet: choose a service and a local folder.' : 'Cloud Sync is off. It keeps a folder in sync with your own server or cloud storage: WebDAV (Nextcloud, NAS…), S3, or Google Drive and Proton Drive through rclone.'),
        el('button', { class: 'sb-foot', onclick: () => ctx.openPrefs('cloud') }, 'Set up Cloud Sync…'),
      )
      return
    }
    let label = ''
    try {
      label = configLabel()
    } catch {}
    const syncBtn = el('button', { title: 'Sync now (Ctrl+Alt+S)', class: busy ? 'spin' : '', onclick: () => sync() }, '⟳')
    const flatBtn = el('button', { title: paneFlat ? 'Show folders' : 'Show all files in one list', class: paneFlat ? 'on' : '', onclick: () => ((paneFlat = !paneFlat), draw()) }, '≡')
    const gear = el('button', { title: 'Cloud Sync settings', onclick: () => ctx.openPrefs('cloud') }, '⚙')
    box.append(el('div', { class: 'sb-head' }, el('span', { class: 'cl-where', title: s().cloudProvider === 'webdav' ? s().cloudUrl : label }, label), el('span', { class: 'sb-actions' }, syncBtn, flatBtn, gear)))
    const list = entries()
    const pending = list.filter((e) => e.kind !== 'same').length
    const line = busy ? progress : st.error ? 'Last sync failed — ' + st.error.split('\n')[0] : st.last ? `Synced ${ago(st.last)}` + (pending ? ` · ${pending} change${pending > 1 ? 's' : ''} waiting` : '') : 'Not synced yet'
    box.append(el('div', { class: 'cl-status' + (st.error && !busy ? ' err' : ''), title: st.error || '' }, line))
    if (!st.remote) {
      box.append(el('button', { class: 'sb-foot', onclick: () => sync() }, 'Sync now'))
      return
    }
    const filter = el('input', { type: 'search', class: 'cl-filter', placeholder: 'Filter cloud files…', spellcheck: 'false', value: paneFilter })
    filter.oninput = () => {
      paneFilter = filter.value
      draw()
    }
    box.append(filter)
    if (focused) {
      filter.focus()
      filter.setSelectionRange(filter.value.length, filter.value.length)
    }
    const q = paneFilter.trim().toLowerCase()
    const shown = q ? list.filter((e) => e.rel.toLowerCase().includes(q)) : list
    const tree = el('div', { class: 'cl-tree' })
    if (!shown.length) tree.append(el('div', { class: 'sb-hint' }, q ? 'No matching files.' : 'The cloud folder is empty.'))
    else if (q || paneFlat) for (const e of shown) tree.append(fileRow(e, 0, true))
    else drawDir(tree, buildTree(shown), '', 0)
    box.append(tree)
    const files = list.filter((e) => e.R).length
    box.append(
      el('div', { class: 'cl-foot' }, `${files} file${files === 1 ? '' : 's'} in the cloud`),
      el('div', { class: 'cl-links' }, el('button', { class: 'sb-foot', onclick: () => openPath(s().cloudLocal) }, 'Open sync folder'), el('button', { class: 'sb-foot', onclick: openTrash }, 'Sync trash')),
    )
  }
  listeners.add(draw)
  draw()
}

function buildTree(list) {
  const root = { dirs: new Map(), files: [], count: 0 }
  for (const e of list) {
    const parts = e.rel.split('/')
    let node = root
    node.count++
    for (const d of parts.slice(0, -1)) {
      if (!node.dirs.has(d)) node.dirs.set(d, { dirs: new Map(), files: [], count: 0 })
      node = node.dirs.get(d)
      node.count++
    }
    node.files.push(e)
  }
  return root
}

function readOpenDirs() {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_DIRS_KEY)) || [])
  } catch {
    return new Set()
  }
}

function drawDir(parent, node, path, depth) {
  const { el } = ctx
  const open = readOpenDirs()
  for (const [name, sub] of [...node.dirs].sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))) {
    const p = path ? path + '/' + name : name
    const changes = countChanges(sub)
    const row = el(
      'div',
      { class: 'tree-row dir', title: p },
      el('span', { class: 'tw' }, open.has(p) ? '▾' : '▸'),
      el('span', { class: 'nm' }, name),
      el('span', { class: 'cl-count' }, changes ? `${changes} ✱` : String(sub.count)),
    )
    const kids = el('div', { class: 'tree-kids' })
    kids.hidden = !open.has(p)
    if (!kids.hidden) drawDir(kids, sub, p, depth + 1)
    row.onclick = () => {
      const o = readOpenDirs()
      if (o.has(p)) o.delete(p)
      else o.add(p)
      localStorage.setItem(OPEN_DIRS_KEY, JSON.stringify([...o].slice(-300)))
      if (kids.hidden) drawDir(kids, sub, p, depth + 1)
      else kids.innerHTML = ''
      kids.hidden = !kids.hidden
      row.firstChild.textContent = kids.hidden ? '▸' : '▾'
    }
    parent.append(row, kids)
  }
  for (const e of node.files) parent.append(fileRow(e, depth, false))
}
const countChanges = (node) => node.files.filter((f) => f.kind !== 'same').length + [...node.dirs.values()].reduce((n, d) => n + countChanges(d), 0)

function fileRow(e, depth, showDir) {
  const { el } = ctx
  const name = e.rel.split('/').pop()
  const dir = e.rel.includes('/') ? e.rel.slice(0, e.rel.lastIndexOf('/')) : ''
  const [icon, what] = STATUS[e.kind] || ['', '']
  const info = [what, e.R ? `Cloud: ${size(e.R.size)}${e.R.mtime ? ', ' + new Date(e.R.mtime).toLocaleString() : ''}` : 'Not in the cloud', e.L ? `This computer: ${size(e.L.size)}` : 'Not on this computer']
  const cur = ctx.currentPath()
  const absPath = P.join(s().cloudLocal, e.rel)
  const row = el(
    'div',
    { class: `tree-row cl-file k-${e.kind}` + (cur && cur.toLowerCase() === absPath.toLowerCase() ? ' current' : ''), title: `${e.rel}\n${info.join('\n')}` },
    el('span', { class: 'cl-st' }, icon),
    el('span', { class: 'nm' }, name.replace(/\.(md|markdown)$/i, ''), showDir && dir ? el('small', { class: 'cl-dir' }, dir) : null),
  )
  row.onclick = () => openEntry(e)
  row.oncontextmenu = (ev) => {
    ev.preventDefault()
    const items = [['Open', () => openEntry(e)]]
    if (e.L) items.push(['Reveal in Explorer', () => revealItemInDir(absPath)])
    if (e.L && e.R) items.push(['Replace with Cloud Version…', () => replaceWithCloud(e)])
    items.push('-', ['Copy Path in Cloud', () => navigator.clipboard.writeText(e.rel).then(() => ctx.toast('Copied'))])
    ctx.showContextMenu(ev.clientX, ev.clientY, items)
  }
  return row
}

async function openEntry(e) {
  const abs = P.join(s().cloudLocal, e.rel)
  if (!e.L) {
    // only in the cloud so far: fetch it now instead of waiting for the next sync
    if (!e.R) return ctx.toast('This file was deleted', 2000)
    try {
      ctx.toast('Downloading…')
      const be = await backend()
      await be.download(e.rel, abs)
      const st = currentState()
      const m = await invoke('mtime', { path: abs })
      st.files[e.rel] = { lm: m, ls: e.R.size, rt: e.R.tag }
      ;(st.local ||= {})[e.rel] = { size: e.R.size, mtime: m }
      saveState()
      emit()
    } catch (err) {
      return ctx.toast('Download failed: ' + (err?.message || err), 4000)
    }
  }
  if (/\.(md|markdown|mdown|mkd|mkdn|mdx|txt)$/i.test(e.rel)) ctx.openFile(abs)
  else openPath(abs)
}

async function replaceWithCloud(e) {
  const ok = await ctx.dialog({
    title: 'Replace with the cloud version?',
    body: `The copy of “${e.rel}” on this computer goes to the sync trash and the cloud version takes its place.`,
    buttons: [
      { label: 'Cancel', value: false, cancel: true },
      { label: 'Replace', value: true, primary: true },
    ],
  })
  if (!ok) return
  try {
    const be = await backend()
    const root = s().cloudLocal
    await invoke('cloud_trash', { root, rel: e.rel, stamp: stamp() })
    const abs = P.join(root, e.rel)
    await be.download(e.rel, abs)
    const st = currentState()
    const m = await invoke('mtime', { path: abs })
    st.files[e.rel] = { lm: m, ls: e.R.size, rt: e.R.tag }
    st.local[e.rel] = { size: e.R.size, mtime: m }
    saveState()
    emit()
    ctx.fileChanged(abs)
    ctx.toast('Replaced with the cloud version')
  } catch (err) {
    ctx.toast('Failed: ' + (err?.message || err), 4000)
  }
}

async function openTrash() {
  try {
    await openPath(await invoke('cloud_trash_dir'))
  } catch (e) {
    ctx.toast(String(e), 3000)
  }
}

function configLabel() {
  const st = s()
  if (st.cloudProvider === 'rclone') return st.rcloneRemote
  if (st.cloudProvider === 's3') return `${st.s3Bucket}${st.s3Prefix ? '/' + st.s3Prefix.replace(/^\/+|\/+$/g, '') : ''}`
  try {
    // long WebDAV paths (remote.php/dav/files/…) say little: the server and the folder name do
    const u = new URL(st.cloudUrl)
    const folder = decodeURIComponent(u.pathname).replace(/\/+$/, '').split('/').pop()
    return folder ? `${u.host} · ${folder}` : u.host
  } catch {
    return st.cloudUrl
  }
}

/** Forget what was synced: the next sync compares every file afresh (nothing is deleted). */
export function resetState() {
  state = { id: configId(), files: {}, remote: null, local: null, last: 0, error: null }
  saveState()
  emit()
}

// ════════════════════════════════════════ Preferences → Cloud Sync
export function prefsPage(row) {
  const { el, customSelect } = ctx
  const st = s()
  const save = () => {
    ctx.saveSettings()
    settingsChanged()
    ctx.cloudUiChanged()
  }
  const text = (key, { placeholder = '', width = 260, type = 'text', trim = true } = {}) => {
    const i = el('input', { type, value: st[key] ?? '', placeholder, spellcheck: 'false', style: `width:${width}px;max-width:100%` })
    i.onchange = () => {
      st[key] = trim ? i.value.trim() : i.value
      save()
    }
    return i
  }
  const check = (key) => {
    const c = el('input', { type: 'checkbox', checked: !!st[key] })
    c.onchange = () => {
      st[key] = c.checked
      save()
      if (key === 'cloudEnabled') showRows()
    }
    return c
  }
  const pick = (key, opts, after) =>
    customSelect(opts, st[key], (v) => {
      st[key] = v
      save()
      after?.()
    })
  const secret = (p) => {
    const i = el('input', { type: 'password', placeholder: '', spellcheck: 'false', autocomplete: 'off', style: 'width:260px;max-width:100%' })
    invoke('cloud_secret_get', { key: secretKey(p) })
      .then((v) => (i.placeholder = v ? '•••••••• (saved)' : ''))
      .catch(() => {})
    i.onchange = async () => {
      await invoke('cloud_secret_set', { key: secretKey(p), value: i.value })
      i.placeholder = i.value ? '•••••••• (saved)' : ''
      i.value = ''
      ctx.toast(i.placeholder ? 'Saved' : 'Removed')
    }
    return i
  }

  // local folder
  const localOut = el('span', { class: 'cl-path' }, st.cloudLocal || 'Not chosen')
  const chooseLocal = el('button', { type: 'button', class: 'fsel' }, 'Choose…')
  chooseLocal.onclick = async () => {
    const p = await openDialog({ directory: true, defaultPath: st.cloudLocal || ctx.currentRoot() || undefined })
    if (!p) return
    st.cloudLocal = p
    localOut.textContent = p
    save()
  }
  const useOpen = el('button', { type: 'button', class: 'fsel' }, 'Use open folder')
  useOpen.onclick = () => {
    const r = ctx.currentRoot()
    if (!r) return ctx.toast('No folder is open', 2000)
    st.cloudLocal = r
    localOut.textContent = r
    save()
  }

  // rclone remotes from `rclone listremotes`
  const remotes = el('datalist', { id: 'cl-remotes' })
  const remoteInput = text('rcloneRemote', { placeholder: 'gdrive:Notes' })
  remoteInput.setAttribute('list', 'cl-remotes')
  remoteInput.onfocus = async () => {
    if (remotes.childElementCount) return
    for (const r of await rcloneRemotes()) remotes.append(el('option', { value: r }))
  }

  // test connection
  const result = el('div', { class: 'cl-test' })
  const testBtn = el('button', { type: 'button', class: 'fsel' }, 'Test connection')
  testBtn.onclick = async () => {
    result.className = 'cl-test'
    result.textContent = 'Connecting…'
    try {
      const be = await backend()
      const r = await be.test()
      result.textContent = r.msg
      result.classList.add(r.ok ? 'ok' : 'err')
      if (r.missing && be.create) {
        result.append(
          ' ',
          el('button', {
            type: 'button',
            class: 'fsel',
            onclick: async () => {
              try {
                await be.create()
                result.className = 'cl-test ok'
                result.textContent = 'Folder created.'
              } catch (e) {
                result.className = 'cl-test err'
                result.textContent = e.message || String(e)
              }
            },
          }, 'Create it'),
        )
      }
    } catch (e) {
      result.classList.add('err')
      result.textContent = e?.message || String(e)
    }
  }

  const reset = el('button', { type: 'button', class: 'fsel' }, 'Compare everything again')
  reset.onclick = async () => {
    const ok = await ctx.dialog({
      title: 'Compare everything again?',
      body: 'CaretFlow forgets what it synced before and compares every file on the next sync. Nothing is deleted; files that differ on both sides are kept twice.',
      buttons: [
        { label: 'Cancel', value: false, cancel: true },
        { label: 'Compare again', value: true, primary: true },
      ],
    })
    if (ok) resetState()
  }

  const rows = {
    webdav: [
      row('Folder address', 'The WebDAV URL of the folder to sync. Nextcloud: https://your.server/remote.php/dav/files/USER/Notes', text('cloudUrl', { placeholder: 'https://cloud.example.com/remote.php/dav/files/me/Notes', width: 320 })),
      row('User name', null, text('cloudUser', { width: 200 })),
      row('Password', 'Use an app password if your server offers them. Stored on this computer only, outside the editor’s storage', secret('webdav')),
    ],
    s3: [
      row('Endpoint', 'e.g. s3.eu-central-1.amazonaws.com, s3.us-west-004.backblazeb2.com, <account>.r2.cloudflarestorage.com, or your MinIO server', text('s3Endpoint', { placeholder: 'https://s3.amazonaws.com', width: 320 })),
      row('Region', '“auto” for Cloudflare R2; us-east-1 when unsure', text('s3Region', { width: 140 })),
      row('Bucket', null, text('s3Bucket', { width: 200 })),
      row('Folder in the bucket', 'Optional, e.g. notes', text('s3Prefix', { width: 200 })),
      row('Access key', null, text('s3AccessKey', { width: 260 })),
      row('Secret key', 'Stored on this computer only, outside the editor’s storage', secret('s3')),
    ],
    rclone: [
      el('p', { class: 'about-note' }, 'rclone (rclone.org) connects to Google Drive, Proton Drive, OneDrive, Dropbox and 70 more services. Set up a remote once with “rclone config” in a terminal; CaretFlow uses it and never sees your login.'),
      row('Remote and folder', 'remote:folder, e.g. gdrive:Notes or proton:Documents/Notes', remoteInput),
      row('rclone program', 'Leave empty if rclone is on the PATH', text('rclonePath', { placeholder: 'rclone', width: 260 })),
      remotes,
    ],
  }
  const providerRows = el('div', {})
  const showProvider = () => {
    providerRows.innerHTML = ''
    providerRows.append(...rows[st.cloudProvider] || rows.webdav)
    result.textContent = ''
  }
  showProvider()

  const settingsRows = el(
    'div',
    {},
    row('Service', 'Where your files are synced to. CaretFlow has no servers of its own', pick('cloudProvider', PROVIDERS, showProvider)),
    providerRows,
    row('Folder on this computer', 'This folder and everything in it is kept in sync', el('span', { class: 'cl-local' }, localOut, chooseLocal, useOpen)),
    row('', null, el('span', {}, testBtn, result)),
    el('div', { class: 'pref-sub' }, 'Sync'),
    row('Sync automatically', 'On startup, a few seconds after you save, and when the connection comes back', check('cloudAuto')),
    row('Also sync every', null, pick('cloudInterval', [[0, 'Never (only the above)'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, 'Hour']])),
    row('Files to sync', null, pick('cloudFiles', [['notes', 'Markdown and images'], ['all', 'All files']])),
    row('Leave out', 'One pattern per line, like .gitignore: drafts/  *.tmp  private/**', excludeBox()),
    row('Deleted files', 'Files a sync removes from this computer go to the sync trash', pick('cloudDeletes', [[true, 'Delete on the other side too'], [false, 'Bring them back']])),
    row('Changed on both sides', null, pick('cloudConflict', [['both', 'Keep both versions'], ['local', 'This computer wins'], ['remote', 'The cloud wins']])),
    row('', null, el('span', {}, el('button', { type: 'button', class: 'fsel', onclick: () => sync() }, 'Sync now'), ' ', el('button', { type: 'button', class: 'fsel', onclick: openTrash }, 'Open sync trash'), ' ', reset)),
  )
  function excludeBox() {
    const t = el('textarea', { class: 'cl-exclude', spellcheck: 'false', rows: 3, placeholder: 'drafts/\n*.tmp' })
    t.value = st.cloudExclude || ''
    t.onchange = () => {
      st.cloudExclude = t.value
      save()
    }
    return t
  }
  const showRows = () => (settingsRows.hidden = !st.cloudEnabled)
  showRows()

  return el(
    'div',
    { 'data-section': 'cloud' },
    row('Turn on Cloud Sync', 'Off by default. Nothing leaves this computer until you turn it on and choose where it goes', check('cloudEnabled')),
    settingsRows,
  )
}
