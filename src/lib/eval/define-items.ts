// The "define" suite's items (issue #251, docs/BENCHMARKS.md section 1 "B8" and section 3 lever 18):
// a student asks what a word means, in one turn. Data only; the grader is define-grade.ts and the
// runner define-runner.ts.
//
// ── How the items were made (frozen before any run) ──────────────────────────
// Written by hand from general knowledge, in one sitting, BEFORE the author opened anything in
// public/dictionary/, the dictionary's tests, or any other WordNet text, and committed on its own
// before the commit that wires the dictionary into the tutor turn. So no word list, definition,
// example or expect term was taken from the dictionary the treatment arm shows the model.
//
// Expect terms are deliberately broad: any everyday synonym or plain paraphrase a correct answer
// might use, so a baseline answer in its own words passes and the treatment arm cannot win by
// repeating the dictionary's wording. Scoring (define-grade.ts): `expect` is a list of groups, every
// group must match; a group is "|"-separated alternatives matched as whole words, case-insensitive
// (rag-dev-v2.ts containsAlternative), and an alternative ending in "*" matches any word starting with
// it ("laugh*" finds "laughing"). No alternative may match the asked word or the student's own text
// (define-items.test.ts), so echoing the question never passes.
//
// Two kinds:
//   - "plain": an explicit meaning question with no sentence. ~38 per grade band, words a student in
//     that band might meet (K-2 everyday words, up to 9-12 rare literary/academic words, several of
//     them commonly misused: enervate, nonplussed, noisome, restive, sanguine).
//   - "sense": a word with several meanings, asked with a sentence where the intended sense is NOT the
//     one a reader would guess first. `wrongSense` lists terms that mark the other sense. Two
//     readings, both reported: lenient = expect matched; strict = expect matched and no wrongSense
//     term anywhere (a reply that contrasts the senses fails strict). A sense effect counts only if it
//     holds under both readings (the k12-flow-fr house rule for two readings).
//
// Every `ask` is a phrasing the detector (kernel/defineWord.ts askedWord) fires on, returning `word`
// (define-items.test.ts checks this against the frozen detector). Phrasings vary on purpose: "what does
// X mean", "what's/whats X mean", "what is the meaning of X", "meaning of X", "definition of X",
// "define X", "I don't know what X means", with and without "the word", quotes, capitals and "?".
//
// The split (DEFINE_SPLIT below) is fixed by position before any run: within each band and kind, every
// third item starting with the first is DEV, the rest TEST.
//
// Ids: "def-<band>-<nn>" for plain items, "sense-<band>-<nn>" for sense items; band k2, 35, 68, 912.

import type { GradeBand } from "../grade";

export type DefineKind = "plain" | "sense";

export interface DefineItem {
  id: string;
  band: GradeBand;
  kind: DefineKind;
  /** The student's whole message. */
  ask: string;
  /** What askedWord must return as `word`. */
  word: string;
  /** Groups of "|" alternatives; every group must match. */
  expect: string[];
  /** Sense items only: terms of the sense the sentence does NOT mean. */
  wrongSense?: string;
}

type Row = [id: string, ask: string, word: string, expect: string, wrongSense?: string];

const make = (band: GradeBand, kind: DefineKind, rows: Row[]): DefineItem[] =>
  rows.map(([id, ask, word, expect, wrongSense]) => ({ id, band, kind, ask, word, expect: [expect], ...(wrongSense ? { wrongSense } : {}) }));

// ── Plain items ───────────────────────────────────────────────────────────────

const PLAIN_K2: Row[] = [
  ["def-k2-01", "what does enormous mean?", "enormous", "big|large|huge|giant|gigantic|massive|immense"],
  ["def-k2-02", "What does the word tiny mean", "tiny", "small|little|teeny|itty|wee"],
  ["def-k2-03", "whats brave mean", "brave", "courag*|fearless|afraid|scared|fear*|bold|daring"],
  ["def-k2-04", "what is the meaning of giggle?", "giggle", "laugh*|chuckl*|titter*"],
  ["def-k2-05", "define shiver", "shiver", "shak*|trembl*|quiver*|shudder*|cold"],
  ["def-k2-06", "i dont know what furious means", "furious", "angry|angri*|mad|rage|enraged|fury|livid|cross|upset"],
  ["def-k2-07", "what does whisper mean", "whisper", "quiet*|soft*|low voice|hush*|breath*"],
  ["def-k2-08", "what does shy mean?", "shy", "nervous|timid|bashful|uncomfortable|quiet|scared|afraid|worried|uneasy|reserved|awkward"],
  ["def-k2-09", "what's delicious mean", "delicious", "tast*|yummy|good to eat|flavor*|flavour*"],
  ["def-k2-10", "definition of nibble", "nibble", "bite*|bit|chew*|munch*|gnaw*"],
  ["def-k2-11", "what does grumpy mean", "grumpy", "cranky|grouch*|bad mood|bad-tempered|crabby|irritab*|annoyed|grumbl*|cross|unhappy|upset|angry|mad|moody|sulky"],
  ["def-k2-12", "what does the word cozy mean?", "cozy", "warm*|comfort*|snug*|safe|relax*"],
  ["def-k2-13", "What is the meaning of sparkle", "sparkle", "shin*|glitter*|twinkl*|flash*|bright*|glint*|gleam*|light"],
  ["def-k2-14", "what does stumble mean", "stumble", "trip*|fall*|fell|balance|stagger*|clums*"],
  ["def-k2-15", "whats chilly mean?", "chilly", "cold|cool|nippy|brisk|frosty"],
  ["def-k2-16", "what does frightened mean", "frightened", "scared|afraid|fear*|terrifi*|alarm*|startl*"],
  ["def-k2-17", "I don't know what curious means", "curious", "want to know|wants to know|wanting to know|wonder*|interest*|ask* questions|find out|learn*|nosy|inquisit*"],
  ["def-k2-18", "what does plump mean?", "plump", "chubby|round*|fat|fleshy|full|chunky|pudgy|thick|stout|well-fed"],
  ["def-k2-19", "define soggy", "soggy", "wet|damp|soak*|mushy|sodden|waterlogged|squish*|moist"],
  ["def-k2-20", "what does scurry mean", "scurry", "hurr*|quick*|fast|rush*|scamper*|dash*|scuttl*|small steps|run*"],
  ["def-k2-21", "what is the definition of peek?", "peek", "quick look|look*|glance*|peep*|sneak*|glimpse*|peer*"],
  ["def-k2-22", "what does drowsy mean", "drowsy", "sleepy|tired|sleep*|doze*|yawn*"],
  ["def-k2-23", "what's fluffy mean?", "fluffy", "soft|fuzz*|puff*|feather*|fur*|airy|downy"],
  ["def-k2-24", "what does wobble mean", "wobble", "shak*|sway*|rock*|unstead*|jiggl*|side to side|back and forth|teeter*|totter*|wiggl*"],
  ["def-k2-25", "What does the word gobble mean?", "gobble", "eat*|ate|gulp*|wolf*|scarf*|devour*|swallow*|quick*|fast|turkey*"],
  ["def-k2-26", "meaning of puddle", "puddle", "water|rain*|small pool|pool"],
  ["def-k2-27", "what does tumble mean", "tumble", "fall*|fell|roll*|topple*|flip*|somersault*|trip*|drop*"],
  ["def-k2-28", "what does hatch mean", "hatch", "egg*|break* out|come out|comes out|born|crack*|emerg*|door|opening|trapdoor"],
  ["def-k2-29", "what does share mean", "share", "give*|giving|split*|divid*|together|some of|let others|let someone|take turns|both use|everyone gets"],
  ["def-k2-30", "define gentle", "gentle", "soft*|kind*|careful*|calm*|tender*|light touch|not rough|mild|easy"],
  ["def-k2-31", "i don't know what squeal means", "squeal", "high*|shriek*|squeak*|scream*|screech*|loud|cry|yelp*|pig*"],
  ["def-k2-32", "what does glad mean?", "glad", "happy|pleased|joy*|delight*|cheer*|thankful|grateful|relieved"],
  ["def-k2-33", "what does the word swift mean", "swift", "fast|quick*|speed*|rapid*|fleet|zoom*|bird*"],
  ["def-k2-34", "What's the meaning of messy?", "messy", "dirty|untid*|clutter*|disorgan*|everywhere|not neat|not tidy|sloppy|jumble*|chaos|chaotic|scatter*"],
  ["def-k2-35", "what does munch mean", "munch", "chew*|eat*|ate|crunch*|chomp*|bite*"],
  ["def-k2-36", "what does shout mean", "shout", "loud*|yell*|scream*|holler*|call out|cry out|raise your voice"],
  ["def-k2-37", "definition of sniff", "sniff", "smell*|nose|inhal*|breath*|scent*|odor*|odour*"],
  ["def-k2-38", "what does fetch mean", "fetch", "get|go and get|bring*|brought|retriev*|carry back|pick up|grab*"],
];

