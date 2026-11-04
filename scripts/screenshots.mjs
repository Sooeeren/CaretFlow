// Takes the README screenshots: runs the Vite dev server, opens CaretFlow in a local Chrome / Edge
// (driven by playwright-core) with a stand-in for the Tauri backend, and captures each scene.
//
//   node scripts/screenshots.mjs                 all scenes → docs/screenshots/*.png
//   node scripts/screenshots.mjs editor writing  only these scenes
//   node scripts/screenshots.mjs --out <dir>     somewhere else (handy for checking UI changes)
//
// Needs Chrome, Edge or Chromium installed (set FOLIO_BROWSER to the executable to pick one).
// The demo documents live in scripts/shots/demo/.
import { createServer, preview } from 'vite'
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const outIdx = args.indexOf('--out')
const outDir = outIdx >= 0 ? args.splice(outIdx, 2)[1] : join(root, 'docs', 'screenshots')
const extraIdx = args.indexOf('--extra') // a module exporting more scenes (used for UI checks)
const extra = extraIdx >= 0 ? args.splice(extraIdx, 2)[1] : null
const only = args.filter((a) => !a.startsWith('--'))

const DEMO_DIR = 'C:\\Users\\you\\Documents\\Notes'
const demoFiles = Object.fromEntries(
  readdirSync(join(root, 'scripts', 'shots', 'demo')).map((f) => [DEMO_DIR + '\\' + f, readFileSync(join(root, 'scripts', 'shots', 'demo', f), 'utf8')]),
)

function findBrowser() {
  const c = [
    process.env.FOLIO_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ]
  const exe = c.find((p) => p && existsSync(p))
  if (!exe) throw new Error('No Chrome/Edge/Chromium found; set FOLIO_BROWSER')
  return exe
}

/** Runs in the page before CaretFlow: a minimal fake of the Tauri IPC layer over an in-memory folder. */
function tauriStub({ files, dir, open }) {
  const fs = { ...files }
  let cb = 0
  const callbacks = {}
  const sep = '\\'
  const handlers = {
    native_titlebar: () => false,
    cli_args: () => [],
    initial_path: () => open,
    exists: ({ path }) => path in fs || path === dir,
    is_dir: ({ path }) => path === dir,
    read_text: ({ path }) => fs[path] ?? '',
    write_text: ({ path, text, contents }) => void (fs[path] = text ?? contents ?? ''),
    mtime: () => 1,
    list_dir: ({ path }) =>
      path === dir
        ? Object.keys(fs)
            .sort()
            .map((p) => ({ name: p.split(sep).pop(), path: p, dir: false }))
        : [],
    walk_md: () => Object.keys(fs),
    search_files: () => [],
    temp_dir: () => 'C:\\Temp',
    log_line: ({ line }) => console.log('[folio]', line),
    'plugin:window|is_maximized': () => false,
    'plugin:window|is_fullscreen': () => false,
    'plugin:event|listen': () => ++cb,
  }
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
    transformCallback: (fn) => {
      callbacks[++cb] = fn
      return cb
    },
    unregisterCallback: (id) => delete callbacks[id],
    convertFileSrc: (p) => p,
    invoke: async (cmd, a = {}) => (handlers[cmd] ? handlers[cmd](a) : null),
  }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
}

const settle = (page, ms = 400) => page.waitForTimeout(ms)
const key = (page, combo) => page.keyboard.press(combo)

