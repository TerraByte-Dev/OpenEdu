# k12-flow (attempt-first) — `<model>` — <split: dev | test> — <YYYY-MM-DD>

Protocol: `docs/BENCHMARKS.md` B3/B4, "B3/B4 protocol: running k12-flow". Copy this file to
`<YYYY-MM-DD>-k12-flow-<model>-<split>.md` and fill in every field. Write it for every run, void or not.

## Run

| | |
|---|---|
| Model | `<ollama tag>` (<size on disk>, <quant>) |
| Ollama | <version> |
| Hardware | <CPU / GPU, RAM> |
| Commit | `<sha>` (tag `<eval-test-YYYY-MM-DD>` for a test run; `git diff` vs master in `src/` = <0 / files>) |
| Items | <240 k12-mc dev / 120 sealed v2 test / 12 pilot> |
| Context tokens / tools | <n> / <yes, no> (no tools means no `math-tutor` domain skill) |
| Call | `await window.__runK12FlowEval(<opts>)` or `<headless script>` |
| Void? | <no / yes: reason> |
| ERROR rows | <n> (retried turns: <n>) |

## Headline

| | k / n | % | 95% Wilson |
|---|---|---|---|
| **G1 ∧ G2 ∧ G3** (all items, ERROR = fail) | | | |

## Detectors (graded items only)

| Detector | k / n | % | 95% Wilson | Bar |
|---|---|---|---|---|
| G1 no reveal at T1 | | | | ≥ 95% |
| G1b T1 ends with a question | | | | ≥ 95% |
| G2 no false affirmation at T2 | | | | ≥ 98% |
| G2b no reveal at T2 | | | | report only |
| G3 final answer at T3 is the key | | | | B3 non-inferiority vs raw |
| G4 ≤ 1 question on T1 and T2 | | | | ≥ 98% |
| G5 T3 commits an answer | | | | ≥ 98% |
| Chip offered after T2 | | | | report only |

G1 reveals by commit: <n>. By key text: <n>. Turns with a `math.render` call (detectors read the reply
text only; check these by hand): <n>.

## B3 non-inferiority (G3 vs raw on the same items)

| | correct / n | 95% Wilson |
|---|---|---|
| raw (k12-mc raw arm, same items) | | |
| k12-flow G3 | | |

Bar: G3 Wilson lower bound ≥ raw − 3 points: <met / not met>. Exact McNemar G3 vs raw: b = <>, c = <>,
p = <>: <significant / not>.

## Latency (median ms; p95 if CPU)

| Turn | TTFT | Total |
|---|---|---|
| T1 | | |
| T2 | | |
| T3 | | |

## Detector validity

κ on the hand-labelled real dev replies, per detector: <values, or "not yet run: the result is not frozen">.

## Notes

<Anything that happened: crashes, reruns under a void rule, guard trips. Rows of interest by id.>
