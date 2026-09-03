# F0(b) — can the 154-card base bear mastery?

**Date:** 2026-09-02 · **Verdict: FAILS as specified.** · Reproduce: `npm test src/lib/steps`

The bar, pre-committed in the design: **`pool_closed >= 10` for ≥40% of the 154 cards**, and ≥1 item
for ≥95%. Below **28%** bearing, the card tier is not mastery-bearing and the empty-shelf product
becomes a reader plus a catalog plus spaced review over items the *user* writes.

The design's estimate was **46.1%**, arrived at by counting markdown structure by hand — 364 table
rows plus 211 definition-list rows. Nothing had actually compiled an item.

## Measured

| | `minDistinct=8` (as designed) | `minDistinct=4` |
|---|---|---|
| yields ≥1 item | **22.7%** (35/154) | **42.2%** (65/154) |
| ≥10 closed-book items | **20.1%** (31/154) | **37.7%** (58/154) |
| ≥2 checker kinds | **3.9%** (6/154) | **10.4%** (16/154) |
| **bears mastery (both)** | **3.9%** | **10.4%** |
| items produced | 794 | 1,864 |
| gate rejections | 6 (all V3) | 9 (all V3) |

Against a 40% bar and a 28% cliff. **The design's 46.1% does not survive contact.**

`minDistinct` is V0b — the minimum distinct values an answer column must hold before it is worth
asking about. At 8 (as specified) a column of fewer than eight distinct answers teaches its own
vocabulary rather than the material. Both columns are reported because the difference is large and
the choice is a judgement, not a fact.

## The failure has two causes and they are not equally real

**1. The corpus is mostly unstructured prose. This is real.**

Only **50 of 154** cards contain a markdown table at all, and only **19** carry a definition list of
eight or more entries. At `minDistinct=8`, **119 cards yield literally nothing** — there is no table
to harvest and the prose bullets are not gradable without a model. No compiler fixes that; the
material simply is not there.

**2. The `kinds >= 2` clause is a proxy, and it misfires here. This one is arguable.**

At `minDistinct=4`, 58 cards reach ten or more closed-book items but only 16 clear `kinds >= 2`.
**The clause, not the yield, is what fails the bar.**

Its stated purpose is that the two sequestered items should differ in *form* from the eight served,
so mastery is not item-memorisation. But harvested table items are nearly all `exact_set` — a
`numeric` item only appears when a table happens to have a numeric column — so a card yielding
sixty distinct questions from sixty different rows is rejected for having one checker shape.

That conflates **checker kind** with **item diversity**. Sixty rows of the periodic table are sixty
different facts; a learner cannot memorise the *form* into a correct answer. The risk the clause
guards against is real, but for harvested content the answer-value diversity already addresses it.

**I am not changing the rule.** I failed a bar and the argument for relaxing it comes from me, which
is exactly when it should be someone else's call. Recommended amendment, for a decision rather than
a silent edit:

> A pool bears mastery with ≥10 closed-book items AND (≥2 checker kinds OR ≥10 distinct expected
> values). The second disjunct is satisfiable by data and captures what the clause was actually for.

Under that amendment the number is **37.7%** — still under the 40% bar, still well clear of the 28%
cliff.

## What is not in doubt

- **The gates work and cost nothing.** 1,864 items compiled in 84 ms with no model. Only V3 (stem
  leaks the answer) ever fired, 9 times. V0 fired zero times, which is expected: these are authored
  reference cards, not extracted PDFs, so there are no dangling "see Table 7.3" references. V0 earns
  its keep the moment real documents are ingested.
- **V1 held on every item.** Trivially, because a harvested key *is* the source data. It becomes
  load-bearing the moment anything is model-authored, and it is the mechanism that makes a
  frontier-model content factory safe.
- **The items are real.** The top yields are `earth-space/solar-system-planets` (66),
  `us-history-civics/major-us-wars` (66), `french/pronouns` (144 at `minDistinct=4`). Those are
  genuine recall items with guaranteed-correct keys.

## What this means

The measurement does its job: it says **do not build the card tier into a mastery product**. Three
readings, in order of how much I believe them.

1. **Most likely.** The base was authored as a *reference* set and is correctly shaped for that. It
   is a citation layer, not an item bank. This is the audit's own conclusion — *"keep them, just stop
   pretending they are a curriculum"* — now with a number behind it.
2. **The unit format is the answer, and this strengthens the case for it.** A unit authored to be
   harvestable — the design requires every concept section to end in a table of ≥4 rows with ≥8
   distinct answers — clears the pool law by construction. That constraint stops being a style note
   and becomes the thing the whole plan rests on.
3. **Worth testing before accepting.** Cloze deletion over card bodies was not implemented here
   (harvest only). The design's own table put cloze-only at 2.6% bearing, so it will not rescue the
   number, but it would raise the "yields anything" figure and is cheap.

**F0(b) is failed. The corpus-to-assessment premise is not dead — it moves from the card tier to the
unit tier, which is where the design already put it.**
