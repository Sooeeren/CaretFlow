// Checks for the Diagram Editor extension (diagram.js, flowchart.js): absent until installed; a
// Diagram button on Mermaid blocks; editing a flowchart on the drawing (add, rename, connect by
// dragging, shapes, direction, delete, undo) writes plain Mermaid back; Esc changes nothing;
// source mode edits the block at the cursor; diagrams it can't model stay code-only.
//   node scripts/screenshots.mjs diagram-off diagram diagram-source --extra scripts/checks/diagram.mjs --out <tmp>
import { check, summary, run, stubBackend, wait } from './lib.mjs'

const DOC = `# Plan

Before the diagram.

\`\`\`mermaid
flowchart TD
  A[Start] --> B{Ready?}
  B -->|Yes| C[Ship]
\`\`\`

After the diagram.

\`\`\`mermaid
flowchart LR
  subgraph one
    X --> Y
  end
\`\`\`
`

let saved = null
async function md(page) {
  saved = null
  await page.keyboard.press('Control+S')
  for (let i = 0; i < 20 && saved === null; i++) await wait(100)
  return saved ?? ''
}
const backend = (page) => stubBackend(page, { read_text: () => DOC, write_text: ({ content }) => void (saved = content) })

const code = (page) => run(page, () => document.querySelector('#dg .dg-code').value)
const nodes = (page) => run(page, () => [...document.querySelectorAll('#dg g.node[data-node]')].map((g) => g.dataset.node))
const center = (page, id) =>
  run(page, (id) => {
    const r = document.querySelector(`#dg g.node[data-node="${id}"]`).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, id)
const drawn = async (page, n) => {
  for (let i = 0; i < 40; i++) {
    if ((await nodes(page)).length === n) return true
    await wait(100)
  }
  return false
}

export const scenes = {
  'diagram-off': {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, updateCheck: false },
    setup: backend,
    async run(page) {
      await wait(2000)
      check('no Diagram button while not installed', (await run(page, () => document.querySelectorAll('.cf-dg-btn').length)) === 0)
      await page.click('#menus .menu-root > button:has-text("Insert")')
      const items = await page.$$eval('.menu-pop .menu-item .lbl', (xs) => xs.map((x) => x.textContent))
      check('no Edit Diagram… in Insert', !items.includes('Edit Diagram…'), items.join('|'))
      summary()
    },
  },
  diagram: {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, updateCheck: false, extensions: ['diagram'] },
    setup: backend,
    async run(page) {
      await wait(2500)
      const btns = await run(page, () => document.querySelectorAll('#wysiwyg .cf-dg-btn').length)
      check('a Diagram button on each Mermaid block', btns === 2, String(btns))

      // open the first block from its button
      await page.hover('#wysiwyg .milkdown-code-block >> nth=0')
      await page.click('#wysiwyg .cf-dg-btn >> nth=0')
      await page.waitForSelector('#dg:not([hidden])')
      check('opens with the block’s code', (await code(page)).startsWith('flowchart TD\n  A[Start] --> B{Ready?}'))
      check('boxes are drawn and known', await drawn(page, 3), (await nodes(page)).join())
      check('toolbar shown for a flowchart', await run(page, () => !document.querySelector('#dg .dg-bar').hidden))

      // select C, add a box after it, name it
      await page.click('#dg g.node[data-node="C"]')
      check('click selects a box', await run(page, () => document.querySelector('#dg g.node[data-node="C"]').classList.contains('dg-sel')))
      await page.click('#dg .dg-add')
      await page.waitForSelector('#dg .dg-rename')
      await page.keyboard.type('Celebrate')
      await page.keyboard.press('Enter')
      await drawn(page, 4)
      let c = await code(page)
      check('+ Box adds a box linked from the selected one', c.includes('\n  C --> D[Celebrate]'), c)

      // drag from A to D to connect them
      const a = await center(page, 'A')
      const d = await center(page, 'D')
      await page.mouse.move(a.x, a.y)
      await page.mouse.down()
      await page.mouse.move(a.x + 20, a.y + 20, { steps: 3 })
      await page.mouse.move(d.x, d.y, { steps: 8 })
      await page.mouse.up()
      await wait(600)
      c = await code(page)
      check('dragging from a box to another connects them', /\n  A --> D\b/.test(c), c)
      check('the new link is selected', await run(page, () => document.querySelectorAll('#dg path.flowchart-link.dg-sel').length === 1))

      // dotted link, then direction, then a shape
      await page.click('#dg .dg-b[title="Dotted arrow"]')
      await wait(500)
      c = await code(page)
      check('link style', /\n  A -\.-> D\b/.test(c), c)
      await page.click('#dg .dg-b[title="Left to right"]')
      await wait(500)
      check('direction', (await code(page)).startsWith('flowchart LR\n'))
      await page.click('#dg g.node[data-node="D"]')
      await page.click('#dg .dg-b[title="Circle"]')
      await wait(500)
      check('shape', (await code(page)).includes('D((Celebrate))'))

      // double-click renames
      await page.dblclick('#dg g.node[data-node="B"]')
      await page.waitForSelector('#dg .dg-rename')
      await page.keyboard.press('Control+A')
      await page.keyboard.type('All set (really)?')
      await page.keyboard.press('Enter')
      await wait(500)
      c = await code(page)
      check('double-click renames, quoting brackets', c.includes('B{"All set (really)?"}'), c)

      // delete and undo
      await page.click('#dg g.node[data-node="D"]')
      await page.keyboard.press('Delete')
      await drawn(page, 3)
      c = await code(page)
      check('Del removes the box and its links', !/\bD\b/.test(c.split('\n').slice(1).join('\n')), c)
      await page.keyboard.press('Control+Z')
      check('Ctrl+Z brings it back', await drawn(page, 4))

      // typing code redraws
      await page.click('#dg .dg-code')
      await page.keyboard.press('Control+End')
      await page.keyboard.type('\n  C --> E[Typed]')
      check('typed code redraws', await drawn(page, 5), (await nodes(page)).join())

      // Done writes it into the document
      await page.click('#dg .dg-b.primary')
      await wait(400)
      check('Done closes the editor', await run(page, () => document.querySelector('#dg').hidden))
      let out = await md(page)
      check('the document has the new code', out.includes('flowchart LR\n  A[Start] --> B{"All set (really)?"}') && out.includes('C --> E[Typed]'), out)
      check('…in the same block, the rest untouched', out.includes('Before the diagram.') && out.includes('After the diagram.') && (out.match(/```mermaid/g) || []).length === 2)

      // Esc changes nothing
      await page.hover('#wysiwyg .milkdown-code-block >> nth=0')
      await page.click('#wysiwyg .cf-dg-btn >> nth=0')
      await page.waitForSelector('#dg:not([hidden])')
      await drawn(page, 5)
      await page.click('#dg .dg-add')
      await page.waitForSelector('#dg .dg-rename')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await wait(300)
      check('Esc closes', await run(page, () => document.querySelector('#dg').hidden))
      const out2 = await md(page)
      check('…without changes', out2 === out, out2.slice(0, 200))

      // a subgraph stays code-only
      await page.hover('#wysiwyg .milkdown-code-block >> nth=1')
      await page.click('#wysiwyg .cf-dg-btn >> nth=1')
      await page.waitForSelector('#dg:not([hidden])')
      await wait(800)
      const r = await run(page, () => ({ bar: document.querySelector('#dg .dg-bar').hidden, hint: document.querySelector('#dg .dg-hint').textContent }))
      check('a subgraph diagram is left to the code', r.bar && /Subgraphs/.test(r.hint), JSON.stringify(r))
      await page.keyboard.press('Escape')

      // new diagram from the menu, outside any block
      await page.click('#wysiwyg .ProseMirror p:has-text("After the diagram.")')
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Control+Alt+D')
      await page.waitForSelector('#dg:not([hidden])')
      check('Ctrl+Alt+D outside a block starts a new diagram', (await run(page, () => document.querySelector('#dg .dg-top b').textContent)) === 'New diagram')
      await page.keyboard.press('Control+Enter')
      await wait(500)
      out = await md(page)
      check('…inserted on Done', (out.match(/```mermaid/g) || []).length === 3 && out.includes('A[Start] --> B[Next step]'), out)
      summary()
    },
  },
  'diagram-source': {
    open: 'Welcome.md',
    settings: { theme: 'ink', sidebar: false, updateCheck: false, extensions: ['diagram'] },
    setup: backend,
    async run(page) {
      await wait(1500)
      await page.keyboard.press('Control+/')
      await wait(800)
      await page.click('.cm-content .cm-line:has-text("B -->|Yes|")')
      await page.keyboard.press('Control+Alt+D')
      await page.waitForSelector('#dg:not([hidden])')
      check('source mode: opens the block at the cursor', (await code(page)).startsWith('flowchart TD\n  A[Start]'))
      check('dark theme drawing', await drawn(page, 3))
      await page.click('#dg g.node[data-node="A"]')
      await page.click('#dg .dg-b[title="Database"]')
      await wait(400)
      await page.keyboard.press('Control+Enter')
      await wait(400)
      const t = await run(page, () => document.querySelector('.cm-content').innerText)
      check('source mode: Done replaces just that block', t.includes('A[(Start)] --> B{Ready?}') && t.includes('subgraph one'), t.slice(0, 300))
      summary()
    },
  },
}