/** Scenes: settings applied before load, the file to open, and what to do before the shot. */
const SCENES = {
  editor: { open: 'Welcome.md', settings: { theme: 'paper', sidebarTab: 'files' } },
  dark: { open: 'Welcome.md', settings: { theme: 'ink', sidebarTab: 'outline' } },
  source: {
    open: 'Welcome.md',
    settings: { theme: 'slate', vim: true, sidebar: false },
    run: async (page) => {
      await key(page, 'Control+/')
      await settle(page, 600)
    },
  },
  writing: {
    open: 'Draft.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: true },
    run: async (page) => {
      await page.waitForSelector('.wc-err', { timeout: 30000 }).catch(async () => console.log('no issues shown; status:', await page.locator('#st-wc').getAttribute('title')))
      await settle(page, 800)
      const box = await page.locator('.wc-err', { hasText: 'tomorow' }).first().boundingBox()
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
      await settle(page)
    },
  },
  review: {
    open: 'Draft.md',
    settings: { theme: 'sepia', sidebar: false, spellcheck: true },
    run: async (page) => {
      await page.waitForSelector('.wc-err', { timeout: 30000 }).catch(async () => console.log('no issues shown; status:', await page.locator('#st-wc').getAttribute('title')))
      await key(page, 'F7')
      await settle(page, 800)
    },
  },
  typing: {
    open: 'Welcome.md',
    settings: { theme: 'ink', sidebar: false },
    run: async (page) => {
      await page.evaluate(() => localStorage.setItem('folio.typing.cfg', JSON.stringify({ mode: 'time', time: 30, punct: false, nums: false })))
      await key(page, 'Control+Alt+T')
      await settle(page)
      const words = await page.$$eval('#tt .tt-word', (ws) => ws.slice(0, 9).map((w) => w.textContent))
      // type the first words, with one typo
      await page.keyboard.type(words.slice(0, 5).join(' ').replace(/(\w)(\w)$/, '$2$1') + ' ' + words[5].slice(0, 2), { delay: 75 })
      await settle(page, 250)
    },
  },
  results: {
    open: 'Welcome.md',
    settings: { theme: 'ink', sidebar: false },
    run: async (page) => {
      await page.evaluate(() => localStorage.setItem('folio.typing.cfg', JSON.stringify({ mode: 'words', words: 25, punct: false, nums: false })))
      await key(page, 'Control+Alt+T')
      await settle(page)
      const words = await page.$$eval('#tt .tt-word', (ws) => ws.map((w) => w.textContent))
      for (const [i, w] of words.entries()) {
        await page.keyboard.type(i === 7 ? w.slice(0, -1) + 'x' : w, { delay: 45 + ((i * 7) % 25) })
        if (i < words.length - 1) await page.keyboard.type(' ', { delay: 40 })
      }
      await settle(page, 500)
    },
  },
  bongo: {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, wpm: true, bongo: true },
    run: async (page) => {
      await page.click('#wysiwyg .ProseMirror p')
      await key(page, 'End')
      await page.keyboard.type(' Typing along with a little companion keeps me going.', { delay: 55 })
      await page.keyboard.press('k')
    },
  },
  about: {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false },
    run: async (page) => {
      await page.click('#menus .menu-root:last-child > button')
      await page.click('.menu-pop .menu-item:has-text("About CaretFlow")')
      await settle(page)
    },
  },
}

if (extra) Object.assign(SCENES, (await import(pathToFileURL(extra).href)).scenes)

// --built: serve the production build in dist/ (run `npx vite build` first) instead of the dev server
const built = args.includes('--built')
const server = built
  ? await preview({ root, logLevel: 'error', preview: { port: 4173, strictPort: false } })
  : await createServer({ root, logLevel: 'error', server: { port: 1420, strictPort: false } })
if (!built) await server.listen()
const url = server.resolvedUrls.local[0]
const browser = await chromium.launch({ executablePath: findBrowser() })
mkdirSync(outDir, { recursive: true })
try {
  for (const [name, scene] of Object.entries(SCENES)) {
    if (only.length && !only.includes(name)) continue
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log(`[${name}] page error:`, e.message))
    page.on('console', (m) => (process.env.DEBUG || m.type() === 'error') && console.log(`[${name}] console:`, m.text()))
    page.on('requestfailed', (r) => process.env.DEBUG && console.log(`[${name}] failed:`, r.url()))
    page.on('response', (r) => process.env.DEBUG && r.status() >= 400 && console.log(`[${name}] ${r.status()}:`, r.url()))
    const open = DEMO_DIR + '\\' + scene.open
    await page.addInitScript(tauriStub, { files: demoFiles, dir: DEMO_DIR, open })
    await page.addInitScript((s) => {
      localStorage.setItem('folio.settings', JSON.stringify({ reopenLast: false, ...s }))
      localStorage.setItem('folio.recent', '[]')
    }, scene.settings || {})
    await page.goto(url)
    await page.waitForSelector('#wysiwyg .ProseMirror, #source .cm-editor')
    await settle(page, 700)
    // let the spelling checker finish loading so the status bar is settled
    await page.waitForFunction(() => !/Checking/.test(document.querySelector('#st-wc')?.textContent || ''), null, { timeout: 30000 }).catch(() => {})
    if (process.env.EVAL) console.log(`[${name}] eval:`, await page.evaluate(`(async () => { try { return JSON.stringify(await (${process.env.EVAL})) } catch (e) { return 'ERR ' + (e.stack || e) } })()`))
    if (scene.run) await scene.run(page)
    const file = join(outDir, name + '.png')
    await page.screenshot({ path: file })
    console.log('saved', file)
    await ctx.close()
  }
} finally {
  await browser.close()
  await server.close()
}
