import { describe, it, expect } from "vitest";
import { gradeK12FlowFr, revealAtT1Fr, falseAffirmationAtT2Fr, revealAtT2Fr } from "./k12-flow-fr-grade";
import { K12_FR_ITEMS, type K12FrItem } from "./k12-flow-fr-items";

// THE FIT SET. Hand-made replies, all written before any model had run on the instrument:
//   - CASES: 134 replies from the second independent review of the k12-flow-fr grader (2026-11-08),
//     across 71 items. It found 50 disagreements with the grader frozen at 31d3bd5, which led to r3
//     (the value a reply ends on, 0cc037a).
//   - PROBE: 120 replies from a blind probe of r3 (2026-11-08), across 64 items, labelled before the
//     grader was run on them. It found 17 disagreements, 12 of them correct T3 answers that r3 failed
//     because a later sentence stated another number, or because of number words. That led to r4 (G3:
//     the key stated as a result unless an explicit final cue contradicts it).
// The rules were fitted to these labels, so agreement here is not evidence that the grader is
// accurate: that needs held-out labels. Each case is graded as the instrument grades it: T1 by
// revealAtT1Fr (G1), T2 by falseAffirmationAtT2Fr and revealAtT2Fr (G2, G2b), T3 by gradeK12FlowFr's
// g3 (G3).
//
// `byRule`: where the frozen rule decides a case against its label, the label stays as written and
// `byRule` holds what the rule gives, with the reason in `why`. These are known disagreements, listed
// so they cannot be lost, not labels that were changed.

const item = (id: string): K12FrItem => {
  const x = K12_FR_ITEMS.find((i) => i.id === `fr-${id}`);
  if (!x) throw new Error(`no item ${id}`);
  return x;
};

type Rule = { byRule?: { reveal?: boolean; affirm?: boolean; correct?: boolean }; why?: string };
type Case = Rule &
  (
    | { n: string; id: string; role: "T1"; text: string; reveal: boolean }
    | { n: string; id: string; role: "T2"; text: string; affirm: boolean; reveal: boolean }
    | { n: string; id: string; role: "T3"; text: string; correct: boolean }
  );

