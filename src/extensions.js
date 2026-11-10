// Extensions: optional features that ship with CaretFlow but stay out of the way until installed.
// An extension that isn't installed has no menu items, shortcuts, tabs or Preferences page, and its
// code is never loaded. Installing needs no download: it only switches the feature on.
// settings.extensions is the list of installed ids.

const shot = (name) => import.meta.env.BASE_URL + 'extensions/' + name
const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const EXTENSIONS = [
  {
    id: 'cloud',
    name: 'Cloud Sync',
    icon: svg('<path d="M7 18h10.5a4 4 0 0 0 .6-8 5.8 5.8 0 0 0-11.2-1.3A4.7 4.7 0 0 0 7 18z"/><path d="M10 13.5l2-2 2 2M12 11.5V16"/>'),
    tagline: 'Keep a folder in sync with your own server or cloud storage',
    description:
      'Two-way sync of one folder between your computers. Works with WebDAV (Nextcloud, ownCloud, Synology and other NAS), S3-compatible storage (AWS, Backblaze B2, Cloudflare R2, MinIO), and Google Drive, Proton Drive, OneDrive or Dropbox through rclone. Conflicts keep both versions, files a sync removes go to a sync trash, and CaretFlow asks before deleting many files at once. CaretFlow has no servers of its own.',
    adds: [
      'A Cloud tab in the sidebar (Ctrl+Shift+4) with every file in the cloud and its sync state',
      'File → Sync Now (Ctrl+Alt+S) and a sync button in the status bar',
      'Preferences → Cloud Sync',
    ],
    network: 'Only to the server or storage you set up, once you turn it on.',
    shots: [shot('cloud-1.webp'), shot('cloud-2.webp')],
  },
  {
    id: 'typing',
    name: 'Typing Test',
    icon: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10"/>'),
    tagline: 'Measure your typing speed and accuracy',
    description:
      'A minimal speed test: 15 to 120 seconds or 10 to 100 words, with optional punctuation and numbers, or on the text of the document you have open. Results show words per minute, accuracy, consistency and a per-second chart, and your personal bests are kept.',
    adds: ['Tools → Typing Test… (Ctrl+Alt+T)'],
    network: 'None.',
    shots: [shot('typing-1.webp'), shot('typing-2.webp')],
  },
  {
    id: 'ai',
    name: 'AI Writing Help',
    icon: svg('<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/><path d="M4 18h7"/>'),
    tagline: 'Corrections and suggestions from the AI you choose',
    description:
      'Spelling, grammar and style suggestions from Claude, ChatGPT, Gemini, DeepSeek and other providers with your own API key, or from a model on your computer (Ollama, LM Studio). Live checking of the paragraph you just wrote, with limits you set for requests and tokens. Or connect your AI app (Claude Desktop, Cursor, VS Code…) over MCP and let it review your document. Nothing changes until you click Apply.',
    adds: [
      'Preferences → AI with providers, limits and an MCP setup guide',
      'An AI tab in the review panel (F7) and AI underlines in the editor',
      'Tools → AI: Check Paragraph (Ctrl+Alt+K), AI: Check Document, AI: Next Suggestion',
      'A local MCP server for your AI app (off until you turn it on)',
    ],
    network: 'Only to the AI provider you choose, or to AI apps on this computer over MCP.',
    shots: [shot('ai-1.webp'), shot('ai-2.webp')],
  },
]

export const isInstalled = (settings, id) => (settings.extensions || []).includes(id)

/** Install or remove; keeps the catalog's order so the list reads the same everywhere. */
export function setInstalled(settings, id, on) {
  const set = new Set(settings.extensions || [])
  if (on) set.add(id)
  else set.delete(id)
  settings.extensions = EXTENSIONS.map((e) => e.id).filter((x) => set.has(x))
}
