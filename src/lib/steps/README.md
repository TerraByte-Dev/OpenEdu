# `src/lib/steps/` — the item compiler

Turns source markdown into deterministically-gradable items with **zero model calls**. The answer
key is the data, so a fabricated key is not unlikely — it is impossible.

| file | job |
|---|---|
| `types.ts` | `Item`, `Expected`, the pool law constants, `itemKey` |
| `checkers.ts` | total verdict functions; reuses `quiz-grading.ts` verbatim |
| `harvest.ts` | markdown tables and definition lists → items |
| `gates.ts` | V0 answerability · V1 groundedness · V2 self-consistency · V3 leak |
| `pool.ts` | the pool law and the F0(b) measurement |

## F0(b) — measured, and it does not clear its bar

Run over all 154 shipped cards. See `../eval/results/2026-09-02-f0b-card-tier.md` for the full
record and the argument about which half of the bar is real.

```
minDistinct=4   yields anything 42.2%  ·  >=10 closed items 37.7%  ·  >=2 kinds 10.4%
minDistinct=8   yields anything 22.7%  ·  >=10 closed items 20.1%  ·  >=2 kinds  3.9%
```

**The bar is 40% mastery-bearing; the cliff below which the card tier is not mastery-bearing is
28%.** Item yield lands just under the bar. The `kinds >= 2` clause is what actually fails it, and
that clause is a proxy — see the results file before changing it.