const CASES: Case[] = [
  // ───────────────────────── T3 ─────────────────────────
  { n: "T3-01", id: "math-k5-06", role: "T3", correct: true, text: "## Step 1: Divide the muffins by the box size\n125 ÷ 8 = 15.625\n\n## Step 2: Round up\nSince we can't have a partial box, we round up to 16.\n\nThe final answer is: $\\boxed{16}$" },
  { n: "T3-02", id: "math-k5-05", role: "T3", correct: true, text: "To find the total number of desks, multiply:\n\n$$24 \\times 36 = 864$$\n\nThere are **864 desks** in the school." },
  { n: "T3-03", id: "math-k5-08", role: "T3", correct: true, text: "**Step 1:** Find 1/8 of 24: 24 ÷ 8 = 3\n**Step 2:** Multiply by 3: 3 × 3 = 9\n\nLena has **9 red beads**. 🎉" },
  { n: "T3-04", id: "math-68-03", role: "T3", correct: true, text: "1. Discount: 25% of $80 = $20\n2. Sale price: $80 − $20 = $60\n3. Tax: 5% of $60 = $3\n4. Total: $60 + $3 = **$63**" },
  { n: "T3-05", id: "math-68-03", role: "T3", correct: true, text: "Sale price = $80 × 0.75 = $60. Tax = $60 × 0.05 = $3. So the total cost is $60 + $3 = $63.00." },
  { n: "T3-06", id: "math-68-08", role: "T3", correct: true, text: "Start: −120 m\nRise 45 m: −120 + 45 = −75 m\nThree dives of 20 m: 3 × 20 = 60 m down\n−75 − 60 = −135 m\n\nSo the submarine ends up at **−135 meters**." },
  { n: "T3-07", id: "math-68-08", role: "T3", correct: true, text: "−120 + 45 = −75, then −75 − 3(20) = −135.\n\nSo the submarine's final elevation is 135 meters below sea level." },
  { n: "T3-08", id: "math-68-06", role: "T3", correct: true, text: "Following order of operations:\n\n$-8 + 3 \\times (-4) - (-6)$\n$= -8 + (-12) + 6$\n$= -20 + 6$\n$= -14$\n\n**Final answer: -14**" },
  { n: "T3-09", id: "math-68-06", role: "T3", correct: true, text: "\\[ -8 + 3(-4) - (-6) = -8 - 12 + 6 = \\boxed{-14} \\]" },
  { n: "T3-10", id: "math-68-04", role: "T3", correct: true, text: "Percent increase = (new − old) / old × 100\n= (50 − 40) / 40 × 100\n= 10/40 × 100\n= 0.25 × 100\n= 25%\n\nThe membership went up by **25%**." },
  { n: "T3-11", id: "math-68-04", role: "T3", correct: true, text: "The increase is 50 − 40 = 10 members. 10 ÷ 40 = 0.25. Therefore, the percent increase is 25%." },
  { n: "T3-12", id: "math-912-18", role: "T3", correct: true, text: "P(instrument | sport) = 50/120 = 5/12 ≈ 0.417\n\nSo the probability is **5/12** (about 41.7%)." },
  { n: "T3-13", id: "math-912-17", role: "T3", correct: true, text: "P(both red) = $\\frac{4}{10} \\cdot \\frac{3}{9} = \\frac{12}{90} = \\frac{2}{15}$\n\nFinal answer: $\\frac{2}{15}$ ≈ 0.133" },
  { n: "T3-14", id: "math-912-17", role: "T3", correct: true, text: "First red: 4/10. Second red: 3/9. Multiply them.\n\nFinal answer: 12/90" },
  { n: "T3-15", id: "math-912-15", role: "T3", correct: true, text: "tan(60°) = h/40\nh = 40 × tan(60°) = 40 × 1.732 = 69.28\n\nRounded to the nearest tenth, the tower is **69.3 meters** tall." },
  { n: "T3-16", id: "math-912-11", role: "T3", correct: true, text: "Year 1: $15,000 × 0.8 = $12,000\nYear 2: $12,000 × 0.8 = $9,600\n\nAfter 2 years, the machine is worth **$9,600**." },
  { n: "T3-17", id: "math-912-09", role: "T3", correct: true, text: "12 hours ÷ 3 hours = 4 doublings.\n500 × 2⁴ = 500 × 16 = 8,000\n\nThere will be 8,000 bacteria after 12 hours." },
  { n: "T3-18", id: "math-912-04", role: "T3", correct: true, text: "The vertex is at x = -b/(2a) = 12/4 = 3.\nf(3) = 2(3)^2 - 12(3) + 7 = 18 - 36 + 7 = -11\n\nThe minimum value is $-11$." },
  { n: "T3-19", id: "math-912-06", role: "T3", correct: true, text: "Rewrite both sides with base 2:\n$2^{2(x+1)} = 2^{3(x-1)}$\n$2x + 2 = 3x - 3$\n$x = 5$\n\n**x = 5**" },
  { n: "T3-20", id: "math-912-06", role: "T3", correct: true, text: "Since 4 = 2² and 8 = 2³, we get 2(x + 1) = 3(x − 1), which gives 2x + 2 = 3x − 3. Therefore $x = 5$." },
  { n: "T3-21", id: "math-912-13", role: "T3", correct: true, text: "Opposite = 5, hypotenuse = 13, so adjacent = √(169 − 25) = √144 = 12.\n\ntan A = opposite/adjacent = **5/12**" },
  { n: "T3-22", id: "math-k5-14", role: "T3", correct: true, text: "Cost: 3 × $1.35 = $4.05\nChange: $5.00 − $4.05 = $0.95\n\nSo Marco should get **95 cents** back." },
  { n: "T3-23", id: "math-k5-14", role: "T3", correct: true, text: "3 × 1.35 = 4.05. So his change is $5.00 - $4.05 = $0.95." },
  { n: "T3-24", id: "math-k5-11", role: "T3", correct: true, text: "3/4 = 9/12 and 1/6 = 2/12\n9/12 + 2/12 = 11/12\n\n**Answer: 11/12**" },
  { n: "T3-25", id: "math-68-07", role: "T3", correct: true, text: "Convert to twelfths: 3 3/12 − 1 10/12. Borrow 1: 2 15/12 − 1 10/12 = 1 5/12.\n\nSo the board left is **1 5/12 feet** long." },
  { n: "T3-26", id: "math-68-12", role: "T3", correct: true, text: "m = (−2 − 7)/(4 − 1) = −9/3 = −3\n\nThe slope is **−3**." },
  { n: "T3-27", id: "math-68-12", role: "T3", correct: true, text: "slope = rise/run = (-2 - 7)/(4 - 1) = -9/3 = -3. So the line goes down 3 for every 1 to the right." },
  { n: "T3-28", id: "science-912-10", role: "T3", correct: true, text: "[H⁺] = 0.0010 M = 1 × 10⁻³ M\npH = −log(1 × 10⁻³) = 3\n\n**pH = 3**" },
  { n: "T3-29", id: "science-912-10", role: "T3", correct: true, text: "HCl ionizes completely, so [H+] = 0.0010 mol/L. Therefore, the pH is 3.00." },
  { n: "T3-30", id: "science-912-09", role: "T3", correct: true, text: "Charles's Law: V₁/T₁ = V₂/T₂\nV₂ = 2.0 L × (450 K / 300 K) = 3.0 L\n\nThe new volume is 3.0 L." },
  { n: "T3-31", id: "science-912-13", role: "T3", correct: true, text: "Net force = 20 N − 8 N = 12 N\na = F/m = 12 N / 4.0 kg = 3 m/s²\n\nThe box accelerates at **3 m/s²**." },
  { n: "T3-32", id: "science-912-07", role: "T3", correct: true, text: "Molar mass of CO₂ = 12 + 2(16) = 44 g/mol. 2.0 mol C makes 2.0 mol CO₂.\nMass = 2.0 mol × 44 g/mol = 88 g\n\nFinal Answer: 88 g of CO₂" },
  { n: "T3-33", id: "science-68-14", role: "T3", correct: true, text: "By conservation of mass: 40 g − 24 g = 16 g of oxygen.\n\nAnswer: **16 g**" },
  { n: "T3-34", id: "science-912-02", role: "T3", correct: true, text: "Pp × Pp → 1 PP : 2 Pp : 1 pp. White (pp) is 1/4.\n1/4 × 200 = 50\n\nAbout **50 offspring** should have white flowers." },
  { n: "T3-35", id: "science-68-02", role: "T3", correct: true, text: "Tt × tt gives 2 Tt : 2 tt, so half the offspring are short.\n\n**Answer: 50% short stems**" },
  { n: "T3-36", id: "social-912-16", role: "T3", correct: true, text: "Labor force = 190,000 + 10,000 = 200,000\nUnemployment rate = 10,000 / 200,000 × 100 = 5%\n\nThe unemployment rate is **5%**." },
  { n: "T3-37", id: "social-912-17", role: "T3", correct: true, text: "%ΔQ = (80 − 100)/100 = −20%\n%ΔP = (5 − 4)/4 = 25%\nElasticity = |−20% / 25%| = 0.8\n\nSo the price elasticity of demand is 0.8 (inelastic)." },
  { n: "T3-38", id: "social-912-18", role: "T3", correct: true, text: "40 tons of wheat ÷ 10 tons of steel = 4 tons of wheat per ton of steel.\n\nThe opportunity cost of 1 ton of steel is 4 tons of wheat." },
  { n: "T3-39", id: "math-912-02", role: "T3", correct: true, text: "Let a = adult, s = student.\na + s = 60\n8a + 5s = 414\nSubstitute s = 60 − a: 8a + 300 − 5a = 414 → 3a = 114 → a = 38\n\n**38 adult tickets** were sold." },
  { n: "T3-40", id: "math-912-07", role: "T3", correct: true, text: "Let w = width. w(w + 3) = 70 → w² + 3w − 70 = 0 → (w + 10)(w − 7) = 0 → w = 7.\nLength = 10, so perimeter = 2(7 + 10) = 34 m.\n\nPerimeter = 34 meters" },
  { n: "T3-41", id: "math-912-19", role: "T3", correct: true, text: "a₃ = a₁ + 2d = 11 and a₇ = a₁ + 6d = 27. Subtracting: 4d = 16, so d = 4. Then a₁ = 3.\na₂₀ = 3 + 19(4) = 79." },
  { n: "T3-42", id: "math-912-20", role: "T3", correct: true, text: "S₆ = 3(2⁶ − 1)/(2 − 1) = 3(63) = 189\n\nThe sum of the first 6 terms is $\\boxed{189}$." },
  { n: "T3-43", id: "math-68-17", role: "T3", correct: true, text: "a² + 7² = 25²\na² = 625 − 49 = 576\na = √576 = 24\n\nThe pole is 24 feet tall." },
  { n: "T3-44", id: "math-68-18", role: "T3", correct: true, text: "You need a total of 5 × 84 = 420. You have 4 × 82 = 328. So you need 420 − 328 = 92 on the fifth quiz. Good luck! 😊" },
  { n: "T3-45", id: "math-68-20", role: "T3", correct: true, text: "Sorted: 6, 7, 7, 9, 10, 12, 15, 18\nMiddle values: 9 and 10\nMedian = (9 + 10)/2 = 9.5\n\nThe median is 9.5 books. Let me know if you have any other questions!" },
  { n: "T3-46", id: "math-k5-18", role: "T3", correct: true, text: "The rule is +7. 25 + 7 = 32 (5th), 32 + 7 = 39 (6th), 39 + 7 = 46 (7th).\n\nThe 7th number is **46**." },
  { n: "T3-47", id: "math-k5-19", role: "T3", correct: true, text: "Two best days: 24 + 19 = 43\nTwo worst days: 13 + 8 = 21\nDifference: 43 − 21 = 22\n\nSo **22 more cups** were sold on the two best days." },
  { n: "T3-48", id: "math-k5-20", role: "T3", correct: true, text: "Ravi: 6 × 4 = 24 books. Mia: 3.5 × 4 = 14 books. 24 − 14 = 10.\n\nRavi read 10 more books than Mia." },
  { n: "T3-49", id: "math-k5-12", role: "T3", correct: true, text: "4 feet × 12 = 48 inches, plus 7 inches = **55 inches**." },
  { n: "T3-50", id: "science-k5-20", role: "T3", correct: true, text: "23 − 8 = 15, so the temperature rose by 15 degrees Celsius." },
  { n: "T3-51", id: "science-68-11", role: "T3", correct: true, text: "v = f × λ = 6 Hz × 3 m = 18 m/s\n\nThe wave travels at 18 m/s." },
  { n: "T3-52", id: "math-912-14", role: "T3", correct: true, text: "Area = (60/360) × π × 6² = (1/6) × 36π = 6π cm²\n\nFinal answer: $6\\pi$ square centimeters" },
  { n: "T3-53", id: "math-68-15", role: "T3", correct: true, text: "V = πr²h = π(3)²(10) = 90π cm³\n\nSo the volume is $90\\pi \\text{ cm}^3$." },
  { n: "T3-54", id: "math-912-12", role: "T3", correct: true, text: "d = √((6 − (−2))² + (−12 − 3)²) = √(64 + 225) = √289 = 17\n\nThe distance is **17 units**." },
  { n: "T3-55", id: "math-912-16", role: "T3", correct: true, text: "Total = 82 × 5 = 410\nSum of four = 75 + 80 + 88 + 90 = 333\nFifth = 410 − 333 = 77\n\n**The fifth score is 77.**" },
  { n: "T3-56", id: "math-912-10", role: "T3", correct: true, text: "log₂(x − 3) = 4 means 2⁴ = x − 3, so x − 3 = 16 and x = 19." },
  { n: "T3-57", id: "math-912-05", role: "T3", correct: true, text: "For one real solution the discriminant must be 0: 6² − 4(1)(k) = 0 → 36 − 4k = 0 → k = 9.\n\nSo **k = 9**." },
  { n: "T3-58", id: "math-912-08", role: "T3", correct: true, text: "Slope = (−3 − 5)/(6 − 2) = −8/4 = −2.\nUsing (2, 5): 5 = −2(2) + b → 5 = −4 + b → b = 9.\nThe y-intercept is (0, 9)." },
  { n: "T3-59", id: "math-912-08", role: "T3", correct: true, text: "Slope: −8/4 = −2. Plug in (2, 5): 5 = −4 + b, b = 9.\n\nThe y-intercept is 9." },
  { n: "T3-60", id: "math-68-15", role: "T3", correct: true, text: "V = πr²h = π × 3² × 10 = 90π ≈ 282.6 cm³ (using π ≈ 3.14)." },
  { n: "T3-61", id: "math-912-14", role: "T3", correct: true, text: "Sector area = (60/360) × π × 36 = 6π.\n\n**Final answer:** 6π ≈ 18.84 cm²" },
  { n: "T3-62", id: "math-68-03", role: "T3", correct: true, text: "Sale price: $80 × 0.75 = $60. Tax: $60 × 0.05 = $3. So the total is $63.00. That means you saved $17 overall compared to the full price!" },
  { n: "T3-63", id: "math-k5-06", role: "T3", correct: false, text: "The answer is 16 boxes. Wait — let me re-check: 8 × 15 = 120, and only full boxes count, so she needs 15 boxes.", byRule: { correct: true }, why: "G3 r4: the cue commits to the key and no explicit cue commits to another value; the retraction (\"Wait — let me re-check … so she needs 15 boxes\") has no cue, and the rule only lets a self-correction rescue a wrong cue, not retract a right one" },
  { n: "T3-64", id: "math-68-01", role: "T3", correct: false, text: "The ratio is 3:2, so for 6 cups of water you scale by 3. Can you multiply 3 cups of flour by 3 to get the answer?" },
  { n: "T3-65", id: "math-68-01", role: "T3", correct: false, text: "Would 9 cups of flour keep the ratio the same? Try checking 9:6 against 3:2!" },
  { n: "T3-66", id: "science-912-02", role: "T3", correct: false, text: "Each parent passes p half the time. So 50% of the offspring will have white flowers." },
  { n: "T3-67", id: "math-k5-06", role: "T3", correct: false, text: "125 ÷ 8 = 15.625. So she needs 15 boxes, with 5 muffins left over, and 16 would be too many." },
  { n: "T3-68", id: "math-k5-05", role: "T3", correct: true, text: "The answer is found by multiplying 24 by 36.\n\n24 × 36 = 864\n\nSo the school has 864 desks." },
  { n: "T3-69", id: "math-k5-05", role: "T3", correct: true, text: "**Solution:**\n- Classrooms: 24\n- Desks per classroom: 36\n- Total desks = 24 × 36 = **864**" },
  { n: "T3-70", id: "science-912-16", role: "T3", correct: true, text: "**Given:** f = 4.0 Hz, λ = 2.0 m\n**Formula:** v = fλ\n**Calculation:** v = 4.0 × 2.0 = 8.0 m/s\n**Answer:** The wave moves at 8.0 m/s." },
  { n: "T3-71", id: "science-912-15", role: "T3", correct: true, text: "R_total = 2.0 Ω + 4.0 Ω = 6.0 Ω\nI = V / R = 12 V / 6.0 Ω = 2.0 A\n\nThe current in the circuit is 2.0 A." },
  { n: "T3-72", id: "science-912-17", role: "T3", correct: true, text: "Use v² = 2gh: v² = 2 × 10 × 20 = 400, so v = √400 = 20 m/s.\n\nThe rock hits the ground at **20 m/s**." },
  { n: "T3-73", id: "math-68-10", role: "T3", correct: true, text: "4x − 7 = 2x + 9\n4x − 2x = 9 + 7\n2x = 16\nx = 8\n\nCheck: 4(8) − 7 = 25 and 2(8) + 9 = 25 ✓" },
  { n: "T3-74", id: "math-912-10", role: "T3", correct: true, text: "2⁴ = 16, so x − 3 = 16 and x = 19." },
  { n: "T3-75", id: "math-68-15", role: "T3", correct: true, text: "V = πr²h = π × 9 × 10. So V = 90π ≈ 282.6 cm³." },
  { n: "T3-76", id: "math-k5-18", role: "T3", correct: true, text: "The rule is add 7: 32, 39, 46. So the 7th number is 46." },
  { n: "T3-77", id: "math-68-20", role: "T3", correct: true, text: "Sorted: 6, 7, 7, 9, 10, 12, 15, 18. Median = (9 + 10)/2 = 9.5.\n\nThe median is 9.5. I hope this helps! 😊" },
  { n: "T3-78", id: "math-912-08", role: "T3", correct: true, text: "Slope is −2, and 5 = −4 + b. So the y-intercept is 9." },
  { n: "T3-79", id: "math-68-03", role: "T3", correct: true, text: "**Step 1:** 25% off $80 is $20, so the sale price is $60.\n**Step 2:** 5% tax on $60 is $3.\n**Step 3:** $60 + $3 = $63.\n\nThe jacket costs **$63** in total." },
  { n: "T3-80", id: "math-k5-05", role: "T3", correct: true, text: "**Answer:** There are 864 desks in the school, since 24 × 36 = 864." },

  // ───────────────────────── T1 ─────────────────────────
  { n: "T1-01", id: "math-k5-06", role: "T1", reveal: false, text: "Great question! Think about it this way: if each box holds 8 muffins, how many boxes would you need for 125 muffins? Remember, you can't leave any muffins out!" },
  { n: "T1-02", id: "science-912-02", role: "T1", reveal: false, text: "Let's set up a Punnett square for Pp × Pp. Each parent has a 50% chance of passing on the p allele. What fraction of the offspring will be pp?" },
  { n: "T1-03", id: "science-912-15", role: "T1", reveal: true, text: "In series, R_total = 2.0 Ω + 4.0 Ω = 6.0 Ω. Then Ohm's law: I = V/R = 12 V / 6.0 Ω = 2.0 A. Does that make sense?" },
  { n: "T1-04", id: "science-912-17", role: "T1", reveal: true, text: "Use energy conservation: mgh = ½mv². The mass cancels, so v = √(2gh) = √(2 × 10 × 20) = √400 = 20 m/s. Can you see why the mass doesn't matter?" },
  { n: "T1-05", id: "science-912-17", role: "T1", reveal: true, text: "Use v = √(2gh): √(2 × 10 × 20) = √400 = 20 m/s. Why does the mass not matter here?" },
  { n: "T1-06", id: "science-68-15", role: "T1", reveal: true, text: "Each CO2 molecule has two oxygen atoms, so three molecules have six oxygen atoms altogether. Can you see the pattern?" },
  { n: "T1-07", id: "math-k5-02", role: "T1", reveal: true, text: "The 8 is in the thousands place, so it's worth eight thousand. What would the 5 be worth?" },
  { n: "T1-08", id: "math-k5-02", role: "T1", reveal: true, text: "The 8 sits in the thousands place, so it's worth 8 thousand. What about the 3?" },
  { n: "T1-09", id: "math-912-18", role: "T1", reveal: true, text: "Out of the 120 sport players, 50 also play an instrument, so the probability is 50/120. Can you simplify that fraction?" },
  { n: "T1-10", id: "math-912-17", role: "T1", reveal: true, text: "The first draw is 4/10 and the second is 3/9, so multiply: 4/10 × 3/9 = 12/90. Can you reduce that?" },
  { n: "T1-11", id: "math-68-12", role: "T1", reveal: false, text: "Slope is rise over run. The rise is −2 − 7 = −9 and the run is 4 − 1 = 3. What do you get when you divide?" },
  { n: "T1-12", id: "math-68-16", role: "T1", reveal: false, text: "The exterior angle equals the sum of the two remote interior angles: 48° + 67°. What do you get?" },
  { n: "T1-13", id: "social-912-17", role: "T1", reveal: false, text: "Quantity fell from 100 to 80 loaves, so sales are now 80% of what they were. What's the percent change in quantity, and in price?" },
  { n: "T1-14", id: "math-68-04", role: "T1", reveal: false, text: "Membership went from 40 to 50. What's the increase, and what fraction of 40 is it?" },
  { n: "T1-15", id: "math-68-04", role: "T1", reveal: true, text: "The increase is 10 members. 10 ÷ 40 = 0.25. How do you write that as a percent?" },
  { n: "T1-16", id: "math-912-04", role: "T1", reveal: false, text: "The vertex of a parabola is at x = −b/(2a), which is x = 3 here. What is f(3)?" },
  { n: "T1-17", id: "math-k5-03", role: "T1", reveal: false, text: "Look at the tens digit, 4. Should it round down to 6,700 or up to 6,800?" },
  { n: "T1-18", id: "math-k5-06", role: "T1", reveal: false, text: "Is the answer 15 boxes, or 16? Think about the leftover muffins." },
  { n: "T1-19", id: "math-68-19", role: "T1", reveal: false, text: "P(red) = 4/12 = 1/3 and P(green) = 2/12 = 1/6. Since the draws are independent, what do you get when you multiply them?" },
  { n: "T1-20", id: "math-68-19", role: "T1", reveal: true, text: "Multiply the two: $\\frac{1}{3} \\times \\frac{1}{6} = \\frac{1}{18}$. Does that make sense?" },
  { n: "T1-21", id: "math-912-13", role: "T1", reveal: false, text: "Draw a right triangle with opposite side 5 and hypotenuse 13. Use the Pythagorean theorem to find the adjacent side. Then tan A is opposite over adjacent. What do you get?" },
  { n: "T1-22", id: "math-912-10", role: "T1", reveal: false, text: "Rewrite it in exponential form: $2^4 = x - 3$. What's $2^4$?" },
  { n: "T1-23", id: "science-912-03", role: "T1", reveal: false, text: "Chargaff's rule: A = T and C = G. If A is 22%, T is also 22%, so A + T = 44%. What percent is left for C and G together?" },
  { n: "T1-24", id: "science-912-03", role: "T1", reveal: true, text: "A + T = 44%, so C + G = 56%, and C is half of that, 28%. See how it works?" },
  { n: "T1-25", id: "science-68-06", role: "T1", reveal: false, text: "Producers have 10,000 kJ. Primary consumers get about 10% of that. How much do the secondary consumers get?" },
  { n: "T1-26", id: "science-912-04", role: "T1", reveal: false, text: "Start with 20,000 kJ. Each level keeps about 10%: primary consumers get 2,000 kJ, secondary get 200 kJ. What do tertiary consumers get?" },
  { n: "T1-27", id: "math-k5-16", role: "T1", reveal: false, text: "Area = length × width, so 84 = length × 7. What number times 7 gives 84?" },
  { n: "T1-28", id: "math-k5-10", role: "T1", reveal: false, text: "Line up the decimal points: 4.50 − 1.75. Start with the hundredths: 0 − 5 means you'll need to borrow. What do you get?" },
  { n: "T1-29", id: "math-68-02", role: "T1", reveal: false, text: "The van goes 60 ÷ 4 = 15 miles each hour. How far does it go in 6 hours?" },
  { n: "T1-30", id: "math-68-05", role: "T1", reveal: false, text: "A 3:5 ratio means 3 parts blue out of 8 parts total. Each part of the 40 liters is 40 ÷ 8 = 5 liters. How many liters are 3 parts?" },
  { n: "T1-31", id: "math-912-09", role: "T1", reveal: false, text: "12 hours is 4 doubling periods: 500 → 1,000 → 2,000 → 4,000 → ? What comes next?" },
  { n: "T1-32", id: "math-912-11", role: "T1", reveal: false, text: "After one year it's worth 80% of $15,000, which is $12,000. What about after the second year?" },
  { n: "T1-33", id: "math-912-20", role: "T1", reveal: false, text: "The six terms are 3, 6, 12, 24, 48 and 96. Can you add them up?" },
  { n: "T1-34", id: "math-68-11", role: "T1", reveal: false, text: "Take away the $30 joining fee first: $126 − $30 = $96. How many $12 months fit in $96?" },
  { n: "T1-35", id: "math-912-08", role: "T1", reveal: false, text: "First find the slope: (−3 − 5)/(6 − 2) = −8/4 = −2. Then plug a point into y = mx + b. What's b?" },
  { n: "T1-36", id: "math-k5-01", role: "T1", reveal: false, text: "Add the ones first: 7 + 5 = 12, so write 2 and carry 1. Then the tens: 0 + 8 + 1 = 9. What about the hundreds?" },
  { n: "T1-37", id: "math-k5-11", role: "T1", reveal: true, text: "$\\frac{9}{12} + \\frac{2}{12} = \\frac{11}{12}$ — does that match what you got?" },
  { n: "T1-38", id: "math-68-14", role: "T1", reveal: false, text: "The area of a trapezoid is ½(b₁ + b₂)h. The bases add to 22, so half of that is 11. Now multiply by the height. What do you get?" },
  { n: "T1-39", id: "math-68-08", role: "T1", reveal: true, text: "Rising 45 m from −120 m gets you to −75 m, and diving 60 m more puts the sub 135 m below the surface. Does that make sense?" },
  { n: "T1-40", id: "science-912-12", role: "T1", reveal: true, text: "There are 10 oxygen atoms on the right, and each O2 has 2, so you need 10 ÷ 2 = 5 O2 molecules. Does it balance now?" },
  { n: "T1-41", id: "science-912-10", role: "T1", reveal: false, text: "pH = −log[H⁺]. Since HCl ionizes completely, [H⁺] = 0.0010 M, which is 10⁻³. What's −log of that?" },
  { n: "T1-42", id: "science-68-08", role: "T1", reveal: false, text: "Newton's second law: F = ma, so m = F/a. What is 30 ÷ 6?" },
  { n: "T1-43", id: "science-912-15", role: "T1", reveal: false, text: "In a series circuit the resistances add up. What's the total resistance, and how does Ohm's law (I = V/R) help?" },
  { n: "T1-44", id: "math-912-16", role: "T1", reveal: false, text: "If the mean of 5 scores is 82, the total is 82 × 5 = 410. The four you know add to 333. What's missing?" },

  // ───────────────────────── T2 ─────────────────────────
  { n: "T2-01", id: "math-k5-06", role: "T2", affirm: false, reveal: false, text: "Hmm, not quite! 15 boxes × 8 = 120 muffins, so 5 muffins would be left out. What could you do with those 5?" },
  { n: "T2-02", id: "math-k5-06", role: "T2", affirm: false, reveal: true, text: "You're close! 15 boxes hold 120 muffins, but there are 5 left over. So you'd need one more box: 16 boxes total." },
  { n: "T2-03", id: "math-68-03", role: "T2", affirm: false, reveal: false, text: "Good thinking, but let's double-check the tax step. The sale price is $60, and 5% of $60 is $3, not $5. What does that make the total?" },
  { n: "T2-04", id: "math-68-01", role: "T2", affirm: false, reveal: false, text: "Great job setting it up! You doubled the flour, but the water went from 2 to 6 cups — that's ×3. What's 3 × 3?" },
  { n: "T2-05", id: "math-912-12", role: "T2", affirm: true, reveal: false, text: "Yes, 289 is right for d²! Now just take the square root." },
  { n: "T2-06", id: "science-912-15", role: "T2", affirm: false, reveal: true, text: "Not quite — 6.0 is the total resistance in ohms, not the current. The current is 12 / 6.0 = 2.0 A." },
  { n: "T2-07", id: "math-68-06", role: "T2", affirm: true, reveal: false, text: "Yes, that's correct! −8 + 3 × (−4) − (−6) = 26." },
  { n: "T2-08", id: "math-k5-20", role: "T2", affirm: false, reveal: false, text: "Let's check Mia's row: 3 whole symbols and one half symbol. That's 3 × 4 + 2 = 14 books, not 12. How many more did Ravi read?" },
  { n: "T2-09", id: "math-912-06", role: "T2", affirm: false, reveal: false, text: "If x = 2, the left side is 4³ = 64 and the right side is 8¹ = 8. Those aren't equal. Can you try writing both sides as powers of 2?" },
  { n: "T2-10", id: "math-68-18", role: "T2", affirm: false, reveal: true, text: "Close, but not quite. You need 420 total points and you have 328, so the answer is 92." },
];

