// Languages besides English: Hunspell dictionaries (the ones LibreOffice uses, packaged by
// wooorm/dictionaries) that CaretFlow downloads on first use, and a small detector that tells
// which language a paragraph is in, so an English checker never marks a German paragraph red.

/** Dictionaries CaretFlow can download. `base` is the language the detector reports. */
export const DICTS = [
  { id: 'de', base: 'de', name: 'German (Germany)', pkg: 'dictionary-de@3.0.0', mb: 1.1 },
  { id: 'de-at', base: 'de', name: 'German (Austria)', pkg: 'dictionary-de-at@3.0.0', mb: 1.1 },
  { id: 'de-ch', base: 'de', name: 'German (Switzerland)', pkg: 'dictionary-de-ch@3.0.0', mb: 1.1 },
  { id: 'fr', base: 'fr', name: 'French', pkg: 'dictionary-fr@3.0.0', mb: 1.4 },
  { id: 'es', base: 'es', name: 'Spanish', pkg: 'dictionary-es@4.0.0', mb: 0.9 },
  { id: 'it', base: 'it', name: 'Italian', pkg: 'dictionary-it@2.0.0', mb: 1.4 },
  { id: 'pt', base: 'pt', name: 'Portuguese (Brazil)', pkg: 'dictionary-pt@4.0.0', mb: 5.5 },
  { id: 'pt-pt', base: 'pt', name: 'Portuguese (Portugal)', pkg: 'dictionary-pt-pt@2.0.0', mb: 1.6 },
  { id: 'nl', base: 'nl', name: 'Dutch', pkg: 'dictionary-nl@2.0.0', mb: 2.6 },
  { id: 'pl', base: 'pl', name: 'Polish', pkg: 'dictionary-pl@2.0.0', mb: 5 },
  { id: 'sv', base: 'sv', name: 'Swedish', pkg: 'dictionary-sv@4.0.0', mb: 2.4 },
  { id: 'da', base: 'da', name: 'Danish', pkg: 'dictionary-da@6.0.0', mb: 3.8 },
  { id: 'nb', base: 'nb', name: 'Norwegian (Bokmål)', pkg: 'dictionary-nb@3.0.0', mb: 5.4 },
  { id: 'ca', base: 'ca', name: 'Catalan', pkg: 'dictionary-ca@3.0.0', mb: 2.9 },
  { id: 'cs', base: 'cs', name: 'Czech', pkg: 'dictionary-cs@4.0.0', mb: 3.8 },
  { id: 'ru', base: 'ru', name: 'Russian', pkg: 'dictionary-ru@3.0.0', mb: 3.6 },
  { id: 'uk', base: 'uk', name: 'Ukrainian', pkg: 'dictionary-uk@4.0.0', mb: 8.7 },
]
export const dictById = (id) => DICTS.find((d) => d.id === id)
/** The variant offered first when a language shows up (the others are in Preferences). */
export const defaultDict = (base) => DICTS.find((d) => d.base === base)
export const languageName = (base) => (base === 'en' ? 'English' : (defaultDict(base)?.name || base).replace(/ \(.*\)$/, ''))
/** Where a dictionary's two files come from (a CDN that mirrors npm, pinned to the version above). */
export const dictUrls = (d) => ['aff', 'dic'].map((ext) => `https://cdn.jsdelivr.net/npm/${d.pkg}/index.${ext}`)

// ─────────────────────────────── language detection
// Common short words of each language. A paragraph's words are looked up here: no model, no
// download, and reliable for anything longer than a short sentence. Shorter text is left to the
// document's main language.
const STOP = {
  en: 'the a and of to in is that it with for was are this you have not but they from which would be on as at by an or will were there their what about we my your',
  de: 'der die und das ist nicht ich mit sie auf den ein eine auch sich dem es zu wir wird oder aber wie für noch nach bei sind von werden kann nur über ihr',
  fr: 'le la les et est des une que dans pas pour qui sur avec il nous vous ce sont mais du au elle ont cette être fait plus aussi leur',
  es: 'el los las que y es una por con para del no se como pero más está son muy esta también fue hay ser tiene sus lo al ya',
  it: 'il che di non per una sono gli della con è anche come questo ma nel più lo alla delle hanno stato essere dei suo',
  pt: 'o os que não uma com para é do da em mas são está isso como você muito das ao pelo seu também foi ser tem às',
  nl: 'de het een en van is niet dat op zijn met voor ik maar ook wij wordt aan er naar dit bij heeft geen worden kan',
  pl: 'i nie się to jest że na do jak ale tak czy co już przez być który jestem może dla są ich go od tylko',
  sv: 'och att det är som en på inte för med jag har av till den om men vi ett var så kan från ska hade också',
  da: 'og at det er en til ikke som på med for har jeg af den de men vi et var så kan fra skal hvad noget efter også',
  nb: 'og at det er en til ikke som på med for har jeg av den de men vi et var så kan fra skal hva noe etter også ble',
  ca: 'el la els les i que és per amb una no del als però també aquest aquesta són hi seu més ha va molt',
  cs: 'a je se na to že v s jsem ale jak tak pro není které být jsou by od jsme také jako bylo já',
  ru: 'и в не на что я с он как это по но из его то все она так был к у же вы за бы от мы',
  uk: 'і в не на що я з він як це по але та його то все вона так був до у же ви за б від ми',
}
const SETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(' '))]))

/**
 * The language of a piece of text ('en', 'de', …), or null when it is too short or unclear.
 * Clear means: many of its words are common words of one language, clearly more than of any other.
 */
export function detectLanguage(text) {
  const words = text.toLowerCase().match(/\p{L}+/gu) || []
  if (words.length < 6) return null
  // Cyrillic: letters only one of the two languages has settle it before word counts do
  if (/[а-яё]/.test(text.toLowerCase())) {
    if (/[іїєґ]/i.test(text)) return 'uk'
    if (/[ыэъё]/i.test(text)) return 'ru'
  }
  const scores = Object.entries(SETS).map(([lang, set]) => [lang, words.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0)])
  scores.sort((a, b) => b[1] - a[1])
  const [[best, top], [, second]] = scores
  // two common words at least: one stray "und" doesn't make an English sentence German
  if (top < 2 || top / words.length < 0.12 || top < second * 1.3) return null
  return best
}

/** The language a document is mostly written in: front matter `lang:` first, else the most common detected one. */
export function mainLanguage(texts, declared) {
  if (declared) return declared.toLowerCase().split(/[-_]/)[0]
  const count = {}
  let n = 0
  for (const t of texts) {
    const l = detectLanguage(t)
    if (!l) continue
    count[l] = (count[l] || 0) + t.length
    n += t.length
  }
  const [best, len] = Object.entries(count).sort((a, b) => b[1] - a[1])[0] || []
  return best && len >= n * 0.6 ? best : 'en'
}
