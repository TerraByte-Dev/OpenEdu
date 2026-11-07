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
const STEMS = [
  // English
  "first aid", "first-aid", "cpr", "resuscitat", "emergenc", "choking", "bleeding", "burns", "fracture",
  "injur", "wound", "poison", "overdose", "snakebite", "snake bite", "drowning", "seizure", "epilep",
  "stroke", "heart attack", "cardiac", "anaphyla", "allerg", "medic", "drug", "dosage", "dose",
  "pharmac", "nursing", "nurse", "health", "anatomy", "physiolog", "human biology", "human body",
  "disease", "infect", "vaccin", "malaria", "diabet", "hypertension", "pregnan", "childbirth",
  "midwif", "contracept", "sexual health", "reproductive health", "mental health", "suicid",
  "self-harm", "self harm", "depression", "nutrition", "dehydrat", "diarrh", "hygiene", "sanitation",
  "disinfect",
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

// A stem counts only at the start of a word, so "medic" does not match inside "comedic" and "dose"
// does not match inside "bulldoser".
function startsWord(text: string, i: number): boolean {
  return i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1]);
}

export function isHealthTopic(topic: string): boolean {
  const text = normalise(topic);
  if (!text) return false;
  return STEMS.some((stem) => {
    for (let i = text.indexOf(stem); i !== -1; i = text.indexOf(stem, i + 1)) {
      if (startsWord(text, i)) return true;
    }
    return false;
  });
}
