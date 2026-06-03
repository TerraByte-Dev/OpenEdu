# Phase 4 Handoff — Math/diagram rendering + sprite tutors

**Written:** 2026-05-24 · **For:** the next session, which will **plan Phase 4** (start in plan mode).
**Status going in:** Phases 0–2 merged to `master`. **Phase 3 (Notebook 2.0) is on branch `feat/12-v2-phase3-notebook` / PR #13 — still open; merge it to `master` first**, then branch Phase 4 off `master`. `__runEvals()` = 7/8 on `gemma4:e4b` after Phase 3 (only the known `math-word-problem` LaTeX fail).

> Planning brief, not a spec. Read the canonical docs, then plan. Line numbers drift — verify before relying on them.

---

## Read first (in order)

1. **This file.**
2. `V2_ARCHITECTURE.md` — **§6.4** (math via structured-output trick), **§6.5** (sprite tutors), **§9 Phase 4**, **§3** (EduTool contract — the two new tools), **§5** (`<persona>` + `<mode>` prompt layers), **§7** (permissions — already seeded for the new tools).
3. `HANDOFF.md` — the locked **"no LaTeX in chat strings while the 4B floor holds"** decision. `math.render` is its *sanctioned workaround*, not a violation.
4. `CLAUDE.md` — invariants/DON'Ts (migrations append-only; integer levels 1–6; no builds while the user is away).
5. Memory: `openedu_premade_tutors_vision` (the persona direction), `openedu_v2_harness_migration`, `project_openedu_vision`, `feedback_psychology_grounded_design`.

---

## The framing — two tracks

Phase 4 adds **expressive output** and **identity** to the tutor. Two tracks:

1. **Math + diagram rendering as tools.** `math.render({ latex })` → a `MathBlock` rendered by **KaTeX**; `diagram.render({ mermaid })` → a **Mermaid** block. Both are EduTools, so the LaTeX/Mermaid source rides inside *tool-call arguments* (which providers double-escape correctly) instead of JSON chat strings — this is exactly how §6.4 sidesteps the no-LaTeX lock. Rendered inline in `ChatTab` as tool-result cards (the slot the Phase 3 `📓 Source` chips already use).
2. **Sprite tutors (personas).** A curated set (~20) of pixel-headshot tutor characters. Each is a `sprite-persona-<id>.md` skill encoding voice/mannerisms; a `CompanionSprite` component renders the animated head/shoulders; course creation gains a sprite picker. Persona feeds the `<persona>` system-prompt layer (§5). **Persona × pedagogical-mode stay orthogonal** (see `openedu_premade_tutors_vision`): you pick a character *and* a mode independently. 4B models follow a *curated* persona far more reliably than a generated one, so v1's free-text `tutor_instructions` generation becomes optional/legacy.

---

## Where things stand — what exists vs. what Phase 4 adds

| File / area | What's there now | Phase 4 does |
|---|---|---|
| `src/lib/tools/` (registry, builtins, `selectTools`) | EduTool contract; notebook/progress/knowledge/ask_user tools | add `math/RenderTool.ts` + `diagram/RenderTool.ts`; register in `builtins.ts` |
| `src/lib/permissions/rules.ts` | already seeds `math.render`, `diagram.render`, `code.run` (allow default/study, **deny exam**) | **no change** — defaults are correct |
| `src/components/ChatTab.tsx` | `ToolChip`/`ToolActivity` render tool results (incl. `📓` chips) | render `MathBlock` (KaTeX) + Mermaid cards for the two new tools |
| `src/lib/kernel/systemPrompt.ts` | layered prompt; `<persona>` slot currently fed by free-text `tutor_instructions` | feed `<persona>` from the active sprite skill; keep `<mode>`/`<skill_bundle>` orthogonal |
| `src/skills/*.md` + loader | mode + assess skills; built-ins via `?raw` glob | add `math-tutor`/`code-tutor` skills that bind the render tools + `sprite-persona-<id>.md` bundles |
| `src/lib/sprites/` | — (new) | `registry.ts` — ~20 sprite defs (id, name, sheet path, blurb, domain hints) |
| `src/components/CompanionSprite.tsx` | — (new) | animated head/shoulders sprite renderer |
| course-creation flow + `courses` table | free-text `tutor_instructions`; no persona column | sprite picker; **migration v9** if a `courses.sprite_id` (or persona) column is needed (max migration is now **8**) |
| `src/lib/eval/` | 8 goldens, 7/8 | add `math-render` + `diagram` goldens; `math.render` may **flip the failing `math-word-problem` golden to pass** (math leaves the chat string) |

The harness pieces Phase 4 plugs into are all in place: native tool-calling (`llm.ts`), the kernel turn loop, skill-gated `selectTools`, the permission layer, and inline tool-result rendering in `ChatTab`.

---

## Phase 4 scope (to be planned — from V2 §6.4 / §6.5 / §9)