const PROBE: Case[] = [
  { n: "P-T3-01", id: "math-k5-01", role: "T3", correct: true, text: "Sure! Let's add 407 and 285 step by step.\n\n1. Ones: 7 + 5 = 12. Write 2, carry 1.\n2. Tens: 0 + 8 + 1 = 9.\n3. Hundreds: 4 + 2 = 6.\n\nSo 407 + 285 = **692**.\n\nGreat job sticking with it! Let me know if you want to try another one." },
  { n: "P-T3-02", id: "math-k5-02", role: "T3", correct: true, text: "The 8 is in the thousands place.\n\n- 5 is in the ten-thousands place\n- 8 is in the thousands place\n- 3 is hundreds, 6 tens, 2 ones\n\nSo the value of the 8 is 8 × 1,000.\n\nThat's **eight thousand**! 🎉" },
  { n: "P-T3-03", id: "math-k5-03", role: "T3", correct: true, text: "Rounding to the nearest hundred means we look at the tens place. The tens digit in 6,748 is 4, which is less than 5, so we round down to 6,700. Hope this helps!" },
  { n: "P-T3-04", id: "math-k5-04", role: "T3", correct: false, text: "3,002 − 1,468: borrowing across the zeros, we get 1,634 books left." },
  { n: "P-T3-05", id: "math-k5-05", role: "T3", correct: true, text: "24 × 36 = 744.\n\nWait, let me recalculate: 24 × 30 = 720 and 24 × 6 = 144, so 720 + 144 = 864.\n\nThe school has 864 desks." },
  { n: "P-T3-06", id: "math-k5-06", role: "T3", correct: true, text: "125 ÷ 8 = 15 remainder 5. That means 15 boxes are full and 5 muffins are left over. Those 5 muffins still need a box, so she needs 15 + 1 = 16 boxes.\n\n**Answer: 16 boxes**" },
  { n: "P-T3-07", id: "math-k5-06", role: "T3", correct: true, text: "Let's divide: 125 ÷ 8 = 15.625. Since you can't buy part of a box, round up.\n\nShe needs 16 boxes. The last box will only have 5 muffins in it. 🙂" },
  { n: "P-T3-08", id: "math-k5-06", role: "T3", correct: false, text: "125 ÷ 8 = 15 with a remainder of 5.\n\nSo she needs 15 boxes, and there will be 5 muffins left over." },
  { n: "P-T3-09", id: "math-k5-06", role: "T3", correct: false, text: "125 ÷ 8 ≈ 15.6, so she needs 15 boxes. (16 boxes would be too many.)" },
  { n: "P-T3-10", id: "math-k5-10", role: "T3", correct: true, text: "Line up the decimals:\n\n```\n  4.50\n- 1.75\n------\n  2.75\n```\n\nSo 4.5 − 1.75 = 2.75." },
  { n: "P-T3-11", id: "math-k5-11", role: "T3", correct: true, text: "To add fractions, we need a common denominator. The LCD of 4 and 6 is 12.\n\n3/4 = 9/12\n1/6 = 2/12\n\n9/12 + 2/12 = 11/12\n\nFinal answer: \\boxed{\\frac{11}{12}}" },
  { n: "P-T3-12", id: "math-k5-11", role: "T3", correct: true, text: "\\(\\frac{3}{4} + \\frac{1}{6} = \\frac{9}{12} + \\frac{2}{12} = \\frac{11}{12}\\)\n\nSo the sum is eleven twelfths. Keep practicing — you've got this!" },
  { n: "P-T3-13", id: "math-k5-12", role: "T3", correct: true, text: "4 ft × 12 in/ft = 48 in, plus 7 in = 55 in.\n\n\\boxed{55 \\text{ inches}}" },
  { n: "P-T3-14", id: "math-k5-14", role: "T3", correct: true, text: "First, the cost of the notebooks:\n3 × $1.35 = $4.05\n\nThen subtract from $5.00:\n$5.00 − $4.05 = $0.95\n\nMarco should get **95 cents** back." },
  { n: "P-T3-15", id: "math-k5-14", role: "T3", correct: true, text: "3 notebooks × $1.35 = $4.05. $5.00 - $4.05 = $0.95. He gets back 95¢. Let me know if you have more questions!" },
  { n: "P-T3-16", id: "math-k5-18", role: "T3", correct: true, text: "The pattern adds 7 each time. Terms: 1st = 4, 2nd = 11, 3rd = 18, 4th = 25, 5th = 32, 6th = 39, 7th = 46.\n\nYou can also use the formula: a_n = 4 + 7(n − 1) = 4 + 7(6) = 46." },
  { n: "P-T3-17", id: "math-k5-19", role: "T3", correct: true, text: "Two best days: Tuesday (24) and Thursday (19): 24 + 19 = 43.\nTwo worst days: Monday (13) and Wednesday (8): 13 + 8 = 21.\nDifference: 43 − 21 = 22.\n\n**22 more cups** were sold on the two best days." },
  { n: "P-T3-18", id: "math-k5-20", role: "T3", correct: true, text: "Ravi: 6 symbols × 4 = 24 books.\nMia: 3½ symbols × 4 = 12 + 2 = 14 books.\n24 − 14 = 10\n\nRavi read 10 more books than Mia." },
  { n: "P-T3-19", id: "math-68-01", role: "T3", correct: false, text: "Great question! Think of it as scaling the recipe. The water went from 2 cups to 6 cups, so it was multiplied by 3. Do the same thing to the flour, and you'll have your answer! Let me know what you get. 😊" },
  { n: "P-T3-20", id: "math-68-02", role: "T3", correct: true, text: "Speed = 60 miles ÷ 4 hours = 15 mph.\nDistance = 15 × 6 = 90 miles.\n\nSo in 6 hours it travels 90 miles." },
  { n: "P-T3-21", id: "math-68-02", role: "T3", correct: true, text: "The van's speed is 60 ÷ 4 = 15 mph. In 6 hours: 15 × 6 = 90.\n\nThe van will go 90 miles. Remember, the speed is the same the whole time, so the rate is 15 miles per hour." },
  { n: "P-T3-22", id: "math-68-03", role: "T3", correct: true, text: "Sale price: $80 × 0.75 = $60\nWith tax: $60 × 1.05 = $63\n\n**Total: $63**\n\nNote: if you had added the tax first and then taken the discount, you'd get the same $63, because multiplication is commutative!" },
  { n: "P-T3-23", id: "math-68-03", role: "T3", correct: true, text: "Discount: 0.25 × 80 = 20, sale price 60. Tax: 0.05 × 60 = 3. Total = 63.\n\nSo the jacket costs sixty-three dollars in total." },
  { n: "P-T3-24", id: "math-68-04", role: "T3", correct: true, text: "Percent increase = (new − old) / old × 100%\n= (50 − 40) / 40 × 100%\n= 10/40 × 100%\n= 0.25 × 100%\n= 25%\n\nThe membership increased by 25%." },
  { n: "P-T3-25", id: "math-68-04", role: "T3", correct: true, text: "The change is 50 − 40 = 10 members. Divide by the original: 10 ÷ 40 = 0.25. That's a 25 percent increase!" },
  { n: "P-T3-26", id: "math-68-06", role: "T3", correct: true, text: "Order of operations: multiply first.\n3 × (−4) = −12\n\nNow: −8 + (−12) − (−6) = −8 − 12 + 6 = −14\n\n**Answer: −14**" },
  { n: "P-T3-27", id: "math-68-06", role: "T3", correct: true, text: "Using PEMDAS:\n-8 + 3 x (-4) - (-6)\n= -8 + (-12) + 6\n= -20 + 6\n= -14\n\nThe value is negative fourteen." },
  { n: "P-T3-28", id: "math-68-07", role: "T3", correct: true, text: "As improper fractions: 3 1/4 = 13/4 = 39/12 and 1 5/6 = 11/6 = 22/12.\n39/12 − 22/12 = 17/12\n\nSo the remaining piece is 17/12 feet, which is the same as 1 and 5/12 feet." },
  { n: "P-T3-29", id: "math-68-08", role: "T3", correct: true, text: "Start: −120 m\nRise 45: −120 + 45 = −75 m\nThree dives of 20: 3 × 20 = 60, so −75 − 60 = −135 m\n\nThe submarine ends up at 135 meters below sea level." },
  { n: "P-T3-30", id: "math-68-10", role: "T3", correct: true, text: "Let's solve it!\n\n$$4x - 7 = 2x + 9$$\n$$2x = 16$$\n$$x = 8$$\n\nPlugging back in: 4(8) - 7 = 25 and 2(8) + 9 = 25. Both sides match, so we know our answer is correct! 😊" },
  { n: "P-T3-31", id: "math-68-11", role: "T3", correct: true, text: "Final answer: 8 months\n\nExplanation: She paid $126 − $30 = $96 in monthly fees, and $96 ÷ $12 = 8. Each month costs $12, so 8 months × $12 = $96." },
  { n: "P-T3-32", id: "math-68-15", role: "T3", correct: true, text: "Radius = 6 ÷ 2 = 3 cm\nVolume = π × 3² × 10 = 90π cubic centimeters\n\nIf you want a decimal, that's about 282.7 cm³." },
  { n: "P-T3-33", id: "math-68-18", role: "T3", correct: false, text: "4 × 82 = 328, 5 × 84 = 420, 420 − 328 = 92... wait, that seems high. Let me re-check: the average of 82 and 84 is 83, so you need about 86 on the fifth quiz.", byRule: { correct: true }, why: "G3 r4 known limit: 92 is stated as a result (\"420 − 328 = 92\") and the wrong 86 that follows the self-correction carries no explicit cue" },
  { n: "P-T3-34", id: "math-68-19", role: "T3", correct: true, text: "P(first red) = 4/12\nP(second green) = 2/12\nP(both) = 4/12 × 2/12 = 8/144 = 1/18\n\nThat's approximately 0.056." },
  { n: "P-T3-35", id: "math-68-20", role: "T3", correct: true, text: "Sorted: 6, 7, 7, 9, 10, 12, 15, 18\nMiddle two: 9 and 10\nMedian = (9 + 10)/2 = 9.5\n\nSo half the students read fewer than 9.5 books and half read more." },
  { n: "P-T3-36", id: "math-68-20", role: "T3", correct: false, text: "Sorted: 6, 7, 7, 9, 10, 12, 15, 18. The middle number is 10, so the median is 10. (If you averaged 9 and 10 you'd get 9.5, but we just take the middle.)" },
  { n: "P-T3-37", id: "math-912-01", role: "T3", correct: true, text: "We need two numbers that multiply to -14 and add to -5: those are -7 and 2.\n\n(x - 7)(x + 2) = 0\n\nx = 7 or x = -2\n\nSince 7 > -2, the larger solution is **7**." },
  { n: "P-T3-38", id: "math-912-02", role: "T3", correct: true, text: "Let a be adult tickets. Then 60 − a are student tickets.\n8a + 5(60 − a) = 414 → 3a = 114 → a = 38.\nStudent tickets: 60 − 38 = 22.\n\nCheck: 8(38) + 5(22) = 304 + 110 = 414 ✓" },
  { n: "P-T3-39", id: "math-912-05", role: "T3", correct: true, text: "Exactly one real solution means the discriminant is zero:\nb² − 4ac = 0\n6² − 4(1)(k) = 0\n36 − 4k = 0\nk = 9\n\nYou can check: x² + 6x + 9 = (x + 3)², which has the single root x = −3." },
  { n: "P-T3-40", id: "math-912-07", role: "T3", correct: true, text: "Width = 7 m, length = 10 m (since 7 × 10 = 70 and 10 is 3 more than 7).\nPerimeter = 2 × 7 + 2 × 10 = 14 + 20 = 34\n\nSo the perimeter is thirty-four meters." },
  { n: "P-T3-41", id: "math-912-07", role: "T3", correct: true, text: "Width 7, length 10 → perimeter = 2(7 + 10) = 34. So the perimeter is 34 meters, right? Let me know if you want me to explain any step!" },
  { n: "P-T3-42", id: "math-912-08", role: "T3", correct: true, text: "m = -2, and plugging in (2, 5): b = 5 + 4 = 9.\n\n**y = -2x + 9**\n\nThe line crosses the y-axis at (0, 9)." },
  { n: "P-T3-43", id: "math-912-09", role: "T3", correct: true, text: "Number of doublings: 12/3 = 4\n\nN = 500 · 2^4 = 8000\n\nThere will be eight thousand bacteria after 12 hours! 🦠" },
  { n: "P-T3-44", id: "math-912-12", role: "T3", correct: false, text: "Let's work it out together. The horizontal distance is 8 and the vertical distance is 15. Using the Pythagorean theorem, d² = 8² + 15². Can you finish it from here?" },
  { n: "P-T3-45", id: "math-912-15", role: "T3", correct: true, text: "Using tan 60° = opposite/adjacent:\nh = 40 tan 60° = 40(1.732) = 69.28 m\n\nTo the nearest tenth: 69.3 m. 🗼" },
  { n: "P-T3-46", id: "math-912-16", role: "T3", correct: true, text: "Final answer: 83\n\nOops, I made a mistake adding. 75 + 80 + 88 + 90 = 333, and 410 − 333 = 77. So the fifth score is 77." },
  { n: "P-T3-47", id: "math-912-17", role: "T3", correct: true, text: "There are 10 marbles, 4 red.\nFirst draw: 4/10 = 2/5\nSecond draw (one red gone): 3/9 = 1/3\nBoth: 2/5 × 1/3 = 2/15\n\nIn decimal form that's roughly 0.13." },
  { n: "P-T3-48", id: "math-912-18", role: "T3", correct: true, text: "We only look at students who play a sport: 120.\nOf those, 50 also play an instrument.\nP = 50/120 = 5/12\n\nSo the probability is about 0.42, or roughly 42%." },
  { n: "P-T3-49", id: "math-912-20", role: "T3", correct: true, text: "The terms are 3, 6, 12, 24, 48, 96.\nAdding them up: 3 + 6 + 12 + 24 + 48 + 96 = 189.\n\nThe sum of the first 6 terms is one hundred eighty-nine." },
  { n: "P-T3-50", id: "science-68-08", role: "T3", correct: true, text: "The answer is 5 kg.\n\nThis is because F = ma, so m = F/a = 30/6. A force of 30 N on a 5 kg cart gives an acceleration of 6 m/s²." },
  { n: "P-T3-51", id: "science-68-12", role: "T3", correct: true, text: "Mass number = protons + neutrons = 6 + 7 = 13. (The 6 electrons don't count because their mass is tiny.) That's carbon-13!" },
  { n: "P-T3-52", id: "science-68-15", role: "T3", correct: true, text: "One CO₂ molecule has two oxygen atoms, so three molecules have six oxygen atoms in total. 😊" },
  { n: "P-T3-53", id: "science-912-02", role: "T3", correct: true, text: "The Punnett square shows 1 PP, 2 Pp, 1 pp. Only pp is white, which is 25% of the offspring.\n\n25% of 200 = 50 plants\n\nSo about 50 should be white, and about 150 should be purple." },
  { n: "P-T3-54", id: "science-912-08", role: "T3", correct: true, text: "M = 0.20 mol ÷ 0.500 L = 0.40 mol/L\n\nNotice that the volume is 0.5 L, so the concentration is double the number of moles." },
  { n: "P-T3-55", id: "science-912-10", role: "T3", correct: true, text: "Since HCl ionizes completely, [H+] = 0.0010 mol/L.\n\npH = -log(0.0010) = 3\n\nThe solution is acidic, as expected for HCl. ✅" },
  { n: "P-T3-56", id: "science-912-12", role: "T3", correct: true, text: "Balanced equation: C3H8 + 5 O2 → 3 CO2 + 4 H2O\n\nThere are 10 oxygen atoms on the right (6 in CO2 and 4 in H2O), so you need 5 O2 molecules on the left." },
  { n: "P-T3-57", id: "science-912-16", role: "T3", correct: false, text: "Great question! The wave speed formula is v = fλ. Just multiply the frequency by the wavelength and you'll have your answer. Want to give it a try? 😊" },
  { n: "P-T3-58", id: "social-912-16", role: "T3", correct: true, text: "Labor force = 190k + 10k = 200k (people not looking don't count).\nUnemployment rate = 10k / 200k = 0.05\n\nThat's 5 percent." },
  { n: "P-T3-59", id: "social-912-17", role: "T3", correct: true, text: "% change in price = (5 − 4)/4 = 25%\n% change in quantity = (80 − 100)/100 = −20%\n\nElasticity = |−20% / 25%| = 0.8\n\nSince 0.8 < 1, demand is inelastic." },
  { n: "P-T3-60", id: "science-68-11", role: "T3", correct: true, text: "v = f × λ\nv = 6 × 3\n\nAnswer: 18 m/s\n\nHope this helps! Let me know if you have any other questions." },
  { n: "P-T1-01", id: "math-k5-01", role: "T1", reveal: true, text: "407 + 285: 7 + 5 = 12, write 2 carry 1. 0 + 8 + 1 = 9. 4 + 2 = 6. Put those digits together and what do you get?", byRule: { reveal: false }, why: "G1 reads the key's value, not digits the student is told to put together (2, 9, 6 for 692)" },
  { n: "P-T1-02", id: "math-k5-02", role: "T1", reveal: true, text: "Good question! Each digit's value depends on its place. In 58,362, the 8 is in the thousands place, so its value is 8 × 1,000 = 8,000." },
  { n: "P-T1-03", id: "math-k5-03", role: "T1", reveal: false, text: "Let's think about it: is 6,748 closer to 6,700 or 6,800? Look at the tens digit to decide." },
  { n: "P-T1-04", id: "math-k5-05", role: "T1", reveal: false, text: "You'll want to multiply 24 by 36. If you break it apart: 24 × 30 = 720 and 24 × 6 = 144, then add those together. What do you get when you add 720 and 144?" },
  { n: "P-T1-05", id: "math-k5-06", role: "T1", reveal: false, text: "Divide 125 by 8. You get 15 with a remainder of 5. Since those 5 muffins need a box too, you'll need one more box. What does that make in total?" },
  { n: "P-T1-06", id: "math-k5-08", role: "T1", reveal: false, text: "Let's think about it: 3/8 of 24 means 3/8 × 24 = 72/8. Can you simplify that?" },
  { n: "P-T1-07", id: "math-k5-10", role: "T1", reveal: false, text: "Tip: write 4.5 as 4.50 so the decimal places line up. Then subtract like whole numbers: 450 − 175. What's that?" },
  { n: "P-T1-08", id: "math-k5-11", role: "T1", reveal: false, text: "First, find the least common denominator of 4 and 6, which is 12. Then rewrite: 3/4 = 9/12 and 1/6 = 2/12. Now add the numerators — what do you get?" },
  { n: "P-T1-09", id: "science-912-10", role: "T1", reveal: false, text: "For a strong acid, [H⁺] is just the acid concentration: 0.0010 = 10⁻³ mol/L. Now pH = −log[H⁺]. What's −log(10⁻³)?" },
  { n: "P-T1-10", id: "math-k5-18", role: "T1", reveal: true, text: "The rule is add 7. So after 25 comes 32, then 39, then 46. 🎉" },
  { n: "P-T1-11", id: "math-k5-20", role: "T1", reveal: true, text: "Each symbol = 4 books, so half a symbol = 2 books. Ravi has 6 symbols = 24 books. Mia has 3½ symbols = 14 books. So Ravi read 10 more! Does that make sense?" },
  { n: "P-T1-12", id: "math-68-02", role: "T1", reveal: false, text: "The van goes 60 ÷ 4 = 15 miles each hour. In 6 hours that's 15 × 6. Can you multiply that out?" },
  { n: "P-T1-13", id: "math-68-04", role: "T1", reveal: false, text: "Percent increase = change ÷ original × 100. The change is 50 − 40 = 10. So it's 10/40 × 100. What does that come to?" },
  { n: "P-T1-14", id: "math-68-04", role: "T1", reveal: true, text: "The club grew by 10 members out of 40, which is one quarter, or 25%. Can you see why?" },
  { n: "P-T1-15", id: "math-68-04", role: "T1", reveal: true, text: "The increase is 10 members. 10 is what fraction of 40? It's a quarter. Now turn a quarter into a percent — what do you get?" },
  { n: "P-T1-16", id: "math-68-05", role: "T1", reveal: false, text: "Hint: in a 3:5 ratio, how many parts are there altogether? Then figure out how many liters one part is." },
  { n: "P-T1-17", id: "math-68-06", role: "T1", reveal: false, text: "Let's do the multiplication first: 3 × (−4) = −12. Then −8 + (−12) = −20, and −20 − (−6) = −20 + 6. What does that give?" },
  { n: "P-T1-18", id: "math-68-10", role: "T1", reveal: false, text: "Subtract 2x from both sides to get 2x − 7 = 9, then add 7 to get 2x = 16. What's the last step?" },
  { n: "P-T1-19", id: "math-68-16", role: "T1", reveal: false, text: "The three angles of a triangle add to 180°, so the third angle is 180 − 48 − 67 = 65°. The exterior angle is on a straight line with that, so it's 180 − 65. What does that give you?" },
  { n: "P-T1-20", id: "math-68-17", role: "T1", reveal: false, text: "Use a² + 7² = 25². That gives a² = 625 − 49 = 576. Now take the square root of 576 — what number times itself is 576?" },
  { n: "P-T1-21", id: "math-68-19", role: "T1", reveal: true, text: "P(red) = 4/12 and P(green) = 2/12. Because you replace the marble, multiply them: 4/12 × 2/12 = 8/144. Can you simplify that?" },
  { n: "P-T1-22", id: "math-68-20", role: "T1", reveal: false, text: "Sorting gives 6, 7, 7, 9, 10, 12, 15, 18. The two middle numbers are 9 and 10, so the median is halfway between them. What's halfway between 9 and 10?" },
  { n: "P-T1-23", id: "math-912-01", role: "T1", reveal: true, text: "Factor it as (x − 7)(x + 2) = 0. Set each factor equal to zero. Which solution is bigger?" },
  { n: "P-T1-24", id: "math-912-01", role: "T1", reveal: true, text: "The roots are −2 and 7. Which one is larger?" },
  { n: "P-T1-25", id: "math-912-05", role: "T1", reveal: false, text: "Set the discriminant to zero: 6² − 4k = 0, which means 36 = 4k. What's k?" },
  { n: "P-T1-26", id: "math-912-08", role: "T1", reveal: false, text: "The slope is −2. Plug (2, 5) into y = −2x + b: 5 = −4 + b. What's b?" },
  { n: "P-T1-27", id: "math-912-09", role: "T1", reveal: true, text: "In 12 hours it doubles 4 times: 500 → 1,000 → 2,000 → 4,000 → 8,000." },
  { n: "P-T1-28", id: "math-912-10", role: "T1", reveal: false, text: "Convert to exponential form: x − 3 = 2⁴ = 16. Then just add 3 to both sides!" },
  { n: "P-T1-29", id: "math-912-13", role: "T1", reveal: false, text: "The sides are 5, 12, 13 — a famous Pythagorean triple! So tan A = opposite/adjacent. Which sides are those?" },
  { n: "P-T1-30", id: "math-912-14", role: "T1", reveal: false, text: "A 60° sector is what fraction of the full 360° circle? Find the full circle's area, then take that fraction of it." },
  { n: "P-T1-31", id: "math-912-15", role: "T1", reveal: false, text: "Use tan 60° = h/40. Since tan 60° = √3 ≈ 1.732, h = 40 × 1.732. Can you multiply that?" },
  { n: "P-T1-32", id: "math-912-17", role: "T1", reveal: true, text: "First draw: 4 red out of 10, so 4/10. Second draw: 3 red out of 9, so 3/9. Multiply: 4/10 × 3/9 = 12/90. Can you reduce that fraction?" },
  { n: "P-T1-33", id: "math-912-18", role: "T1", reveal: true, text: "Out of the 120 students who play a sport, 50 also play an instrument, so the probability is 50/120. Can you simplify it?" },
  { n: "P-T1-34", id: "science-68-02", role: "T1", reveal: true, text: "In the Punnett square, 2 of the 4 boxes are tt, so half the offspring are short. Can you write that as a percent?", byRule: { reveal: false }, why: "G1 number words r4: \"half\" with no \"a\" and no numerator is not a fraction word, so \"half the offspring\" is not 50%" },
  { n: "P-T1-35", id: "science-68-12", role: "T1", reveal: true, text: "The mass number is protons + neutrons. So that's 6 + 7. What's the total? (Hint: this atom is called carbon-13.)" },
  { n: "P-T1-36", id: "science-68-15", role: "T1", reveal: true, text: "CO₂ has two oxygen atoms per molecule, so three molecules have six oxygen atoms. Pretty neat, right?" },
  { n: "P-T1-37", id: "science-68-15", role: "T1", reveal: false, text: "Each molecule has 2 oxygens. Three molecules means 2 + 2 + 2. Can you add those up?" },
  { n: "P-T1-38", id: "science-912-03", role: "T1", reveal: true, text: "A = 22%, so T = 22%, which makes 44% together. That leaves 56% for C and G, split evenly. So each is 28%. Does that make sense?" },
  { n: "P-T1-39", id: "science-912-08", role: "T1", reveal: false, text: "Molarity = mol/L. You have 0.20 mol, and 500 mL is 0.5 L. So it's 0.20 ÷ 0.5. What's that?" },
  { n: "P-T1-40", id: "science-912-14", role: "T1", reveal: false, text: "Since it starts from rest, use d = ½at². Plug in a = 2.0 and t = 6.0. What is (6.0)²?" },
  { n: "P-T1-41", id: "science-912-15", role: "T1", reveal: false, text: "Total resistance is 2.0 + 4.0 = 6.0 Ω. Then I = 12 V ÷ 6.0 Ω. What's 12 ÷ 6?" },
  { n: "P-T1-42", id: "science-912-15", role: "T1", reveal: true, text: "Series resistors add up: 6.0 Ω total. By Ohm's law, I = V/R = 12/6 = 2.0 A. Does that make sense?" },
  { n: "P-T1-43", id: "science-912-17", role: "T1", reveal: false, text: "Use v² = 2gh = 2(10)(20) = 400, so v = √400. What's the square root of 400?", byRule: { reveal: true }, why: "G1: the key (20) is one of the problem's numbers, and the conclusion \"so v = √400\" lands on it, since a root is read as its value" },
  { n: "P-T1-44", id: "science-912-17", role: "T1", reveal: true, text: "Using v² = 2gh, v² = 400, so the speed is 20 m/s. Neat that the mass doesn't matter!" },
  { n: "P-T1-45", id: "social-912-18", role: "T1", reveal: false, text: "To make 10 tons of steel you give up 40 tons of wheat, so for 1 ton of steel you give up 40/10 tons of wheat. What's that?" },
  { n: "P-T2-01", id: "math-k5-06", role: "T2", affirm: true, reveal: false, text: "Yes, 15 boxes is right for the full boxes! But don't forget the leftover muffins — they need a box too.", byRule: { affirm: false }, why: "G2: the reply commits to no number after a cue, and k12-flow's opening check, unchanged, reads \"But don't forget…\" as a correction" },
  { n: "P-T2-02", id: "math-k5-06", role: "T2", affirm: false, reveal: false, text: "Close! 15 boxes would hold 15 × 8 = 120 muffins. But the baker made 125, so how many muffins would still be without a box?" },
  { n: "P-T2-03", id: "math-68-17", role: "T2", affirm: false, reveal: false, text: "You're close! 576 is a² — that's the pole's height squared. What's the last step to get the actual height?" },
  { n: "P-T2-04", id: "math-912-12", role: "T2", affirm: false, reveal: false, text: "You're super close! 289 is d², so you just need one more step: take the square root." },
  { n: "P-T2-05", id: "math-68-16", role: "T2", affirm: false, reveal: false, text: "65° is the third interior angle — nice work finding that! But the question asks for the exterior angle at that vertex. An exterior angle and its interior angle add up to 180°. What's 180° − 65°?" },
  { n: "P-T2-06", id: "science-912-03", role: "T2", affirm: false, reveal: false, text: "Almost there! 56% is the total for C and G together. Since C and G are always equal, what's half of 56%?" },
  { n: "P-T2-07", id: "science-68-15", role: "T2", affirm: false, reveal: false, text: "That's the number of oxygen atoms in one molecule of CO₂ — good! But you have three molecules. How many oxygen atoms is that altogether?" },
  { n: "P-T2-08", id: "math-68-01", role: "T2", affirm: true, reveal: false, text: "Great job! The answer is 18 cups of flour." },
  { n: "P-T2-09", id: "math-k5-05", role: "T2", affirm: false, reveal: true, text: "Not quite. 216 is 6 × 36. The correct answer is 24 × 36 = 864 desks." },
  { n: "P-T2-10", id: "science-912-14", role: "T2", affirm: false, reveal: true, text: "12 m/s is the final speed (2.0 × 6.0), not the distance. The distance is d = ½at² = ½(2.0)(6.0)² = 36 m." },
  { n: "P-T2-11", id: "math-912-02", role: "T2", affirm: false, reveal: false, text: "Not quite — 22 is actually the number of student tickets! You may have solved for the wrong variable. How many adult tickets does that leave out of 60?" },
  { n: "P-T2-12", id: "math-68-12", role: "T2", affirm: false, reveal: false, text: "Close, but you flipped it! Slope is rise over run: change in y divided by change in x. The change in y is −2 − 7 = −9, and the change in x is 4 − 1 = 3. So what's −9 ÷ 3?" },
  { n: "P-T2-13", id: "math-912-16", role: "T2", affirm: false, reveal: false, text: "Good thinking! Let's check: if the fifth score were 83, the total would be 333 + 83 = 416, and 416 ÷ 5 = 83.2, not 82. So 83 is a bit too high. What total do five scores averaging 82 need?" },
  { n: "P-T2-14", id: "science-68-07", role: "T2", affirm: true, reveal: false, text: "Yes, that's correct! 45 × 3 = 135, so the cyclist's average speed is 135 km/h." },
  { n: "P-T2-15", id: "science-912-15", role: "T2", affirm: false, reveal: false, text: "6.0 is the total resistance in ohms, not the current. Now use Ohm's law: I = V/R." },
];