const PLAIN_35: Row[] = [
  ["def-35-01", "what does ancient mean?", "ancient", "old|long ago|thousands of years|years ago|old times|antique|aged"],
  ["def-35-02", "what's the definition of reluctant", "reluctant", "unwilling|not want*|don't want|didn't want|doesn't want|hesitan*|hesitat*|not eager|unenthusiastic|hold* back"],
  ["def-35-03", "what does the word cautious mean", "cautious", "careful*|danger*|risk*|wary|prudent|safe|avoid*"],
  ["def-35-04", "define fragile", "fragile", "break*|broke*|easily damaged|delicate|weak|crack*|shatter*|handle with care"],
  ["def-35-05", "what is the meaning of drought", "drought", "rain*|dry|dried|water|thirst*|arid"],
  ["def-35-06", "I don't know what migrate means", "migrate", "move*|moving|travel*|journey*|go south|goes south|another place|another region|relocat*|season*"],
  ["def-35-07", "what does nocturnal mean", "nocturnal", "night*|dark|after sunset"],
  ["def-35-08", "whats vibrant mean", "vibrant", "bright*|colorful|colourful|lively|full of life|energ*|vivid|bold|strong"],
  ["def-35-09", "what does generous mean?", "generous", "shar*|giv*|kind*|unselfish|free*|lavish|plenty|big-hearted"],
  ["def-35-10", "meaning of predator", "predator", "hunt*|eat*|kills|prey|kill*|catch*"],
  ["def-35-11", "what does camouflage mean", "camouflage", "blend*|hide*|hidden|hiding|disguis*|conceal*|surround*|not be seen|invisible"],
  ["def-35-12", "What does hesitate mean?", "hesitate", "pause*|paus*|wait*|unsure|delay*|not sure|uncertain|second thoughts|holding back|hold back|reluctan*"],
  ["def-35-13", "define abundant", "abundant", "lot*|plenty|plentiful|many|much|large amount|large quantity|more than enough|ample|loads|tons|rich|great quantity"],
  ["def-35-14", "what does the word humid mean?", "humid", "moist*|damp|water vapor|water vapour|wet|muggy|sticky|steamy|moisture"],
  ["def-35-15", "whats the definition of gratitude", "gratitude", "thank*|grateful|appreciat*"],
  ["def-35-16", "what does persuade mean", "persuade", "convinc*|talk* into|get someone to|get them to|get somebody to|make someone|coax*|urge*|influenc*|change their mind|change someone's mind|change your mind|agree"],
  ["def-35-17", "what is the meaning of the word fierce", "fierce", "violent|aggressive|wild|ferocious|savage|intense|strong|powerful|scary|angry|dangerous|frighten*|attack*|brutal|vicious"],
  ["def-35-18", "i don't know what conclude means", "conclude", "end*|finish*|clos*|wrap* up|decid*|figure* out|work* out|judg*|deduc*|infer*|final"],
  ["def-35-19", "what does elevate mean", "elevate", "lift*|rais*|higher|upward*|boost*|increas*|hoist*|improv*|promot*"],
  ["def-35-20", "what does observe mean?", "observe", "watch*|look*|notic*|see|seeing|study|studi*|examin*|follow* a rule|obey*|celebrat*|keep"],
  ["def-35-21", "what's the meaning of scarce", "scarce", "rare|rarely|not enough|hard to find|short supply|few|little|limited|lack*|insufficient|uncommon|not much|not many"],
  ["def-35-22", "define vast", "vast", "huge|big|large|enormous|immense|great|wide|spread* out|massive|endless|extensive|boundless|giant"],
  ["def-35-23", "what does mischievous mean", "mischievous", "trouble*|naughty|playful*|prank*|tricks|tease|teasing|harm*|annoy*|cheeky|impish|misbehav*|mischief"],
  ["def-35-24", "what does the word fatigue mean", "fatigue", "tired*|exhaust*|weary|weari*|worn out|lack of energy|sleepy|no energy"],
  ["def-35-25", "what does triumph mean?", "triumph", "win*|won|victor*|success*|achiev*|beat*|great joy|celebrat*|accomplish*|conquer*"],
  ["def-35-26", "whats the definition of examine", "examine", "look*|inspect*|stud*|check*|investigat*|observ*|scrutin*|test*|analy*"],
  ["def-35-27", "what does vanish mean", "vanish", "disappear*|gone|go away|went away|out of sight|no longer|fade*|invisible|cease*"],
  ["def-35-28", "what is the meaning of anxious", "anxious", "worr*|nervous|uneasy|afraid|scared|stress*|tense|fear*|eager|impatient|jittery|on edge|concern*"],
  ["def-35-29", "define precise", "precise", "exact*|accurate*|correct|careful*|specific|detail*|right|definite|particular"],
  ["def-35-30", "what does the word solitary mean?", "solitary", "alone|lonely|lone|on its own|on their own|on your own|by itself|by themselves|by yourself|single|isolat*|without others|without company|no company"],
  ["def-35-31", "what does exaggerate mean", "exaggerate", "bigger|more than|overstat*|stretch* the truth|blow* out of proportion|make it sound|than it really|than it is|than they are|than it was|overdo*|inflat*|embellish*|amplif*"],
  ["def-35-32", "I don't know what flexible means", "flexible", "bend*|bent|bendy|stretch*|chang*|adapt*|adjust*|without breaking|elastic|supple|pliable|bendable|not rigid|not stiff"],
  ["def-35-33", "what's ignite mean", "ignite", "fire|light*|burn*|catch fire|flame*|spark*|combust*|kindle*|inflame*|excite*|rouse*"],
  ["def-35-34", "what does peculiar mean?", "peculiar", "strange*|odd*|weird*|unusual*|different|funny|bizarre|curious|unique|special|particular|specific|belong*|characteristic"],
  ["def-35-35", "meaning of contaminate", "contaminate", "dirty|dirti*|pollut*|poison*|infect*|germ*|unclean|spoil*|taint*|impure|harmful|unsafe"],
  ["def-35-36", "what does trudge mean", "trudge", "walk*|heav*|slow*|tired*|plod*|trek*|hard|effort|tramp*|drag*"],
  ["def-35-37", "what does the word reside mean?", "reside", "live*|living|dwell*|stay*|home|inhabit*|located|exist*|settled"],
  ["def-35-38", "define coax", "coax", "persuad*|convinc*|gentl*|sweet-talk*|sweet talk*|talk* into|urge*|encourag*|kind words|wheedl*|cajol*|patient*|tempt*|lure*"],
];

