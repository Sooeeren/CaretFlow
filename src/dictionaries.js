// Hunspell dictionaries on disk (lazy): downloaded once into CaretFlow's data folder, then read
// from there. The list and download addresses are in languages.js.
import { dictById, dictUrls } from './languages.js'
import * as P from './paths.js'

const files = async (invoke, id) => {
  const dir = await invoke('data_dir', { sub: 'dictionaries' })
  return ['aff', 'dic'].map((ext) => P.join(dir, `${id}.${ext}`))
}

export async function downloadDict(invoke, id) {
  const d = dictById(id)
  if (!d) throw new Error(`unknown dictionary ${id}`)
  const paths = await files(invoke, id)
  const urls = dictUrls(d)
  for (let i = 0; i < 2; i++) {
    const res = await invoke('cloud_http', { req: { method: 'GET', url: urls[i], saveTo: paths[i], timeoutMs: 180000 } })
    if (res.status !== 200) throw new Error(`${urls[i]}: HTTP ${res.status}`)
  }
}

/** The two files as ArrayBuffers. */
export async function readDict(invoke, id) {
  const paths = await files(invoke, id)
  return Promise.all(paths.map((path) => invoke('read_bytes', { path })))
}

export async function removeDict(invoke, id) {
  for (const p of await files(invoke, id)) await invoke('data_remove', { path: p }).catch(() => {})
}
