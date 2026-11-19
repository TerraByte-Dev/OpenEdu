// Child safety in the tutor chat, decided by code with no model call. Pure module (no Tauri, no DOM),
// tested in child-safety.test.ts and called unchanged by grade.ts and ChatTab.
//
// Two parts:
// 1. CHILD_SAFETY_RULES, a short section for the tutor's system prompt. grade.ts adds it whenever the
//    learner has a grade (K-12) set, and on any turn whose message trips isSafetyDisclosure, grade or
//    not. Every other turn with no grade stays byte-identical (systemPrompt-master.test.ts pins that).
// 2. isSafetyDisclosure, a check of a student's chat message for self-harm, suicide and abuse
//    disclosures (sexual abuse, unwanted touching, nude pictures and sextortion among them, ported from
//    TerraTutor #125; the patterns equal TerraTutor's as of its PR #246), and, for a learner with a K-12 grade set, a strong self-disclosure of a pregnancy
//    (strongPregnancy, below). A match shows SAFETY_NOTICE under that message. A notice, never a block: the
//    learner always gets a reply, never silence. A self-harm, suicide or abuse disclosure (isSafetyDisclosure
//    with no grade) gets disclosureReply, written by code, unless it is a question about someone else
//    (isHarmTopicQuestion); that and a pregnancy one get the tutor under CHILD_SAFETY_RULES (TutorEngine.ts,
//    ported from TerraTutor #246). Like health-notice.ts, a deterministic list is auditable and costs nothing on a CPU box.
//    A miss means no notice, never a block. A false positive in the chat costs one kind line of text and, for
//    a harm one that is not a question about someone else, the model's answer to that message; but
//    the same check also refuses a new-course topic (Dashboard.tsx, SAFETY_TOPIC_COURSE_LINE), passes a
//    quiz or level-test written answer as not checked with no mark (quiz.ts gradeAnswersBatch) and skips
//    the mastery-check verdict and the dictionary note on that chat turn (TutorEngine.ts). So a pattern
//    that fires on ordinary schoolwork costs a learner a course or a free mark: the patterns below need a
//    person, the child's own body or a first-person object. The only topic words that count on their own are
//    "suicid*", "sextort*" and "sexual assault*" (accepted false positives, pinned in the tests). English only.

import type { Grade, GradeBand } from "./grade";

/** The child-safety section of the tutor's system prompt. Plain and short, for small models. */
export const CHILD_SAFETY_RULES =
  "## Safety\nThe student is a child. Never write sexual content. Never explain how to hurt yourself or " +
  "others, or how to get or use weapons, drugs or other dangerous things. Never describe violence in " +
  "graphic detail. Keep to schoolwork. If the student seems upset or unsafe, or says someone is hurting " +
  "them, answer kindly and tell them to talk to a grown-up they trust.";

/** Shown in the chat under a message that trips isSafetyDisclosure. Fixed text, never model-written. */
export const SAFETY_NOTICE =
  "You matter, and you don't have to deal with this alone. Please tell a grown-up you trust, like a " +
  "parent, teacher or school counselor, right away. If you are in danger right now, call 911. In the " +
  "US you can call or text 988 (Suicide & Crisis Lifeline), or call 1-800-422-4453 (Childhelp " +
  "National Child Abuse Hotline), any time, day or night.";

/**
 * Said under SAFETY_NOTICE for a new-course topic that trips isSafetyDisclosure (Dashboard.tsx). No course
 * is made from it: the topic would be the course's title on every screen, and would go to the model and
 * web search. Ported from TerraTutor #215.
 */
export const SAFETY_TOPIC_COURSE_LINE =
  "This can't be made into a course. If it is for school, try the name of the book or the subject instead.";

/** disclosureReply's text for K-2: the fewest, plainest words, read aloud after SAFETY_NOTICE. */
export const DISCLOSURE_REPLY_K2 =
  "Thank you for telling me. You did the right thing, and you are not in trouble. It is not your fault. I am a " +
  "computer, so I can't help with this the way a person can. Please tell a grown-up you trust right away.";
/** disclosureReply's text for grades 3-5. */
export const DISCLOSURE_REPLY_3_5 =
  "Thank you for telling me. You did the right thing, and you are not in trouble. I am a computer, so I can't " +
  "help with this the way a person can. Please tell a grown-up you trust right away, like a parent, teacher or " +
  "school counselor. The note under your message has numbers you can call any time.";
/** disclosureReply's text for grades 6-12. */
export const DISCLOSURE_REPLY_OLDER =
  "Thank you for telling me. I'm really glad you did, and you are not in trouble. I'm an AI, so I can't help " +
  "with this the way a person can. Please talk to a grown-up you trust right away, like a parent, teacher or " +
  "school counselor. The note under your message has numbers you can call or text any time, day or night.";
/** disclosureReply's text with no grade set: an adult or a child who never set one, so it names no grown-up
 *  (Fable's decision as Tate's delegate, 2026-11-19; TerraTutor gives no-grade the 6-12 words). */
export const DISCLOSURE_REPLY_NO_GRADE =
  "Thank you for telling me. I'm really glad you did, and you are not in trouble. I'm an AI, so I can't help " +
  "with this the way a person can. Please talk to someone you trust right away, like a family member, friend, " +
  "teacher or counselor. The note under your message has numbers you can call or text any time, day or night.";

/**
 * The tutor's whole reply on a turn whose newest message is a self-harm, suicide or abuse disclosure
 * (isSafetyDisclosure with no grade) and not a question about someone else (isHarmTopicQuestion), written by
 * code with no model call (TutorEngine; ported from TerraTutor #246, whose click test found the small model's
 * own words cold: "Please stop. I am very sorry...", "I cannot help with that kind of question. Please tell me
 * if you have any questions about fractions."). SAFETY_NOTICE is already under the message, with 911, 988 and
 * Childhelp, and K-2 hears it read first, so this does not repeat it: it thanks the learner, says they are not
 * in trouble (K-2 also "It is not your fault"), says plainly that the tutor is a computer, names someone they
 * trust and points to the numbers in the note. Never "stop", never back to the lesson, never "a grown-up at
 * home". By grade band; null (no grade set) takes DISCLOSURE_REPLY_NO_GRADE. A strong self-disclosure of a
 * pregnancy keeps its model call.
 */
export function disclosureReply(band: GradeBand | null): string {
  if (band === null) return DISCLOSURE_REPLY_NO_GRADE;
  return band === "K-2" ? DISCLOSURE_REPLY_K2 : band === "3-5" ? DISCLOSURE_REPLY_3_5 : DISCLOSURE_REPLY_OLDER;
}

