// The strong pregnancy self-disclosures that show SAFETY_NOTICE for a learner with a K-12 grade set
// (child-safety.ts strongPregnancy), and the messages that must behave as before (no notice). Ported with
// the check from TerraTutor #158, whose review rounds found the false-alarm forms below. Shared by
// child-safety.test.ts and kernel/systemPrompt-master.test.ts. Written for these tests; no real people,
// nothing from an eval set. Test fixtures only: no app code imports this file.

import corpus from "./child-safety-pregnancy-corpus.json";

/** The corpus shared with TerraTutor (its PR #161): every input of OpenEdu #342's reviews, TerraTutor #161's
 *  final reviews and TerraTutor's fixture lists, each tagged with where it came from. Copied unchanged from
 *  TerraTutor's pregnancyCorpus(); strong gets the notice for a K-12 learner, notStrong never does.
 *  acceptedExtraNotice gets the notice for a K-12 learner although it is not a disclosure: the lead's decision
 *  after TerraTutor #161's second final review. The notice never blocks, so a missed disclosure costs far more
 *  than an extra notice: there is no "pregnant with <thing>" guard ("im pregnant with tacos" with no laughing
 *  emoji gets one), and PRETEND_FRAME is not widened to pretend games set up in an earlier sentence ("we're
 *  playing school. im the teacher and im pregnant" gets one). */
export type CorpusEntry = { text: string; source: string };
export const PREGNANCY_CORPUS: { strong: CorpusEntry[]; notStrong: CorpusEntry[]; acceptedExtraNotice: CorpusEntry[] } = corpus;

/** The child about themselves: the first person, their own age, their own missed or late period, their own
 *  positive test. Spellings by shape, digits, spelled-out letters and the emoji. */
export const STRONG_PREGNANCY = [
  "am i pregnant", "am i pregnant? im 13", "i think i'm pregnant", "i think im pregnant what do i do", "i might be pregnant",
  "i may be pregnant and im scared", "could i be pregnant", "I'm pregnant", "im pregnant and scared", "i'm only 13 and i'm pregnant",
  "im 14 and pregnant", "i am 13 years old and pregnant", "im 12 yo and pregnant", "im really pregnant", "i got pregnant",
  "my boyfriend knocked me up", "i think im knocked up", "my mom thinks i'm pregnant",
  "am i prenant", "i think im pregnet", "am i pregnat", "am i preggo", "am i pr3gnant", "am i p r e g n a n t", "am i 🤰", "i'm 🤰",
  "i missed my period", "i missed my period and im 13", "missed my period help", "my period is late", "my period is 2 weeks late",
  "my period's like a week late", "my pregnancy test was positive", "my pregnancy test came back positive",
  "i took a pregnancy test and it was positive", "i got a positive pregnancy test", "my pregnacy test said positive",
];

/** OpenEdu PR #342 review, must-fix 1-3: someone else "got me pregnant", "having a baby" with the learner's own
 *  age in either order, and a plain disclosure next to an ordinary mention of a book, a game, a show, a play,
 *  "if i was", a laughing emoji or someone's words in another clause or sentence. */
export const REVIEW_342_STRONG = [
  "my boyfriend got me pregnant", "he got me pregnant", "i think he got me pregnant", "my boyfriend got me pregnant and im 14",
  "im 15 and having a baby", "i'm having a baby and i'm 15", "im 14 and im having a baby", "im 13 and going to have a baby",
  "i'm going to have a baby and im only 14",
  "I'm pregnant. Can you help with my book report?",
  "im 13 and i think im pregnant, im playing soccer tomorrow can i still play?",
  "i think im pregnant and i have to read a book for school", "im pregnant, my mom watches tv all day and doesnt care",
  "i think im pregnant and i cant stop playing with my hair im so nervous", "im pregnant and i dont want to go to the school play",
  "i think im pregnant. the nurse asked if i was ok", "im pregnant omg what do i do 😂😭",
  "my friend said i should take a test because i think im pregnant",
];

/** Review round 6, class 3 (false disclosures on the PR), and the forms the lead ruled not strong. */
export const REVIEW6_CLASS3 = [
  "my parents will have a baby in june, im 9!", "our family will have a baby in the spring and im 7",
  "my aunt is 45, can you have a baby at that age?", "can you have a baby at 50? my grandma wants to know",
  "is it ok to have a baby when you're 40? asking for my mom", "is it safe for you to have a baby after 35? my mom asked",
  "will i have babies one day?", "can i have babies someday?", "how long until i can have a baby?",
  "miss lee is pregnant, can i make her a card?", "ms. lee is pregnant! what gift can i make?",
  "my brother's girlfriend is pregnant and im going to be an aunt!", "how long are people pregnant? im a 3rd grader",
  "how long are humans pregnant? its for 6th grade", "why was hannah crying because she wasnt pregnant? i dont get it",
  "daisy is pregnant!! can i be there when the babies come?",
];
/** Review round 7, class A (false strong disclosures on the PR): a food-baby joke, someone else's words, pretend
 *  play, a game, a show, a school play and a school class period. No notice. */
export const REVIEW7_CLASS_A = [
  "i ate so much at thanksgiving i feel like im pregnant lol", "i ate so much i feel like im pregnant",
  "my mom came in and said im pregnant!! were having a baby", "my aunt called and said 'i'm pregnant!' so now im going to be a cousin",
  "my sister said i'm pregnant but she's 25 and married so its ok", "my teacher asked am i pregnant? as a joke when i ate 3 cupcakes",
  "on a tv show a lady said am i pregnant? and fainted, why?", "in toca boca i am pregnant and need to set up a nursery",
  "in gacha life im pregnant lol what should i name my baby", "im playing house with my sister and im pregnant",
  "i was pregnant in the school play", "i missed my period on monday, what did we learn in history?",
  "i missed my period with the sub so what was the homework",
];
/** Review round 8, class A, that its cheap guards cover: a laughing emoji or "food baby" (a joke), a language
 *  lesson, a hypothetical, and pretend play (doctor, hospital, a doll, halloween). */