const PLAIN_68: Row[] = [
  ["def-68-01", "what does ambiguous mean?", "ambiguous", "more than one meaning|unclear|not clear|uncertain|vague|two meanings|several meanings|different meanings|different ways|more than one way|open to|confus*|double meaning|interpret*|equivocal|doubtful"],
  ["def-68-02", "what's the definition of meticulous", "meticulous", "careful*|detail*|precise*|thorough*|exact*|painstak*|attention to|fussy|scrupulous*|particular|perfect*"],
  ["def-68-03", "define benevolent", "benevolent", "kind*|generous*|good|charit*|caring|well-meaning|goodwill|good will|help*|compassion*|altruis*|benign|warm-hearted|kindhearted|kind-hearted|good-hearted"],
  ["def-68-04", "what is the meaning of resilient", "resilient", "recover*|bounce* back|spring* back|tough*|strong|adapt*|cope|coping|withstand*|bounc*|elastic|hardy|get back up|overcome|keep going|setback*|difficult*|hard times"],
  ["def-68-05", "what does the word candid mean", "candid", "honest*|frank*|open*|truth*|direct*|sincere*|straightforward|blunt|unposed|natural|unscripted|informal|spontaneous|not posed"],
  ["def-68-06", "I don't know what inevitable means", "inevitable", "certain*|sure to happen|bound to|unavoidable|can't be avoided|cannot be avoided|can't avoid|cannot avoid|will happen|going to happen|no way to stop|can't be stopped|cannot be stopped|can't stop|cannot stop|definitely happen|unstoppable|no escap*|impossible to avoid|impossible to stop"],
  ["def-68-07", "what does scrutinize mean", "scrutinize", "examin*|inspect*|stud*|closely|careful*|detail*|analy*|investigat*|check*|critical*"],
  ["def-68-08", "whats the meaning of eloquent", "eloquent", "speak* well|speaking well|express*|well-spoken|well spoken|fluent*|articulat*|persuasive*|graceful*|clear|moving|powerful*|beautiful*|skill*|good with words|way with words|silver-tongued|forceful"],
  ["def-68-09", "what does tedious mean?", "tedious", "boring|bore*|dull|monoton*|tiresome|tiring|long|repetit*|slow|wearisome|drag* on|uninteresting|not interesting|mind-numbing|humdrum|dreary"],
  ["def-68-10", "define deteriorate", "deteriorate", "worse|worsen*|declin*|decay*|degenerat*|break* down|fall* apart|crumbl*|weaken*|get bad|go downhill|rot*|wear* out|wear* away|degrad*"],
  ["def-68-11", "what does the word frugal mean?", "frugal", "sav*|careful with money|thrift*|econom*|cheap|spend* little|not spend|not waste|don't waste|without waste|budget*|sparing*|penny|money"],
  ["def-68-12", "what's the definition of hypothesis", "hypothesis", "guess*|predict*|explanation|idea|propos*|assum*|theor*|test*|suppos*|tentative"],
  ["def-68-13", "what does adversary mean", "adversary", "enem*|opponent*|rival*|foe*|competitor*|against|antagonist*|other side|oppos*"],
  ["def-68-14", "what is the meaning of contemplate", "contemplate", "think*|thought*|consider*|ponder*|reflect*|look at|gaze*|stare*|meditat*|mull*|weigh*|wonder*|plan*|intend*|study"],
  ["def-68-15", "I don't know what diligent means", "diligent", "hard-work*|hard work*|work* hard|careful*|thorough*|effort*|persist*|dedicat*|industrious|conscientious*|attentive|steady|keep* at|committed|commitment|focus*|devot*|serious|responsible|assiduous"],
  ["def-68-16", "what does arid mean?", "arid", "dry|dried|little rain|no rain|not much rain|desert*|lack* of water|lack* water|without water|without rain|parched|barren|moisture|dull|boring|lifeless"],
  ["def-68-17", "define obsolete", "obsolete", "out of date|outdated|out-of-date|no longer|not used anymore|old-fashioned|old fashioned|outmoded|replaced|not used|out of use|disused|archaic|antiquated|discontinued|out of style|extinct|defunct|dated|old|anymore|any more"],
  ["def-68-18", "whats skeptical mean", "skeptical", "doubt*|not sure|unsure|question*|unconvinced|not convinced|suspicious*|distrust*|mistrust*|wary|disbelie*|uncertain|not believ*|don't believe|hard to believe|cynical|proof|evidence"],
  ["def-68-19", "what does the word allocate mean", "allocate", "assign*|give*|giving|distribut*|set aside|share* out|divid*|allot*|apportion*|designat*|earmark*|hand* out|portion*|budget*|parcel* out|split*"],
  ["def-68-20", "what does tranquil mean?", "tranquil", "calm*|peace*|quiet*|still|serene|relax*|restful|undisturbed|untroubled|placid|soothing|gentle|at rest|at ease"],
  ["def-68-21", "what's the meaning of illuminate", "illuminate", "light*|lit|brighten*|bright*|shine*|shining|explain*|clarif*|clear|enlighten*|understand*|reveal*"],
  ["def-68-22", "meaning of dilemma", "dilemma", "choice*|choos*|decid*|decision*|option*|alternative*|both|either|difficult|tough|hard|tricky|problem|predicament|quandary|stuck|conflict*"],
  ["def-68-23", "define plausible", "plausible", "believ*|possib*|reasonable|likely|credible|could be true|might be true|seems true|seem* true|realistic|makes sense|make sense|probable|convincing|acceptable|valid|logical|feasible|sound"],
  ["def-68-24", "what does the word vivid mean?", "vivid", "bright*|colorful|colourful|intense|strong|clear*|sharp|detailed|lifelike|realistic|striking|brilliant|lively|real|bold|rich|graphic|powerful|alive"],
  ["def-68-25", "what does compel mean", "compel", "forc*|make|made|making|requir*|oblig*|pressur*|push*|driv*|must|have to|had to|no choice|coerc*|urge*|demand*|insist*|irresistib*"],
  ["def-68-26", "what is the definition of feasible", "feasible", "possible|doable|able to be done|can be done|could be done|achievable|practical|workable|realistic|viable|attainable|reasonable|manageable|within reach|likely|realizable"],
  ["def-68-27", "I don't know what ominous means", "ominous", "threaten*|menac*|bad sign|warning|foreboding|sinister|dark|scary|danger*|something bad|bad omen|omen|eerie|creepy|gloomy|worrying|uneasy|dread*|portent*|inauspicious|unlucky|doom*"],
  ["def-68-28", "whats the meaning of the word profound", "profound", "deep*|intense*|great|serious*|significant*|meaningful|insightful|wise|wisdom|important|powerful*|strong*|thoughtful|complex|heavy|extreme*|huge|thorough|major|far-reaching|intellectual"],
  ["def-68-29", "what does conspicuous mean?", "conspicuous", "notice*|noticeabl*|obvious|stand* out|standing out|easy to see|easily seen|visible|attract* attention|eye-catching|striking|prominent|stick* out|sticking out|apparent|clear|evident|glaring|blatant|showy"],
  ["def-68-30", "define articulate", "articulate", "express*|clear*|speak*|speaking|spoke*|well-spoken|well spoken|eloquent*|fluent*|words|joint*|connect*|explain*|state*|pronounc*|communicat*|put into words"],
  ["def-68-31", "what does the word imminent mean", "imminent", "soon|about to|any moment|any minute|going to happen|near|close|upcoming|impending|coming|approach*|at hand|on the horizon|on its way|on the way|shortly|immediately|right away|forthcoming|looming"],
  ["def-68-32", "what does mediocre mean", "mediocre", "average|ordinary|okay|ok|not great|not very good|so-so|so so|middle|medium|moderate|unremarkable|unexceptional|not special|plain|run-of-the-mill|second-rate|fair|passable|meh|inferior|poor|not good|uninspired|unimpressive|nothing special|middling|low quality|lacking"],
  ["def-68-33", "what's the definition of consensus", "consensus", "agree*|accord|unanim*|everyone|general|majority|most people|common view|together|group|all|shared|harmony|concur*"],
  ["def-68-34", "what is the meaning of perpetual", "perpetual", "forever|never end*|endless|constant*|continu*|always|eternal*|permanent*|everlast*|nonstop|non-stop|without end|unending|ceaseless|lasting|lifelong|repeated*|again and again|perennial|infinite|indefinite*|never stop*|keeps going|keep going|incessant"],
  ["def-68-35", "meaning of exasperated", "exasperated", "annoy*|frustrat*|irritat*|fed up|angr*|upset|impatien*|aggravat*|irked|cross|mad|vexed|patience|tired of|sick of|had enough|infuriat*|bother*|exhausted"],
  ["def-68-36", "define nonchalant", "nonchalant", "calm*|relax*|casual*|cool|unconcerned|not worried|not concerned|don't care|didn't care|doesn't care|indifferen*|carefree|easygoing|easy-going|laid-back|laid back|unbothered|not bothered|composed|unworried|blasé|blase|untroubled|careless|uninterested|not interested|unruffled|offhand|detached|without worry|without concern|not excited"],
  ["def-68-37", "what does the word endeavor mean?", "endeavor", "try|tried|trying|tries|attempt*|effort*|striv*|undertak*|work*|project|enterprise|venture*|task|aim*|seek*|goal"],
  ["def-68-38", "whats emulate mean", "emulate", "copy*|copies|imitat*|mimic*|match*|follow* the example|follow* example|role model|model*|same as|equal*|rival*|replicat*|reproduce*|simulat*|software|act like|be like|similar"],
];