// Lower-case phrases, matched as whole words at both ends: "hurt myself" does not match inside a longer
// word. A trailing "*" makes an entry a stem that matches at the start of a word: "suicid*" catches
// suicide and suicidal.
// Kept to first-person and disclosure wording on purpose, so schoolwork does not trip it: "kill the
// process", "the character died", "cut the fraction", "my brother beats me at chess". Bare "kill",
// "die", "cut", "abuse" (substance abuse, abuse of power) and "beats me" are left out for that reason.
// "Hits me", "hurts me", "touched me" and the like are not phrases either ("the poem touched me", "a
// wave hits me", "my hand hurts me"): ABUSE_RE below matches them only after a person as the subject.
// "suicid*" is the one bare topic word kept. A question about a character's suicide shows the notice,
// which is the cheap side of the trade. A third-person statement of fact with no first-person word does
// not ("the character commits suicide", "suicide rates rose"; thirdPersonSuicide, TerraTutor #223).
// child-safety.test.ts lists the other known, accepted false positives.
const PHRASES = [
  // Suicide and wanting to die
  "suicid*", "kill myself", "killing myself", "kill my self", "end my life", "ending my life",
  "take my own life", "taking my own life", "want to die", "wanna die", "want to be dead",
  "wish i was dead", "wish i were dead", "wish i was never born", "better off dead",
  "better off without me", "don't want to live", "dont want to live", "don't want to be alive",
  "dont want to be alive", "do not want to live", "do not want to be alive", "don't wanna live",
  "dont wanna live", "don't wanna be alive", "dont wanna be alive", "wanna be dead", "rather be dead",
  "wish i could die", "wish i wasn't alive", "wish i had never been born", "wish i'd never been born",
  "if i died", "end it all", "no reason to live", "unalive*",
  // Self-harm
  "hurt myself", "hurting myself", "harm myself", "harming myself", "cut myself", "cutting myself",
  "hurt my self", "harm my self", "cut my wrist*", "self-harm*", "self harm*", "selfharm*",
  // Abuse disclosures. Someone hitting, hurting or touching the child is ABUSE_RE's job.
  "beat me up", "beats me up", "abuses me", "abused me", "abusing me", "being abused", "molest*",
  "raped", "rape me", "rapes me", "sexually abused", "not safe at home", "scared to go home",
  "afraid to go home",
  // Sexual abuse in a child's words (ported from TerraTutor #125, its cycle-3 review). Without these,
  // "he made me have sex with him" got no safety notice.
  "sexually assault*", "sexual assault*", "made me have sex", "makes me have sex", "make me have sex",
  "making me have sex", "forced me to have sex", "forces me to have sex", "forced me to do sex*",
  "forces me to do sex*", "me to do sexual", "me do sexual", "sexual things to me", "sexual stuff to me",
  "sexual things with me", "sexual stuff with me", "sexy pic*", "sexy photo*", "naked pic*",
  "naked photo*", "showed me porn", "shows me porn", "showing me porn", "made me watch porn",
  "makes me watch porn", "sent me a sext", "sent me sexts", "sends me sexts", "sexted me", "sexting me",
  // TerraTutor #125's cycle-5 review: "my uncle had sex with me", "he does sex stuff to me", "my coach asked me to have
  // sex", "my cousin makes me do sex stuff", "a stranger online sent me porn". Someone showing or using
  // their own body is BODY_RE's job below.
  "sex with me", "sex with us", "sex stuff to me", "sex stuff with me", "sex things to me",
  "sex things with me", "me do sex stuff", "me do sex things", "me to have sex", "sent me porn",
  "sends me porn", "send me porn", "sending me porn", "porn to me",
];

// A person doing something to the child, or to their family: "my dad hit me", "he touches my private
// parts", "my stepdad hurts my sister". The subject has to be a person (a family member, a grown-up,
// he/she/they/someone), which keeps "the poem touched me" and "a wave hits me" out. Only "beat" takes a
// games exclusion (see BEAT); "kicked me off the team" and "kicked us out" are dropped for every verb.
// Known, accepted miss the other way: "he hit me with a great idea" fires.
// KIN is the person nouns; WHO adds "my"/"our", the pronouns and a trailing "'s"/"'re".
const KIN =
  "(?:step[ -]?|foster )?(?:dad|daddy|papa|father|mom|mommy|mama|mum|mother|parents?|uncle|aunt|grandpa|" +
  "grandma|grandfather|grandmother|brother|sister|cousin|teacher|coach|babysitter|neighbou?r|boyfriend|girlfriend)" +
  "(?:'s (?:boyfriend|girlfriend|friend))?";
// WHO with no trailing "'s": for the agent after "touched by", where "my teacher's words" is not a person.
// "a grown up" is also typed with a space (the click test of #227, 2026-11-19).
const WHO_BARE = "(?:(?:(?:my|our) )?" + KIN + "|he|she|they|someone|somebody|a grown[- ]?up|an adult)";
const WHO = WHO_BARE + "(?:'s|'re)?";
// Where the person is, between them and the verb: "someone at home hurts me", "someone at my house hits me",
// "someone in my family hurts me", "a grown up at my dad's house hurts me" (#227's own test phrase, which the
// adjacent-only form missed). Only a place the child lives, learns or is looked after, so "someone at the park"
// and "a grown up at the museum" need the verb right after the person as before. "A person" counts only with
// such a place ("a person at home hurts me"): "when a person hits me with a ball" stays out.
const PLACE =
  " (?:at|in) (?:home|school|church|daycare|camp|(?:my|our) (?:house|home|school|family|room|apartment|class|church|daycare|camp)|" +
  "(?:my|our) " + KIN + "'s(?: (?:house|home|place|apartment))?)";
const SUBJECT = "(?:" + WHO + "(?:" + PLACE + ")?|a person" + PLACE + ")";
const FILL = "(?: (?:always|often|keeps?|sometimes|just|is|was|are|were|has|have|had|been|would|will|used to)){0,3}";
const OBJ = "(?:me|us|my (?:(?:little|big|baby|older|younger) )?(?:mom|mum|mother|dad|father|sister|brother|private\\w*|genital\\w*|penis|vagina|vulva))";
const ACT =
  "(?:hit|hits|hitting|hurt|hurts|hurting|punch(?:es|ed|ing)?|slap(?:s|ped|ping)?|smack(?:s|ed|ing)?|" +
  "spank(?:s|ed|ing)?|kick(?:s|ed|ing)?|whip(?:s|ped|ping)?|chok(?:es|ed|ing)|touch(?:es|ed|ing)?|abus(?:es|ed|ing))";
// "beat" is the games verb ("beat me at chess", "beat us by 3", "beat us 3-0", "beat me to it"), so only
// it takes the follow-word exclusion. "hit me in the face" and "hits me at night" must fire.
const BEAT = "(?:beat|beats|beating)";
const END = "(?![\\p{L}\\p{N}])";
const GAMES = "(?! (?:at|in|by|to|again at|\\d))";
const ABUSE_RE = new RegExp(
  "(?<![\\p{L}\\p{N}])" + SUBJECT + FILL + " (?:" + ACT + " " + OBJ + END + "(?! (?:off|out) )|" +
    BEAT + " " + OBJ + END + GAMES + ")",
  "u",
);
// A person and, within six words in the same sentence, their own genitals: "my brother showed me his
// penis", "someone sent me a picture of his penis", "he makes me suck his penis", "he showed me his
// genitals". The subject is WHO, so "a male frog's penis" stays out; "how does he use his penis" said of
// an animal shows the safety notice, which is the cheap side of the trade.
// "private" said of the body: privates, private part(s) / area(s) / bits (not "of the ..."), or plain
// "private" with no noun after it ("he touches my private", "his private, it hurts"). "private" before any
// other word is the adjective and never counts. TerraTutor #125 listed the nouns to leave out ("his private school"),
// and every noun not on its list fired ("her private feelings", "his private quarters", "their private
// lives"; review of OpenEdu #372, TerraTutor #221). "private place" and "private spot" are a hideaway ("her
// private place in the garden"), and "private and" before public, personal and the like is the adjective
// ("his private and public life"). "privates" is also the army rank: not with a war word within four words
// after it ("he led his privates into battle").
const PRIVATE =
  "(?:privates(?!(?: [\\p{L}']+){0,3} (?:battle|war|army|soldiers?|front|march\\p{L}*|drill\\p{L}*|salut\\p{L}*)(?![\\p{L}\\p{N}]))|" +
  "private (?:parts?|areas?|bits)(?! of (?:the|a|an|this|that|his|her|their|our)(?![\\p{L}\\p{N}]))|" +
  "private(?=\\s*(?:$|[^\\p{L}\\p{N}\\s']|(?:and(?! (?:public|personal|professional|social|family|school|work|business|political|secret)(?![\\p{L}\\p{N}]))|" +
  "again|too|with|when|while|every)(?![\\p{L}\\p{N}']))))";
const BODY = "(?:penis\\p{L}*|genital\\p{L}*|" + PRIVATE + "|vagina\\p{L}*|vulva\\p{L}*)";
const BODY_RE = new RegExp("(?<![\\p{L}\\p{N}])" + WHO + "(?: [\\p{L}']+){1,6}? (?:his|her|their) " + BODY + END, "u");

// TerraTutor #125's cycle-6 review: common ways a child tells that the lists above missed. Each one is a pattern of its
// own, kept to disclosure wording so schoolwork does not trip it (child-safety.test.ts pins both sides).
// The review of OpenEdu #372 (TerraTutor #221 and #223) narrowed the ones that fired on schoolwork; each
// narrowing is said where it is made.
// A person, then within eight words of the same sentence, "touch(es|ed|ing)" and me, us or a part of the
// child's body: "my stepdad comes into my room at night and touches me", "my coach said it's our secret and
// touched me". The person may also be a boy, girl, kid, man, woman, guy, lady, stranger or people, but not
// "a person" or "people" in general after when or if ("when a person touches me after walking on carpet i
// get a shock").
const TOUCHER =
  "(?:" + WHO + "|(?:the |some |a |an |this |that |these |those )?(?:older |big |bigger |other |strange )?" +
  "(?:boys?|girls?|kids?|man|men|guys?|lady|ladies|woman|women|strangers?|" +
  "(?<!(?<![\\p{L}\\p{N}])(?:when|whenever|if) (?:a |an |some |other )?)(?:person|people)))";
