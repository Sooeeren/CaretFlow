// Menu templates for Customize Menus (menueditor.js): starting points for different kinds of users.
// Items are command ids (their default menu path, as in settings.keybindings), '-' for a line,
// M(label, …items) for a menu or submenu, and '@Path' for a whole default submenu
// ('@View/Theme'). Extension commands are listed too: they stay hidden until it is installed.
// Every template keeps Preferences… and Customize Menus…, so the way back is always there.

const M = (label, ...items) => ({ label, items })

const help = (...extra) =>
  M('Help', 'Help/Welcome Page', 'Help/Markdown Guide', ...extra, '-', 'Help/Command Palette…', 'Help/Keyboard Shortcuts', 'Help/Customize Shortcuts…', 'Help/Customize Menus…', '-', 'Help/Check for Updates…', 'Help/About CaretFlow')
const headings = ['Paragraph/Heading 1', 'Paragraph/Heading 2', 'Paragraph/Heading 3', 'Paragraph/Paragraph']
const lists = ['Paragraph/Bullet List', 'Paragraph/Ordered List', 'Paragraph/Task List']
const find = ['Edit/Find…', 'Edit/Replace…', 'Edit/Find Next', 'Edit/Find Previous']
const zoom = ['View/Zoom In', 'View/Zoom Out', 'View/Actual Size']

