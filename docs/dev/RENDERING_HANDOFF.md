# Rendering Handoff — multi-formula + cross-domain (math / chemistry) chat rendering

**Written:** 2026-05-25 · **For:** a fresh session (this conversation got long/uncached — start clean).

## TL;DR
Chat replies render **only the first formula / math span**; everything after leaks as raw source.
The problem is **broader than math** — it also hits **chemistry** (balanced equations like
`2 H₂ + O₂ → 2 H₂O`, states, arrows, subscripts) and likely any repeated notation. Phase 4a's
inline-KaTeX + `math.render` handle a *single* clean equation but not multiples or non-math notation.
A prompt-side partial fix is in flight (PR #21); the **real fix is render-side** and should also help
already-generated courses.

> ⚠️ The user has **screenshots** showing several issues in one reply. They did **not** come through to
> the handoff session. **Start the new session by asking the user to re-share them** and pin the symptoms.

## Status going in
- **Phase 4b (sprite personas) MERGED** to `master` (PR #19, merge `af80700`, issue #18 closed).
  `window.__runEvals()` = **11/11** on `gemma4:e4b`.
- **Issue #20** (OPEN): "only the first equation renders; later inline LaTeX leaks raw `$…$`".
- **PR #21** (DRAFT, branch `fix/20-chat-math-prose`, `Closes #20`): **prompt-side** fix — relaxed the
  generated chat `rules` bullet in `curriculum.ts` `generateTutorInstructions` to allow inline `$…$` /
  `$$…$$`, prefer `math.render`, and guard a half-open `$`. **New courses only.** Decision pending:
  merge as groundwork, or fold into the bigger render fix. (Note: this is NOT enough on its own — the
  user still sees the 1-formula limit, confirming the bottleneck is render-side.)
- Build green; max DB migration **v9**.

## The problem (refined by user testing)
1. **Multi-span limit** — a reply with 2+ formulas renders the first and leaks the rest as text.
   Persists even with `$…$` allowed ⇒ **render-side**, not (only) prompt-side.
2. **Beyond math** — chemistry balanced equations / arrows / states / subscripts aren't handled.
   KaTeX needs the **mhchem** extension (`\ce{...}`) for chemistry; it's **not** enabled today.
   (Likely also relevant: units, multi-line derivations, simple tables.)

## Where the rendering lives (read these first)
- `src/components/ChatTab.tsx` — `chatMarked = new Marked(...).use(markedKatex({ throwOnError:false }))`
  (~L23); used for BOTH streaming (~L294) and persisted `MessageBubble` (~L403). `ToolChip` dispatches
  `math.render`→`MathBlock`, `diagram.render`→`MermaidBlock` (one card per tool call).
- `src/components/MathBlock.tsx` — `katex.renderToString(latex,{displayMode:true,throwOnError:true})`,
  raw-source fallback on error.
- `src/components/MermaidBlock.tsx` — lazy-imported mermaid.
- `src/lib/tools/math/RenderTool.ts`, `src/lib/tools/diagram/RenderTool.ts` — the tools.
- `src/skills/math-tutor.md`, `code-tutor.md` — domain skills (mandate `math.render`); routed by
  `resolveDomainSkill` (`src/lib/skills/trigger.ts`) from `course.topic`.
- `src/lib/formatting.ts` — THREE math constants, keep them straight:
  - `MATH_FORMATTING_RULES` (JSON/structured) — **KEEP the ban.** `gemma4:e4b` corrupts JSON if it emits
    backslash-LaTeX in string fields. Used by research/outline/syllabus/quiz JSON calls.
  - `MATH_FORMATTING_RULES_PROSE` — used by pedagogy-gen **and the post-test study plan**, which renders
    as **plain text** (`whitespace-pre-wrap`, `PromotionTestFullScreen.tsx:498` / `PromotionTestModal.tsx:440`).
    **Do NOT relax this** or study plans leak raw `$`.
  - The **chat** rule is an inline bullet in `curriculum.ts` `generateTutorInstructions` (~L564) — that's
    the one PR #21 relaxed (chat-only, new courses).

## Root-cause hypotheses (confirm against the screenshots + raw message text)
1. **marked-katex inline desync (most likely):** a stray / unclosed / `$`-adjacent-to-digit `$` mispairs
   subsequent delimiters → only the first span renders. Check marked-katex options (`nonStandard`) and
   whether a half-open `$` from the 4B model desyncs the rest.
2. **`math.render` under-calling:** 4B calls the tool once, writes later equations in prose. Verify the
   tool loop allows + renders **multiple** `math.render` cards per turn.
3. **No chemistry support:** `\ce{}` needs KaTeX **mhchem**; arrows/states/multiple species don't render.
4. **Block vs inline:** confirm `$$…$$` works; `\[ \]` / `\( \)` are not supported.

## Proposed directions (decide with the user)
- **A. Harden inline rendering (fixes existing + new courses):** enable KaTeX **mhchem**
  (`import "katex/contrib/mhchem"`) for `\ce{}`; pre-normalize the model's text (balance/close `$`,
  convert `\(\)`/`\[\]` → `$…$`); make ALL `$…$` spans render (config/preprocess); verify `$$…$$`.
- **B. Tool-first:** make `math.render` robust for multiple/large equations + add chemistry (or a
  `chem.render` tool); nudge per-equation calls. Less reliant on fragile inline parsing.
- **C. Hybrid (likely best):** inline `$…$` for simple/multiple spans (hardened + mhchem) + cards for big
  standalone equations.

## Constraints / invariants (don't regress)
- **Structured-output ban stays** (`MATH_FORMATTING_RULES`, JSON) — JSON corruption on `gemma4:e4b`.
- **Study plan is plain-text** — don't relax the shared `MATH_FORMATTING_RULES_PROSE`.
- **4B floor model** (`gemma4:e4b`): keep prompts lean; don't destabilize tool selection (cf. the Phase-4a
  `assess`-from-domain-composition exemption).
- **Hold evals ≥ 11/11**; add a **multi-equation** golden + a **chemistry** golden.
- Branch off `master`; **merge-commit** style; don't run builds while the user is away.

## Suggested first steps
1. Ask the user to re-share the screenshots; pin which hypotheses apply.
2. Reproduce on a NEW math course **and** a NEW chemistry course; capture the raw assistant message text.
3. Pick direction A/B/C (likely start with mhchem + inline-parser hardening — it helps existing courses too).
4. Decide PR #21's fate (merge as prompt-side groundwork, or supersede).
5. Open a new issue for the broadened render-side + chemistry scope (or expand #20).

## Verification target
New math course: a reply with 2+ equations renders all of them. New chemistry course: a balanced equation
renders. Existing courses improve too (render-side). Study-plan + JSON outputs unchanged.
`window.__runEvals()` ≥ 11/11 + new goldens pass.

## Context pointers
- Memory: `openedu_v2_harness_migration` (full phase history; the #20/#21 + this scope are recorded),
  `openedu_premade_tutors_vision` (persona decisions).
- `V2_ARCHITECTURE.md` §6.4 (math/diagram rendering), `CLAUDE.md` (invariants, design tokens).
