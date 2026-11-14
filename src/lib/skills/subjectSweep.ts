// A sweep of course titles a K-12 learner or parent would type, each with the domain skill it should
// get. Click test 2026-11-14: a course called only "Fractions" got no math skill, so the tutor was
// never offered diagram.render and could not draw. trigger.test.ts runs every row through
// resolveDomainSkill. The titles were written before the fix, but the subject words were then chosen
// with them in view, so this list shows coverage, not accuracy. The held-out lists below are the
// honest measure.

export type SweepExpect = "math-tutor" | "science-tutor" | "code-tutor" | "music-tutor" | undefined;

export const MATH_SWEEP: string[] = [
  "Fractions",
  "Long Division",
  "Geometry",
  "Place Value",
  "Multiplication Facts",
  "Decimals",
  "Ratios and Proportions",
  "Fractions on a Number Line",
  "Telling Time",
  "Counting Money",
  "Addition and Subtraction within 20",
  "Counting to 100",
  "Skip Counting",
  "Times Tables",
  "Percentages",
  "Pre-Algebra",
  "Algebra 1",
  "Area and Perimeter",
  "Measurement",
  "Rounding and Estimation",
  "Word Problems",
  "Integers",
  "Exponents",
  "Linear Equations",
  "Graphing Lines",
  "Probability",
  "Statistics",
  "The Pythagorean Theorem",
  "Basic Arithmetic",
  "Mental Math",
  "Shapes",
  "Angles",
  "Equivalent Fractions",
  "The Coordinate Plane",
  "Trigonometry",
  "Calculus",
  "Order of Operations",
  "Negative Numbers",
  "Mixed Numbers",
  "Bar Graphs",
  "Even and Odd Numbers",
  "History of Mathematics",
];

export const SCIENCE_SWEEP: string[] = [
  "The Water Cycle",
  "Photosynthesis",
  "The Solar System",
  "Plant Life Cycles",
  "States of Matter",
  "The Human Body",
  "Weather and Climate",
  "Rocks and Minerals",
  "Food Chains",
  "Magnets",
  "Simple Machines",
  "Volcanoes",
  "Ecosystems",
  "Intro to Chemistry",
  "Cells",
  "Earth Science",
  "Biology",
  "Dinosaurs",
  "Electricity and Circuits",
  "Animal Habitats",
  "The Five Senses",
  "Life Science",
];

// Physics stays with math-tutor (its description: math/physics/engineering), as before.
export const PHYSICS_SWEEP: string[] = ["Physics of Motion", "Classical Physics"];

// Courses that must get no math or science skill.
export const OTHER_SWEEP: Array<[string, SweepExpect]> = [
  ["Phonics", undefined],
  ["Spelling", undefined],
  ["US States and Capitals", undefined],
  ["Reading Comprehension", undefined],
  ["Poetry", undefined],
  ["Creative Writing", undefined],
  ["Grammar", undefined],
  ["World History", undefined],
  ["The American Revolution", undefined],
  ["Civics", undefined],
  ["Spanish for Kids", undefined],
  ["Handwriting", undefined],
  ["Sight Words", undefined],
  ["Art History", undefined],
  ["Drawing", undefined],
  ["Ancient Egypt", undefined],
  ["Geography", undefined],
  ["Shakespeare", undefined],
  ["Public Speaking", undefined],
  ["Physical Education", undefined],
  ["Piano for Beginners", "music-tutor"],
  ["Python Programming", "code-tutor"],
];

// Held out: written by a separate agent that never saw the subject-word lists, after the fix. Not
// tuned against. Rows the fix still gets wrong are listed as misses in trigger.test.ts.
export const HELDOUT_MATH: string[] = [
  "Counting to 10", "Counting to 100", "Kindergarten Math", "Number Bonds", "Addition Facts", "Subtraction Within 20",
  "1st Grade Math", "Place Value", "Skip Counting", "Telling Time", "Money and Coins", "2nd Grade Math",
  "Multiplication Tables", "Long Division", "Fractions", "Adding Fractions with Unlike Denominators", "3rd Grade Math",
  "Measurement and Conversion", "Area and Perimeter", "Decimals", "Mental math tricks for my 4th grader",
  "Ratios and Proportions", "Percentages", "Order of Operations", "Geometry Basics", "Angles and Triangles",
  "Mean, Median, and Mode", "Intro to Probability", "Negative Numbers", "Pre-Algebra", "Solving Two-Step Equations",
  "Algebra 1", "Graphing Linear Equations", "Pythagorean Theorem", "Geometry Proofs", "Quadratic Functions",
  "Algebra 2", "Trigonometry", "Precalculus", "AP Calculus AB",
];

export const HELDOUT_SCIENCE: string[] = [
  "Plants", "Animal Habitats", "Kindergarten Science", "The Five Senses", "Weather and Seasons", "Life Cycles",
  "The Solar System", "Phases of the Moon", "Rocks and Minerals", "The Water Cycle", "3rd Grade Science",
  "States of Matter", "Food Chains and Ecosystems", "Human Body Systems", "The Digestive System",
  "Dinosaurs and Fossils", "Plate Tectonics", "Layers of the Earth", "Photosynthesis", "Cells and Organelles",
  "Intro to Chemistry", "The Periodic Table", "Chemical Reactions", "Acids and Bases", "Genetics and Heredity",
  "DNA and Protein Synthesis", "Evolution and Natural Selection", "Middle School Life Science", "High School Biology",
  "AP Chemistry",
];

export const HELDOUT_OTHER: Array<[string, SweepExpect]> = [
  ...[
    "Phonics", "Letter Sounds", "Learning to Read", "Sight Words", "Kindergarten Reading", "Rhyming Words",
    "Handwriting Practice", "Spelling for 2nd Grade", "Parts of Speech", "Grammar Basics", "Writing a Paragraph",
    "5th Grade Reading Comprehension", "Persuasive Essay Writing", "Creative Writing", "Poetry Writing",
    "Charlotte's Web", "A Wrinkle in Time", "Frankenstein", "The Giver", "Flowers for Algernon", "Hatchet",
    "Number the Stars", "The Phantom Tollbooth", "Edgar Allan Poe Short Stories", "Shakespeare for Kids",
    "American History", "Ancient Egypt", "Ancient Rome", "The American Revolution", "World Geography",
    "US States and Capitals", "Civics and Government", "Spanish for Beginners", "French 1", "Sign Language Basics",
    "Drawing for Beginners", "Physical Education Games", "Nutrition and Healthy Habits", "Study Skills and Note-Taking",
  ].map((t): [string, SweepExpect] => [t, undefined]),
  ["Music Theory Basics", "music-tutor"],
];
