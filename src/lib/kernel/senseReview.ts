// Lever 19, R1(b) (docs/BENCHMARKS.md): the senses the child-safety filter keeps but lever 18's caps never
// showed were read once before any run. A model of another family (openai/gpt-6-luna via OpenRouter) flagged
// 292 of 14,244; Claude read every flag on 2026-11-12. These are the ones removed, keyed by headword and the
// exact WordNet text, so nothing else moves. Rule applied: sexual or suggestive senses, contraception (as in
// lever 18), drug use and demeaning slang go; ordinary alcohol, gambling, bodily-function, crime, war and
// history vocabulary stays (the known keeps are listed in BENCHMARKS).

/** [headword, definition] pairs whose sense is not shown. */
export const REVIEWED_UNSAFE_SENSES: ReadonlyArray<readonly [string, string]> = [
  ["bag", "an ugly or ill-tempered woman"],
  ["ball", "one of the two male reproductive glands that produce spermatozoa and secrete androgens"],
  ["blue", "the sodium salt of amobarbital that is used as a barbiturate; used as a sedative and a hypnotic"],
  ["bottomless", "unclothed especially below the waist or featuring such nudeness"],
  ["bundle", "sleep fully clothed in the same bed with one's betrothed"],
  ["burning", "a form of torture in which cigarettes or cigars or other hot implements are used to burn the victim's skin"],
  ["bush", "hair growing in the pubic area"],
  ["cat", "the leaves of the shrub Catha edulis which are chewed like tobacco or used to make tea; has the effect of a euphoric stimulant"],
  ["cleavage", "the line formed by a groove between two parts (especially the separation between a woman's breasts)"],
  ["crab", "a louse that infests the pubic region of the human body"],
  ["dish", "a very attractive or seductive looking woman"],
  ["drop", "a predetermined hiding place for the deposit and distribution of illicit goods (such as drugs or stolen property)"],
  ["familiarity", "an act of undue intimacy"],
  ["habit", "excessive use of drugs"],
  ["head", "a user of (usually soft) drugs"],
  ["honor", "a woman's virtue or chastity"],
  ["honour", "a woman's virtue or chastity"],
  ["impropriety", "an act of undue intimacy"],
  ["kick", "the sudden stimulation provided by strong drink (or certain drugs)"],
  ["knocker", "either of two soft fleshy milk-secreting glandular organs on the chest of a woman"],
  ["liberty", "an act of undue intimacy"],
  ["nut", "one of the two male reproductive glands that produce spermatozoa and secrete androgens"],
  ["loop", "an intrauterine device in the shape of a loop"],
  ["looseness", "dissolute indulgence in sensual pleasure"],
  ["pig", "uncomplimentary terms for a policeman"],
  ["nobble", "disable by drugging"],
  ["pill", "a contraceptive in the form of a pill containing estrogen and progestin to inhibit ovulation and so prevent conception"],
  ["push", "sell or promote the sale of (illegal goods such as drugs)"],
  ["rhythm", "natural family planning in which ovulation is assumed to occur 14 days before the onset of a period (the fertile period would be assumed to extend from day 10 through day 18 of her cycle)"],
  ["retardation", "lack of normal development of intellectual capacities"],
  ["skirt", "informal terms for a (young) woman"],
  ["speed", "a central nervous system stimulant that increases energy and decreases appetite; used to treat narcolepsy and some forms of depression"],
  ["tempt", "try to seduce"],
  ["thong", "minimal clothing worn by stripteasers; a narrow strip of fabric that covers the pubic area, passes between the thighs, and is supported by a waistband"],
  ["trouble", "an unwanted pregnancy"],
  ["wanton", "engage in amorous play"],
];

/** [headword, example] pairs whose example is not quoted (the sense stays). */
export const REVIEWED_UNSAFE_EXAMPLES: ReadonlyArray<readonly [string, string]> = [
  ["blow up", "Her faced puffed up from the drugs"],
  ["cast", "The gypsies roamed the woods"],
  ["commit", "practice safe sex"],
  ["conjugation", "the casual couplings of adolescents"],
  ["culture", "the developing drug culture"],
  ["drink", "The husband drinks and beats his wife"],
  ["draw", "He ran his eyes over her body"],
  ["fill out", "The young woman is fleshing out"],
  ["identify", "Sex activity is closely identified with the hypothalamus"],
  ["mold", "The dress molds her beautiful figure"],
  ["mould", "The dress molds her beautiful figure"],
  ["puff", "Her faced puffed up from the drugs"],
  ["roll", "The gypsies roamed the woods"],
  ["slug", "he took a slug of hard liquor"],
  ["squeeze", "He pinched her behind"],
  ["twitch", "He pinched her behind"],
];

const key = (headword: string, text: string) => headword.toLowerCase() + '\u0000' + text;
const SENSES = new Set(REVIEWED_UNSAFE_SENSES.map(([h, t]) => key(h, t)));
const EXAMPLES = new Set(REVIEWED_UNSAFE_EXAMPLES.map(([h, t]) => key(h, t)));

export const reviewedUnsafeSense = (headword: string, definition: string): boolean => SENSES.has(key(headword, definition));
export const reviewedUnsafeExample = (headword: string, example: string): boolean => EXAMPLES.has(key(headword, example));