export const MENU_TEMPLATES = [
  {
    id: 'minimal',
    name: 'Minimal',
    desc: 'Four short menus with what most people use. Everything else stays in the command palette (F1).',
    menus: [
      M('File', 'File/New', 'File/Open…', 'File/Quick Open…', 'File/Open Recent', '-', 'File/Save', 'File/Save As…', 'File/Export as PDF…', 'File/Print…', '-', 'File/Preferences…'),
      M('Edit', 'Edit/Undo', 'Edit/Redo', '-', 'Edit/Find…', 'Edit/Replace…'),
      M('View', 'View/Source Code Mode', 'View/Sidebar', '@View/Theme', '-', 'View/Focus Mode', 'View/Full Screen'),
      M('Help', 'Help/Markdown Guide', 'Help/Command Palette…', 'Help/Keyboard Shortcuts', 'Help/Customize Menus…', 'Help/About CaretFlow'),
    ],
  },
  {
    id: 'writer',
    name: 'Writer',
    desc: 'For stories, essays and blog posts: distraction-free modes, the writing check up front, export to Word and EPUB.',
    menus: [
      M('File', 'File/New', 'File/Open…', 'File/Open Recent', 'File/Open Folder…', '-', 'File/Save', 'File/Save As…', 'File/Auto-save', 'File/Rename…', 'File/Sync Now', '-', 'File/Export as Word (.docx)…', 'File/Export as PDF…', M('Export as E-book or Other', 'File/Export as Other Format/EPUB E-book (.epub)…', 'File/Export as Other Format/OpenDocument Text (.odt)…', 'File/Export as Other Format/Plain Text (.txt)…', 'File/Export as HTML…'), 'File/Page Preview', 'File/Print…', '-', 'File/Preferences…', 'File/Close Window'),
      M('Edit', 'Edit/Undo', 'Edit/Redo', '-', 'Edit/Paste as Plain Text', '-', ...find, '-', 'Edit/Read-only Mode'),
      M('Format', ...headings, '-', 'Format/Bold', 'Format/Italic', 'Format/Underline', 'Format/Strikethrough', 'Format/Clear Formatting', '-', 'Paragraph/Quote', ...lists.slice(0, 2), '-', 'Insert/Link', 'Insert/Image…', 'Insert/Horizontal Rule', 'Insert/Page Break'),
      M('Review', 'Tools/Spelling & Grammar…', 'Tools/Next Spelling or Grammar Issue', 'Tools/Check Spelling & Grammar', 'Tools/AutoCorrect While Typing', '-', 'Tools/AI: Check Paragraph', 'Tools/AI: Check Document', 'Tools/AI: Next Suggestion', 'Tools/AI: Review Panel'),
      M('View', 'View/Focus Mode', 'View/Typewriter Mode', 'View/Zen Mode (hide chrome)', 'View/Full Screen', '-', 'View/Sidebar', 'View/Outline', '@View/Theme', 'View/Full-width Content', ...zoom, '-', 'Tools/Typing Speed (WPM)', 'Tools/Typing Cat', '@Tools/Cat Style', 'Tools/Discord Status'),
      help(),
    ],
  },
  {
    id: 'academic',
    name: 'Student & Academic',
    desc: 'For papers, theses and homework: math, tables, a table of contents, page breaks, export to PDF, Word and LaTeX.',
    menus: [
      M('File', 'File/New', 'File/Open…', 'File/Quick Open…', 'File/Open Recent', 'File/Open Folder…', '-', 'File/Save', 'File/Save As…', 'File/Auto-save', 'File/Sync Now', '-', 'File/Preferences…', 'File/Close Window'),
      M('Edit', 'Edit/Undo', 'Edit/Redo', '-', 'Edit/Paste as Plain Text', 'Edit/Copy as Markdown', '-', ...find, 'Edit/Find in Folder…'),
      M('Paragraph', 'Paragraph/Heading 1', 'Paragraph/Heading 2', 'Paragraph/Heading 3', 'Paragraph/Heading 4', 'Paragraph/Paragraph', 'Paragraph/Promote Heading', 'Paragraph/Demote Heading', '-', ...lists, '-', 'Paragraph/Quote', '@Paragraph/Callout'),
      M('Insert', 'Insert/Math Block', 'Format/Inline Math', 'Insert/Table', 'Insert/Image…', '@Format/Image Size', 'Insert/Mermaid Diagram…', '-', 'Insert/Table of Contents', 'Insert/Page Break', 'Insert/Front Matter', '-', 'Insert/Link', 'Insert/Code Block'),
      M('Format', 'Format/Bold', 'Format/Italic', 'Format/Underline', 'Format/Strikethrough', 'Format/Inline Code', '-', 'Format/Clear Formatting'),
      M('Export', 'File/Export as PDF…', 'File/Page Preview', '@File/Export / PDF Theme', 'File/Print…', '-', 'File/Export as Word (.docx)…', 'File/Export as Other Format/LaTeX (.tex)…', 'File/Export as Other Format/OpenDocument Text (.odt)…', 'File/Export as HTML…'),
      M('Review', 'Tools/Spelling & Grammar…', 'Tools/Next Spelling or Grammar Issue', 'Tools/Check Spelling & Grammar', '-', 'Tools/AI: Check Document', 'Tools/AI: Review Panel'),
      M('View', 'View/Sidebar', 'View/Outline', 'View/Files', 'View/Search', '-', 'View/Source Code Mode', '@View/Theme', ...zoom, '-', 'View/Focus Mode', 'View/Full Screen'),
      help(),
    ],
  },
  {
    id: 'developer',
    name: 'Developer & Technical Writer',
    desc: 'For READMEs and docs: source mode and Vim at hand, code, diagrams, front matter, HTML and Markdown copy.',
    menus: [
      M('File', 'File/New', 'File/New Window', 'File/New File in Folder…', '-', 'File/Open…', 'File/Quick Open…', 'File/Open Recent', 'File/Open Folder…', 'File/Close Folder', '-', 'File/Save', 'File/Save As…', 'File/Auto-save', 'File/Rename…', 'File/Reload from Disk', 'File/Close File', '-', 'File/Export as HTML…', 'File/Export as PDF…', '-', 'File/Reveal in Explorer', 'File/Copy File Path', '-', 'File/Preferences…', 'File/Close Window'),
      M('Edit', 'Edit/Undo', 'Edit/Redo', '-', 'Edit/Copy as Markdown', 'Edit/Copy as HTML', 'Edit/Paste as Markdown', 'Edit/Paste as Plain Text', '-', ...find, 'Edit/Find in Folder…', '-', 'Edit/Read-only Mode'),
      M('Insert', 'Insert/Code Block', 'Format/Inline Code', 'Insert/Mermaid Diagram…', 'Insert/Table', '-', 'Insert/Link', 'Insert/Image…', '@Paragraph/Callout', '-', 'Insert/Front Matter', 'Insert/Table of Contents', 'Insert/Horizontal Rule'),
      M('Format', ...headings, 'Paragraph/Promote Heading', 'Paragraph/Demote Heading', '-', 'Format/Bold', 'Format/Italic', 'Format/Strikethrough', 'Format/Clear Formatting', '-', ...lists, 'Paragraph/Quote'),
      M('View', 'View/Source Code Mode', 'View/Vim Keybindings', '@View/Line Numbers', 'View/Wrap Code Lines', '-', 'View/Sidebar', 'View/Files', 'View/Outline', 'View/Search', '-', '@View/Theme', 'View/Full-width Content', ...zoom, '-', 'View/Always on Top', 'View/Command Palette…'),
      M('Tools', 'Tools/Check Spelling & Grammar', 'Tools/Spelling & Grammar…', '-', 'Tools/AI: Check Paragraph', 'Tools/AI: Review Panel', '-', 'Tools/Discord Status', 'Tools/Extensions…'),
      help(),
    ],
  },
  {
    id: 'notes',
    name: 'Note-taker',
    desc: 'For a folder of notes: quick open, folder search, task lists and callouts, sidebar tabs and Cloud Sync.',
    menus: [
      M('Notes', 'File/New File in Folder…', 'File/New', 'File/Quick Open…', 'File/Open Recent', '-', 'File/Open Folder…', 'File/Close Folder', 'Edit/Find in Folder…', '-', 'File/Save', 'File/Auto-save', 'File/Rename…', 'File/Close File', '-', 'File/Sync Now', 'Tools/Cloud Sync…', '-', 'File/Export as PDF…', 'File/Print…', '-', 'File/Preferences…'),
      M('Edit', 'Edit/Undo', 'Edit/Redo', '-', 'Edit/Paste as Plain Text', 'Edit/Copy as Markdown', '-', ...find, '-', 'Edit/Read-only Mode'),
      M('Insert', ...lists, '-', '@Paragraph/Callout', 'Paragraph/Quote', '-', 'Insert/Link', 'Insert/Image…', 'Insert/Table', 'Insert/Code Block', '-', 'Insert/Front Matter', 'Insert/Table of Contents'),
      M('Format', ...headings, '-', 'Format/Bold', 'Format/Italic', 'Format/Underline', 'Format/Strikethrough', 'Format/Inline Code', 'Format/Clear Formatting'),
      M('View', 'View/Sidebar', 'View/Files', 'View/Outline', 'View/Search', 'View/Cloud Files', '-', 'View/Source Code Mode', '@View/Theme', ...zoom, '-', 'View/Focus Mode', 'View/Always on Top'),
      help(),
    ],
  },
]

/** A template in the saved layout form: default submenus filled in, ids this build lacks left out. */
export function expandTemplate(t, defaults, has) {
  const findSub = (path) => {
    const parts = path.split('/')
    let items = defaults
    let hit = null
    for (const p of parts) {
      hit = items.find((x) => x && typeof x === 'object' && x.label === p)
      if (!hit) return null
      items = hit.items
    }
    return hit
  }
  const conv = (items) =>
    items.flatMap((x) => {
      if (x === '-') return ['-']
      if (typeof x === 'string' && x.startsWith('@')) {
        const sub = findSub(x.slice(1))
        return sub ? [structuredClone(sub)] : []
      }
      if (typeof x === 'string') return has(x) ? [x] : []
      return [{ label: x.label, items: conv(x.items) }]
    })
  return conv(t.menus)
}