const PLAIN_912: Row[] = [
  ["def-912-01", "what does ubiquitous mean?", "ubiquitous", "everywhere|all over|omnipresent|very common|common|widespread|pervasive|in every place|all around|universal|wherever|ever-present|always present"],
  ["def-912-02", "What's the definition of ephemeral", "ephemeral", "short|brief*|fleeting|temporary|transient|momentary|passing|quickly|not last*|doesn't last|does not last|short-lived|short lived|impermanent|fade*|vanish*|transitory|evanescent"],
  ["def-912-03", "define obfuscate", "obfuscate", "confus*|unclear|obscur*|hide|hiding|hid|conceal*|cloud*|muddl*|blur*|complicat*|hard to understand|harder to understand|difficult to understand|bewilder*|muddy|disguise*|garble*|scramble*|mislead*|deliberately"],
  ["def-912-04", "what does the word perfunctory mean", "perfunctory", "minimum|minimal|without care|without much care|careless*|without effort|little effort|without interest|without thought|routine*|superficial*|cursory|half-hearted|halfhearted|going through the motions|mechanical*|hasty|hastily|duty|obligation|indifferent|automatic|token|offhand|rushed|just to get it done|for the sake of it"],
  ["def-912-05", "I don't know what sycophant means", "sycophant", "flatter*|suck* up|kiss* up|brown-nos*|yes-man|toady|bootlick*|fawn*|servile|praise*|win favor|win favour|gain favor|gain favour|get ahead|teacher's pet|crawler|lackey|obsequious|people in power|powerful people|someone important|important people|boss"],
  ["def-912-06", "what is the meaning of laconic", "laconic", "few words|brief|terse|concise|short|curt|succinct|not talk* much|doesn't talk much|does not talk much|economical|pithy|clipped|minimal|sparing|to the point|reticent|quiet|taciturn"],
  ["def-912-07", "whats pernicious mean", "pernicious", "harm*|damag*|destruct*|deadly|injur*|ruin*|danger*|subtle|gradual*|wicked|evil|malicious|malign*|toxic|insidious|poison*|detriment*|hurtful|corrupt*|deleterious|noxious|lethal|fatal|baneful"],
  ["def-912-08", "what does recalcitrant mean?", "recalcitrant", "stubborn*|uncooperative|not cooperat*|refus*|defian*|disobedient*|resist*|unruly|obstinate|difficult|won't|will not|hard to control|hard to manage|rebellious|headstrong|intractable|obey|uncontrollable|insubordinate|ungovernable|wayward|refractory|willful|wilful|contrary|authority"],
  ["def-912-09", "define magnanimous", "magnanimous", "generous*|forgiv*|noble|big-hearted|kind*|gracious*|unselfish|charitable|benevolent|high-minded|lofty|not petty|not resentful|without resentment|rival|opponent|defeated|enemy|selfless|grace"],
  ["def-912-10", "what's the meaning of quixotic", "quixotic", "idealis*|unrealistic*|impractical*|romantic*|dream*|naive|naïve|visionary|fanciful|lofty|noble|impossible|quixote|chivalr*|unattainable|foolish*|starry-eyed|utopian|extravagant|impulsive|unpredictable|whimsical"],
  ["def-912-11", "what does the word insidious mean?", "insidious", "gradual*|slow*|subtl*|sneak*|stealth*|hidden|unnoticed|without being noticed|treacher*|harmful|danger*|creep*|crafty|sly|deceptive|deceit*|cunning|wily|underhanded|secret*|unseen|not obvious|before you notice|before anyone notices|pernicious|lurking|spread*"],
  ["def-912-12", "I don't know what equivocate means", "equivocate", "vague|ambiguous|ambiguity|avoid*|evad*|evasive|dodge*|hedge*|hedging|unclear|mislead*|beat around the bush|beating around the bush|beat about the bush|waffl*|fudg*|sit on the fence|noncommittal|non-committal|prevaricat*|not commit*|without commit*|weasel*|straight answer|clear answer|direct answer|commit*"],
  ["def-912-13", "what does sanguine mean", "sanguine", "optimist*|hopeful*|positive*|cheerful*|confident*|upbeat|buoyant|rosy|good mood|turn out well|go well|sunny|ruddy|blood-red|blood red|reddish|red|hope"],
  ["def-912-14", "whats the definition of enervate", "enervate", "weaken*|weak*|drain*|tire*|tiring|tired|exhaust*|sap*|fatigu*|wear* out|wore out|worn out|devitaliz*|debilitat*|deplete*|enfeebl*|less energy|lose energy|lack of energy|lose strength|lethargic|listless|sluggish|feeble"],
  ["def-912-15", "what is the meaning of nonplussed?", "nonplussed", "confus*|puzzl*|bewilder*|perplex*|baffl*|surpris*|unsure|uncertain|at a loss|don't know what to|didn't know what to|not know what to|not knowing what to|flummox*|stump*|dumbfound*|disconcert*|taken aback|stunned|lost for words|speechless|befuddl*|mystifi*|astonish*|shocked"],
  ["def-912-16", "define noisome", "noisome", "smell*|stink*|stench*|odor*|odour*|foul*|disgust*|offensive|unpleasant|nasty|harmful|noxious|toxic|unwholesome|rotten|putrid|fetid|rank|vile|repuls*|revolting|gross|unhealthy|injurious|obnoxious|objectionable"],
  ["def-912-17", "what does the word restive mean", "restive", "restless|unsettled|uneasy|impatient|fidget*|agitat*|edgy|on edge|jittery|nervous|stubborn|unruly|refus*|balk*|resist*|unmanageable|stir-crazy|anxious|antsy|sit still|keep still|stay still|disobedient|defiant|rebellious|discontent*|dissatisf*|unrest|tense|bored|squirm*"],
  ["def-912-18", "what's garrulous mean?", "garrulous", "talk*|chatt*|wordy|loquacious|verbose|gabby|long-winded|long winded|voluble|babbl*|rambl*|gossip*|blabber*|motormouth|chat*|speak*|conversation*"],
  ["def-912-19", "what does vicarious mean", "vicarious", "through someone else|through another|through others|through other people|someone else's|other people's|another person's|another's|second-hand|secondhand|indirect*|substitut*|on behalf|in place of|instead of|by watching|living through|proxy"],
  ["def-912-20", "meaning of esoteric", "esoteric", "obscure|special*|few people|small group|select group|only a few|niche|secret*|hidden|mysterious|mystic*|arcane|abstruse|recondite|cryptic|insiders|insider|initiated|expert*|understood by|hard to understand|difficult to understand|not widely|not well known|little-known|little known|uncommon|unusual|private|inner circle|occult"],
  ["def-912-21", "I don't know what cogent means.", "cogent", "convinc*|persuasive*|compelling|clear*|logical*|strong|powerful|forceful|valid|sound|well-reasoned|well reasoned|well-argued|well argued|coherent|reasonable|solid|effective|weighty|makes sense|make sense|to the point|lucid|telling|potent|incisive|rational"],
  ["def-912-22", "what does the word ebullient mean?", "ebullient", "cheer*|enthusias*|excit*|exuberan*|lively|energetic|bubbl*|happy|joy*|vivacious|high spirits|high-spirited|elated|exhilarat*|zest*|upbeat|effervescen*|buoyant|full of energy|sparkling|animated|boil*|vibrant|eager|gleeful|merry|jubilant|ecstatic|thrilled|overflow*"],
  ["def-912-23", "define fastidious", "fastidious", "careful*|detail*|meticulous*|picky|fussy|particular|demanding|exacting|precise|perfectionis*|hard to please|difficult to please|neat*|clean*|tidy|squeamish|choosy|finicky|scrupulous*|painstaking|thorough|exact|standards|accura*|disgust*|attention"],
  ["def-912-24", "whats impetuous mean?", "impetuous", "impuls*|rash*|hasty|hastily|reckless*|without thinking|without thought|act* quickly|act* fast|spur of the moment|spontaneous*|headlong|hot-headed|hotheaded|careless|unthinking|rushed|rush*|sudden*|quick|thoughtless|abrupt|precipitate|heedless|unplanned|unconsidered|without considering|consequences|forceful"],
  ["def-912-25", "what's the definition of inexorable?", "inexorable", "unstoppable|can't be stopped|cannot be stopped|impossible to stop|can't stop|cannot stop|not be stopped|relentless*|inevitable|unavoidable|can't be avoided|cannot be avoided|unrelenting|unyielding|inflexible|can't be changed|cannot be changed|unchangeable|persistent|steady|certain|implacable|unalterable|unpreventable|unbending|nothing can|no one can|merciless|remorseless|ceaseless|continu*|irresistible|persuaded|moved by"],
  ["def-912-26", "What does mendacious mean?", "mendacious", "lying|liar*|lie|lies|untruth*|dishonest*|false*|deceit*|deceiv*|deceptive|fake|fibb*|fib|mislead*|not true|not truthful|untrustworthy|fraud*|duplicit*|fabricat*|made up|make up|invent*|perjur*|disingenuous|insincere|crooked"],
  ["def-912-27", "meaning of parsimonious", "parsimonious", "cheap|stingy|tight*|frugal|thrift*|miserly|miser*|penny-pinch*|pinch* pennies|unwilling to spend|reluctant to spend|reluctance to spend|not spend|spend* very little|spend little|spending little|sparing*|scrimp*|careful with money|economical|ungenerous|close-fisted|tightfisted|tight-fisted|niggardly|penurious|grudg*|simplest|fewest|minimal|minimum|economy"],
  ["def-912-28", "what does the word pedantic mean", "pedantic", "detail*|rules|minor|small|tiny|trivial*|nitpick*|nit-pick*|fussy|overly concerned|too concerned|precise|precision|correct*|accura*|show* off|knowledge|learning|book*|academic|formal|technical*|hair-split*|stickler|know-it-all|know it all|petty|particular|perfectionis*|literal*|exact*|dogmatic|didactic|lectur*|condescend*|smug|teacher|scholar*"],
  ["def-912-29", "define prosaic", "prosaic", "ordinary|dull|boring|plain|unimaginative|imagination|matter-of-fact|matter of fact|everyday|mundane|commonplace|unremarkable|uninspired|uninspiring|flat|bland|routine|humdrum|pedestrian|practical|unpoetic|not poetic|prose|straightforward|dry|tedious|common|banal|workaday|run-of-the-mill|uninteresting|not interesting|literal|factual|average|regular|normal|simple"],
  ["def-912-30", "I dont know what reticent means", "reticent", "reserved|quiet*|shy|silent|restrain*|hold* back|holding back|held back|not reveal*|don't reveal|doesn't reveal|unwilling to|reluctan*|hesitant|guarded|secretive|private|not open|unforthcoming|uncommunicative|taciturn|tight-lipped|keep* to|kept to|self-contained|withdrawn|introvert*|not share|don't share|doesn't share|not talk*|not speak*|thoughts|feelings|discreet|aloof|distant|modest|timid"],
  ["def-912-31", "what's the meaning of sardonic?", "sardonic", "mock*|scorn*|sneer*|sarcas*|cynical*|derisive|derision|disdain*|contempt*|grim*|bitter*|dry|wry|ironic*|irony|caustic|biting|cutting|sharp|acid|mean-spirited|snide|smirk*|scoff*|jeer*|ridicul*|humor|humour|joke|joking|jokes|witty|teasing|tease|unkind|cruel|harsh|amused|amusement"],
  ["def-912-32", "what does soporific mean", "soporific", "sleep*|drows*|doz*|tired*|tiring|boring|dull|tedious|sedat*|tranquiliz*|tranquillis*|calming|relax*|slumber*|somnolen*|hypnotic|narcotic|lull*|nod* off|knock* out|yawn*|soothing|bore|lethargy|lethargic"],
  ["def-912-33", "whats tacit mean", "tacit", "unspoken|unsaid|understood|implied|implicit|without words|without being said|without saying|not said|not spoken|never said|not stated|unstated|silent*|wordless|unwritten|unexpressed|without being stated|without speaking|inferred|assumed|taken for granted|nonverbal|non-verbal|indirect*|unvoiced|not expressed|not put into words|not written|everyone knows"],
  ["def-912-34", "what does the word vacillate mean?", "vacillate", "waver*|hesitat*|indecis*|undecided|can't decide|cannot decide|can't make up|cannot make up|unable to decide|not decide|back and forth|switch*|change your mind|changing your mind|change their mind|changing their mind|changes their mind|change one's mind|keeps changing|keep changing|alternat*|fluctuat*|oscillat*|sway*|swing*|dither*|shilly-shally*|flip-flop*|flip flop*|teeter*|torn between|between two|two options|uncertain|irresolut*|on the fence|of two minds|seesaw*|yo-yo|blow* hot and cold"],
  ["def-912-35", "define venerate", "venerate", "respect*|rever*|honor*|honour*|admir*|worship*|esteem*|ador*|look up to|idoliz*|idolis*|high regard|great regard|deep regard|regard|exalt*|hallow*|sanctif*|awe|praise*|treasure|cherish*|glorif*|devotion"],
  ["def-912-36", "whats the definition of truculent", "truculent", "aggress*|hostile|hostility|belliger*|combat*|confrontational|defian*|argumentative|quarrel*|fierce|savage|cruel|violent|fight*|bad-tempered|bad tempered|ill-tempered|surly|sullen|pugnacious|bellicose|contentious|antagonistic|scrappy|feisty|threatening|bully*|rude|harsh|obstreperous|angry|irritable|grumpy|uncooperative"],
  ["def-912-37", "what does ineffable mean", "ineffable", "indescribable|beyond words|can't be described|cannot be described|can't be put into words|cannot be put into words|too great|unspeakable|inexpressible|unutterable|beyond description|defies description|words can't|words cannot|no words|can't be expressed|cannot be expressed|can't be said|cannot be said|can't express|cannot express|express*|describ*|words|unnamable|unnameable|taboo|sacred|holy|unsayable|indefinable|transcend*|incommunicable|inexplicable"],
  ["def-912-38", "what's the meaning of harbinger", "harbinger", "sign*|signal*|warn*|forerunner|precursor|herald*|omen*|portent*|foreshadow*|announc*|indicat*|predict*|messenger|preced*|before|ahead|first sign|early sign|coming|approach*|to come|on the way|presage|augur*"],
];

