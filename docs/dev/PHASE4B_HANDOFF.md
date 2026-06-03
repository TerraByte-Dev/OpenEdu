# Phase 4b Handoff — Sprite-tutor personas

**Written:** 2026-05-25 · **For:** the next session, which will **plan + implement Phase 4b** (start in plan mode).

**Status going in:** Phases 0–3 and **Phase 4a are merged to `master`.**
- Phase 4a (PR #15, merge commit `9f03b14`): `math.render` (KaTeX) + `diagram.render` (lazy Mermaid) tools, a new **domain-skill axis** (`math-tutor`/`code-tutor`), and inline chat-math rendering. `__runEvals()` = **9/10** on `gemma4:e4b` (occasional 4B tool-call variance on the three tool goldens).
- Icon chore (PR #16, `480b40f`): app icon refreshed — unrelated to features.
- **`master` is current. Branch Phase 4b off `master`.** Max DB migration is **v8** (Phase 3); 4a added none → **Phase 4b = migration v9**.

> Planning brief, not a spec. Read the canonical docs, then plan. Line numbers drift — verify before relying on them.

---

## Read first (in order)

1. **This file.**
2. The approved Phase 4 plan: `~/.claude/plans/read-phase4-handoff-md-end-to-curried-fog.md` — its **Phase 4b** section + the resolved-decisions table. (4b was split out of Phase 4; 4a shipped first.)
3. `V2_ARCHITECTURE.md` — **§5** (`<persona>` layer), **§6.5** (sprite tutors), **§8** (persona DSL).
4. Memory: `openedu_premade_tutors_vision` (the persona direction — persona × mode orthogonal), `openedu_v2_harness_migration` (full phase history).
5. `CLAUDE.md` — invariants/DON'Ts (migrations append-only; integer levels 1–6; no builds while the user is away; merge-commit style).

---

## The framing — Phase 4b adds *identity*

A curated set of **robot-themed** pixel-headshot tutor characters, picked per course, feeding the `<persona>` system-prompt layer. **4B models follow a *curated* persona far more reliably than a generated one** (§6.5) — so this is a reliability win, not just aesthetics.

**Orthogonality — there are now THREE axes (persona is the new fourth consideration, but tool-free):**
- **Persona (WHO):** name, voice, sprite headshot. Picked per course. Feeds `<persona>`. **Never binds tools.**
- **Mode (HOW):** explain / socratic / quiz / review / hint / assess. Picked per turn via the chat mode bar. Feeds `<skill_bundle>` + gates tools.
- **Domain (WHAT subject):** `math-tutor` / `code-tutor`, code-routed from `course.topic` (added in 4a). Gates the render tools; `selectTools` unions mode ∪ domain `tools_required`.

A student picks a character **and** a mode independently; any character teaches any subject in any mode.

---

## Where things stand — what exists vs. what 4b adds

| File / area | What's there now | Phase 4b does |
|---|---|---|
| `src/lib/dsl/skill.ts` | minimal `SkillFrontmatterSchema` (name/description/trigger/tools_required/model_tier_min) | add **optional** `display_name`, `avatar`, `domain_hints` (the vision memo's forward-compat fields; mode/domain skills ignore them) |
| `src/lib/skills/` (loader, `resolveSkill`, `resolveDomainSkill`) | globs `src/skills/*.md` via `?raw`; `resolveDomainSkill` **already excludes `sprite-persona-*`** (added in 4a — forward-compat for this) | add `resolvePersona(spriteId)` = `skillRegistry.get("sprite-persona-" + id)` |
| `src/skills/*.md` | mode skills + `math-tutor`/`code-tutor` | add `sprite-persona-<id>.md` ×3–5 — body = voice/mannerisms, **`tools_required` omitted** (personas never gate tools) |
| `src/lib/sprites/` | — (new) | `registry.ts` — `SpritePersona[]` (id, displayName, imagePath, blurb, domainHints) |
| `src/components/CompanionSprite.tsx` | — (new) | static head/shoulders sprite renderer (`<img>`, pixelated). Idle/talk **animation deferred** |
| `src/assets/sprites/*.png` | — (new) | the headshots (added when art lands; placeholder until then) |
| `src/lib/curriculum.ts` `buildSystemPrompt` (~948) | identity slot fed by generated `instructions.identity` | add optional `personaIdentity?` param; when a persona is set it overrides **only** the identity slot (pedagogy/rules/progress unchanged) |
| `src/components/ChatTab.tsx` | builds the system prompt; mode bar | resolve persona from `course.sprite_id`, pass `personaIdentity`; render `CompanionSprite` (swap the mode-bar/header emoji for the headshot) |
| `src/views/Dashboard.tsx` create modal (~271) | topic input → BUILD | add a **sprite picker** before BUILD |
| `src/lib/db.ts` `createCourse` (~29) + `Course` type | `createCourse(title, topic)`; no persona column | `createCourse(title, topic, spriteId?)`, `setCourseSprite(courseId, spriteId)` (mid-course switch), `getCourse` maps the column, `Course.sprite_id?` |
| `src-tauri/src/lib.rs` migrations (max v8) | v1–v8 | **migration v9**: `ALTER TABLE courses ADD COLUMN sprite_id TEXT;` (append-only) |
| `src/lib/eval/` | 10 goldens, 9/10 | add one light **persona** golden (no-regression): a persona-active turn still passes its answer check |

The harness pieces 4b plugs into are all in place: the skill loader/registry, the `<persona>` slot in the layered prompt design, the permission layer, and course creation.

---

## Phase 4b scope (to be planned)

1. **Migration v9** — `courses.sprite_id TEXT` (NULL → neutral default persona for legacy courses). Append-only; never edit v1–v8 (the plugin hashes each).
2. **Sprite registry + `CompanionSprite`** — `src/lib/sprites/registry.ts` (3–5 robots) + a static headshot renderer. Animation is a documented fast-follow.
3. **Persona skills** — `sprite-persona-<id>.md` per character (extended frontmatter + voice body, **no `tools_required`**), loaded by the existing glob. `resolvePersona(spriteId)`.
4. **Persona prompt layer** — extend `buildSystemPrompt` with `personaIdentity?`; persona overrides the identity slot only. **Keep generating v1 `tutor_instructions`** (pipeline unchanged — respects "no retroactive cleanup"); persona is additive/overriding for identity, fallback to generated identity when no persona.
5. **Course-creation sprite picker** + `createCourse(spriteId?)` + `setCourseSprite` for mid-course switching (concept ledger + learning profile are persona-independent).
6. **Eval** — one light persona golden; hold ≥ **9/10**.

---

## Sprite-generation prompts (robot-themed, for the Codex pixel generator)

Tate generates the art via his Codex pixel-sprite generator. **Ship 3–5 first; static headshots (animation deferred).** Decide the art pipeline before committing to a full ~20.

**Shared style preamble** (prepend to each): *"Pixel-art character portrait, head-and-shoulders, front-facing, 128×128, limited retro palette, crisp hard pixels (no anti-aliasing), transparent background, retro-futuristic friendly robot, cyan/blue phosphor CRT glow accents to match a dark terminal UI, subtle scanline vibe, clean readable silhouette."*

1. **`sage` — "SAGE" (default / general).** *"…a warm, approachable rounded-head robot with a single gently-glowing cyan eye-screen showing a soft smile, small antenna, matte off-white + steel-blue plating. Calm, patient, welcoming expression."* Voice: friendly, encouraging, plain-spoken generalist.
2. **`euler` — "EULER" (math / physics / engineering).** *"…a precise boxy-headed robot, twin cyan lens-eyes, a protractor/compass motif etched on its forehead, a thin equation ticker-display across its chest plate, brushed-graphite body. Stoic, exact, quietly proud of elegant solutions."* Voice: precise, methodical, loves clean derivations.
3. **`ada` — "ADA-9" (computer science / code).** *"…a sleek angular robot with a horizontal visor eye scrolling tiny green-on-black code, a single side antenna, dark navy chassis with cyan circuit traces. Sharp, witty, curious."* Voice: crisp, a little playful, debugging-minded.
4. **`lingo` — "LINGO-3" (languages).** *"…an expressive friendly robot with a rounded head, two small round eyes, a speaker-grille mouth emitting a tiny speech-bubble icon, teal + cream plating, small headphone earpieces. Chatty, warm, animated."* Voice: conversational, patient with practice/repetition.
5. **`nova` — "NOVA" (science: chem / bio / general science).** *"…an inquisitive robot with large round goggle-eyes, a small electron-orbit halo above its head, a beaker emblem on its chest, white-and-cyan lab plating. Curious, experimental, enthusiastic."* Voice: exploratory, hypothesis-driven, excited by phenomena.

`domain_hints` map each persona to its subjects so the picker can *suggest* a default — but persona stays free to teach any subject in any mode.

---

## Gotchas

- **Personas are NOT tool-binding skills.** Omit `tools_required` so they never affect tool gating (orthogonality). `resolveDomainSkill` already excludes `sprite-persona-*` (4a), and the mode bar only lists `TUTOR_MODES`, so persona skills won't leak into the mode or domain axes.
- **Migrations are append-only; 4b = v9.** Never modify v1–v8.
- **Persona overrides the identity slot only** — keep the generated `tutor_instructions` pipeline intact; legacy courses (no `sprite_id`) render unchanged.
- **Persona applies to all modes** — independent of the 4a "assess is exempt from *domain* composition" rule (that's the domain axis, not persona).
- **Inline chat-math rendering** (`marked-katex-extension` on a dedicated chat `Marked` instance) shipped in 4a — unrelated to persona, don't disturb it.
- **Sprite art is the long pole** (content, not code). Static MVP; ship 3–5; expand later.
- Don't run `npm run tauri dev` / `cargo build` while the user is away. **Merge-commit** style (not squash).

---

## GitHub flow for Phase 4b

New issue ("Phase 4b: sprite-tutor personas") → branch `feat/<n>-v2-phase4b-personas` off `master` → draft PR → `Closes #<n>`. Apply the `enhancement` label. Merge-commit.

## Verification target

`tsc` + `npm run build` green · migration **v9** applies cleanly on an existing v8 DB · the create-course **sprite picker** sets `courses.sprite_id` · the chosen `CompanionSprite` shows in chat · the persona's voice is visible in replies · **mid-course sprite switch** works · `window.__runEvals()` ≥ **9/10** (persona golden passes; no regression).

## Rough estimate

~2–3 dev-days for the code (migration + registry + `CompanionSprite` + picker + persona prompt layer + one eval golden). **Sprite-art sourcing is the schedule variable** — ship 3–5 personas first and expand.