// Not when a thing does the touching ("my mom said the story touched me", "her kindness touched the
// children"): no thing just before the verb, and none of the plainly-a-thing nouns earlier in the same
// clause, so an adverb or a relative clause between them does not hide it ("the story about the old man
// really touched me", "the teacher read a poem which touched the children"). A joining word starts a new
// clause: "my uncle read me a story and then touched me" still counts, and so does a thing named after a
// preposition, which says where or when ("during the movie the man next to me touched me").
// A thing given to the child is the object, not the one touching, so it does not block either: after "me" /
// "us" or a giving verb ("the man who gave me gifts touched me", "my coach who sends me messages touches
// me", "the man who gave me a gift that i liked touched me"). It still blocks when "that" or "which" after it
// leads straight to the touching verb, adverbs aside ("the coach gave a speech that really touched the kids",
// "she gave me a letter that touched me"): then the thing is what touched.
const GIVEN =
  "(?<![\\p{L}\\p{N}])(?:me|us|gave|gives|give|giving|sends|sent|send|sending|writes|wrote|write|writing|buys|bought|buy|buying|" +
  "shows|showed|show|showing) (?:me |us )?(?:the |a |an |some |nice |little |his |her |their )?";
const NOT_A_THING =
  "(?<!(?:it|that|this) )(?<!(?<!" + GIVEN + ")(?:poem|story|song|movie|film|book|speech|letter|music|word|words|show|video|scene|ending|art|painting|picture|play|lyrics|kindness|love|gift|message|smile|generosity|faith) )";
const THING =
  "(?:poems?|story|stories|songs?|movies?|films?|books?|speech(?:es)?|letters?|music|lyrics|scenes?|endings?|" +
  "paintings?|videos?|words|kindness|messages?|gifts?|generosity)";
const AFTER_PREP =
  "(?:during|in|at|on|after|before|through|from|of|about|for|with|watching|watched|watch) " +
  "(?:the |a |an |this |that |my |his |her |our |their |some )?";
// Adverbs and helpers between "that" / "which" and the touching verb ("that really touched", "which has
// deeply touched").
const THING_ADV =
  "(?: (?:\\p{L}+ly|so|just|also|always|still|once|even|often|never|ever|has|have|had|will|would|did|does|do)){0,3}";
const NO_THING_BEFORE =
  "(?<!(?<![\\p{L}\\p{N}])(?<!" + AFTER_PREP + ")(?:(?<!" + GIVEN + ")|(?=" + THING + " (?:that|which)" + THING_ADV + " (?:touch|touches|touched|touching)(?![\\p{L}\\p{N}])))" +
  THING + "(?![\\p{L}\\p{N}])(?:(?!(?<![\\p{L}\\p{N}])(?:and|then|but|so|because|while|when|after|before|until)" +
  "(?![\\p{L}\\p{N}]))[^.!?;,])*)";
const TOUCH = NOT_A_THING + NO_THING_BEFORE + "(?:touch|touches|touched|touching)";
// Him, her or them as the one touched, with nothing after it but the end, punctuation or a joining or time
// word ("make me touch him down there"; not "touched him on the shoulder", "her shoulder").
const OBJ_END = "(?= ?(?:$|[^\\p{L}\\p{N}\\s]|and|again|there|too|down|when|while|at|in|every|all)(?![\\p{L}\\p{N}]))";
const THIRD_OBJ = "(?:him|them|her)" + OBJ_END;
// Touching him, her or them counts only after someone's family member or grown-up ("her dad touches her at
// night", "his coach touched him", the child's own "my stepdad touches her at night"), and only at the end or
// before a place or time: "his mother touched him when he cried" and "his grandma touched him and he felt
// better" are stories. People, kids, a woman or a pronoun touching a third person is how science and stories
// talk ("sea anemones sting people who touch them", "the woman reached out and touched him").
const THEIR_KIN = "(?:his|her|their|my|our) " + KIN;
const KIN_OBJ = "(?:him|them|her)(?= ?(?:$|[^\\p{L}\\p{N}\\s]|again|there|down|at|in|every|all)(?![\\p{L}\\p{N}]))";
// The child's own family member or grown-up ("my uncle", "my mom's boyfriend") touching him, her or them also
// counts before when, while, and, too, gently, at night and the like: "my uncle touches her when she sleeps",
// "my stepdad touches them while mom is at work", "my uncle touches her and she cries". Not with another
// subject in between ("my teacher read us how the prince touched her and she woke up"), and not before a noun
// ("in the book my dad touches her hand"). "Our" keeps the narrower rule above ("our teacher touches them
// gently with the brush"). Known, accepted: "my mom touches her when she cries" fires.
const MY_KIN_GAP =
  "(?:,? (?!(?:the|a|an|his|her|their|its|this|that|these|those|he|she|they|it|who|which|where)(?![\\p{L}\\p{N}']))[\\p{L}']+){0,8}?";
const MY_KIN_OBJ =
  "(?:him|them|her)(?= ?(?:$|[^\\p{L}\\p{N}\\s]|and|again|there|too|down|when|whenever|while|at|in|every|all|after|before|" +
  "until|if|but|so|then|because|during|under|sometimes|always|lots|a lot|" +
  "(?!(?:belly|family|jelly|bully|lily|holly)(?![\\p{L}\\p{N}]))\\p{L}+ly)(?![\\p{L}\\p{N}]))";
// A named grown-up, family member or stranger (no bare pronoun, no possessive): "a teacher at school touches
// kids". Not "jesus touched the children", "her kindness touched the children", "he touched the children
// and blessed them" (a Bible story).
const GROWN_UP =
  "(?:(?:(?:my|our|his|her|their|a|an|the|some|this|that) )?" + KIN + "|(?:a |an |the |some |this |that )?" +
  "(?:older |big |bigger |strange |grown )?(?:man|men|guys?|strangers?|grown-?ups?|adults?))";
// Who did the touching, after "touched by": a person, him / them / her (not "her kindness"), or a man, guy or
// stranger. Never followed by an apostrophe: "my teacher's words", "my mom's letter" and "a stranger's
// kindness" are things (WHO's own "'s" used to take the apostrophe first).
const AGENT =
  "(?:" + WHO_BARE + "|him|them|her" + OBJ_END + "|(?:a |an |some |this |that )?(?:older |big |bigger |strange |grown )?" +
  "(?:man|men|guys?|strangers?))(?!')";
// The one touched is the child (or the child's brother or sister): "touched by" is also how stories say
// moved ("the old woman was touched by a stranger who gave her food", "she was touched by them").
const TOUCHED_BY =
  "(?:i|we|my (?:(?:little|big|baby|older|younger) )?(?:sister|brother))(?:'m|m|'re|'ve|ve| am| are| have| has)?" +
  "(?: (?:was|were|got|get|gets|getting|been|being|keep|keeps|kept|always|often|sometimes|just|also)){1,3} touched by ";
// The child getting touched with no one named ("i got touched at school", "we got touched"). Not "touched
// by" a thing ("i got touched by the story"): with "by", TOUCHED_BY's person is needed.
const I_GOT_TOUCHED =
  "(?:i|we)(?:'m|m|'re|'ve|ve|'ll|ll| am| are| have| will)?" +
  "(?: (?:always|often|sometimes|still|just|also|keep|kept|was|were|have|had|would|will|used to)){0,3} " +
  "(?:got|get|getting|been|being) touched(?! by(?![\\p{L}\\p{N}]))";
// Child texting drops the subject: "got touched by my uncle", "got touched at school", "i went home and got
// touched", at the start of the message or a clause (after punctuation, "and", "but" or "then"). Not after a
// noun or pronoun ("when its hairs get touched", "they get touched" are plants), and with "by" only a person
// counts (GOT_TOUCHED_BY + AGENT; "got touched by the movie" is moved).
const CLAUSE_GOT_TOUCHED =
  "(?<=^|[.!?;,:] ?|(?<![\\p{L}\\p{N}])(?:and|but|then) )(?:(?:always|often|sometimes|just|also|once|keep|kept|have) )?" +
  "(?:got|get|getting|been) touched";
