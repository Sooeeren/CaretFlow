// Helpers for UI checks: scene modules run by scripts/screenshots.mjs with --extra.
//   node scripts/screenshots.mjs <scene> --extra scripts/checks/<file>.mjs --out <tmp dir>
// Each check prints PASS/FAIL; a scene ends with summary(), which prints ALL PASSED or the count.

let failures = 0
export function check(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
  return ok
}
export function summary() {
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
  failures = 0
}

/**
 * Backend commands implemented in Node (handlers: { cmd: (args) => result }), available to the page
 * through the stub's window.__stubExtra. Also lets a test change settings across a reload:
 * sessionStorage['test.override'] is merged into folio.settings before the app starts.
 */
export async function stubBackend(page, handlers = {}) {
  await page.exposeFunction('__node', (cmd, args) => handlers[cmd](args))
  await page.addInitScript((cmds) => {
    window.__stubExtra = Object.fromEntries(cmds.map((c) => [c, (a) => window.__node(c, a).then((r) => (c === 'read_bytes' ? new Uint8Array(r).buffer : r))]))
  }, Object.keys(handlers))
  await page.addInitScript(() => {
    const o = sessionStorage.getItem('test.override')
    if (!o) return
    const st = JSON.parse(localStorage.getItem('folio.settings') || '{}')
    localStorage.setItem('folio.settings', JSON.stringify({ ...st, ...JSON.parse(o) }))
  })
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms))
/** Evaluate in the page and report a thrown error as a value instead of failing the run. */
export const run = (page, fn, arg) => page.evaluate(fn, arg).catch((e) => ({ error: String(e.message || e) }))