// ── Sense items: the sentence picks a sense other than the one a reader guesses first ──

const SENSE_K2: Row[] = [
  ["sense-k2-01", "what does bat mean in 'the bat flew out of the cave at night'", "bat", "animal|mammal|wing*|creature|furry|mouse|rodent", "baseball|softball|cricket|hit the ball|stick|club|swing*"],
  ["sense-k2-02", "What does the word bark mean in this sentence: The bark on the old tree was rough.", "bark", "outside|outer|covering|cover*|skin|layer|trunk|wood*|protect*", "dog*|woof|sound a dog|noise"],
  ["sense-k2-03", "what does fair mean in 'we went on the rides at the fair'", "fair", "carnival|festival|show|event|amusement|attractions|celebration|exhibition|exhibit*|market|county fair|booths", "just|equal*|same rules|honest|treat* everyone|light-colored|light colored|blond*|pale"],
  ["sense-k2-04", "what does ring mean in \"did you hear the phone ring?\"", "ring", "sound|noise|bell|buzz*|chime|tone|call*", "finger|jewel*|circle|band|wedding|round"],
  ["sense-k2-05", "whats duck mean in 'duck so the ball doesn't hit you'", "duck", "lower|crouch*|squat*|bend*|get down|move down|dip*|drop down|head down|stoop*|dodge*|out of the way|avoid*", "bird|quack*|feather*|pond|swim*|waddl*|beak|bill"],
  ["sense-k2-06", "My mom said my bag is light today. What does light mean here?", "light", "heav*|weigh*|easy to carry|easy to lift", "lamp|sun|bright|dark|glow|shine|bulb"],
  ["sense-k2-07", "what does trunk mean in 'the elephant lifted water with its trunk'", "trunk", "nose|snout|proboscis|sniff*|smell*", "tree|car|storage|suitcase|box|chest|luggage|swim trunks|shorts|torso"],
  ["sense-k2-08", "what does row mean in 'we row the boat across the lake'", "row", "oar*|paddl*|push the water|pull the water|move the boat|moving the boat|moves the boat", "line|seat*|next to each other|side by side|fight|argument|quarrel"],
];