const GOT_TOUCHED_BY = CLAUSE_GOT_TOUCHED + " by ";
const BODY_PART = "(?:body|butt|bum|bottom|chest|boobs?|breasts?|" + PRIVATE + "|genital\\p{L}*|penis|vagina|vulva)";
const NOT_ME = "(?<!(?:^|[^\\p{L}\\p{N}'])(?:i|i'll|ill|i'm|im|we|you) )";
const CLOTHES = "(?:pants|shirt|underwear|undies|panties|skirt|shorts|clothes|bra|dress|pajamas|pyjamas|swimsuit)";
const PICS = "(?:pictures?|pics?|photos?|videos?|selfies?)";
const NAKED = "(?:naked|nude|without (?:my |any |a |his |her )?(?:clothes|shirt|pants)|with no clothes(?: on)?|in (?:my |their )?underwear|in the (?:shower|bath))";
const SHARE = "threat\\p{L}* to (?:share|post|send|show|leak) ";
// The child hit, hurt or beaten, said in the passive (the click test of #227, 2026-11-19: "i get hit at home"):
// the first person, a passive helper ("get", "got", "keep getting", "was", "have been", "am being"), the verb,
// then either a person after "by" ("i got hit by my dad", "i was slapped by him") or, within three words, a home
// ("i get hit at home", "i get hit a lot at my dad's house"). With neither it is a playground or a sport: "i got
// hit by a ball", "i got hurt at recess", "i got hit by a car once". A home followed by "by" and no person is
// weather ("we got hit at home by the storm"). "beat" keeps the games rule: no gap before "by", nothing like "at
// chess" or a score after ("i got beaten by my brother at chess", "i got beaten at home 3-0"), and beaten at home
// is the child alone ("i got beat at home"): "we got beat at home" is a team's home game.
const PASSIVE_HELPER =
  "(?: (?:always|often|sometimes|still|just|also|really|usually|keep|kept|have|had|will|would|" +
  "might|could|used to|am|are|was|were)){0,3} (?:get|gets|got|getting|gotten|been|being|am|are|was|were)";
const PASSIVE_ME = "(?:i|we)(?:'m|m|'re|'ve|ve)?" + PASSIVE_HELPER;
const PASSIVE_I = "i(?:'m|m|'ve|ve)?" + PASSIVE_HELPER;
const HURT_PASSIVE = "(?:hit|hurt|punched|slapped|smacked|spanked|kicked|whipped|choked|abused)";
const BEATEN = "(?:beat|beaten)";
const PASSIVE_GAP = "(?: (?!by(?![\\p{L}\\p{N}]))[\\p{L}']+){0,3}?";
// Not home plate or a home game, and "at my dad's" only with nothing after it but a house, the end or a joining
// or time word ("i got hit at my dad's game" is a sports day).
const HOME =
  " (?:at|in) (?:home(?! (?:plate|base|run|game|team|field|court|stadium|page|screen)(?![\\p{L}\\p{N}]))|(?:my|our) (?:house|home|apartment)|" +
  "(?:my|our) " + KIN + "'s(?: (?:house|home|place|apartment)|(?= ?(?:$|[^\\p{L}\\p{N}\\s']|and|when|while|every|all|too|again|a lot)(?![\\p{L}\\p{N}]))))" +
  END + "(?! by (?!" + AGENT + "))";
