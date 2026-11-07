// What differs between the desktop and Android, in one place: file pickers and opening files in
// other apps. On the desktop these are the system dialogs; Android has no folder picker that gives
// back a path, so it uses CaretFlow's own file browser (android.js, loaded only there).
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { openPath as osOpenPath, revealItemInDir } from '@tauri-apps/plugin-opener'

export const IS_ANDROID = /Android/i.test(navigator.userAgent)

const android = () => import('./android.js')

/** One file to open: { defaultPath, filters } → path (or a content:// link on Android) | null */
export async function pickFile(opts = {}) {
  if (IS_ANDROID) return (await android()).browse({ mode: 'open', ...opts })
  return openDialog({ multiple: false, directory: false, ...opts })
}

/** A folder: { defaultPath, title } → path | null */
export async function pickFolder(opts = {}) {
  if (IS_ANDROID) return (await android()).browse({ mode: 'folder', ...opts })
  return openDialog({ directory: true, ...opts })
}

/** Where to save: { defaultPath, filters } → path | null */
export async function pickSave(opts = {}) {
  if (IS_ANDROID) return (await android()).browse({ mode: 'save', ...opts })
  return saveDialog(opts)
}

/** An image from the gallery or files: path | null (Android copies it to a real file first) */
export async function pickImage() {
  if (IS_ANDROID) return (await android()).pickImage()
  return openDialog({ multiple: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] }] })
}

/** Open a file in the app the system picks for it (a PDF after export, a linked document) */
export async function openPath(p) {
  if (IS_ANDROID) return (await android()).openPath(p)
  return osOpenPath(p)
}

/** Show a file in Explorer / the file manager; Android has no such thing, so it's left out there */
export const canReveal = !IS_ANDROID
export function reveal(p) {
  return revealItemInDir(p)
}