const SENSE_35: Row[] = [
  ["sense-35-01", "what does bank mean in 'we had a picnic on the bank and watched the ducks swim by'", "bank", "river*|stream|creek|lake|pond|water|shore|edge|side|slope|land|ground|grass*", "money|deposit*|loan*|account*|cash|savings|financial"],
  ["sense-35-02", "What does the word spring mean in 'the spring in the mattress was broken'?", "spring", "coil*|metal|bounc*|wire|stretch*|squeez*|push* back|elastic|compress*", "season|flowers|bloom*|after winter|march|april|warm weather|jump"],
  ["sense-35-03", "what does the word kind mean in 'what kind of dog do you have?'", "kind", "type|sort|variety|breed|category|group|class|species", "nice|friendly|caring|gentle|helpful|generous"],
  ["sense-35-04", "what does pitcher mean in 'pour the lemonade from the pitcher'", "pitcher", "jug|container|jar|carafe|vessel|handle|spout|holds liquid|hold liquid|holds water|holds drinks", "baseball|throws|throw*|mound|player|softball"],
  ["sense-35-05", "what does the word present mean in 'every student was present today'?", "present", "attend*|in class|absent|showed up|show up|shows up|in attendance|at school|in the room", "gift|birthday|wrapped|right now|current time|this moment"],
  ["sense-35-06", "what does the word figure mean in 'can you figure out the answer'", "figure", "understand|solve*|work out|work it out|calculat*|determin*|discover*|puzzle", "number|digit|shape|body|person|statue|drawing|diagram|picture|illustration"],
  ["sense-35-07", "what does crane mean in 'a crane stood in the shallow water looking for fish'", "crane", "bird|feather*|long legs|long-legged|long neck|wading|wader|heron|stork", "machine|lift*|construction|heavy|building|hook|cable|stretch your neck"],
  ["sense-35-08", "I don't know what file means in 'she used a file to smooth her nails'", "file", "tool|rough|metal|scrap*|rub*|grind*|shape|emery|nail file|wear* down|filing", "document|folder|computer|papers|records|data|cabinet"],
];

