// Web worker around spell-core.js: Hunspell's lookups and suggestions never block typing.
import { load, check } from './spell-core.js'

self.onmessage = async ({ data: { id, op, args } }) => {
  try {
    const result = op === 'load' ? await load(...args) : check(...args)
    self.postMessage({ id, result })
  } catch (e) {
    self.postMessage({ id, error: String(e?.message || e) })
  }
}
