// Checks for the Extensions catalog, hiding, the Preferences tab and the 0.7.0 migration.
import { check, summary, run } from './lib.mjs'

export const scenes = {
  'ext-catalog': {
    open: 'Welcome.md',
    settings: {},
    async run(page) {
      const r = await run(page, async () => {
        const m = await import('/src/extensions.js')
        const s = { extensions: [] }
        const out = { ids: m.EXTENSIONS.map((e) => e.id), none: m.isInstalled(s, 'cloud') }
        m.setInstalled(s, 'ai', true)
        m.setInstalled(s, 'cloud', true)
        out.both = [...s.extensions]
        m.setInstalled(s, 'cloud', false)
        out.after = [...s.extensions]
        out.fields = m.EXTENSIONS.every((e) => e.name && e.icon && e.tagline && e.description && e.adds.length && e.network && e.shots.length >= 2)
        return out
      })
      check('catalog ids', JSON.stringify(r.ids) === '["cloud","typing","ai"]', JSON.stringify(r.ids ?? r.error))
      check('nothing installed', r.none === false)
      check('installed keeps catalog order', JSON.stringify(r.both) === '["cloud","ai"]', JSON.stringify(r.both))
      check('remove', JSON.stringify(r.after) === '["ai"]', JSON.stringify(r.after))
      check('every entry has texts and 2+ screenshots', r.fields === true)
      summary()
    },
  },
}