const DISCLOSURE_RES = [
  PASSIVE_ME + " " + HURT_PASSIVE + PASSIVE_GAP + HOME,
  PASSIVE_I + " " + BEATEN + PASSIVE_GAP + HOME + GAMES,
  PASSIVE_ME + " " + HURT_PASSIVE + PASSIVE_GAP + " by " + AGENT,
  PASSIVE_ME + " " + BEATEN + "(?: (?:up|really|badly|bad))? by " + AGENT + END + GAMES,
  TOUCHER + "(?:,? [\\p{L}']+){0,8}? " + TOUCH + " (?:me|us|my " + BODY_PART + ")",
  THEIR_KIN + "(?:,? [\\p{L}']+){0,8}? " + TOUCH + " " + KIN_OBJ,
  "my " + KIN + MY_KIN_GAP + " " + TOUCH + " " + MY_KIN_OBJ,
  // Touched by someone ("i got touched by my uncle", "i was touched by a man at the park"), or the child
  // touched with no one named ("i got touched at school"). Anyone else's "get touched" with no one doing it
  // is a plant or a feeling ("when its hairs get touched", "he gets touched by the story").
  TOUCHED_BY + AGENT,
  GOT_TOUCHED_BY + AGENT,
  CLAUSE_GOT_TOUCHED + "(?! by(?![\\p{L}\\p{N}]))",
  I_GOT_TOUCHED,
  GROWN_UP + "(?:,? [\\p{L}']+){0,8}? " + TOUCH + " (?:the |other |younger |little )?(?:kids|children|boys|girls)(?!')",
  // Not a remedy rubbed on ("my mom rubs my chest with vapor rub when i am sick").
  WHO + "(?:,? [\\p{L}']+){0,8}? (?:rub|rubs|rubbed|rubbing|lick|licks|licked|licking|grab|grabs|grabbed|grabbing) my " + BODY_PART +
    "(?! with (?:(?:some|the|a) )?(?:vapou?r|vicks|medicine|cream|lotion|ointment|balm|oil|sunscreen))",
  // "touches my butt", "grabbed my boobs", "rubs my private area", with or without a named person.
  "(?:touch|touches|touched|touching|rub|rubs|rubbed|rubbing|lick|licks|licked|licking|grab|grabs|grabbed|grabbing|squeez\\p{L}*) " +
    "my (?:butt|bum|boobs?|breasts?|" + PRIVATE + "|genital\\p{L}*|penis|vagina|vulva)",
  // Down there. Touching needs me or my: "touch down there" with neither is a landing ("apollo 11 touched
  // down there in 1969"), and "her down there" is "see her down there" unless she is touched.
  "(?:touch|touches|touched|touching) (?:me|my) down there",
  "(?:lick\\p{L}*|rub\\p{L}*|kiss\\p{L}*|grab\\p{L}*|feel\\p{L}*) (?:me |my )?down there",
  "(?:my|his|their) down there",
  "(?:touch\\p{L}*|lick\\p{L}*|rub\\p{L}*|kiss\\p{L}*|grab\\p{L}*|feel\\p{L}*) her down there",
  // A hand in or down the child's clothes, or on their private parts.
  "(?:hands?|fingers?|mouth|tongue|thing) (?:in|into|inside|down|up|under) my " + CLOTHES,
  "(?:hands?|fingers?|mouth|tongue|thing) (?:on|in|inside|into|against) my (?:butt|bum|boobs?|breasts?|" + PRIVATE + ")",
  "fingers? (?:in|inside|into) me",
  // In me or my, or on me or a part of the child's body ("the nurse put her fingers on my wrist" is a pulse).
  "(?:his|her|their) (?:thing|fingers?|penis|dick|privates?) (?:(?:in|inside|into) (?:me|my)|on (?:me|my " + BODY_PART + "))",
  // Clothes pulled down or taken off, by someone else.
  NOT_ME + "(?:pull|pulls|pulled|pulling|yank\\p{L}*|take|takes|took|taking|taken) (?:down|off) my " + CLOTHES,
  NOT_ME + "(?:pull|pulls|pulled|pulling|yank\\p{L}*) my " + CLOTHES + " (?:down|off)",
  NOT_ME + "(?:take|takes|took|taking|taken) my clothes off",
  "(?:me|us) (?:to )?(?:take|get|be|stay|go) (?:off my " + CLOTHES + "|my " + CLOTHES + " off|naked|nude|undressed)",
  "(?:pull\\p{L}*|took|take\\p{L}*) (?:down |off )?(?:his|her|their) " + CLOTHES + "(?: down| off)? in front of (?:me|us)",
  "undress(?:es|ed|ing)? (?:me|us)",
  // Made to touch or suck.
  "(?:make|makes|made|making|forc\\p{L}*|ask|asks|asked|want|wants|wanted|tell|tells|told) me (?:to )?touch " +
    "(?:" + THIRD_OBJ + "|(?:his|her|their) (?:thing|stuff|body|" + PRIVATE + "|penis|dick|vagina|boobs?|breasts?|butt|bum))",
  "(?:make|makes|made|making|forc\\p{L}*) me (?:to )?suck",
  // Nudes, pictures and video.
  "(?:for|send|sent|sends|sending) (?:me |him |her |them |you )?(?:my |some |a |any )?nudes",
  "my nudes",
  "nude (?:pic|pics|picture|pictures|photo|photos|selfie|selfies|video|videos)",
  "dick ?pics?",
  "naked (?:pictures?|videos?|selfies?)",
  PICS + " of (?:me|myself|us)(?: [\\p{L}']+){0,2} " + NAKED,
  PICS + " (?:naked|nude|without (?:my |any |a )?(?:clothes|shirt|pants)|with no clothes(?: on)?|in (?:my |your )?underwear)",
  PICS + " of (?:his|her|their) " + BODY,
  "(?:showed|shows|show|showing|sent|sends|send|sending) (?:me|us) " + PICS + " of(?: [\\p{L}']+){1,2} " + NAKED,
  "(?:video ?chat\\p{L}*|facetime|cam|call) (?:me |us )?(?:naked|nude|without (?:my |any )?clothes|with no clothes(?: on)?)",
  "(?:record\\p{L}*|film\\p{L}*|tap(?:es|ed|ing)) (?:me|us) " + NAKED,
  // Sextortion. Sharing pictures counts only with a threat in the same message (handled below).
  "sextort\\p{L}*",
  "blackmail(?:s|ed|ing)? (?:me|us)",
  // A threat to share the child's own things: "threatened to share my nudes". Not "the king threatened to
  // send his army" or "threatened to show force"; "threatened to post them" counts with pictures (below).
  SHARE + "(?:all )?(?:my|our)",
  "hump(?:s|ed|ing)? (?:on )?(?:me|us)",
  "(?:watch|watches|watched|watching|spies on|spied on|spying on|peeks? at|peeked at|peeking at) (?:me|us) " +
    "(?:in the shower|in the bath|showering|bathing|naked|undress\\p{L}*)",
  "(?:watch|watches|watched|watching) (?:me|us) (?:when|while) (?:i|we) (?:shower|bathe|change|undress|get dressed|take a (?:shower|bath))",
  "(?:don't|dont|do not) feel safe (?:at|in) (?:home|my|our)",
  // The child getting hurt at home, not a health lesson ("many kids get hurt at home from falls").
  "(?:i|we)(?:'m|m|'re|'ll|ll|'ve been|ve been| am| are| have been| will)?" +
    "(?: (?:always|often|sometimes|still|keep|kept|really|just|usually|might|could|would|will)){0,2} (?:get|got|getting) hurt at home",
].map((s) => new RegExp("(?<![\\p{L}\\p{N}])" + s + END, "u"));
// "he has my pictures and threatened to post them": a threat to share them or it, with pictures in the message.
const SHARE_THEM_RE = new RegExp("(?<![\\p{L}\\p{N}])" + SHARE + "(?:them|it|those|these)" + END, "u");
const PICS_RE = new RegExp("(?<![\\p{L}\\p{N}])(?:" + PICS + "|nudes)" + END, "u");
// "he'll post my pics unless i send more": sharing the child's pictures, with a threat in the message.
const SHARE_PICS_RE = new RegExp("(?<![\\p{L}\\p{N}])(?:share|post|send|show|leak)(?:s|ed|ing)? (?:all )?my (?:naked |nude |private )?" + PICS + END, "u");
const THREAT_RE = /(?<![\p{L}\p{N}])(?:unless|if i (?:don't|dont|do not|won't|wont|didn't|didnt)|or else|threat\p{L}*)(?![\p{L}\p{N}])/u;
// "kms" is also kilometres ("5 kms", "miles to kms"): it counts only as the whole message (with chat
// filler) or right after a first-person lead-in.
const KMS_RE =
  /^kms(?: (?:lol|lmao|rn|fr|bruh|omg))*[.!?]*$|(?<![\p{L}\p{N}])(?:i|i'll|ill|i'm|im|gonna|imma|ima|wanna|want to|going to|might|should|just) kms(?![\p{L}\p{N}])/u;

// A K-12 learner who says they may be pregnant (ported from TerraTutor #158). Only a STRONG
// SELF-DISCLOSURE in the newest message counts, and only when the learner has a K-12 grade set
// (isSafetyDisclosure's grade). OpenEdu also serves adults: with no grade set this never counts, so
// nothing changes for them. A hit only ADDS what any safety disclosure gets: SAFETY_NOTICE under the
// message (it names Childhelp), and the tutor answers under CHILD_SAFETY_RULES (grade.ts already adds
// them for every K-12 learner). It never blocks or changes a turn, so a false hit costs one notice.
// Strong means the learner about themselves:
//   - the first person with the pregnancy word: "am i pregnant", "i think i'm pregnant", "i might be pregnant",
//     "could i be pregnant", "i'm (only / really / probably ...) pregnant", "i got pregnant", "he knocked me up",
//     "he got me pregnant";
//   - their own age with it, or with having a baby, in either order: "im 14 and pregnant", "i am 13 years old
//     and pregnant", "im 15 and having a baby", "i'm having a baby and i'm 15";
//   - their own missed or late period: "i missed my period", "my period is 2 weeks late";
//   - their own positive test: "my pregnancy test was positive", "i took a pregnancy test and it said
//     positive".
// The pregnancy word is read by its shape (pregnancyShape: any spelling within two edits, the short forms,
// digits for letters, letters spelled one at a time) and the pregnant-person emoji. Not strong, so no
// notice: anyone else ("my mom is pregnant", "is my goat pregnant"), "have a baby" without the learner's own
// age (or with an age under 10: "im 8 and having a baby" is family news), "will i have babies one day",
// grade, Bible and story forms, "can i get pregnant from ..." and "can kissing get me pregnant?". Strong is
// the learner's own real state, so it is never a joke, pretend play, a language lesson, a hypothetical or
// someone else's words. The guard code below is TerraTutor's, as of its PR #161 (the same regexes and
// functions), and each guard has its own reach: a laughing emoji (unless the message shows distress: "im
// pregnant omg what do i do 😂😭" counts), a language lesson ("how do you say", "translate", "in spanish"),
// "im a boy", "when i grow up" and family news anywhere in the message; an explicit pretend frame ("lets play
// house!", "we're playing toca boca.") anywhere before the cue's clause ends; "food baby", a story, book,
// show, game, costume, doll, dream, "in my book" or "if i was" in the cue's clause or sentence; quoted words
// and what follows "said", "asked" or "saying" up to the sentence end or a joining word (not "the doctor
// said"). A disclosure next to an ordinary mention still counts: "I'm pregnant. Can you help with my book
// report?", "im pregnant. lets play a game". The notice never blocks, so a missed disclosure costs far more
// than an extra notice (lead decision after TerraTutor #161's second final review): there is no "pregnant
// with <thing>" guard ("im pregnant with my boyfriend", "im pregnant with nobody to help me" get the notice,
// and so does "im pregnant with tacos" with no laughing emoji), and the pretend frames are not widened past
// the list below (a game set up in an earlier sentence, "we're playing school. im the teacher and im
// pregnant", gets one notice). The shared review corpus (child-safety-pregnancy-corpus.json) is every input
// both repos' reviews ruled on, with these accepted extra notices listed apart. The open vocabulary this
// leaves out (euphemisms, "i'm late", "we didn't use protection") gets no notice.

// Damerau-Levenshtein distance (optimal string alignment: insert, delete, change, or swap two neighbours).
function editDistance(a: string, b: string): number {
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
    }
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

// The real English words inside pregnancyShape's reach that are not pregnancy words. Found by sweeping the
// bundled word list (public/wordlist/, 274,137 words); child-safety.test.ts sweeps it again and fails on any
// new one. The pregnancy words it also finds (pregnant, pregnantly, pregnancy, pregnancies, pregnance,
// pregnances, impregnant, unpregnant, preggers, preggy) keep their shape.
const NOT_PREGNANCY_SHAPE = new Set([
  "pennant", "poignant", "preenact", "preplant", "regnant", "regrant", "remnant",
  "pernancy", "pernancies", "poignancy", "poignancies", "prevenancy", "prevenancies", "regnancy", "regnancies",
  "reggo", "priggers", "proggers",
]);

/**
 * The pregnancy word by its shape, not by a list of spellings ("prenant", "pragnent" and "pregrant" each fell
 * outside a list). A lower-case word is "pregnant" when it is 7 to 10 letters and within two edits of
 * "pregnant", or a short form: "preg", "preggie(s)", or 5 to 9 letters within one edit of "preggo" (prego,
 * preggos) or "preggers" (pregers). It is "pregnancy" (the noun) when it is within two edits of "pregnancy"
 * (7-11 letters) or "pregnancies" (9-13) and closer to it than to "pregnant", or ends in "cy" or "cies".
 * Short forms get one edit, not two: two edits of a six-letter word reach ordinary words. Real words in reach
 * are never it (NOT_PREGNANCY_SHAPE). Otherwise null.
 */
export function pregnancyShape(word: string): "pregnant" | "pregnancy" | null {
  const n = word.length;
  if (n < 4 || n > 13 || NOT_PREGNANCY_SHAPE.has(word)) return null;
  if (word === "preg" || word === "preggie" || word === "preggies") return "pregnant";
  if (n >= 5 && n <= 9 && (editDistance(word, "preggo") <= 1 || editDistance(word, "preggers") <= 1)) return "pregnant";
  const adj = n >= 7 && n <= 10 ? editDistance(word, "pregnant") : 99;
  const noun = Math.min(n >= 7 && n <= 11 ? editDistance(word, "pregnancy") : 99, n >= 9 ? editDistance(word, "pregnancies") : 99);
  if (noun <= 2 && (noun < adj || /c(?:y|ies)$/.test(word))) return "pregnancy";
  return adj <= 2 ? "pregnant" : null;
}

// Every pregnancy-shaped word written as "pregnant" or "pregnancy", so the patterns below name one spelling.
// Not "prego" before sauce or pasta. Digits read as letters inside a word ("pr3gnant"), and letters spelled
// out one at a time ("p r e g n a n t", "am i p.r.e.g.n.a.n.t") are joined when the joined word has the
// shape; a single letter before the run ("i") is kept as its own word. The pregnant woman, man and person
// emoji are the word ("am i 🤰"); the breast-feeding emoji is not (a baby already born).
const SAUCE = /^ (?:sauce|pasta|spaghetti)(?![\p{L}\p{N}])/u;
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "6": "g", "9": "g" };
const SPELLED = /(?<![\p{L}\p{N}])\p{L}(?:[ .-]\p{L}(?![\p{L}\p{N}])){4,}/gu;
const PREGNANT_EMOJI = /[\u{1F930}\u{1FAC3}\u{1FAC4}]/gu;
function pregnancyWords(text: string): string {
  const joined = text.replace(PREGNANT_EMOJI, " pregnant ").replace(/\s+/g, " ").trim().replace(SPELLED, (run: string) => {
    const w = run.replace(/[ .-]/g, "");
    if (pregnancyShape(w.slice(1))) return `${w[0]} ${w.slice(1)}`;
    return pregnancyShape(w) ? w : run;
  });
  return joined.replace(/\p{L}[\p{L}\d]*/gu, (w: string, at: number) => {
    const shape = pregnancyShape(/\d/.test(w) ? w.replace(/\d/g, (d) => LEET[d] ?? d) : w);
    return shape && !SAUCE.test(joined.slice(at + w.length)) ? shape : w;
  });
}

// After pregnancyWords.
const PREG = "(?:pregnant|knocked[- ]up)";
const AGE =
  "(?:(?<!\\p{N})(?:1[0-7]|[1-9])(?!\\p{N})|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)";
const IM = "(?:i'm|im|i am)";
const ADVERB = "(?:only|just|so|really|actually|probably|maybe|possibly|definitely|still|also|now|kinda|like|totally|literally|already)";
// A cue laughed off right after it in words is a joke ("im pregnant lol", "im pregnant jk"). A laughing emoji
// counts anywhere in the message (LAUGH, in strongPregnancy).
const NOT_JOKE = "(?![\\s.,!?]*(?:lol|lmao|jk|j/k|ha(?:ha)+|hehe)(?![\\p{L}\\p{N}]))";
// What makes "i missed my period" a school class period: a day, the sub or class right after it, or "for"
// before anything but a length of time ("for the assembly", not "for 2 months"); or a lesson question later.
const WEEKDAY = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
const DURATION =
  "(?:(?:a|about|over|like|almost|nearly|more than) )?(?:\\d|one|two|three|four|five|six|seven|eight|nine|ten|a few|a couple|a while|a long|months?|weeks?|days?|so long|too long)";
const SCHOOL_PERIOD =
  "(?! (?:(?:on " + WEEKDAY + "|with the sub(?:stitute)?|in class)(?![\\p{L}\\p{N}])|for (?!" + DURATION + ")))" +
  "(?!.*(?:what did we learn|homework|(?:math|history|science) period))";
const AGE_SUFFIX = "(?: ?(?:years?|yrs?|yr)[- ]?old| ?y/?o)?";
const MY_AGE = AGE + AGE_SUFFIX;
// Having a baby counts with an age of 10 or more: "im 8 and having a baby" is family news.
const MY_AGE_10 = "(?:(?<!\\p{N})1[0-7](?!\\p{N})|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)" + AGE_SUFFIX;
// "and", "&", "n" or a comma between the age and the rest: "im 14 and pregnant", "im 14 n pregnant", "im having
// a baby, im 14".
const AND = "(?:,? (?:and|&|n)|,) ";
const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|march|april|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const SEASON = "(?:the )?(?:spring|summer|fall|autumn|winter)";
// The child's own baby: "a baby" followed only by the end, punctuation, a joining word or a few words of time
// ("soon", "in june", "next year"). Not "a baby tooth", "a baby sitter", "a baby hamster", "a baby brother".
const HAVING_A_BABY =
  "(?:having|going to have|gonna have) a baby(?=\\s*(?:$|[^\\p{L}\\p{N}\\s])|\\s(?:(?:and|but|so|because|cause|cuz|bc|then|or|n|soon|too|now|already|this|next|boy|girl|what|help|omg|please|pls|i|im|i'm|with|at)(?![\\p{L}\\p{N}'])|in (?:" +
  MONTH + "|" + SEASON + "|a few|a couple|a month|a week|\\p{N})))";
// Who the baby is with, between "having a baby" and the child's age ("im having a baby with my boyfriend and im
// 15", final check of TerraTutor #161): my, his, a, the ... and a person word, with up to three words before it
// ("my 17 year old boyfriend", "an older guy"), or one word for a name or "him". Never a parent or the family:
// "im having a baby with my mom and dad and im 12" is family news. Someone else's baby ("a baby sister with my
// mom") never reaches it: HAVING_A_BABY ends at "a baby".
const PARENT = "(?:mom|mum|mommy|mummy|mama|momma|mother|ma|stepmom|stepmum|parents?|family|fam)";
const PERSON =
  "(?:boyfriend|bf|bae|girlfriend|gf|partner|guy|boy|man|dude|friend|husband|hubby|fianc[eé]e?|ex|crush|teacher|coach|" +
  "stepdad|stepfather|dad|daddy|father|uncle|cousin|brother|stepbrother|neighbou?r|pastor|tutor|babysitter|someone|somebody)";
const WITH_SOMEONE =
  "(?: with (?:(?:my|his|a|an|the|this|that|some) (?:(?!(?:and|n|or|but|" + PARENT + ")(?![\\p{L}\\p{N}']))[\\p{L}\\p{N}'-]+ ){0,3}" + PERSON +
  "|(?!(?:my|his|a|an|the|this|that|some|" + PARENT + ")(?![\\p{L}\\p{N}']))[\\p{L}']+))?";
// The "g" flag is for matchAll in strongPregnancy only: never call .test() or .exec() on these (lastIndex).
const STRONG_PREGNANCY = [
  // The first person with the word. Not "i feel like im pregnant" or "like i'm pregnant" (a full tummy), and not
  // "if i was pregnant" (a hypothetical; "if i got pregnant at 30 ..." stays strong).
  "(?:am i|(?:could|might|may) i be|i (?:might|may|could|must) be|i think (?:" + IM + "|i (?:might|may|could) be)|(?<!like )" + IM +
    "(?: " + ADVERB + ")*|i (?:got|became|have been|'ve been|ve been)|(?<!if )i was|i'm getting|im getting) " + PREG,
  "knocked me up",
  // Someone got the child pregnant. Not "can kissing get me pregnant?" (a curiosity question) or "this burrito
  // got me pregnant" (a food joke).
  "(?<!(?:this|that|these|those) [\\p{L}']+ )(?:got|made) me " + PREG,
  // The child's own age with it, or with having a baby, in either order; or the age opening the message ("14
  // and pregnant help").
  IM + " (?:only |just )?(?:" + MY_AGE + AND + PREG + "|" + MY_AGE_10 + AND + "(?:" + IM + " )?" + HAVING_A_BABY + ")",
  "^" + MY_AGE + AND + PREG,
  IM + " " + HAVING_A_BABY + WITH_SOMEONE + AND + "(?:" + IM + " )?(?:only |just )?" + MY_AGE_10,
  // The child's own missed or late period. Not a school period ("i missed my period 2 class", "i missed my
  // period on monday, what did we learn?").
  "(?:missed|skipped|miss|missing) my (?:last )?period" +
    "(?! ?(?:\\d|one|two|three|four|five|six|seven|eight|class\\p{L}*|block|lesson|teacher|bell|of|because|cause|bc|today|at school|in school|for class)(?![\\p{L}\\p{N}]))" +
    SCHOOL_PERIOD,
  "my period(?:'s|s| is| was| has been| seems)(?: (?:like|about|really|so|very|a|an|one|two|three|four|five|six|few|couple|of|\\d+|days?|weeks?|little|bit|lot))* (?:late|overdue)",
  // The child's own positive test.
  "my pregnancy tests? (?:(?:came back|came out|was|is|were|are|said|says|showed|shows|turned|read|reads) )+(?:[\\p{L}']+ )?positive",
  "i (?:took|did|had|got|used) (?:a |the |an |another )?(?:home )?pregnancy tests?(?: [\\p{L}'&]+){0,6}? positive",
  "i (?:got|have|had) (?:a )?positive pregnancy tests?",
].map((s) => new RegExp("(?<![\\p{L}\\p{N}])" + s + "(?![\\p{L}\\p{N}])" + NOT_JOKE, "gu"));
// A laughing emoji anywhere makes the message a joke ("😂😂 i ate so much im pregnant", "im pregnant with tacos
// 😂"), unless the message also shows distress: a crying or scared face, "what do i do", "scared", "worried",
// "help me". 😂 with 😭 is distress, not a joke ("im pregnant omg what do i do 😂😭", "i think i'm pregnant 😭😂
// what do i do"): decided for the review of TerraTutor #161, since a child who means it may laugh nervously.
const LAUGH = /[\u{1F602}\u{1F606}\u{1F639}\u{1F923}]/u;
const DISTRESS =
  /[\u{1F62D}\u{1F622}\u{1F625}\u{1F630}\u{1F628}\u{1F631}]|(?<![\p{L}\p{N}])(?:what (?:do|should|can) i do|what do i tell|scared|afraid|worried|nervous|freaking out|terrified|i need help|(?:please|pls|plz) help|help me(?! with))(?![\p{L}\p{N}])/u;
// The guards below read the cue's own clause, its sentence, or the message up to the cue's clause end, never what
// comes after (review of OpenEdu #342): "im pregnant and i dont want to go to the school play" is a disclosure;
// "i was pregnant in the school play" is not. A clause ends at a comma, a sentence end or a joining word; a
// sentence ends at . ! ? or ;.
const SENTENCE_END = /[.!?;]/gu;
const CLAUSE_END = /[.!?;,]|(?<![\p{L}\p{N}'])(?:and|but|so|because|cause|cuz|bc|then|or)(?![\p{L}\p{N}'])/gu;
// In the cue's clause: a story, a book, a show, a game, pretend play, a school play, a costume, a doll, a dream
// or a food baby ("i got pregnant in bitlife", "i was pregnant in the school play", "im pregnant with my baby
// doll", "i dreamed i was pregnant"). "play" and "show" count as nouns only ("the school play", "a tv show").
const FICTION_RE =
  /(?<![\p{L}\p{N}])(?:story|stories|books?|novels?|movies?|films?|poems?|chapters?|characters?|pretend\p{L}*|role ?play\p{L}*|fanfic|scripts?|playing|games?|toca(?: boca)?|gacha|bitlife|sims|minecraft|roblox|costumes?|halloween|dolls?|dream\p{L}*|nightmares?|tv|episodes?|cartoons?|(?:school|class|church|christmas|nativity|the|a|our|my) play|play(?:ed|s)? (?:house|pretend|mom|mommy|family|doctors?|hospital|vet)|(?:tv|a|the|this|that|my|our|favou?rite) shows?|food[- ]?bab(?:y|ies))(?![\p{L}\p{N}])/u;
// Anywhere in the message up to the cue's clause end: an explicit pretend frame, since children set up the game in
// one sentence and play in the next ("lets play house! im the mom and im pregnant", "we're playing toca boca. im
// pregnant with twins", "my doll is the baby. im pregnant with her"). A game is a frame only after "in", "on" or
// "playing": "i played minecraft all day and i think im pregnant" is a disclosure. A frame after the cue does not
// reach back to it ("im pregnant. lets play a game" gets the notice). Kept to this list on purpose: a wider frame
// could hide a real disclosure, and a game it misses ("we're playing school. im the teacher and im pregnant")
// costs one notice under play, never a blocked answer.
const PRETEND_FRAME =
  /(?<![\p{L}\p{N}])(?:pretend\p{L}*|role ?play\p{L}*|make[- ]believe|(?:let's|lets|let us) play|play(?:s|ed|ing)? (?:house|pretend|mom|mommy|family|doctors?|hospital|vet)|(?:in|on|playing) (?:toca(?: boca)?|gacha|bitlife|(?:the )?sims|minecraft|roblox)|(?:school|class|church|christmas|nativity|easter|the|a|our|my) play|dolls? (?:is|are) (?:the |my |a )?bab(?:y|ies)|(?:halloween )?costumes?|for halloween|writ(?:e|es|ing) (?:me )?(?:a |an |my )?(?:story|poem|script|play))(?![\p{L}\p{N}])/u;
// Earlier in the cue's sentence, or in its clause: a book, a show or a game named after "in" or "on", or a
// hypothetical ("in my book im pregnant", "if i was a seahorse dad could i be pregnant?").
const FRAME_RE =
  /(?<![\p{L}\p{N}])(?:(?:in|on) (?:a |an |the |my |our |this |that |his |her |their )?(?:\p{L}+ )?(?:story|stories|books?|novels?|movies?|films?|poems?|chapters?|scripts?|fanfic|games?|play|shows?|tv|episodes?|cartoons?)|if i (?:were|was))(?![\p{L}\p{N}])/u;
// Anywhere in the message: the narrow, high-precision frames. A language lesson ("i am pregnant, how do you say
// that in spanish?", "translate i am pregnant to german", "what does estoy embarazada mean?") and the clear
// hypotheticals ("could i be pregnant? im a boy", "i might be pregnant someday, when i grow up"). Not "how do i
// say im pregnant to my mom": that is asking how to tell a parent.
const LESSON_FRAME =
  /(?<![\p{L}\p{N}])(?:how (?:do|would|can|to) (?:you |u |i )?say(?!.*(?<![\p{L}\p{N}])to (?:my|mom|mommy|mum|dad|daddy|her|him|them)(?![\p{L}\p{N}]))|translat\p{L}*|(?:in|into|to) (?:spanish|french|german|italian|portuguese|latin|chinese|japanese|korean)|embarazada|enceinte|schwanger|incinta|(?:i'm|im|i am) a boy|when i grow up|someday when|when (?:i'm|im|i am) (?:older|grown(?: up)?|a grown-?up|an adult))(?![\p{L}\p{N}])/u;
// Not a frame: "im pregnant for real this isnt a story".
const NOT_FICTION = /(?<![\p{L}\p{N}])(?:not|isn't|isnt|is not|ain't|aint|no) (?:a |an |just |even )?(?:story|joke|game|pretend|role ?play)(?![\p{L}\p{N}])/gu;
// Family news: someone else's baby ("were having a baby", "so now im going to be a cousin").
const FAMILY_NEWS =
  /(?<![\p{L}\p{N}])(?:(?:we're|were|we are) having a baby|(?:going to|gonna) be (?:a |an )?(?:big )?(?:cousin|aunt|auntie|uncle|sister|brother|sibling))(?![\p{L}\p{N}])/u;
// Someone else's words: anything inside quotation marks (an unclosed double quote runs to the end), and what
// follows "said", "says", "saying", "asked" or "asks" up to the end of the sentence or a joining word ("my
// teacher asked am i pregnant?", "my brother keeps saying im pregnant cuz my belly is big"; not "my friend said i
// should take a test because i think im pregnant"). Not "the test said", "it said" or "the doctor / nurse said":
// that is the child's own result ("the doctor said im pregnant").
const QUOTED = /"[^"]*(?:"|$)|“[^”]*(?:”|$)|(?<![\p{L}\p{N}])'.*?'(?![\p{L}\p{N}])/gu;
const REPORTED =
  /(?<![\p{L}\p{N}])(?<!(?:tests?|it|doctor|doctors|doc|nurse|clinic) )(?:said|says|saying|asked|asks)(?![\p{L}\p{N}]).*?(?=[.!?;]|(?<![\p{L}\p{N}'])(?:and|but|so|because|cause|cuz|bc|then|or)(?![\p{L}\p{N}'])|$)/gu;

// Where a regex matches in a text, found once per message: [start, end] of each match.
function boundaries(re: RegExp, text: string): [number, number][] {
  return [...text.matchAll(re)].map((m): [number, number] => [m.index, m.index + m[0].length]);
}
// The end of the last boundary that ends at or before i (0 when none), and the start of the first one at or after
// i (the text's length when none).
function lastEndBefore(bounds: [number, number][], i: number): number {
  let at = 0;
  for (const [, end] of bounds) if (end <= i) at = end;
  return at;
}
function firstStartAfter(bounds: [number, number][], i: number, length: number): number {
  for (const [start] of bounds) if (start >= i) return start;
  return length;
}

function strongPregnancy(text: string): boolean {
  const c = pregnancyWords(text);
  if (FAMILY_NEWS.test(c) || LESSON_FRAME.test(c) || (LAUGH.test(c) && !DISTRESS.test(c))) return false;
  // Someone else's words are blanked to spaces, so every index still points into c; so is "not a story".
  const blank = (s: string) => " ".repeat(s.length);
  const own = c.replace(QUOTED, blank).replace(REPORTED, blank);
  const guarded = c.replace(NOT_FICTION, blank);
  const clauses = boundaries(CLAUSE_END, c);
  const sentences = boundaries(SENTENCE_END, c);
  return STRONG_PREGNANCY.some((re) => {
    for (const m of own.matchAll(re)) {
      const end = m.index + m[0].length;
      const clauseEnd = firstStartAfter(clauses, end, c.length);
      const clause = guarded.slice(lastEndBefore(clauses, m.index), clauseEnd);
      const sentence = guarded.slice(lastEndBefore(sentences, m.index), clauseEnd);
      if (FICTION_RE.test(clause) || FRAME_RE.test(sentence) || PRETEND_FRAME.test(guarded.slice(0, clauseEnd))) continue;
      return true;
    }
    return false;
  });
}

function normalise(s: string): string {
  // Apostrophes first: NFKC turns "´" into a space and a combining accent.
  return s.replace(/[‘’ʼ`´]/g, "'").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
function startsWord(text: string, i: number): boolean {
  return i === 0 || !WORD_CHAR.test(text[i - 1]);
}
function endsWord(text: string, i: number): boolean {
  return i >= text.length || !WORD_CHAR.test(text[i]);
}

/**
 * True when a student's message reads as a self-harm, suicide or abuse disclosure (sexual abuse,
 * unwanted touching, nude pictures and sextortion included), or, when the learner has a K-12 grade set,
 * as a strong self-disclosure of a pregnancy (strongPregnancy). With no grade (an adult, or a learner who
 * never set one) only the first part applies.
 */
export function isSafetyDisclosure(message: string, grade: Grade | null = null): boolean {
  const text = normalise(message);
  if (!text) return false;
  if (ABUSE_RE.test(text) || BODY_RE.test(text) || KMS_RE.test(text)) return true;
  if (DISCLOSURE_RES.some((re) => re.test(text)) || (SHARE_PICS_RE.test(text) && THREAT_RE.test(text))) return true;
  if (SHARE_THEM_RE.test(text) && PICS_RE.test(text)) return true;
  if (grade !== null && strongPregnancy(text)) return true;
  return PHRASES.some((entry) => {
    const stem = entry.endsWith("*");
    const phrase = stem ? entry.slice(0, -1) : entry;
    for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + 1)) {
      if (!startsWord(text, i) || (!stem && !endsWord(text, i + phrase.length))) continue;
      if (phrase === "suicid" && thirdPersonSuicide(text, i)) continue;
      return true;
    }
    return false;
  });
}

// TerraTutor #223: a history or literature answer that states someone else's suicide as a fact ("in the
// story the character commits suicide", "romeo and juliet both commit suicide", "suicide rates rose after the
// war") is not the child's own disclosure. Only a grammatically third-person form counts ("commits", "both /
// all / each commit", "suicide rate(s)"), and only in a sentence with no first-person word: "i think about
// suicide", "my brother committed suicide" and "the character commits suicide and i want to too" still show
// the notice, and so do "they commit suicide" and a question such as "why did romeo commit suicide?"
// (accepted false positives).
const THIRD_PERSON_SUICIDE_RE = /(?<![\p{L}\p{N}])(?:(?:commits|(?:both|all|each) commit) suicide|suicide rates?)(?![\p{L}\p{N}])/gu;
const FIRST_PERSON_RE = /(?<![\p{L}\p{N}'])(?:i|i'm|im|i've|ive|i'll|i'd|me|my|myself|mine|we|we're|we've|us|our|ours|ourselves)(?![\p{L}\p{N}'])/u;
const NOT_ABOUT_OTHERS_RE = /(?<![\p{L}\p{N}'])(?:kms|you|your|yours|yourself|yourselves|u|ur)(?![\p{L}\p{N}'])/u;
const QUESTION_LEAD_RE = /^(?:what|why|how|did)(?![\p{L}\p{N}'])/u;

/**
 * True when a student's message is a question about someone else: it opens with what / why / how / did and has
 * no first-person word (FIRST_PERSON_RE: i, me, my, we, us, our, im, i'm ...), no "kms" and no second-person
 * word (you, your, yourself, u, ur: "how do you kill yourself" is never one). On a self-harm, suicide or abuse
 * disclosure TutorEngine sends such a message to the model, as before, and answers every other one with
 * disclosureReply (TerraTutor #246, Fable's decision as Tate's delegate, 2026-11-19): "why did romeo commit
 * suicide?", "what does molest mean" and "how does the author end it all" are schoolwork the harm list cannot
 * tell from a disclosure, while "no reason to live", "he touched her down there" and "is self-harm bad" (a
 * child asking it is likelier asking about themselves) keep the fixed reply. Ported verbatim.
 */
export function isHarmTopicQuestion(message: string): boolean {
  const text = normalise(message);
  if (!text || FIRST_PERSON_RE.test(text) || NOT_ABOUT_OTHERS_RE.test(text)) return false;
  return QUESTION_LEAD_RE.test(text);
}

function thirdPersonSuicide(text: string, at: number): boolean {
  const from = Math.max(text.lastIndexOf(".", at), text.lastIndexOf("!", at), text.lastIndexOf("?", at), text.lastIndexOf(";", at)) + 1;
  const ends = [".", "!", "?", ";"].map((c) => text.indexOf(c, at)).filter((n) => n !== -1);
  const sentence = text.slice(from, ends.length ? Math.min(...ends) : text.length);
  if (FIRST_PERSON_RE.test(sentence)) return false;
  const local = at - from;
  for (const m of sentence.matchAll(THIRD_PERSON_SUICIDE_RE)) {
    if (local >= m.index! && local < m.index! + m[0].length) return true;
  }
  return false;
}
