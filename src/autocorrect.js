// AutoCorrect while typing (rendered editor), like Word's: when a word is finished with a space or
// punctuation, common typos are fixed. Backspace right after a correction undoes it.
import { InputRule } from '@milkdown/kit/prose/inputrules'

// Frequent English typos → correction. Only unambiguous ones: nothing that is itself a word.
const TYPOS = `
abbout:about abotu:about abscence:absence accomodate:accommodate accross:across acheive:achieve acheived:achieved
acknowlege:acknowledge acording:according adress:address agian:again agressive:aggressive alot:a lot allready:already
alwasy:always amature:amateur anual:annual apparantly:apparently appearence:appearance aquire:acquire arguement:argument
athiest:atheist awfull:awful basicly:basically becasue:because becuase:because beacuse:because becomeing:becoming
begining:beginning beleive:believe beleived:believed belive:believe buisness:business calender:calendar carefull:careful
catagory:category cemetary:cemetery certianly:certainly chnage:change collegue:colleague comming:coming commited:committed
comittee:committee completly:completely concious:conscious copmuter:computer correspondance:correspondence curiousity:curiosity
definately:definitely definatly:definitely definetly:definitely dependant:dependent desparate:desperate develope:develop
diffrent:different dilema:dilemma disapear:disappear disapoint:disappoint doesnt:doesn't dont:don't didnt:didn't
embarass:embarrass enviroment:environment equiptment:equipment exagerate:exaggerate excercise:exercise existance:existence
experiance:experience explaination:explanation familar:familiar finaly:finally foriegn:foreign fourty:forty freind:friend
freinds:friends futher:further gaurd:guard goverment:government gratefull:grateful greatful:grateful happend:happened
harrass:harass havent:haven't hasnt:hasn't hadnt:hadn't heirarchy:hierarchy humourous:humorous hte:the
idenity:identity immediatly:immediately incidently:incidentally independant:independent infomation:information
interupt:interrupt irrelevent:irrelevant isnt:isn't jist:gist knowlege:knowledge langauge:language lenght:length
libary:library liason:liaison lisence:license maintainance:maintenance managment:management millenium:millennium
mischievious:mischievous mispell:misspell neccessary:necessary necessery:necessary neice:niece nieghbor:neighbor
noticable:noticeable occassion:occasion occured:occurred occurence:occurrence ocurred:occurred offical:official
oppurtunity:opportunity paralell:parallel parliment:parliament peice:piece persue:pursue posession:possession
potatos:potatoes prefered:preferred presense:presence probaly:probably publically:publicly realy:really recieve:receive
recieved:received reccomend:recommend recomend:recommend refered:referred relevent:relevant religous:religious
remeber:remember repitition:repetition resistence:resistance responsability:responsibility rythm:rhythm
seperate:separate seperately:separately shouldnt:shouldn't similiar:similar sincerly:sincerely speach:speech
succesful:successful successfull:successful supercede:supersede suprise:surprise surprize:surprise teh:the tehre:there
tendancy:tendency thier:their threshhold:threshold tommorow:tomorrow tommorrow:tomorrow tomorow:tomorrow tounge:tongue
truely:truly twelth:twelfth untill:until usualy:usually vaccuum:vacuum wasnt:wasn't wierd:weird
whcih:which wich:which wiht:with wouldnt:wouldn't couldnt:couldn't werent:weren't arent:aren't youre:you're
theyre:they're youve:you've theyve:they've weve:we've ive:I've im:I'm wouldve:would've couldve:could've shouldve:should've
writting:writing yeild:yield adn:and taht:that thta:that waht:what whta:what jsut:just konw:know knwo:know
`
  .trim()
  .split(/\s+/)
  .map((p) => p.split(':'))
const MAP = new Map(TYPOS.map(([a, b]) => [a, b]))

/**
 * Correction for a finished word, or null.
 * @param word        the word just typed
 * @param atSentenceStart  true when the word starts a sentence / block
 * @param o           { capitalize }
 */
export function correctWord(word, atSentenceStart = false, o = {}) {
  if (!/^[A-Za-z']+$/.test(word)) return null
  let out = null
  const lower = word.toLowerCase()
  const fix = MAP.get(lower)
  if (fix && word !== fix) {
    // keep the user's capitalization: Teh → The, TEH → THE
    if (word === word.toUpperCase() && word.length > 1) out = fix.toUpperCase()
    else if (word[0] === word[0].toUpperCase()) out = fix[0].toUpperCase() + fix.slice(1)
    else out = fix
  } else if (word === 'i') out = 'I'
  else if (/^[A-Z]{2}[a-z]{2,}$/.test(word)) out = word[0] + word.slice(1).toLowerCase() // TWo INitial CApitals
  if (o.capitalize && atSentenceStart) {
    const w = out || word
    if (/^[a-z]/.test(w)) out = w[0].toUpperCase() + w.slice(1)
  }
  return out && out !== word ? out : null
}

/** ProseMirror input rule. `opts()` returns { enabled, capitalize, english }. */
export function autocorrectRule(opts) {
  return new InputRule(/(^|[^\p{L}\p{N}_'’`])([A-Za-z']+)([ .,;:!?)\]"”’])$/u, (state, match, start, end) => {
    const o = opts()
    if (!o.enabled || !o.english) return null
    const $start = state.doc.resolve(start)
    if ($start.parent.type.spec.code || $start.marks().some((m) => m.type.spec.code || /code|link/i.test(m.type.name))) return null
    const wordStart = start + match[1].length
    // is the word at the start of a sentence?
    const before = state.doc.textBetween($start.start(), wordStart, '\n', '￼')
    const atStart = /(^|[.!?]\s+)$/.test(before) && !/\b(e\.g|i\.e|etc|vs|Mr|Mrs|Dr|St)\.\s+$/.test(before)
    const fixed = correctWord(match[2], atStart, o)
    if (!fixed) return null
    return state.tr.insertText(fixed + match[3], wordStart, end)
  })
}
