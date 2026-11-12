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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
    // Advanced Grammar: downloaded, with German and English n-grams; the server "runs" on 8010
    lt_status: () => ({ installed: true, running: 8010, ngrams: ['de', 'en'], busy: null, bytes: 11.6e9, dir: '' }),
    lt_start: () => 8010,
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
    // window.__stubExtra: more commands from a scene's setup() (see --extra)
    invoke: async (cmd, a = {}) => {
      const h = window.__stubExtra?.[cmd] || handlers[cmd]
      return h ? h(a) : null
    },
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
    webp: 'typing-1',
    open: 'Welcome.md',
    settings: { theme: 'ink', sidebar: false, extensions: ['typing'] },
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
    webp: 'typing-2',
    open: 'Welcome.md',
    settings: { theme: 'ink', sidebar: false, extensions: ['typing'] },
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
  cloud: {
    webp: 'cloud-1',
    open: 'Welcome.md',
    settings: {
      theme: 'paper',
      sidebarTab: 'cloud',
      sidebarWidth: 300,
      extensions: ['cloud'],
      cloudEnabled: true,
      cloudProvider: 'webdav',
      cloudUrl: 'https://cloud.example.com/remote.php/dav/files/you/Notes',
      cloudUser: 'you',
      cloudLocal: DEMO_DIR,
      cloudAuto: false,
    },
    // a remembered sync state: the Cloud tab draws from it without any server
    setup: (page) =>
      page.addInitScript((dir) => {
        const now = Date.now()
        const files = {}
        const local = {}
        const remote = {}
        const add = (rel, kind) => {
          const f = { size: 800 + rel.length * 37, mtime: now - 3600e3 }
          if (kind !== 'cloud') local[rel] = { ...f, mtime: kind === 'up' ? now - 60e3 : f.mtime }
          if (kind !== 'local') remote[rel] = { ...f, tag: kind === 'down' ? 'new' + rel : 'v1' + rel }
          if (kind !== 'cloud' && kind !== 'local') files[rel] = { lm: f.mtime, ls: f.size, rt: 'v1' + rel }
        }
        for (const r of ['Welcome.md', 'Draft.md', 'Ideas.md', 'Journal/2026-11-04.md', 'Journal/2026-11-05.md', 'Projects/CaretFlow/Roadmap.md', 'Projects/CaretFlow/Release notes.md', 'Reading list.md', 'assets/diagram.png']) add(r, 'same')
        add('Draft.md', 'up')
        add('Journal/2026-11-06.md', 'cloud')
        add('Projects/Garden.md', 'down')
        localStorage.setItem('folio.cloud', JSON.stringify({ id: `webdav|https://cloud.example.com/remote.php/dav/files/you/Notes|you|${dir}|notes`, files, local, remote, last: now - 4 * 60e3, error: null }))
        localStorage.setItem('folio.cloud.openDirs', JSON.stringify(['Journal', 'Projects', 'Projects/CaretFlow']))
      }, DEMO_DIR),
  },
  // only for the Extensions page (public/extensions/cloud-2.webp)
  'cloud-prefs': {
    webp: 'cloud-2',
    only: true,
    open: 'Welcome.md',
    settings: {
      theme: 'paper',
      extensions: ['cloud'],
      cloudEnabled: true,
      cloudProvider: 'webdav',
      cloudUrl: 'https://cloud.example.com/remote.php/dav/files/you/Notes',
      cloudUser: 'you',
      cloudLocal: DEMO_DIR,
      cloudAuto: false,
    },
    run: async (page) => {
      await key(page, 'Control+,')
      await settle(page, 300)
      await page.click('.prefs-nav button:has-text("Cloud Sync")')
      await settle(page, 600)
    },
  },
  // Preferences → Extensions, for the README
  extensions: {
    open: 'Welcome.md',
    settings: { theme: 'paper', extensions: ['cloud'] },
    run: async (page) => {
      await key(page, 'Control+,')
      await settle(page, 300)
      await page.click('.prefs-nav button:has-text("Extensions")')
      await settle(page, 400)
    },
  },
  // the AI Writing Help screenshots of the Extensions page: an AI answer comes from a stand-in
  'ai-tab': {
    webp: 'ai-1',
    only: true,
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, extensions: ['ai'], aiEnabled: true, aiProvider: 'anthropic', aiModel: 'claude-sonnet-5-5', aiFixWhen: 'manual', aiRecWhen: 'manual', autocorrect: false },
    setup: (page) =>
      page.addInitScript(() => {
        const answer = {
          model: 'claude-sonnet-5-5',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                findings: [
                  { quote: 'in order to', replacement: 'to', kind: 'conciseness', message: '“In order to” says the same as “to”.' },
                  { quote: 'it’s', replacement: 'its', kind: 'grammar', message: 'The possessive has no apostrophe.' },
                ],
              }),
            },
          ],
          usage: { input_tokens: 412, output_tokens: 96 },
        }
        const b64 = (t) => btoa(String.fromCharCode(...new TextEncoder().encode(t)))
        window.__stubExtra = {
          cloud_http: async () => ({ status: 200, headers: [], body: b64(JSON.stringify(answer)) }),
          secret_get: async () => 'key',
          secret_set: async () => null,
        }
      }),
    run: async (page) => {
      await page.click('#wysiwyg .ProseMirror h1')
      await key(page, 'End')
      await key(page, 'Enter')
      await key(page, 'Control+0')
      await page.keyboard.type('We moved the meeting in order to give the team time to read the draft, and the draft has it’s own summary now.')
      await key(page, 'F7')
      await settle(page, 300)
      await page.click('#wc-panel .wc-tab:nth-child(2)')
      await page.click('#wc-panel button:has-text("Check paragraph")')
      await settle(page, 1500)
    },
  },
  'ai-prefs': {
    webp: 'ai-2',
    only: true,
    open: 'Welcome.md',
    settings: { theme: 'paper', extensions: ['ai'], aiEnabled: true, aiProvider: 'anthropic', aiModel: 'claude-sonnet-5-5' },
    run: async (page) => {
      await key(page, 'Control+,')
      await settle(page, 300)
      await page.click('.prefs-nav button:has-text("AI")')
      await settle(page, 800)
    },
  },
  // the Discord Status screenshots of the Extensions page (discord_set answers null in the stub)
  'discord-prefs': {
    webp: 'discord-1',
    only: true,
    open: 'Welcome.md',
    settings: { theme: 'paper', extensions: ['discord'], discordAppId: '1' },
    run: async (page) => {
      await key(page, 'Control+,')
      await settle(page, 300)
      await page.click('.prefs-nav button:has-text("Discord")')
      await settle(page, 2500)
    },
  },
  'discord-dark': {
    webp: 'discord-2',
    only: true,
    open: 'Welcome.md',
    settings: { theme: 'ink', extensions: ['discord'], discordAppId: '1', discordFileName: true, vim: true },
    run: async (page) => {
      await key(page, 'Control+/')
      await settle(page, 400)
      await key(page, 'Control+,')
      await settle(page, 300)
      await page.click('.prefs-nav button:has-text("Discord")')
      await settle(page, 2500)
    },
  },
  // the Advanced Grammar screenshots of the Extensions page
  'ltlocal-prefs': {
    webp: 'ltlocal-1',
    only: true,
    open: 'Welcome.md',
    settings: { theme: 'paper', extensions: ['ltlocal'], spellcheck: true, wcEngine: 'languagetool', ltServer: 'local' },
    setup: (page) => page.route('http://127.0.0.1:8010/v2/check', (r) => r.fulfill({ json: { matches: [] } })),
    run: async (page) => {
      await key(page, 'Control+,')
      await settle(page, 300)
      await page.click('.prefs-nav button:has-text("Advanced Grammar")')
      await settle(page, 1200)
    },
  },
  'ltlocal-review': {
    webp: 'ltlocal-2',
    only: true,
    open: 'Draft.md',
    settings: { theme: 'ink', sidebar: false, extensions: ['ltlocal'], spellcheck: true, wcStyle: true, wcEngine: 'languagetool', ltServer: 'local' },
    // what LanguageTool answers for the draft: found by text, like the real server would
    setup: (page) =>
      page.route('http://127.0.0.1:8010/v2/check', (r) => {
        const text = new URLSearchParams(r.request().postData()).get('text') || ''
        const rules = [
          ['Their going', 'Their', 'Did you mean “They’re”?', 'They’re', 'grammar', 'Grammar'],
          ['tomorow', 'tomorow', 'Possible spelling mistake found.', 'tomorrow', 'misspelling', 'Possible Typo'],
          ['should of', 'should of', 'Did you mean “should have”?', 'should have', 'grammar', 'Grammar'],
          ['Its a', 'Its', 'Did you mean “It’s” (= it is)?', 'It’s', 'grammar', 'Grammar'],
          ['alot', 'alot', 'Did you mean “a lot”?', 'a lot', 'misspelling', 'Possible Typo'],
          ['is is', 'is is', 'Possible typo: you repeated a word.', 'is', 'duplication', 'Grammar'],
          ['I has', 'has', 'The pronoun “I” must be used with a non-third-person form of a verb.', 'have', 'grammar', 'Grammar'],
          ['completely offline', 'completely', 'This word is often unnecessary. Consider removing it.', '', 'style', 'Style'],
        ]
        const matches = rules
          .filter(([find]) => text.includes(find))
          .map(([find, word, message, rep, issueType, cat]) => ({
            offset: text.indexOf(find) + find.indexOf(word),
            length: word.length,
            message,
            replacements: [{ value: rep }],
            rule: { id: cat.toUpperCase().replace(/ /g, '_'), issueType, category: { name: cat } },
          }))
        r.fulfill({ json: { matches } })
      }),
    run: async (page) => {
      await page.waitForSelector('.wc-err', { timeout: 20000 }).catch(() => {})
      await settle(page, 600)
      await key(page, 'F7')
      await settle(page, 800)
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

/**
 * The README's main image: the editor screenshot as a window with rounded corners and a soft shadow,
 * on a colorful backdrop in the icon's plum and peach.
 */
async function heroShot(browser, src, dest) {
  const img = 'data:image/png;base64,' + readFileSync(src).toString('base64')
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 880 }, deviceScaleFactor: 1.5 })
  const page = await ctx.newPage()
  await page.setContent(`<!doctype html><html><head><style>
    html, body { margin: 0; width: 1280px; height: 880px; overflow: hidden; background: #160c28; }
    .bg { position: absolute; inset: 0;
      background:
        radial-gradient(60% 55% at 8% 12%, #c2409a 0%, transparent 62%),
        radial-gradient(55% 60% at 95% 8%, #6a3fd8 0%, transparent 60%),
        radial-gradient(50% 55% at 100% 95%, #2f7ee8 0%, transparent 58%),
        radial-gradient(60% 60% at 0% 100%, #ff7a59 0%, transparent 55%),
        linear-gradient(160deg, #4b2f6e 0%, #2a1748 55%, #1a0f30 100%); }
    svg { position: absolute; inset: 0; }
    .win { position: absolute; left: 50%; top: 50%; width: 1080px; transform: translate(-50%, -50%);
      border-radius: 14px; overflow: hidden;
      box-shadow: 0 0 0 1px rgba(255,255,255,.14), 0 30px 80px rgba(10,0,30,.55), 0 8px 24px rgba(10,0,30,.35); }
    .win img { display: block; width: 100%; }
  </style></head><body>
    <div class="bg"></div>
    <svg viewBox="0 0 1280 880" preserveAspectRatio="none">
      <defs>
        <linearGradient id="r1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a7a"/><stop offset=".5" stop-color="#e0469e"/><stop offset="1" stop-color="#7b4be0"/></linearGradient>
        <linearGradient id="r2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#53c8ff"/><stop offset="1" stop-color="#8a5cf0"/></linearGradient>
        <filter id="soft" filterUnits="userSpaceOnUse" x="-300" y="-300" width="1880" height="1460"><feGaussianBlur stdDeviation="26"/></filter>
        <filter id="glow" filterUnits="userSpaceOnUse" x="-300" y="-300" width="1880" height="1460"><feGaussianBlur stdDeviation="3"/></filter>
      </defs>
      <path d="M -80 700 C 200 520, 330 900, 640 760 S 1100 520, 1380 640" stroke="url(#r1)" stroke-width="150" fill="none" opacity=".85" filter="url(#soft)"/>
      <path d="M -60 140 C 220 40, 380 260, 620 120 S 1040 -40, 1360 90" stroke="url(#r2)" stroke-width="120" fill="none" opacity=".65" filter="url(#soft)"/>
      <path d="M -80 700 C 200 520, 330 900, 640 760 S 1100 520, 1380 640" stroke="#ffd2c4" stroke-width="2.5" fill="none" opacity=".45" filter="url(#glow)"/>
      <path d="M -60 140 C 220 40, 380 260, 620 120 S 1040 -40, 1360 90" stroke="#cfe9ff" stroke-width="2" fill="none" opacity=".35" filter="url(#glow)"/>
    </svg>
    <div class="win"><img src="${img}"></div>
  </body></html>`)
  await page.waitForFunction(() => document.querySelector('.win img').complete)
  await page.screenshot({ path: dest })
  await ctx.close()
  console.log('saved', dest)
}

/** Small WebP copies for the Extensions page (1280 px wide), encoded by the browser itself. */
async function toWebp(browser, src, dest) {
  mkdirSync(dirname(dest), { recursive: true })
  const page = await browser.newPage()
  const b64 = await page.evaluate(async (png) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + png
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 1280
    c.height = Math.round((img.height * 1280) / img.width)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/webp', 0.72).split(',')[1]
  }, readFileSync(src).toString('base64'))
  writeFileSync(dest, Buffer.from(b64, 'base64'))
  await page.close()
  console.log('saved', dest)
}

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
    if (only.length ? !only.includes(name) : scene.only) continue
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
    if (scene.setup) await scene.setup(page)
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
    if (name === 'editor') await heroShot(browser, file, join(outDir, 'hero.png'))
    if (scene.webp) await toWebp(browser, file, join(root, 'public', 'extensions', scene.webp + '.webp'))
  }
} finally {
  await browser.close()
  await server.close()
}