1. **`math.render` tool + KaTeX card.** Tool input `{ latex }`, output a `MathBlock`; `ChatTab` renders it with KaTeX. Decide the **render protocol** (open question below).
2. **`diagram.render` tool + Mermaid card.** Tool input `{ mermaid }`; `ChatTab` renders Mermaid. **Lazy-load Mermaid** (it's heavy; the bundle is already ~1.2 MB with CodeMirror).
3. **Domain skills.** `math-tutor` (binds `math.render`, owns math pitfalls), `code-tutor` (CS; later owns `code.run`) — add `math.render`/`diagram.render` to the right skills' `tools_required` and cue them imperatively (4B reliability — see Phase 3's `notebook.search` lesson).
4. **Sprite registry + `CompanionSprite`.** ~20 curated personas, the renderer component, `sprite-persona-<id>.md` skills, a course-creation sprite picker, and the `<persona>` prompt layer. Switching sprite mid-course is allowed (concept ledger + learning profile are persona-independent).
5. **Migration v9** only if persona needs persistence (`courses.sprite_id`), else store it via plugin-store.
6. **Eval.** `math-render` golden (assert the tutor calls `math.render` for an equation answer, no backslash-LaTeX in chat) + a `diagram` golden; hold ≥ **7/8**, and check whether `math-word-problem` now passes.

---

## Open questions to resolve while planning

- **Math render protocol.** §6.4 describes an inline placeholder (`[math:1]`) the renderer swaps in. Simpler MVP: render the `math.render` result as a standalone card at the tool-call site (like the Phase 3 chips), no placeholder substitution. Decide — placeholder is nicer inline, the card is far less plumbing.
- **KaTeX vs MathJax.** V2 says KaTeX (lighter/faster). Confirm, and how to bundle (KaTeX CSS + fonts).
- **Mermaid bundle weight.** It's large — dynamic `import()` it so it doesn't bloat startup. Confirm Mermaid renders inside the frameless dark webview (theme/init config).
- **Sprite art — the long pole.** Where do ~20 pixel-headshot sprite sheets come from (AI image-gen pipeline? a sprite pack? commission)? This is the biggest schedule variable and is *content*, not code. Resolve the asset pipeline before committing to 20 — maybe ship 3–5 first.
- **4B tool-call reliability for `math.render`.** Like `notebook.search`, gemma4:e4b calls tools unevenly. Plan an imperative tool description + a `math-tutor` skill that strongly cues it, and a graceful fallback (if it emits plain-text math, render as-is — never punish).
- **Curated vs generated personas.** §6.5 + the vision memory favor curated. Decide what happens to v1's generated `tutor_instructions` (legacy/optional?), and how persona text composes with the existing `<persona>` layer.
- **Persona storage + switching.** `courses.sprite_id` (migration v9) vs a store setting; default persona for legacy courses; mid-course switching UX.
- **Does `math.render` fix the eval?** If the tutor routes math through the tool, the chat string has no backslash-LaTeX → the `math-word-problem` golden could flip to passing. Worth designing the math-tutor cue with that in mind.

---

## Gotchas

- **Merge PR #13 (Phase 3) to `master` first**, then branch `feat/<n>-v2-phase4-...` off `master`. **Merge style is merge-commit** (not squash).
- **The no-LaTeX-in-chat-strings lock still holds.** `math.render` is the sanctioned workaround (LaTeX rides in tool-call args). Don't start emitting `\frac` in chat text.
- **Permissions are already seeded** for `math.render` / `diagram.render` / `code.run` (allow default/study, deny exam) in `permissions/rules.ts` — no permission change needed; exam mode correctly denies model help.
- **Migrations are append-only; max is now v8** → Phase 4 = **v9** if it touches the schema. Never modify v1–8 (the plugin hashes each).
- **Bundle size:** lazy-load Mermaid (and consider KaTeX) so startup stays snappy.
- **Tool-result rendering** plugs into `ChatTab`'s `ToolChip`/`ToolActivity` (where the `📓` chips render) — extend that, don't bolt on a parallel path.
- Don't run `npm run tauri dev` / `cargo build` while the user is away.

---

## GitHub flow for Phase 4

After PR #13 merges: new issue ("Phase 4: math/diagram rendering + sprite tutors") → branch `feat/<n>-v2-phase4-personas` off `master` → draft PR → `Closes #<n>`. Merge-commit style. Apply labels matching the change type.

## Verification target

`tsc` + `npm run build` green · `window.__runEvals()` ≥ **7/8** (math-render golden added; ideally `math-word-problem` flips to pass) · KaTeX renders a `math.render` result and Mermaid renders a `diagram.render` result inline in chat · a sprite persona appears in chat + the course-creation picker · exam mode still denies `math.render`/`diagram.render`.

## Rough estimate (from V2 §9)

~5 dev-days for the code (two render tools + KaTeX/Mermaid + sprite registry/component/picker/persona layer). **Sprite art sourcing is extra and the main schedule variable** — consider shipping a few personas first and expanding.