export const REVIEW8_CLASS_A = [
  "i ate 4 slices of pizza and now im pregnant with a food baby 😂",
  "my brother keeps saying im pregnant cuz my belly is big 😂 can you help with spelling",
  "i ate so much im pregnant 😂", "im pregnant with a food baby", "after that burrito im pregnant 🤣🤣",
  "lets play doctor, im pregnant and you check on me", "lets play hospital, im pregnant and you are the nurse",
  "im a mommy and im pregnant with my baby doll", "i was pregnant for halloween and everyone laughed",
  "i was pregnant for halloween lol it was funny",
  "in spanish class we learned estoy embarazada means i am pregnant not im embarrassed! whats another false friend?",
  "how do you say i am pregnant in french? its for my vocab list", "how do you say i am pregnant in spanish",
  "when i grow up could i be pregnant with twins like my aunt?", "if i was a seahorse dad could i be pregnant?",
  "im a boy, could i be pregnant?",
];
/** Review round 8, class A, left strong (no cheap guard is clearly right for them). For a K-12 learner
 *  they cost one notice, never a blocked answer. */
export const REVIEW8_STILL_STRONG = [
  "my sister told me im pregnant because i ate so much", "my brother joked that im pregnant after thanksgiving dinner",
  "i put a pillow in my shirt so im pregnant like mommy", "is i am pregnant a complete sentence?",
  "if i got pregnant at 30 how old would i be when my kid is 12? its a math problem",
];
export const NOT_STRONG_PREGNANCY = [
  ...REVIEW6_CLASS3,
  ...REVIEW7_CLASS_A,
  ...REVIEW8_CLASS_A,
  "for halloween im going as a pregnant lady lol", "when my mom was pregnant with me i was born on christmas",
  "my mom thinks \"i'm pregnant\"", "my mom thinks i'm pregnant, were having a baby", "im pregnant jk", "i'm like pregnant haha",
  "i missed my period for the assembly", "i missed my period in class", "i missed my math period",
  "i missed my period, whats the homework", "my favorite show has a girl who says i'm pregnant",
  "my mom is pregnant", "my mom is pregnant and im so excited!", "im 9 and my mom is pregnant", "my teacher is pregnant! what gift can i make? im 7",
  "is my guinea pig pregnant", "my goat is pregnant! when will she have her babies?", "how long are humans pregnant? 6th grade science",
  "why did mary get pregnant? 3rd grade sunday school", "if i have a baby when im grown up what should i name it",
  "can i get pregnant from kissing?", "how do i get pregnant", "write a story where the queen says i'm pregnant",
  "in my book the girl asks am i pregnant", "i got pregnant in bitlife", "i missed my period 2 class", "i missed 2 periods today",
  "i missed my period because the bus was late", "my mom's pregnancy test was positive", "my covid test was positive",
  "sorry im late! can we do fractions?", "i think im late", "im not pregnant, my cat is", "my period hasn't come yet",
  "when will i get my period", "i'm so excited my mom is pregnant", "prego sauce or ragu?",
  // The #342 forms' quiet neighbours: a sibling or a doll, family news, and a guard in the cue's own clause.
  "im 7 and going to have a baby sister", "im 9 and were having a baby", "im 8 and having a baby doll party",
  "in my game the girl said im pregnant, then she had twins", "can you be the dad? im playing house and im pregnant",
  "i got pregnant in the sims. how do i make the baby come?", "my brother keeps saying im pregnant lol",
];

/** Having a baby "with" someone, next to the learner's own age (10 to 17), in either order: the notice for a
 *  K-12 learner, as in TerraTutor's same fix. One "with" phrase may sit between "a baby" and the age join:
 *  "with" a name or "him", or "with my / his / a / an / the ..." and up to three words before a person word (TerraTutor's
 *  WITH_SOMEONE, the same regex); never a parent or the family. */
export const BABY_WITH_STRONG = [
  "im having a baby with my boyfriend and im 15", "im going to have a baby with my boyfriend, im 16",
  "i'm having a baby with my bf and i'm 14", "im gonna have a baby with jake and im 13", "im having a baby with him, im only 15",
  "im having a baby with my ex and im 15", "i'm going to have a baby with the guy, im 15", "im having a baby with a boy, im 14",
  "im 15 and having a baby with my boyfriend", "i'm 16 and im going to have a baby with tyler",
  // The sync check of #344: the inputs where OpenEdu's first "with" rule and TerraTutor's disagreed.
  "i am having a baby with an older guy and i am only 14", "im having a baby with my 17 year old boyfriend, im 14",
  "im having a baby with an older man, im 13",
];
/** Their quiet neighbours: someone else's baby, a sibling or cousin, family news, an age under 10, pretend play. */
export const BABY_WITH_QUIET = [
  "my mom is having a baby with her boyfriend and im 15", "my sister is having a baby with her husband, im 16",
  "were having a baby with my stepdad, im 14", "im having a baby sister with my new stepdad, im 15",
  "im going to have a baby cousin, im 12", "im 8 and having a baby with my friend", "im having a baby with my doll and im 12",
  "lets play house! im having a baby with my brother and im 12", "im having a baby with my mom and im 11",
];
