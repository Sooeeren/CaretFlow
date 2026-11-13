// Checks for issue #27: switching between source mode and the rendered view must not rewrite the
// Markdown (`-` bullets came back as `*`), and edits in the rendered view keep the document's style.
import { check, summary, stubBackend, wait } from './lib.mjs'

const DOC = `# Notes

- Quellenangaben: Die Presse, 19. Juni 2021
- Textart: Zeitungsbericht
- Medium: Zeitung

---

Some __bold__ and _italic_ text.
`
const STARS = `# Stars

* one
* two

***

End.
`

let saved = null
async function save(page) {
  saved = null
  await page.keyboard.press('Control+S')
  for (let i = 0; i < 30 && saved === null; i++) await wait(100)
  return saved ?? ''
}
const toggle = async (page) => {
  await page.keyboard.press('Control+/')
  await wait(700)
}
const typeAtEnd = async (page, text) => {
  await page.keyboard.press('Control+End')
  await page.keyboard.type(text)
  await wait(400)
}

function scene(doc, run) {
  return {
    open: 'Welcome.md',
    settings: { theme: 'paper', sidebar: false, spellcheck: false, vim: false },
    setup: (page) => stubBackend(page, { read_text: () => doc, write_text: ({ content }) => void (saved = content) }),
    run: async (page) => {
      await wait(500)
      await run(page)
      summary()
    },
  }
}

export const scenes = {
  'roundtrip-source': scene(DOC, async (page) => {
    // the issue's steps: write in source mode, go to the rendered view and back
    await toggle(page) // → source
    await page.click('#source .cm-content')
    await typeAtEnd(page, '\n- Thema: Videospiele\n')
    await toggle(page) // → rendered
    await toggle(page) // → source
    const text = await save(page)
    check('bullets stay -', text.includes('- Thema: Videospiele') && !/^\* /m.test(text), JSON.stringify(text))
    check('text unchanged otherwise', text.includes('Some __bold__ and _italic_ text.') && text.includes('\n---\n'), JSON.stringify(text))

    // save from the rendered view right after switching: the exact text too
    await typeAtEnd(page, 'More.\n')
    await toggle(page) // → rendered, nothing edited there
    const text2 = await save(page)
    check('saving in the rendered view keeps the typed text', text2.includes('- Medium: Zeitung') && text2.includes('More.') && !/^\* /m.test(text2), JSON.stringify(text2))
    await wait(500)
    check('not dirty after saving', !(await page.title()).includes('•') && !(await page.evaluate(() => document.title)).startsWith('*'), await page.title())
  }),

  'roundtrip-rendered': scene(DOC, async (page) => {
    // an edit in the rendered view: the Markdown is written again, in the document's style
    await page.click('#wysiwyg .ProseMirror')
    await typeAtEnd(page, ' Edited.')
    const text = await save(page)
    check('rendered edit saved', text.includes('Edited.'), JSON.stringify(text))
    check('rendered edit keeps - bullets', /^- Quellenangaben/m.test(text) && !/^\* /m.test(text), JSON.stringify(text))
    check('rendered edit keeps --- rule', /^---$/m.test(text) && !/^\*\*\*$/m.test(text), JSON.stringify(text))
  }),

  'roundtrip-stars': scene(STARS, async (page) => {
    await page.click('#wysiwyg .ProseMirror')
    await typeAtEnd(page, ' Edited.')
    const text = await save(page)
    check('* bullets stay *', /^\* one/m.test(text) && !/^- /m.test(text), JSON.stringify(text))
  }),
}