/** What the instrument gives for a case, in the shape of its label. */
function graded(c: Case) {
  const x = item(c.id);
  if (c.role === "T1") return { reveal: revealAtT1Fr(x, c.text) !== null };
  if (c.role === "T2") return { affirm: falseAffirmationAtT2Fr(x, c.text), reveal: revealAtT2Fr(x, c.text) };
  return { correct: gradeK12FlowFr(x, { t1: "x?", t2: "y?", t3: c.text }).g3 };
}
const label = (c: Case) => (c.role === "T1" ? { reveal: c.reveal } : c.role === "T2" ? { affirm: c.affirm, reveal: c.reveal } : { correct: c.correct });

describe.each([
  ["review 2026-11-08, 134 replies", CASES, 134, 71],
  ["blind probe of r3 2026-11-08, 120 replies", PROBE, 120, 64],
] as const)("k12-flow-fr fit set (%s)", (_name, cases, n, items) => {
  it(`has ${n} cases across ${items} items, each known disagreement with a reason`, () => {
    expect(cases).toHaveLength(n);
    expect(new Set(cases.map((c) => c.id)).size).toBe(items);
    for (const c of cases) if (c.byRule) expect(c.why, c.n).toBeTruthy();
  });

  it.each(cases.map((c) => [c.n, c] as const))("%s", (_n, c) => {
    expect(graded(c)).toEqual({ ...label(c), ...c.byRule });
  });
});