const SENSE_68: Row[] = [
  ["sense-68-01", "what does the word grave mean in 'the doctor's face looked grave'?", "grave", "serious|solemn|somber|sombre|worried|concern*|stern|grim|gloomy|worr*|troubl*|bad news|dire|sad|heavy", "buried|burial|bury|cemetery|tomb|coffin|graveyard|dug"],
  ["sense-68-02", "what does the word sound mean in 'that is a sound plan'", "sound", "solid|reliable|reasonable|sensible|well thought|well-thought|logical|valid|wise|secure|stable|trustworth*|careful*|thought out|thought-out|sturdy|dependable|makes sense|make sense|smart", "noise|hear|hearing|heard|ears|vibrat*|loud|music|volume"],
  ["sense-68-03", "what does fine mean in 'he had to pay a fine for parking there'", "fine", "penalty|punish*|money|charge|fee|payment|ticket|fined|sum|law|rule*|breaking", "okay|ok|thin|delicate|tiny|alright|all right|nice|great|sunny"],
  ["sense-68-04", "what does the word novel mean in 'she had a novel idea for the science fair'", "novel", "new|original|unusual|fresh|creative|different|innovative|inventive|unique|never been|not been done|first|clever|unlike", "book|story|fiction|chapters|author|pages"],
  ["sense-68-05", "Our teacher said: find the mean of 3, 5 and 7. what's the meaning of the word mean here?", "mean", "average|add*|divide*|sum|total|middle|typical", "unkind|rude|cruel|nasty|bully|not nice|intend*|signify"],
  ["sense-68-06", "what does the word bear mean in 'I can't bear the noise any longer'", "bear", "stand|tolerate|put up with|endure|handle|take it|cope|deal with|stomach|accept|withstand|suffer", "animal|grizzl*|fur*|honey|cub*|polar|brown bear|black bear|forest"],
  ["sense-68-07", "what does strike mean in 'the workers went on strike for better pay'", "strike", "stop work*|stopped work*|refus*|protest*|walk* out|walkout|work stoppage|not work*|quit working|stop doing their job|demands|union|lay down tools", "hit|punch|swing|lightning|bowling|baseball|miss|ball|attack"],
  ["sense-68-08", "what does the word current mean in 'the current pulled the swimmer away from the beach'", "current", "flow*|moving water|movement of water|water moves|water moving|stream|tide|rip|motion|direction|riptide|undertow|wave*", "present|recent|today|up to date|up-to-date|latest|modern|electric*|happening now"],
];

