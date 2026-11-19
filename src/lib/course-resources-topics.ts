// Course topics and subtopic titles the Resources tab is measured on (port of TerraTutor #253, which
// fixed TerraTutor #248). Each text is scored on its own, the way courseResources scores an anchor: the
// subject sweep a learner or parent would type (skills/subjectSweep.ts), every topic and title named in
// TerraTutor's #249 review and #248, and subtopic titles of the shape the course model writes. 139 texts.

import { MATH_SWEEP, SCIENCE_SWEEP, PHYSICS_SWEEP, OTHER_SWEEP } from "./skills/subjectSweep";

const NAMED = [
  "shapes", "algebra", "reading", "division", "plants", "animals", "economics", "chemistry", "biology",
  "grammar", "US Government", "Circles", "Scales and Keys", "Gravity", "Newton's Laws of Motion",
  "the periodic table", "Music Theory Basics", "Spanish for Beginners", "French 1", "Parts of Speech",
  "Nutrition and Healthy Habits", "Map Skills", "Supply and Demand", "Computer Science", "Sign Language Basics",
];

const SUBTOPIC_TITLES = [
  "What is Gravity?", "Newton's Law of Universal Gravitation", "Falling Objects",
  "What is a Fraction? Whole and Parts", "Defining Equal Parts", "Identifying the Numerator and Denominator",
  "What is a Cell? Defining Life and Non-Life", "Introduction to Cell Theory", "Parts of a Plant Cell",
  "Counting Objects to 20", "Naming 2D Shapes", "Sorting Shapes by Sides", "Reading a Map Scale",
  "The Three Branches of Government", "Checks and Balances", "Nouns and Verbs", "Long Division Steps",
  "Solving for x", "Reading Nutrition Labels", "Notes on the Staff", "Major and Minor Scales",
  "Speed and Velocity", "Forces and Motion", "Balancing Chemical Equations", "How Plants Make Food",
  "Animal Classification",
];

export const RESOURCE_TOPICS: string[] = [
  ...new Set([...MATH_SWEEP, ...SCIENCE_SWEEP, ...PHYSICS_SWEEP, ...OTHER_SWEEP.map(([t]) => t), ...NAMED, ...SUBTOPIC_TITLES]),
];

// Every card the Resources tab recommends for each text, judged by hand: each one is about the course.
// A text not listed gets none (the tab lists the Library A to Z). "Animal vs Plant Cell" for "plants" and
// "animals" is counted right (Fable's decision in TerraTutor #253: plant and animal cell structure is part
// of either unit). The test compares this exactly, so a card tag or alias edit that changes a pick fails
// it on purpose: update this list with the new judgement.
export const RIGHT_CARDS: Record<string, string[]> = {
  "Geometry": ["math/geometry-formulas"],
  "Multiplication Facts": ["math/multiplication-table"],
  "Times Tables": ["math/multiplication-table"],
  "Area and Perimeter": ["math/geometry-formulas"],
  "Exponents": ["math/laws-of-exponents"],
  "Linear Equations": ["math/linear-equation-forms"],
  "Probability": ["math/probability-statistics-sheet"],
  "Statistics": ["math/probability-statistics-sheet"],
  "The Coordinate Plane": ["math/coordinate-plane"],
  "Trigonometry": ["physics/vectors-and-trig-for-physics"],
  "Order of Operations": ["math/order-of-operations"],
  "The Water Cycle": ["earth-space/water-cycle"],
  "Photosynthesis": ["biology/photosynthesis-respiration"],
  "The Solar System": ["earth-space/solar-system-planets"],
  "The Human Body": ["biology/human-body-systems"],
  "Rocks and Minerals": ["earth-space/rock-cycle"],
  "Cells": ["biology/animal-plant-cell"],
  "Electricity and Circuits": ["physics/ohms-law-circuits"],
  "Physics of Motion": ["physics/kinematics-equations", "physics/projectile-motion", "physics/circular-and-rotational-motion"],
  "US States and Capitals": ["geography/us-states-map"],
  "World History": ["world-history/world-history-timeline"],
  "The American Revolution": ["us-history-civics/causes-of-the-american-revolution", "world-history/major-revolutions"],
  "Ancient Egypt": ["world-history/river-valley-civilizations"],
  "Geography": ["geography/landform-glossary"],
  "plants": ["biology/animal-plant-cell"],
  "animals": ["biology/animal-plant-cell"],
  "Circles": ["math/unit-circle"],
  "Newton's Laws of Motion": ["physics/newtons-laws-forces"],
  "the periodic table": ["chemistry/periodic-table"],
  "Parts of Speech": ["ela/parts-of-speech"],
  "Supply and Demand": ["economics/supply-and-demand"],
  "Parts of a Plant Cell": ["biology/animal-plant-cell"],
  "Reading a Map Scale": ["geography/map-symbols-and-legend"],
  "The Three Branches of Government": ["us-history-civics/three-branches-government"],
  "Checks and Balances": ["us-history-civics/three-branches-government"],
  "Nouns and Verbs": ["ela/parts-of-speech"],
  "Reading Nutrition Labels": ["health-pe/nutrition-facts-label"],
  "Notes on the Staff": ["music/grand-staff-and-clefs"],
  "Major and Minor Scales": ["music/major-minor-scales"],
  "Forces and Motion": ["physics/newtons-laws-forces", "physics/circular-and-rotational-motion"],
  "Balancing Chemical Equations": ["chemistry/reaction-types"],
};

// Wrong cards, each seen at the grounding floor or within 1.5 of it in TerraTutor, that must never be
// recommended. The first six were recommended before this fix: a one-word topic inside a longer alias
// ("flowchart shapes", "boolean algebra", "reading a label", "division of powers", "spelling alphabet").
export const WRONG_CARDS: Array<[string, string]> = [
  ["Shapes", "arts-music-cs/flowchart-symbols"],
  ["shapes", "arts-music-cs/flowchart-symbols"],
  ["algebra", "arts-music-cs/boolean-and-de-morgan"],
  ["reading", "health-pe/nutrition-facts-label"],
  ["division", "us-history-civics/federalism"],
  ["Spelling", "reference/nato-phonetic-alphabet"],
  ["Counting to 100", "spanish/numbers-0-100"],
  ["Counting to 100", "french/numbers-0-100"],
  ["Circles", "music/circle-of-fifths"],
  ["Scales and Keys", "geography/map-symbols-and-legend"],
  ["Plant Life Cycles", "earth-space/hr-diagram"],
  ["How Plants Make Food", "health-pe/myplate"],
];
