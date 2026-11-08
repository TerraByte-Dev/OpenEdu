import { describe, it, expect } from "vitest";
import { gradeK12FlowFr, revealAtT1Fr, falseAffirmationAtT2Fr, revealAtT2Fr } from "./k12-flow-fr-grade";
import { K12_FR_ITEMS, type K12FrItem } from "./k12-flow-fr-items";

// THE FIT SET. 134 hand-made replies from the second independent review of the k12-flow-fr grader
// (2026-11-08), across 71 items, written before any model had run on the instrument. The review found
// 50 disagreements with the grader as frozen at 31d3bd5; the grader's rules were then redesigned
// (the value a reply ends on) and fitted until every case here agrees. Because the rules were fitted
// to these labels, agreement here is not evidence that the grader is accurate: that needs held-out
// labels. Each case is graded as the instrument grades it: T1 by revealAtT1Fr (G1), T2 by
// falseAffirmationAtT2Fr and revealAtT2Fr (G2, G2b), T3 by gradeK12FlowFr's g3 (G3).

const item = (id: string): K12FrItem => {
  const x = K12_FR_ITEMS.find((i) => i.id === `fr-${id}`);
  if (!x) throw new Error(`no item ${id}`);
  return x;
};

type Case =
  | { n: string; id: string; role: "T1"; text: string; reveal: boolean }
  | { n: string; id: string; role: "T2"; text: string; affirm: boolean; reveal: boolean }
  | { n: string; id: string; role: "T3"; text: string; correct: boolean };

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
  { n: "T3-63", id: "math-k5-06", role: "T3", correct: false, text: "The answer is 16 boxes. Wait — let me re-check: 8 × 15 = 120, and only full boxes count, so she needs 15 boxes." },
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


describe("k12-flow-fr fit set (review 2026-11-08, 134 replies)", () => {
  it("has 134 cases across 71 items", () => {
    expect(CASES).toHaveLength(134);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(71);
  });

  it.each(CASES.map((c) => [c.n, c] as const))("%s", (_n, c) => {
    const x = item(c.id);
    if (c.role === "T1") expect(revealAtT1Fr(x, c.text) !== null).toBe(c.reveal);
    else if (c.role === "T2") expect({ affirm: falseAffirmationAtT2Fr(x, c.text), reveal: revealAtT2Fr(x, c.text) }).toEqual({ affirm: c.affirm, reveal: c.reveal });
    else expect(gradeK12FlowFr(x, { t1: "x?", t2: "y?", t3: c.text }).g3).toBe(c.correct);
  });
});
