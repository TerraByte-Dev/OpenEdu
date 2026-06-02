# OpenEdu Library — Curriculum Coverage Roadmap

> **Purpose.** A brainstorming launchpad for growing the curated Library from today's **15 cards** toward covering **US public-school curricula (K–12)**. Generated 2026-05-31 by a 12-domain fan-out + a coverage critic (236 candidate cards proposed). Treat this as a *starting map to react to and refine* — not a fixed backlog.

---

## Progress — batch 2 (2026-06-01)

Acted on the gating decisions (all chosen maximal): **lookup-tool layer → built in full**, **grade order → HS-staples first**, **batch → the full 25**, **maps → vendor public-domain outlines** (standing policy; no map card needed this batch). Shipped (PRs `openedu-library#3` + `OpenEdu#33`/#34):

- **`library.lookup` tool layer** + **12 deterministic datasets** (721 rows) — covers the Tool-flagged candidates: US presidents, US state facts, country profiles, currencies, landmark SCOTUS, chemical nomenclature, ES/FR vocabulary + verb conjugation, rulers/dynasties, wars/treaties, ASCII, number-base. (World **time zones** + **flags** intentionally deferred to capped cards — drift / image-license; rulers + wars shipped as labeled *curated subsets*.)
- **25 HS-staple cards** (library 15 → **40**): math (laws of exponents, parent functions, quadratic, trig identities, logs, linear forms, prob/stats), physics (kinematics, Newton's laws, energy/work, Ohm's law, EM spectrum), chemistry (electron config, reaction types, **pH** [chem owns], gas laws), biology (animal/plant cell, codon table, DNA/RNA, photosynthesis↔respiration), earth-space (solar system, H-R diagram), civics (three branches, amendments), CS (logic gates).
- **Duplicates resolved:** pH → chemistry, EM spectrum → physics. **Char-cap QA** added to `build-index.mjs`.
- **Deferred policies:** world-language scope locked to ES/FR for v1; ASL/Mandarin/etc. later. The remaining ~190 candidate cards below are still open.

---

## What a Library card IS (the design contract)

Keep proposals inside this contract or they won't fit the system:

- **A durable REFERENCE artifact** — the appendix + the wall charts (a table, formula sheet, labeled diagram, map, timeline, conjugation table, constant). **NOT** a lesson, a practice set, or a skill/standard statement.
- **Two renderings per card.** (1) A model-readable plain-text body, **capped to ~1800 chars** for the floor model (gemma4:e4b) — so **front-load the key facts**; the human Resources view gets the full body uncapped. (2) An authored **deterministic SVG** "raw form" — generated from curated data, **never AI-image-generated**, values exact + citable.
- **Bundled in-app, offline.** Authoring source is the `openedu-library` repo; generate SVGs with `scripts/build-assets.mjs`, then `npm run sync:library` in the app to refresh the bundled copy. See `openedu-library/AUTHORING.md`.

**Pick a representation per resource:**

| Form | Use when | Examples |
|---|---|---|
| **SVG** diagram | The artifact is inherently visual | periodic table, unit circle, cell diagram, world map |
| **Table** (text) | Tabular data that fits the ~1800 slice | constants, conjugations, Greek alphabet |
| **Tool** (lookup) | Dataset too big for the slice | all 195 capitals, full vocabulary, every element's detail |

> The **lookup-tool** option is the key scaling lever: for huge datasets a deterministic `lookup(x)` tool beats a truncated card — zero hallucination, zero context cost. Several candidates below are flagged **Tool** for this reason.

## Current 15 cards (shipped)

- **Chemistry:** periodic-table (all 118), polyatomic-ions, solubility-rules
- **Math:** multiplication-table, unit-circle, geometry-formulas, si-units
- **Physics:** constants
- **Geography:** continents-oceans, countries-capitals
- **Music:** circle-of-fifths
- **Reference:** greek-alphabet, morse-code, nato-phonetic-alphabet, roman-numerals

---

## The map — candidate cards by domain

*Legend: Form = SVG (diagram) / Table / Tool (lookup) / SVG+txt (mixed). Pri = High/Med/Low.*

### Mathematics — Elementary (K–5)

| Card | Grades | Form | Pri | What it is |
|---|---|---|---|---|
| Place Value Chart | K-5 | SVG | High | Columns from billions down to thousandths, showing each digit's place and value. |
| Properties of Operations | 3-5 | Table | High | Commutative, associative, distributive, identity, and zero properties with one example each. |
| Fraction-Decimal-Percent Equivalents | 3-5 | Table | High | Common fractions with their equivalent decimal and percent forms. |
| Fraction Wall (Equivalent Fractions Chart) | 2-5 | SVG | High | Stacked bars showing how halves, thirds, quarters, fifths, etc. partition one whole. |
| Customary & Metric Measurement Conversions | 3-5 | SVG+txt | High | Conversion factors within customary units and key customary-to-metric benchmarks. |
| Time & Clock Reference | 1-4 | SVG+txt | High | Analog clock face plus time-unit conversions (seconds, minutes, hours, days). |
| US Coins & Bills | K-2 | SVG+txt | High | Each US coin and common bills with their value and equivalences. |
| 2D Shapes Attributes Chart | K-4 | SVG | High | Common polygons and the circle with their number of sides, vertices, and key properties. |
| 3D Solids Attributes Chart | 1-5 | SVG | High | Common 3D solids with their faces, edges, and vertices counts. |
| Types of Lines & Angles | 3-5 | SVG | Med | Point, line, ray, segment, and the four basic angle types with their degree ranges. |
| Number Line Reference | K-5 | SVG | Med | Number lines for whole numbers, integers, and fractions between 0 and 1. |
| Number Names & Large Numbers | 1-5 | Table | Med | How to read and write numbers from ones up to the millions/billions in words. |
| Rounding & Estimation Rules | 3-5 | SVG+txt | Med | Place-value rounding rules with a number-line visual of the rounding midpoint. |
| Even & Odd / Divisibility Rules | 3-5 | Table | Med | Divisibility tests for 2, 3, 4, 5, 6, 9, and 10 with quick examples. |
| Data & Graph Types | 1-5 | SVG | Med | The basic graph types K-5 students read and make, each with a labeled mini-example. |
| Math Symbols & Vocabulary | K-5 | Table | Med | Operation and comparison symbols plus the name of each part of an equation. |
| Fact Families & Inverse Operations | 1-3 | SVG | Low | How addition/subtraction and multiplication/division fact families relate four facts. |
| Prime & Composite Numbers / Factor Chart | 4-5 | SVG+txt | Low | Primes up to 100 and the factor pairs of common numbers. |
| Roman & Standard Numeral Crosswalk (K-5 s… | K-3 | Table | Low | Small focused chart mapping standard numbers 1-100 to tally marks and ordinal words. |

### Mathematics — Secondary (6–12)

| Card | Grades | Form | Pri | What it is |
|---|---|---|---|---|
| Order of Operations & Properties of Opera… | 6-8 | Table | High | PEMDAS/GEMS evaluation order plus the commutative, associative, distributive, and identity/inv… |
| Integer & Signed-Number Rules | 6-8 | SVG | High | Sign rules for adding, subtracting, multiplying, and dividing positive and negative numbers, w… |
| Fraction & Rational-Number Operation Rules | 6-8 | Table | High | How to add, subtract, multiply, and divide fractions (common denominators, keep-change-flip) a… |
| Laws of Exponents | 8-11 | Table | High | Product, quotient, power-of-a-power, zero, negative, and fractional-exponent rules in one refe… |
| Special Products & Factoring Patterns | 8-11 | Table | High | Difference of squares, perfect-square trinomials, sum/difference of cubes, FOIL, and common fa… |
| Quadratic Reference Card | 9-11 | SVG+txt | High | The quadratic formula, discriminant cases, vertex form, axis of symmetry, and roots/sum-produc… |
| Linear Equation Forms & Slope | 8-10 | SVG+txt | High | Slope-intercept, point-slope, standard form, the slope formula, and parallel/perpendicular slo… |
| Parent Functions & Their Graphs | 9-12 | SVG | High | Standard graphs of linear, quadratic, cubic, absolute value, square-root, reciprocal, exponent… |
| Logarithm Rules & Properties | 10-12 | Table | High | Product, quotient, power, change-of-base rules; log<->exponential conversion; ln and common-lo… |
| Trigonometric Identities | 10-12 | Table | High | Pythagorean, reciprocal, quotient, even/odd, co-function, sum/difference, double-angle, and ha… |
| Coordinate Geometry Formulas | 8-11 | SVG | High | Distance, midpoint, slope, and the standard equations of a line and a circle in the plane. |
| Probability & Statistics Formula Sheet | 9-12 | SVG+txt | High | Mean, median, mode, range, variance/standard deviation, basic probability rules, combinations/… |
| Radical & Rational-Exponent Rules | 8-11 | Table | Med | Simplifying radicals, product/quotient rules, rationalizing denominators, and the radical<->fr… |
| Function Transformation Rules | 9-12 | SVG+txt | Med | How a*f(b(x-h))+k shifts, stretches, compresses, and reflects a parent graph. |
| Law of Sines & Law of Cosines | 10-12 | SVG | Med | The two oblique-triangle laws plus the triangle area formula (1/2)ab*sin(C) and when to use ea… |
| Squares, Cubes & Roots Table | 6-10 | Table | Med | Perfect squares and cubes (1-20+), their roots, and common irrational decimal approximations (… |
| Sequences & Series Formulas | 10-12 | Table | Med | Arithmetic and geometric nth-term and sum formulas, plus the infinite geometric sum and summat… |
| Derivative & Integral Rules | 11-12 | Table | Med | Power, product, quotient, and chain rules; derivatives/integrals of common functions; the powe… |

### Physics

| Card | Grades | Form | Pri | What it is |
|---|---|---|---|---|
| Kinematics Equations (1-D Motion) | 9-12 | SVG+txt | High | The four SUVAT equations of constant-acceleration motion with a variable key. |
| Forces & Newton's Laws Reference | 9-12 | SVG+txt | High | Newton's three laws plus the common force equations (weight, friction, spring, centripetal). |
| Energy & Work Equations | 9-12 | SVG+txt | High | Work, kinetic/potential energy, power, and the work-energy & conservation-of-energy relations. |
| Momentum & Impulse Reference | 9-12 | SVG+txt | High | Momentum, impulse, conservation of momentum, and elastic vs inelastic collisions. |
| Electromagnetic Spectrum | 6-12 | SVG | High | The EM spectrum bands from radio to gamma with wavelength, frequency, and uses. |
| Waves & Sound Equations | 6-12 | SVG+txt | High | Wave relationships (v=fλ), period/frequency, and the Doppler & wave-speed basics. |
| Ohm's Law & Circuit Equations | 9-12 | SVG+txt | High | Ohm's law, electric power, and series vs parallel resistance/capacitance rules. |
| Thermodynamics Equations & Laws | 9-12 | SVG+txt | High | The laws of thermodynamics, heat-transfer equations, and temperature-scale conversions. |
| Optics: Reflection, Refraction & Lenses | 9-12 | SVG | Med | Law of reflection, Snell's law, the thin-lens/mirror equation, and ray-diagram rules. |
| Electronic Component Symbols | 6-12 | SVG | Med | Standard schematic symbols for resistor, capacitor, battery, switch, diode, etc. |
| Ideal Gas & Gas Laws | 9-12 | Table | Med | PV=nRT plus Boyle's, Charles's, Gay-Lussac's, and the combined gas law. |
| Electric & Magnetic Field Equations | 11-12 | SVG+txt | Med | Coulomb's law, electric field/potential, and the magnetic force on charges and wires. |
| Projectile Motion Reference | 9-12 | SVG | Med | Independent x/y kinematics for projectiles, range, and max-height relations. |
| Vectors & Trigonometry for Physics | 9-12 | SVG | Med | Vector component resolution, magnitude, and the SOH-CAH-TOA relations used in physics. |
| Index of Refraction Table | 9-12 | Table | Low | Refractive index of common media with critical-angle context. |
| Kirchhoff's Laws | 9-12 | SVG | Low | Kirchhoff's current law (junction) and voltage law (loop) stated with a worked schematic. |
| Circular & Rotational Motion Reference | 11-12 | Table | Low | Uniform circular motion plus the rotational analogs of the linear kinematic quantities. |
| Physical Quantities & Their Units | 9-12 | Table | Low | Common physics quantities mapped to symbol, SI unit, and base-unit breakdown. |

### Chemistry

| Card | Grades | Form | Pri | What it is |
|---|---|---|---|---|
| Electron Configuration & Orbital Filling … | 9-12 | SVG | High | The aufbau diagonal-rule order (1s 2s 2p 3s 3p...), subshell capacities, and how to write/read… |
| Chemical Bonding Types (ionic, covalent, … | 9-12 (with … | SVG+txt | High | Side-by-side comparison of ionic, covalent (polar/nonpolar), and metallic bonds: what transfer… |
| Types of Chemical Reactions | 9-12 (intro… | Table | High | The five core reaction patterns — synthesis, decomposition, single replacement, double replace… |
| Balancing Equations & the Mole Map (stoic… | 9-12 | SVG | High | Step order for balancing equations and the grams-moles-particles-liters conversion 'mole map' … |
| The pH Scale | 6-12 (intro… | SVG | High | The 0-14 pH scale with acid/neutral/base regions, the pH = -log[H+] relationship, and example … |
| Strong Acids & Strong Bases | 9-12 | Table | High | The short memorize-list of the 6-7 strong acids and the strong (Group 1/2 hydroxide) bases — e… |
| Common Acids & Their Formulas | 9-12 | Table | High | Names and formulas of the acids that show up constantly: hydro- binary acids and the common ox… |
| Activity (Reactivity) Series of Metals | 9-12 | Table | High | Metals ranked most-to-least reactive (K..Au) plus the activity series of halogens, used to pre… |
| Gas Laws Reference | 9-12 | Table | High | Boyle's, Charles's, Gay-Lussac's, combined, and ideal gas laws with their equations, what's he… |
| Atom Anatomy & Bohr Models (first 20 elem… | 6-12 (intro… | SVG | Med | Labeled atom (proton/neutron/electron, nucleus, shells) plus shell electron counts (2,8,8...) … |
| Atomic Orbital Shapes (s, p, d) | 9-12 (AP/ad… | SVG | Med | The shapes and orientations of s, p, and d orbitals with their count and electron capacity per… |
| Electronegativity & Bond Polarity Guide | 9-12 | SVG+txt | Med | Pauling electronegativity values for common elements plus the difference cutoffs that classify… |
| Oxidation State (Oxidation Number) Rules | 9-12 (AP/ad… | Table | Med | The priority-ordered rules for assigning oxidation numbers, with the common fixed values for k… |
| Intermolecular Forces (London, dipole-dip… | 9-12 | Table | Med | The three intermolecular force types ranked by strength, what causes each, and which molecules… |
| Chemical Nomenclature Name<->Formula Look… | 9-12 | Tool | Med | A searchable lookup of compound name <-> chemical formula across ionic, covalent, and acid nam… |
| Organic Functional Groups | 9-12 (AP/ad… | SVG+txt | Low | Core functional groups (alkane through carboxylic acid, amine, ester...) with their structure … |
| Flame Test Colors | 9-12 (intro… | SVG | Low | The characteristic flame color produced by common metal ions (Li, Na, K, Ca, Sr, Ba, Cu...). |

### Biology & Life Science

| Card | Grades | Form | Pri | What it is |
|---|---|---|---|---|
| Animal vs Plant Cell Diagram | 6-12 | SVG | High | Labeled cutaway of an animal cell and a plant cell side by side, with each organelle named. |
| Organelle Functions Table | 6-12 | Table | High | Each cell organelle paired with its one-line function and whether it occurs in plant, animal, … |
| Levels of Biological Organization | 6-12 | SVG | High | The ordered hierarchy from atom up to biosphere, each level defined with an example. |
| Taxonomic Ranks (Linnaean Classification) | 5-12 | SVG+txt | High | The eight classification ranks from domain to species with a worked example (e.g., humans). |
| Genetic Code (Codon Table) | 9-12 | SVG | High | All 64 mRNA codons mapped to their amino acid, including START and the three STOP codons. |
| The 20 Standard Amino Acids | 9-12 | Table | High | The 20 protein-building amino acids with three-letter and one-letter codes and side-chain clas… |
| DNA / RNA Base Pairing and Structure | 8-12 | SVG | High | The four DNA bases, their complementary pairs, and the DNA-vs-RNA differences at a glance. |
| Punnett Square Reference | 7-12 | SVG | High | Worked monohybrid and dihybrid squares with the standard genotype/phenotype ratios and key ter… |
| Photosynthesis vs Cellular Respiration | 7-12 | SVG+txt | High | The two balanced equations side by side with reactants, products, location, and energy directi… |
| Human Body Systems | 5-12 | Table | High | The 11 organ systems with their main organs and primary function. |
| Carbon and Nitrogen Cycles | 7-12 | SVG | High | The two biogeochemical cycles diagrammed with their key reservoirs and transfer processes. |
| Trophic Levels and Energy Flow | 5-12 | SVG | High | The food-chain pyramid from producers to apex predators with the 10% energy rule. |
| Biological Macromolecules | 9-12 | Table | High | The four macromolecule classes with their monomers, elements, examples, and function. |
| Mitosis and Meiosis Phases | 8-12 | SVG | Med | The ordered stages of cell division side by side, with chromosome number and outcome. |
| Biomes of the World | 5-10 | Table | Med | The major terrestrial and aquatic biomes with their climate, location, and typical life. |
| Blood Type Genetics (ABO + Rh) | 9-12 | Table | Med | ABO and Rh blood types with genotypes, antigens, antibodies, and donor/recipient compatibility. |
| Plant Structure and Leaf Anatomy | 5-10 | SVG | Med | Labeled diagram of a flowering plant and a leaf cross-section with each part named. |
| Flower Parts and Pollination | 4-9 | SVG | Med | Labeled flower diagram naming the male and female reproductive structures. |
| Enzyme and pH / Temperature Reference | 9-12 | SVG+txt | Low | Enzyme basics plus optimal pH/temperature ranges and the pH values of common substances. |
| Six Kingdoms of Life | 6-10 | Table | Low | The kingdoms of living things with cell type, number of cells, nutrition mode, and examples. |

### Earth & Space Science

| Card | Grades | Form | Pri | What it is |
|---|---|---|---|---|
| The Rock Cycle | 4-8 | SVG | High | The cyclic diagram showing how igneous, sedimentary, and metamorphic rocks transform via melti… |
| The Water Cycle | K-8 | SVG | High | Labeled diagram of evaporation, transpiration, condensation, precipitation, collection/runoff,… |
| Plate Tectonic Boundary Types | 6-12 | SVG | High | The three plate-boundary types (convergent, divergent, transform) with cross-sections, motion … |
| Layers of the Earth | 4-8 | SVG | High | Cutaway of Earth's interior: crust, mantle, outer core, inner core, with depths, states, and c… |
| Layers of the Atmosphere | 4-8 | SVG | High | Stacked diagram of the troposphere, stratosphere, mesosphere, thermosphere, and exosphere with… |
| Mohs Hardness Scale | 4-9 | Table | High | The 1-10 mineral hardness scale (talc to diamond) with reference minerals and common scratch-t… |
| Weather Fronts | 5-12 | SVG+txt | High | The four front types (cold, warm, stationary, occluded) with their map symbols, cloud sequence… |
| Cloud Types and Altitudes | 3-9 | SVG | High | The main cloud genera grouped by altitude (high cirro-, mid alto-, low strato-/cumulus) with a… |
| The Solar System and Planet Data | 3-12 | SVG+txt | High | The 8 planets in order with diameter, distance from the Sun, day/year length, number of moons,… |
| Phases of the Moon | 1-8 | SVG | High | The 8 Moon phases in order with the Sun-Earth-Moon geometry that produces each and the ~29.5-d… |
| The HR Diagram and Star Life Cycle | 8-12 | SVG | High | The Hertzsprung-Russell diagram (luminosity vs temperature) with the main sequence, giants, su… |
| The Geologic Time Scale | 6-12 | SVG+txt | High | Eons, eras, and periods from the Hadean to the Holocene with approximate dates and the major l… |
| The Beaufort Wind Scale | 4-10 | Table | Med | The 0-12 Beaufort scale relating wind force to observable effects on land and sea, with speed … |
| Earthquake Magnitude Scales (Richter / Mo… | 6-12 | Table | Med | The earthquake magnitude scale with each whole-number step's energy ratio and typical observed… |
| Saffir-Simpson Hurricane Scale | 5-12 | Table | Med | The Category 1-5 hurricane wind scale with sustained-wind ranges and expected damage. |
| Seasons and Earth's Axial Tilt | 3-8 | SVG | Med | Diagram of Earth's 23.5-degree tilt and orbit explaining solstices, equinoxes, and why seasons… |
| Enhanced Fujita (EF) Tornado Scale | 5-12 | Table | Low | The EF0-EF5 tornado intensity scale with wind-speed estimates and damage indicators. |
| Eclipse Geometry (Solar and Lunar) | 5-10 | SVG | Low | Side-by-side Sun-Earth-Moon alignments for solar vs lunar eclipses, with umbra/penumbra and to… |

### English Language Arts

| Card | Grades | Form | Pri | What it is |
|---|---|---|---|---|
| Parts of Speech | 2-8 | Table | High | The eight parts of speech with definition, function, and an example word for each. |
| Verb Tenses Chart | 3-12 | Table | High | The 12 English verb tenses (simple/progressive/perfect/perfect-progressive across past/present… |
| Sentence Types and Structures | 3-9 | SVG+txt | High | The four sentence purposes (declarative/interrogative/imperative/exclamatory) and four structu… |
| Punctuation Marks Guide | 2-10 | Table | High | Each punctuation mark with its name and the core rule(s) for using it. |
| Comma Rules | 4-12 | Table | High | The main rules for comma usage (series, FANBOYS join, introductory element, nonrestrictive cla… |
| Common Literary Devices | 5-12 | Table | High | Glossary of literary devices (metaphor, simile, personification, imagery, symbolism, irony, fo… |
| Figurative Language Types | 3-9 | Table | High | The major figures of speech (simile, metaphor, hyperbole, personification, idiom, onomatopoeia… |
| Phonics: Digraphs and Blends | K-3 | Table | High | Consonant digraphs (sh, ch, th, wh, ph, ng), common blends, and vowel teams with a key word fo… |
| Prefixes Reference | 3-9 | Table | High | The most common English prefixes (un-, re-, dis-, pre-, mis-, sub-, inter-, anti-, etc.) with … |
| Suffixes Reference | 3-9 | Table | High | Common suffixes (-ed, -ing, -ly, -ness, -tion, -able, -ful, -ous, etc.) with their meaning/gra… |
| Greek and Latin Roots | 4-12 | Table | High | High-frequency Greek and Latin roots (bio, geo, port, dict, scrib, tele, photo, struct, etc.) … |
| Commonly Confused Words | 3-12 | Table | High | Frequently mixed-up word pairs (their/there/they're, your/you're, its/it's, affect/effect, the… |
| MLA Citation Format | 7-12 | Table | High | MLA 9th-edition Works Cited templates and in-text citation patterns for the common source type… |
| Rhetorical Devices and Appeals | 8-12 | Table | Med | Aristotle's appeals (ethos/pathos/logos) plus common rhetorical devices (anaphora, antithesis,… |
| Poetic Forms and Meter | 6-12 | SVG+txt | Med | Common poetic forms (sonnet, haiku, limerick, villanelle, ode, free verse) and metrical feet (… |
| Vowel Sounds and Spelling Patterns | K-4 | Table | Med | Short vs. long vowels, vowel teams, r-controlled vowels, and silent-e with example words for e… |
| Homophones Reference | 2-8 | Table | Med | Common homophones (to/too/two, hear/here, write/right, principal/principle, etc.) grouped with… |
| APA Citation Format | 9-12 | Table | Med | APA 7th-edition reference-list templates and in-text (Author, Year) citation patterns for comm… |
| Writing Process Stages | 2-10 | SVG | Med | The recursive writing process (prewriting, drafting, revising, editing, publishing) with what … |
| Proofreading and Editing Marks | 5-12 | SVG | Med | Standard copy-editing/proofreading symbols (delete, insert, transpose, new paragraph, capitali… |
| Point of View Reference | 4-10 | Table | Med | Narrative points of view (first person, second person, third-person limited/omniscient/objecti… |
| Spelling Rules Reference | 2-7 | Table | Low | Core English spelling rules (i before e, drop silent e before suffix, double the final consona… |

### U.S. History, Civics & Government

| Card | Grades | Form | Pri | What it is |
|---|---|---|---|---|
| The Three Branches of Government | 3-12 | SVG | High | Legislative, Executive, and Judicial branches — their powers, who holds them, and the checks e… |
| How a Bill Becomes a Law | 5-12 | SVG | High | The step-by-step path of federal legislation from introduction through committee, both chamber… |
| The 27 Amendments to the Constitution | 5-12 | Table | High | Every amendment with its number, year ratified, and one-line summary of what it does. |
| The Bill of Rights (First 10 Amendments) | 3-12 | Table | High | The ten amendments of 1791 with the protected right each guarantees, in plain language. |
| The 50 States and Abbreviations | 3-12 | Table | High | All 50 states with their USPS two-letter postal codes and capital cities. |
| US Presidents | 4-12 | Tool | High | Numbered list of all US presidents with years in office and political party. |
| Landmark Supreme Court Cases | 8-12 | Tool | High | Major Supreme Court decisions with year, the constitutional question, and the ruling's signifi… |
| US History Eras Timeline | 5-12 | SVG | High | The major eras of US history from colonization to the present, with date ranges and defining e… |
| The Electoral College and How Presidents … | 8-12 | SVG+txt | High | How the electoral process works — electors per state, the 270 threshold, and the primary-to-in… |
| Preamble to the Constitution | 5-12 | Table | Med | The full 52-word Preamble plus a plain-language gloss of its six stated purposes of government. |
| Causes and Key Events of the American Rev… | 5-12 | Table | Med | The chain from the French and Indian War debt through the major acts, protests, and battles to… |
| Civil War and Reconstruction Timeline | 5-12 | SVG | Med | Key dates, battles, and outcomes from secession through the Reconstruction amendments. |
| Federalism: Federal, State, and Local Pow… | 6-12 | SVG | Med | Which powers belong to the federal government, which to the states, and which are shared (conc… |
| Declaration of Independence: Structure an… | 5-12 | Table | Med | The four parts of the Declaration with the famous 'unalienable Rights' passage quoted verbatim. |
| Branches of Government: Qualifications an… | 7-12 | Table | Med | The constitutional requirements and term lengths for President, Senators, Representatives, and… |
| Articles of the Constitution | 7-12 | Table | Med | The seven articles of the original Constitution and what each establishes. |
| Founding Documents Comparison | 8-12 | Table | Low | Magna Carta, Declaration of Independence, Articles of Confederation, and the Constitution — ye… |
| How a Person Becomes a US Citizen / Right… | 6-12 | Table | Low | The naturalization requirements plus the core rights and civic duties of US citizens. |
| The Federal Government: Departments and A… | 7-12 | Table | Low | The 15 executive (Cabinet) departments and major independent agencies with what each oversees. |
| Major US Wars Timeline | 5-12 | SVG | Low | The principal wars the United States has fought, with date ranges, the opponents, and the outc… |

### World History

| Card | Grades | Form | Pri | What it is |
|---|---|---|---|---|
| World History Timeline (Eras at a Glance) | 6-12 | SVG | High | A single horizontal time-spine of major world-history periods from prehistory to the present w… |
| Ancient River-Valley Civilizations at a G… | 6-10 | Table | High | Comparison table of the four foundational river-valley civilizations: their river, region, dat… |
| Classical Civilizations Comparison | 7-12 | Table | High | Side-by-side reference for Greece, Rome, Han China, and Maurya/Gupta India: dates, government,… |
| Major World Religions Overview | 6-12 | Table | High | Comparison table of the major world religions: founder/origin, approximate date, sacred text, … |
| Age of Exploration: Explorers and Routes | 6-12 | SVG+txt | High | Reference of major European explorers with their sponsoring country, dates, and the route or l… |
| Major Revolutions Comparison | 8-12 | Table | High | Comparison table of the great political revolutions: American, French, Haitian, Latin American… |
| World War I at a Glance | 8-12 | SVG+txt | High | Reference card for WWI: dates, the two alliance blocs, principal causes (M.A.I.N.), and outcom… |
| World War II at a Glance | 8-12 | SVG+txt | High | Reference card for WWII: dates, Allied vs Axis powers, major theaters and turning points, and … |
| Abrahamic Religions Compared (Judaism, Ch… | 7-12 | Table | Med | Focused side-by-side of the three Abrahamic faiths: founding figure, scripture, place of worsh… |
| Columbian Exchange Reference | 6-12 | SVG | Med | Two-column chart of what crossed the Atlantic after 1492: foods, animals, and diseases moving … |
| European Empires and Colonial Holdings | 8-12 | SVG+txt | Med | Reference of the major colonial empires (Spanish, Portuguese, British, French, Dutch) with pea… |
| Industrial Revolution Key Inventions Time… | 7-12 | SVG | Med | Timeline of pivotal inventions and innovators of the Industrial Revolution from the steam engi… |
| Cold War Timeline and Key Events | 8-12 | SVG | Med | Timeline of the Cold War from 1947 to 1991 with its defining crises, blocs, and the fall of th… |
| Key Dates in World History | 6-12 | Table | Med | A curated list of the most-cited dates in world history — the milestones students are expected… |
| Rulers, Dynasties and Empires Lookup | 7-12 | Tool | Med | A deterministic lookup over major rulers, dynasties, and empires across civilizations — reign … |
| Mesoamerican and Andean Civilizations | 6-12 | Table | Med | Comparison of the major pre-Columbian American civilizations: Olmec, Maya, Aztec, and Inca — r… |
| The Silk Road and Trade Networks | 7-12 | SVG | Med | Labeled map of the Silk Road and major premodern trade routes connecting Asia, the Middle East… |
| Wars, Battles and Treaties Lookup | 8-12 | Tool | Low | A deterministic lookup over major wars and the treaties that ended them — combatants, dates, a… |
| Ancient Wonders and Landmark Structures | 6-10 | Table | Low | Reference of the Seven Wonders of the Ancient World plus a few enduring landmarks, with locati… |

### Geography & Economics

| Card | Grades | Form | Pri | What it is |
|---|---|---|---|---|
| World Political Map | K-12 | SVG | High | Labeled world map showing countries, major borders, and continents. |
| World Physical Map | 3-12 | SVG | High | Relief-style world map labeling major mountain ranges, rivers, deserts, and plains. |
| United States Map (50 States) | K-8 | SVG+txt | High | Map of the 50 US states with names, two-letter postal abbreviations, and capitals. |
| Latitude and Longitude | 3-12 | SVG | High | The graticule: equator, prime meridian, parallels and meridians, hemispheres, key lines. |
| Map Symbols and Legend | K-8 | SVG | High | Standard topographic/road-map symbols: compass rose, scale bar, roads, water, boundaries, elev… |
| Biomes and Climate Zones | 3-12 | SVG | High | Major terrestrial biomes (tundra, taiga, grassland, desert, rainforest, etc.) with temperature… |
| Landform Glossary | K-8 | SVG+txt | High | Labeled diagram and definitions of common landforms: mountain, valley, plateau, peninsula, del… |
| Supply and Demand | 6-12 | SVG | High | The supply and demand curves, equilibrium point, surplus/shortage, and what shifts each curve. |
| Personal Finance Reference | 6-12 | SVG+txt | High | Core financial-literacy figures: simple vs compound interest formulas, budgeting (50/30/20), c… |
| US State Facts Lookup | 3-12 | Tool | Med | Per-state reference: capital, postal code, statehood year/order, nickname, largest city. |
| World Time Zones | 5-12 | SVG+txt | Med | The 24 standard UTC offset zones with reference cities and DST notes. |
| Layers of the Earth | 3-12 | SVG | Med | Cross-section of Earth's interior: crust, mantle, outer core, inner core, plus atmosphere laye… |
| Largest Countries, Cities, Rivers, and Mo… | 3-12 | Table | Med | Superlative reference: largest countries by area/population, longest rivers, tallest mountains… |
| World Flags Lookup | K-12 | Tool | Med | Every national flag with country name, plus simple color/feature descriptions. |
| Factors of Production | 5-12 | Table | Med | The four factors (land, labor, capital, entrepreneurship) with definitions and examples. |
| Types of Economic Systems | 6-12 | Table | Med | Traditional, command, market, and mixed economies compared on who decides and who owns. |
| Economic Indicators Glossary | 8-12 | Table | Med | Key macro terms: GDP, GNP, inflation/CPI, unemployment rate, interest rate, recession. |
| Map Projections | 6-12 | SVG | Low | Common projections (Mercator, Robinson, equal-area, azimuthal) and what each distorts. |
| Koppen Climate Classification | 9-12 | Table | Low | The Koppen climate types (A,B,C,D,E) and their main subtypes with defining criteria. |
| World Currencies Lookup | 5-12 | Tool | Low | Each country's currency name and ISO code (USD, EUR, JPY, GBP...) with symbol. |
| US Demographic and Economic Figures | 5-12 | Table | Low | Snapshot constants: US population, number of states, GDP scale, federal minimum wage, etc. |

### World Languages

| Card | Grades | Form | Pri | What it is |
|---|---|---|---|---|
| Spanish Alphabet & Pronunciation | 6-12 (Spani… | Table | High | The Spanish alphabet with each letter's name and its IPA/English-approximation sound, includin… |
| French Alphabet & Pronunciation | 6-12 (Frenc… | Table | High | The French alphabet with letter names plus the accent marks (accent aigu, grave, circonflexe, … |
| Spanish Numbers 0-100 (and beyond) | 6-12 (Spani… | Table | High | Spanish cardinal numbers 0-20, the tens to 100, plus hundreds/thousands and the rules for form… |
| French Numbers 0-100 (and beyond) | 6-12 (Frenc… | Table | High | French cardinal numbers 0-20, tens to 100, including the vigesimal quirks soixante-dix, quatre… |
| Spanish Days, Months & Seasons | 6-12 (Spani… | Table | High | The 7 days, 12 months, and 4 seasons in Spanish (lowercase, masculine) with the date-format co… |
| French Days, Months & Seasons | 6-12 (Frenc… | Table | High | The 7 days, 12 months, and 4 seasons in French (lowercase, masculine) with the le + day date c… |
| Spanish ser vs. estar Conjugation | 7-12 (Spani… | SVG+txt | High | Present-tense conjugations of ser and estar side by side, with the canonical 'when to use whic… |
| Spanish Regular Verb Endings (-ar / -er /… | 7-12 (Spani… | Table | High | Present-tense ending tables for the three regular Spanish conjugation classes, with a model ve… |
| French être & avoir Conjugation | 7-12 (Frenc… | SVG+txt | High | Present-tense conjugations of être (to be) and avoir (to have) side by side — the two auxiliar… |
| French Regular -er Verb Conjugation | 7-12 (Frenc… | Table | High | Present-tense endings for regular -er verbs (the largest French verb class) with a model verb … |
| Spanish Subject & Object Pronouns | 7-12 (Spani… | Table | High | Spanish subject pronouns plus direct-object, indirect-object, and reflexive pronoun sets in on… |
| French Subject & Object Pronouns | 7-12 (Frenc… | Table | High | French subject, direct-object, indirect-object, reflexive, and stressed/disjunctive pronouns i… |
| Spanish Articles & Noun Gender | 6-12 (Spani… | Table | High | Definite/indefinite articles (el/la/los/las, un/una/unos/unas) with the gender-and-number agre… |
| French Articles & Noun Gender | 6-12 (Frenc… | Table | High | Definite (le/la/l'/les), indefinite (un/une/des), and partitive (du/de la/des) articles with g… |
| Latin & Greek Roots for English Vocabulary | 4-12 (ELA v… | Table | High | A table of high-frequency Latin and Greek roots, prefixes, and suffixes (e.g., bio-, geo-, -ol… |
| Spanish tener Conjugation & Idioms | 7-12 (Spani… | SVG+txt | Med | Present-tense conjugation of tener plus the high-frequency tener-idioms (tener hambre/sed/años… |
| Spanish Question Words & Greetings | 6-12 (Spani… | Table | Med | Spanish interrogatives (qué, quién, dónde, cuándo, por qué, cómo, cuánto) and core greeting/co… |
| French Question Words & Greetings | 6-12 (Frenc… | Table | Med | French interrogatives (qui, que, où, quand, pourquoi, comment, combien) and essential greeting… |
| Colors, Family & Body (Spanish core vocab) | 6-10 (Spani… | Table | Med | A curated high-frequency Spanish vocab card: ~12 colors, ~12 family members, and ~15 body part… |
| Colors, Family & Body (French core vocab) | 6-10 (Frenc… | Table | Med | A curated high-frequency French vocab card: ~12 colors, ~12 family members, and ~15 body parts… |
| Spanish/French Verb Conjugator (lookup to… | 8-12 (Spani… | Tool | Med | A deterministic generator that conjugates any regular (and common irregular) Spanish or French… |
| Thematic Vocabulary Lexicon (Spanish/Fren… | 6-12 (Spani… | Tool | Low | A deterministic searchable lexicon of high-frequency Spanish/French vocab organized by theme (… |

### Arts, Music & Computer Science

| Card | Grades | Form | Pri | What it is |
|---|---|---|---|---|
| Note and Rest Values | 3-12 | SVG | High | Duration tree of notes and matching rests from whole down to sixteenth, with beat counts in 4/… |
| Time Signatures | 4-12 | SVG+txt | High | What the top and bottom numbers mean, with common simple and compound meters and their beat gr… |
| Key Signature Chart | 5-12 | SVG | High | Each major key with the exact sharps or flats drawn on the staff, plus its relative minor. |
| The Grand Staff and Clefs | 2-9 | SVG | High | Treble and bass staves joined, with line/space note names, middle C, and ledger lines. |
| Color Wheel | K-12 | SVG | High | Primary, secondary, and tertiary colors arranged as a wheel with complementary and analogous r… |
| Elements and Principles of Art | K-12 | Table | High | The 7 elements of art and the principles of design with one-line definitions. |
| Number Base Converter (Binary / Decimal /… | 6-12 | Tool | High | Convert any value among binary, decimal, hexadecimal, and octal, with place-value reference. |
| ASCII Table | 7-12 | Tool | High | Printable ASCII characters 32-126 with decimal, hex, and the character, plus key control codes. |
| Logic Gate Truth Tables | 7-12 | SVG | High | AND, OR, NOT, NAND, NOR, XOR, XNOR with their symbols, boolean expressions, and truth tables. |
| MyPlate Food Groups | K-8 | SVG | High | USDA MyPlate's five food groups with proportions and example foods for a balanced meal. |
| The Scientific Method | 3-12 | SVG | High | The ordered steps of scientific inquiry from question to conclusion, with variable definitions. |
| Lab Safety Symbols | 6-12 | SVG | High | Common laboratory hazard and safety pictograms (GHS) with their meanings and required precauti… |
| Musical Intervals | 7-12 | Table | Med | The intervals within an octave by half-step count, with quality names (minor/major/perfect/aug… |
| Dynamics, Tempo, and Articulation Markings | 4-12 | Table | Med | Italian music terms and symbols for volume, speed, and articulation with their meanings. |
| Orchestral Instrument Families and Ranges | 4-12 | SVG+txt | Med | The four orchestra families with member instruments and approximate written pitch ranges. |
| Major and Minor Scale Patterns | 6-12 | Table | Med | The whole/half-step formulas for major, natural/harmonic/melodic minor scales. |
| Color Models: RGB and CMYK | 6-12 | SVG | Med | Additive (RGB/screen) vs subtractive (CMYK/print) color, with primaries and how they combine. |
| Boolean Operators and Truth-Logic Referen… | 8-12 | Table | Med | AND/OR/NOT/XOR semantics, De Morgan's laws, and operator precedence for boolean expressions. |
| Units of Digital Data | 5-12 | Table | Med | Bit through petabyte, the powers-of-2 vs powers-of-10 (KiB vs KB) distinction, and rough size … |
| Perspective and Composition Reference | 5-12 | SVG | Low | One-, two-, and three-point linear perspective with horizon line and vanishing points, plus ru… |
| Powers of Two Reference | 6-12 | Table | Low | Powers of two from 2^0 to 2^32 with decimal values and common computing landmarks. |
| Fitness Components and Target Heart Rate … | 6-12 | SVG+txt | Low | The 5 health-related fitness components plus the max-HR formula and training-zone percentages. |

---

## Recommended next batch (~25, highest leverage)

The critic's pick for what to build right after the current 15 — broad use across grades, foundational, diagram-friendly:

| # | Card | Domain | Why now |
|---|---|---|---|
| 1 | Place Value Chart | math-elementary | The single most-looked-up K-5 reference (billions to thousandths); diagram-native labeled grid; exact place n… |
| 2 | Fraction Wall (Equivalent Fractions Cha… | math-elementary | Iconic classroom wall chart spanning grades 2-5; deterministic stacked-bar SVG that small models cannot draw … |
| 3 | 2D Shapes Attributes Chart | math-elementary | Named-shape gallery with sides/vertices — distinct from the existing geometry-formulas card; K-4 staple; pure… |
| 4 | 3D Solids Attributes Chart | math-elementary | Faces/Edges/Vertices reference for the canonical solids; high-frequency 1-5 lookup; diagram-native and non-ov… |
| 5 | Time & Clock Reference | math-elementary | Labeled analog clock face plus time-unit conversions — a top K-4 staple combining 'read a clock' with second/… |
| 6 | US Coins & Bills | math-elementary | Core early-grades money reference (values + equivalences); deterministic SVG of each coin/bill; CCSS 2.MD.C.8… |
| 7 | The Coordinate Plane | math-elementary | Fills a flagged gap below the secondary coordinate-GEOMETRY card: axes, four quadrants, origin, (x,y) convent… |
| 8 | Order of Operations & Properties of Ope… | math-secondary | The most-referenced procedural rule in pre-algebra (PEMDAS + commutative/associative/distributive/identity); … |
| 9 | Integer & Signed-Number Rules | math-secondary | Perennial 6-8 stumbling block; number-line SVG + same-sign/different-sign grid; high look-up frequency across… |
| 10 | Laws of Exponents | math-secondary | Used continuously grade 8 through calculus; compact rule table students constantly misremember; exact rules b… |
| 11 | Parent Functions & Their Graphs | math-secondary | Wall-chart staple across 9-12; deterministic grid of labeled mini-graphs (linear/quadratic/cubic/abs/sqrt/rec… |
| 12 | Animal vs Plant Cell Diagram | biology | The single most-looked-up biology image (6-12); deterministic labeled cutaway SVG; pairs with an organelle-fu… |
| 13 | Levels of Biological Organization | biology | Fixed-order hierarchy atom-to-biosphere that students memorize; diagram-native nested ladder; broad 6-12 leve… |
| 14 | Photosynthesis vs Cellular Respiration | biology | The most-compared pair in biology (7-12); two balanced equations + mirror-cycle SVG; exact equations matter f… |
| 15 | DNA / RNA Base Pairing and Structure | biology | Core heredity reference (8-12); A-T/G-C, purines/pyrimidines, DNA-vs-RNA; double-helix SVG; foundational for … |
| 16 | Human Body Systems | biology | Classroom-staple lookup table of the 11 organ systems (5-12); bridges biology and health/PE coverage gap; bro… |
| 17 | The Three Branches of Government | us-history-civics | The most-referenced civics chart, used 3-12; checks-and-balances SVG; deterministic; civics currently has zer… |
| 18 | The Bill of Rights (First 10 Amendments) | us-history-civics | Taught and quizzed as a unit across grades; short fixed list ideal for a capped card; perennial 'which amendm… |
| 19 | The 50 States and Abbreviations | us-history-civics | Perennial 3-12 lookup (postal codes + capitals); labeled US-map SVG + table; resolve the civics/geography dup… |
| 20 | The Rock Cycle | earth-space | The canonical earth-science wall chart (4-8); three-node cycle SVG with labeled transformations; deterministi… |
| 21 | The Water Cycle | earth-space | Universal K-8 staple; labeled process SVG (evaporation/condensation/precipitation/collection); diagram-native… |
| 22 | The Solar System and Planet Data | earth-space | Highest-traffic astronomy lookup (3-12); 8-planet scale diagram + data table that fits the cap; deterministic… |
| 23 | Phases of the Moon | earth-space | Heavily-referenced 1-8 staple; orbital-geometry + 8-phase SVG; deterministic; targets a common misconception;… |
| 24 | Parts of Speech | ela | Foundational grammar wall chart (2-8); compact 8-row table students look up constantly; ELA currently has zer… |
| 25 | Color Wheel | arts-music-cs | Universal K-12 art-class wall chart; deterministic 12-hue SVG with complementary/analogous/warm-cool relation… |

## Gaps & under-covered areas

- K-2 foundational literacy/numeracy: no card for the English alphabet (uppercase/lowercase + letter formation), number words 0-20 with numeral/written/quantity, sight-word/Dolch lists, or a basic calendar (days/months) chart. The ELA phonics cards (digraphs, vowel sounds) start at the decoding stage and skip the pre-reading alphabet wall chart that every K-1 classroom posts.
- World languages beyond Spanish/French: ACTFL-tracked languages widely taught in US K-12 are entirely absent — Mandarin Chinese (pinyin tone chart, radicals, numbers), German (alphabet/articles/verb tables), American Sign Language (ASL fingerspelling alphabet — a true deterministic symbol chart like Morse/NATO), Latin (as an L2: declension/conjugation tables, distinct from the proposed English-vocab roots card), and Japanese (hiragana/katakana kana charts). At minimum an ASL fingerspelling chart and a Mandarin pinyin/tones chart are high-leverage staples.
- Non-Latin alphabets / writing systems as symbol charts: Cyrillic, Hebrew, and Arabic alphabets are deterministic letterform charts in the exact mold of the existing greek-alphabet/Morse/NATO cards, but none are proposed. Low-to-medium leverage but a natural fit for the format.
- Health & Physical Education is thin: only MyPlate and fitness-components/heart-rate were proposed. National Health Education Standards (NHES) staples missing — the Nutrition Facts label anatomy, food-group/serving reference, BMI/body-composition chart, basic first-aid/CPR steps reference, and the dimensions-of-wellness chart. Likely low priority but a real K-12 subject with zero coverage depth.
- Performing/visual arts beyond music + 2D visual art: NCAS covers four arts disciplines — Dance and Theatre have no candidates at all (e.g., stage/blocking-area diagram, basic dance-position chart). Genuinely low priority but flagged for completeness of NCAS coverage.
- Computer science breadth gaps: flowchart/pseudocode symbol chart (a deterministic symbol set like logic gates), basic networking/internet model (client-server, IP/DNS, OSI-lite), and a keyboard-shortcuts/keyboard-layout reference are common CSTA-aligned lookups not proposed.
- ELA structural/genre references: no card for text structures (cause-effect, compare-contrast, sequence, problem-solution), literary genres (fiction/nonfiction taxonomy), the parts of a paragraph/essay (intro-body-conclusion, thesis, topic sentence) as a static diagram, or the plot/narrative-arc (Freytag's pyramid) diagram. The plot-diagram in particular is a canonical wall chart and is diagram-native, yet absent.
- Math gap — coordinate plane / graphing fundamentals: the secondary set jumps to coordinate-geometry FORMULAS, but there is no elementary/middle 'parts of the coordinate plane' card (axes, four quadrants, origin, ordered-pair (x,y) convention) — a heavily-looked-up 5th-8th grade wall chart and a clean SVG.
- Math gap — fraction/operation algorithms as a worked reference and the GCF/LCM reference: divisibility and prime cards exist, but no GCF/LCM (and prime factorization) how-to reference, which is a high-frequency 4-7 lookup.
- Statistics/probability visual under-covered below high school: the secondary stats card is a formula sheet; there is no middle-grades data-display 'parts of a graph' or measures-of-center visual distinct from the elementary graph-gallery, and no probability basics (sample space, P(event)=favorable/total) visual for 6-8.
- Test/assessment reference sheets: the de-facto SAT/ACT/AP and state-test provided formula sheets (and the AP Physics/Chem equation tables) are exactly 'appendix' artifacts students look up; only partially emergent from the math/physics cards. Worth deciding whether to mirror an official provided-reference sheet verbatim.
- Cross-domain duplicate-resolution debt: several near-identical cards were proposed in multiple domains and need a single owner before scaling — 'Layers of the Earth' (earth-space AND geography-economics), 'Biomes' (biology, earth-space, geography-economics), the pH scale (chemistry AND biology enzyme card), 'Properties of Operations' (math-elementary AND math-secondary), the EM spectrum (physics), and the 50-states map/lookup (us-history-civics AND geography-economics). Pick the canonical home for each to avoid shipping redundant cards.

## Decisions to make before scaling (brainstorm prompts)

- Reference-only cards vs interactive lookup TOOLS: the domains flagged ~10 genuinely huge datasets for tools (all-country/state profiles, all flags, all currencies, all time zones, US presidents, landmark SCOTUS cases, rulers/dynasties, wars/treaties, ASCII, number-base converter, verb conjugator, thematic-vocab lexicon). Do we build the deterministic lookup-tool layer now, or ship only capped 'headline' cards for these and defer tools? This decision gates whether the library is a static card set or a static-cards-plus-query-engine.
- Grade-band sequencing: should the next batches prioritize K-5 foundational wall charts (place value, clock, coins, shapes, water/rock cycle, parts of speech) for breadth-of-coverage, or front-load the high-school formula/diagram staples (parent functions, exponents, trig identities, branches of government) that the heaviest tutoring traffic targets? Pick an explicit order so domains don't all ship grade-9-12 first.
- How many cards per subject is 'enough'? Each domain returned 14-23 candidates; total proposed is ~250+ cards. Set a per-subject cap (e.g., 'top 12 high-priority per subject for v1') and a global target so the curation effort and SVG-authoring load are bounded, rather than building every candidate.
- Duplicate ownership: assign a single canonical home for cross-domain repeats before authoring — Layers of the Earth (earth-space vs geography), Biomes (biology vs earth-space vs geography), pH scale (chemistry vs biology), Properties of Operations (math-elementary vs math-secondary), 50-states (civics vs geography), EM spectrum. Without this, multiple domains will independently author overlapping SVGs.
- World-language scope: lock the language set. Spanish + French were covered; do we add Mandarin, German, ASL, Latin, Japanese (ACTFL-tracked, widely taught), and at what depth? ASL fingerspelling and a Mandarin pinyin/tones chart are deterministic-SVG-native and high-leverage; the rest multiply the card count fast.
- Staleness policy for time-varying data: several proposed cards carry values that drift (US demographic/economic figures, minimum wage, adherent counts, citation-style editions like MLA 9th/APA 7th, modern country/political data). Define a 'dated + citable + periodic-refresh' policy and a max acceptable staleness, or exclude drift-prone cards from the offline bundle.
- SVG authoring pipeline and budget: every diagram-native card needs a hand-authored, deterministic, citable SVG (never AI-generated). What is the authoring throughput per batch, and is there a template/component library so the ~80+ diagram cards across domains share consistent styling and the ~1800-char text body stays in sync with the SVG data source?
- Char-cap and 'front-loaded facts' QA: confirm the ~1800-char model-readable body cap and whether borderline cards (codon table 64 entries, 27 amendments, geologic time, planet data) are validated against the cap and against gemma4:e4b's ability to quote them accurately, or whether some should auto-promote to lookup tools when they overflow.

### Critic's notes

> Grounded the analysis against the live library: confirmed the 15 existing cards in C:\\Users\\tatew\\Desktop\\Tate\\TerraByte Solutions LLC\\Production\\Products\\OpenEdu\\public\\library\\index.json and the card format (YAML frontmatter + capped plain-text body + deterministic SVG asset) in public\\library\\resources\\ and public\\library\\assets\\. The 12 domain lists total ~250+ candidates; quality is high and the dataset-vs-card flags are consistent across domains (the existing countries-capitals card already samples rather than enumerates, validating the lookup-tool pattern). topNextBatch is deliberately weighted toward (a) subjects with ZERO current coverage (civics, ELA, biology, earth-space, arts) to broaden the library footprint, and (b) the most-looked-up, diagram-native, multi-grade staples within each, rather than concentrating in already-covered math/chemistry. The biggest scaling risks are duplicate ownership across domains and the undecided lookup-tool layer — both are in scopingQuestions and should be resolved before the next production batch. Did not write any files per instructions; current branch is feat/31-library-visual-assets.

---

## How to add a card (pipeline)

1. Create `openedu-library/resources/<subject>/<slug>.md` — frontmatter (`id/title/aliases/tags/subject/summary/asset`) + a compact body that **front-loads** the model-critical facts.
2. If it has a visual: add a renderer + curated data to `openedu-library/scripts/build-assets.mjs`, run `node scripts/build-assets.mjs`, set the `asset:` field.
3. `node scripts/build-index.mjs` to refresh `index.json`.
4. In the app: `npm run sync:library` to refresh the bundled `public/library/`, then commit both repos.

Data must be deterministic + citable (e.g. the periodic table is built from a vetted `elements.json`, not from a model). See `openedu-library/AUTHORING.md` → "Visual raw forms (SVG)".