const SENSE_912: Row[] = [
  ["sense-912-01", "what does the word gravity mean in 'he did not grasp the gravity of the situation'", "gravity", "serious*|importan*|significan*|severity|severe|solemn*|danger*|consequence*|how bad|magnitude|grave", "force|pull*|mass|earth|fall*|newton|attraction|weightless|planet"],
  ["sense-912-02", "what does qualify mean in 'let me qualify that statement: it applies only to adults'", "qualify", "limit*|restrict*|modif*|add a condition|adding a condition|condition*|exception*|clarif*|narrow*|specify|soften|tone down|less absolute|less general|moderate|caveat*|reservation*", "eligible|meet the requirements|pass|compet*|earn a place|be allowed|skills|license|licence|certified|tournament|entitled"],
  ["sense-912-03", "What does the word temper mean in 'she tried to temper her criticism with praise'?", "temper", "soften*|moderat*|tone down|toning down|balance*|mitigat*|lessen*|reduce*|ease|offset|mellow*|make less|milder|gentler|less harsh|cushion*|dilut*", "anger|angry|mad|rage|lose your temper|tantrum|mood|outburst|harden*|steel|metal|heat*"],
  ["sense-912-04", "what does the word champion mean in 'she has championed the rights of refugees for years'", "champion", "support*|defend*|fight for|fights for|fought for|stand up for|stands up for|stood up for|advocat*|promot*|backed|backing|backs|speak* up for|campaign*|cause|uphold*", "winner|won|win*|first place|competition|contest|trophy|title|tournament|victor*|best"],
  ["sense-912-05", "what is the meaning of sanction in 'the principal sanctioned the student trip'", "sanction", "approv*|allow*|permit*|permission|authoriz*|authoris*|endors*|agree*|green light|go-ahead|consent*|sign* off", "penalt*|punish*|ban*|restrict*|embargo*|trade|forbid*|prohibit*|fine|boycott*|consequence*"],
  ["sense-912-06", "what does the word discriminate mean in 'the test asks you to discriminate between similar shades of blue'", "discriminate", "tell apart|tell the difference|tell them apart|telling apart|telling the difference|distinguish*|differentiat*|notice the difference|see the difference|spot the difference|recogni*|separat*|discern*|identify|distinction", "unfair*|prejudic*|race|racis*|treat differently|treated differently|treating differently|treats differently|bias*|sexis*|exclude|exclusion|minority|minorities|rights"],
  ["sense-912-07", "In my economics reading: the value of the house appreciated over ten years. What does appreciate mean in this sentence?", "appreciate", "increase*|grow*|rise|rose|risen|rising|go up|went up|goes up|gain*|more valuable|worth more|higher|climb*", "thank*|grateful|gratitude|recogni*|enjoy*|admire*"],
  ["sense-912-08", "I don't know what the word cleave means in 'the axe cleaved the log in two'", "cleave", "split*|cut*|chop*|divid*|sever*|slice*|hack*|halves|apart|separat*|cleft|in half", "cling*|stick*|stay close|hold on|attach*|adhere*|loyal*|faithful*|stuck"],
];

export const DEFINE_ITEMS: readonly DefineItem[] = [
  ...make("K-2", "plain", PLAIN_K2),
  ...make("3-5", "plain", PLAIN_35),
  ...make("6-8", "plain", PLAIN_68),
  ...make("9-12", "plain", PLAIN_912),
  ...make("K-2", "sense", SENSE_K2),
  ...make("3-5", "sense", SENSE_35),
  ...make("6-8", "sense", SENSE_68),
  ...make("9-12", "sense", SENSE_912),
];

export type DefineSplit = "dev" | "test";

/** The split, fixed by position before any run: within each band and kind, every third item starting
 *  with the first is DEV, the rest TEST. */
export const DEFINE_SPLIT: Readonly<Record<string, DefineSplit>> = (() => {
  const out: Record<string, DefineSplit> = {};
  const seen = new Map<string, number>();
  for (const item of DEFINE_ITEMS) {
    const cell = `${item.band}/${item.kind}`;
    const i = seen.get(cell) ?? 0;
    seen.set(cell, i + 1);
    out[item.id] = i % 3 === 0 ? "dev" : "test";
  }
  return out;
})();

/** The grade a band's learner is given in the runner's system prompt (grade.ts readingLevelLayer). */
export const DEFINE_BAND_GRADE: Readonly<Record<GradeBand, 2 | 4 | 7 | 10>> = { "K-2": 2, "3-5": 4, "6-8": 7, "9-12": 10 };
