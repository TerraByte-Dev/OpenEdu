// A warning, never a block, for courses about health, first aid and medicine.
//
// Small local models have written first-aid courses with dangerous errors (the wrong choking
// technique for infants, the wrong burn care). Blocking the topic would also block a school health
// class, which is exactly what a community learning center needs, and a keyword list will always
// match some harmless topics. So a match only shows a notice. A false positive costs one line of text.
//
// Matched by code, not a model: a deterministic list is auditable and costs nothing on a CPU box.
// English plus the most common languages at the target centers. A miss in another language means
// no notice, never a block.

export const HEALTH_NOTICE =
  "Health topic. The AI tutor can get medical and first-aid facts wrong. Use this course to learn, " +
  "not to handle an emergency: in an emergency, call your local emergency number and follow a " +
  "trained person. Check what you learn with a health worker or a hands-on first-aid course.";

// Lower-case stems. A stem matches at the start of a word, so "injur" catches injury and injuries.
// A trailing "$" makes an entry match a whole word only: "stroke$" matches "stroke" but not "strokes"
// (swimming strokes, brush strokes).
// Words that collide with common school topics are left out or narrowed on purpose: "depression"
// (the Great Depression), "seizure" (search and seizure), "medic" (the Medici), "emergenc"
// (emergence), "aids" (teaching aids). Those topics would otherwise see the warning so often that
// students learn to ignore it.
const STEMS = [
  // English
  "first aid", "first-aid", "cpr", "resuscitat", "emergency", "emergencies", "choking", "bleed",
  "burn care", "burn injur", "burns first aid", "treating a burn", "treating burns", "broken bone",
  "fracture", "injur", "wound", "poison", "overdose", "snakebite", "snake bite", "drowning",
  "seizures", "epilep", "stroke$", "heart attack", "cardiac", "anaphyla", "allerg", "medica",
  "medicin", "paramedic", "drug", "dosage", "pharmac", "nursing", "nurse", "health", "anatomy",
  "physiolog", "human biology", "human body", "disease", "infect", "vaccin", "immunis", "immuniz",
  "malaria", "hiv", "tuberculosis", "cholera", "covid", "diabet", "hypertension", "pregnan",
  "childbirth", "newborn", "breastfeed", "midwif", "puberty", "menstrua", "contracept",
  "sex education", "sexual health", "reproductive health", "mental health", "suicid", "self-harm",
  "self harm", "herbal remed", "nutrition", "malnutrition", "dehydrat", "diarrh", "hygiene",
  "sanitation", "disinfect",
  // French
  "premiers secours", "secourisme", "santé", "médec", "médicament", "maladie", "blessure", "grossesse",
  // Spanish / Portuguese
  "primeros auxilios", "primeiros socorros", "salud", "saúde", "medicina", "medicamento", "enfermedad",
  "doença", "embarazo", "gravidez",
  // Swahili
  "huduma ya kwanza", "afya", "dawa", "ugonjwa", "magonjwa",
];

function normalise(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

// A stem counts only at the start of a word, so "hiv" does not match inside "archive".
const WORD_CHAR = /[\p{L}\p{N}]/u;
function startsWord(text: string, i: number): boolean {
  return i === 0 || !WORD_CHAR.test(text[i - 1]);
}
function endsWord(text: string, i: number): boolean {
  return i >= text.length || !WORD_CHAR.test(text[i]);
}

export function isHealthTopic(topic: string): boolean {
  const text = normalise(topic);
  if (!text) return false;
  return STEMS.some((entry) => {
    const whole = entry.endsWith("$");
    const stem = whole ? entry.slice(0, -1) : entry;
    for (let i = text.indexOf(stem); i !== -1; i = text.indexOf(stem, i + 1)) {
      if (startsWord(text, i) && (!whole || endsWord(text, i + stem.length))) return true;
    }
    return false;
  });
}
