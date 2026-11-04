// In-app updates (lazy): check GitHub for a newer release, then download, install and restart.
// Releases are signed (tauri signer); the updater plugin refuses files that don't match the
// public key in tauri.conf.json. Only `latest.json` is fetched for a check: no data is sent.
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { invoke } from '@tauri-apps/api/core'

const RELEASES = 'https://github.com/Sooeeren/folio/releases'
// copies the updater can replace; the others (portable, pacman) only get a download link
const SELF_UPDATING = ['nsis', 'appimage', 'deb', 'rpm']
// the manifest key to read the version from for those
const PORTABLE_TARGET = navigator.userAgent.includes('Windows') ? 'windows-x86_64-nsis' : 'linux-x86_64-appimage'

let busy = false

/**
 * ctx: { el, dialog, toast, settings, saveSettings, confirmDiscard, openUrl, version }
 * manual = true from Help → Check for Updates (always reports a result, ignores "skip").
 */
export async function checkForUpdates(ctx, { manual = false } = {}) {
  if (busy) return
  busy = true
  try {
    const kind = await invoke('install_kind').catch(() => 'portable')
    const portable = !SELF_UPDATING.includes(kind)
    if (manual) ctx.toast('Checking for updates…')
    let update
    try {
      update = await check({ timeout: 15000, ...(portable ? { target: PORTABLE_TARGET } : {}) })
    } catch (e) {
      console.warn('update check failed:', e)
      if (manual) await failed(ctx, 'Folio could not reach the update server.', e)
      return
    }
    if (!update) {
      if (manual) await ctx.dialog({ title: 'You’re up to date', body: `Folio ${ctx.version} is the latest version.` })
      return
    }
    // automatic checks never interrupt another dialog; they offer it again next time
    if (!manual && (ctx.settings.updateSkip === update.version || !document.querySelector('#modal').hidden)) return update.close()
    await offer(ctx, update, portable && kind)
  } finally {
    busy = false
  }
}

async function offer(ctx, update, portable) {
  const { el } = ctx
  const page = `${RELEASES}/tag/v${update.version}`
  const body = el(
    'div',
    { class: 'update' },
    el('p', {}, `Folio ${update.version} is available. You have ${update.currentVersion}.`),
  )
  const notes = cleanNotes(update.body)
  if (notes) body.append(el('div', { class: 'update-notes' }, notes))
  body.append(
    el('p', { class: 'about-note' }, el('a', { href: '#', onclick: (e) => (e.preventDefault(), ctx.openUrl(page)) }, 'Full release notes on GitHub')),
  )
  if (portable === 'pacman')
    body.append(el('p', { class: 'about-note' }, 'Folio was installed with pacman, so your package manager updates it (or download the new package and run sudo pacman -U on it).'))
  else if (portable)
    body.append(el('p', { class: 'about-note' }, 'This copy of Folio runs without an installer, so it can’t update itself. Download the new version, or use the installer to get automatic updates.'))

  const r = await ctx.dialog({
    title: 'Update available',
    body,
    wide: true,
    buttons: [
      { label: 'Skip This Version', value: 'skip' },
      { label: 'Later', value: 'later', cancel: true },
      portable ? { label: 'Download…', value: 'download', primary: true } : { label: 'Update & Restart', value: 'install', primary: true },
    ],
  })
  if (r === 'skip') {
    ctx.settings.updateSkip = update.version
    ctx.saveSettings()
  }
  if (r === 'download') ctx.openUrl(page)
  if (r !== 'install') return update.close()
  // unsaved work would be lost when the app restarts
  if (!(await ctx.confirmDiscard())) return update.close()
  await install(ctx, update, page)
}

async function install(ctx, update, page) {
  const p = progress(ctx, `Updating to Folio ${update.version}`)
  let total = 0
  let got = 0
  // saved first: on Windows the installer ends this process before downloadAndInstall returns
  ctx.settings.updatedFrom = update.currentVersion
  ctx.saveSettings()
  try {
    await update.downloadAndInstall((ev) => {
      if (ev.event === 'Started') total = ev.data.contentLength || 0
      else if (ev.event === 'Progress') {
        got += ev.data.chunkLength
        p.set(total ? got / total : null, total ? `Downloading… ${mb(got)} of ${mb(total)}` : `Downloading… ${mb(got)}`)
      } else if (ev.event === 'Finished') p.set(1, 'Installing…')
    })
    // Windows: the installer has already closed Folio and opens it again when done.
    // Linux: the new files are in place; start them.
    p.set(1, 'Restarting…')
    await relaunch()
  } catch (e) {
    console.error('update failed:', e)
    ctx.settings.updatedFrom = ''
    ctx.saveSettings()
    p.close()
    await failed(ctx, 'The update could not be installed. Your files were not changed.', e, page)
  }
}

/** A modal progress bar that can't be dismissed while the download runs. */
function progress({ el }, title) {
  const m = document.querySelector('#modal')
  const bar = el('span', { class: 'indeterminate' })
  const label = el('p', { class: 'about-note' }, 'Starting download…')
  const box = el('div', { class: 'modal-box' }, el('h3', {}, title), el('div', { class: 'ai-bar update-bar' }, bar), label)
  m.innerHTML = ''
  m.append(box)
  m.hidden = false
  m.onmousedown = null
  const block = (e) => e.key === 'Escape' && (e.preventDefault(), e.stopPropagation())
  document.addEventListener('keydown', block, true)
  return {
    set(frac, text) {
      bar.classList.toggle('indeterminate', frac == null)
      if (frac != null) bar.style.width = Math.round(frac * 100) + '%'
      label.textContent = text
    },
    close() {
      document.removeEventListener('keydown', block, true)
      m.hidden = true
      m.innerHTML = ''
    },
  }
}

async function failed(ctx, msg, err, page = `${RELEASES}/latest`) {
  const r = await ctx.dialog({
    title: 'Update failed',
    body: ctx.el('div', {}, ctx.el('p', {}, msg), ctx.el('p', { class: 'about-note' }, String(err?.message || err || 'Unknown error'))),
    buttons: [
      { label: 'Close', value: false, cancel: true },
      { label: 'Open Download Page', value: true, primary: true },
    ],
  })
  if (r) ctx.openUrl(page)
}

const mb = (n) => (n / 1048576).toFixed(1) + ' MB'

/** Release notes as plain text: drop the downloads table and Markdown syntax. */
function cleanNotes(s) {
  if (!s) return ''
  return s
    .replace(/\r/g, '')
    .split(/\n#+\s*Downloads/i)[0]
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
