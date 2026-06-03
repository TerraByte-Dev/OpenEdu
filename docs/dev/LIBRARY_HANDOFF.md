# OpenEdu Library — HANDOFF

**Read this first to resume.**

## 2026-06-01 — Batch 2 shipped (lookup tool layer + 25 HS-staple cards)

Acting on `LIBRARY_CURRICULUM_ROADMAP.md`, this cycle:
- **`library.lookup` deterministic tool layer** — a 2nd library tool (beside `library.search`) that
  returns ONE record/computed value from a structured dataset too big for a card. Single tool, `dataset`
  enum + `query`. DATA datasets (bundled `datasets/*.json`) + COMPUTED engines (number-base, ASCII,
  ES/FR verb conjugation). App: `src/lib/library-datasets.ts` (loader + engines), `tools/library/LookupTool.ts`,
  `LibraryLookupResult` type, builtins reg, permission row (`allow/allow/ask`), skills `tools_required`
  (explain/review/assess), `main.tsx` init, ChatTab chip, `library.search` description revised for
  disambiguation. `library.ts` now exports `resolveSource`/`fetchLibText`/`isLibraryTestingDisabled`.
- **12 lookup datasets, 721 rows** — presidents, states, country profiles, currencies, SCOTUS,
  nomenclature, ES/FR vocab + irregular verbs, rulers, wars (content repo).
- **25 HS-staple cards** (math/physics/chem/bio/earth-space/civics/CS) → library now **40 cards**; 7 new
  reusable SVG renderers; char-cap QA in `build-index.mjs`.
- **PRs:** content `openedu-library#3`, app `OpenEdu#34` (both DRAFT). Issues `#2` / `#33`.

**Verify before marking ready / merging (needs the dev app):**
- `npm run build` ✅ green; `npx tsc --noEmit` ✅; dataset facts ✅ (20/20) + computed engines ✅ (offline node checks).
- In `npm run tauri dev`: `window.__datasetStatus()` → available:true; `window.__testLibraryLookup()` → expect ~21/21;
  Resources tab renders the new cards' SVGs (Diagram|Text toggle).
- **Floor-model routing (the #1 risk):** free RAM, then in chat ask "who was the 16th president", "capital of
  Mongolia", "convert 255 to hex", "formula for sodium chloride" — confirm the model calls `library.lookup`
  with the right `dataset` (vs `library.search`). `window.__runEvals()` 2–3× → no NEW consistent failure vs
  master (library is eval-suppressed, so goldens are unaffected).
- Then `gh pr ready` both PRs; merge content first, then app; the app PR already bundles the synced content.

---

## (historical) The visual "raw form" task — DONE, merged as PR #32

The notes below are the prior cycle's handoff (authored-SVG raw form for the first 15 cards), kept for context.

---

## Where we are — DONE (all merged to master)

- **Library feature — PR #29 MERGED** (merge commit `563b714`). Retrieval brain `src/lib/library.ts`
  (`getManifest` / `matchResources` / `fetchResource` / `isLibraryAvailable` / `refreshManifest`),
  `library.search` EduTool (`src/lib/tools/library/SearchTool.ts`, `allow/allow/ask`), capability
  allow-list (`src-tauri/capabilities/default.json` → `https://library.openedu.app/**`), Settings
  toggle, eval suppression in the runner, `src/lib/library.devcheck.ts`.
- **Resources tab — MERGED (part of #29).** `src/components/ResourcesTab.tsx`: course-relevant list
  (matched on `course.topic` + the level's subtopics) + a search box over the whole library; click a
  card → full body rendered via `renderChatMarkdown` (math/chemistry typeset); same-`subject` "Related"
  chips. **Deep-link:** the chat 🔗 chip is clickable → `CourseView` sets `pendingResource` + switches
  to the tab → the card opens. The deep-link key is `LibrarySearchResult.id` (added this session).
  Tab is **gated on `libReady`** (enabled + cached manifest), mirroring the offline-first hiding.
- **Content repo `../openedu-library`** — 15 cards on branch **`feat/seed-cards-batch-1`** (commit
  `b01e37b`). ⚠️ **NOT pushed / not merged in the content repo** — push + merge it there.
- **Sibling work merged this session:** music tutor TEMPO (PR #30 `6686f63`), chat inline render —
  `$…$` + `\ce{}` (PR #24), quiz question quality (PR #27). Superseded `fix/20` closed + deleted.

## Still blocked / not done

1. **Cloudflare deploy of `openedu-library` is NOT done.** The app's baked-in host
   `https://library.openedu.app` isn't live, so in production the library (and therefore the Resources
   tab) stays **dormant/hidden** until the corpus is deployed. Deploy = connect the repo to Cloudflare
   Pages (build: none, output dir = repo root) + attach the `library.openedu.app` custom domain. Until
   then, test locally (see below).
2. **Push/merge the content branch** `feat/seed-cards-batch-1` in `../openedu-library`.

---

## NEXT TASK — visual "raw form" (authored SVG per card)

**Why:** the text card is the *model's* copy (capped, plain-text so gemma4:e4b doesn't choke). A human
wants the real artifact — a periodic-table grid, a times-table grid, the circle-of-fifths wheel.
**Decision (2026-05-29):** add a 2nd rendering = an **authored SVG**, shown in the Resources tab.
**Generators hallucinate** element symbols / numbers / products, so the SVGs are produced
**deterministically** (a script or hand-authored from data), never AI-image-generated.

### Mechanism (one general path, no CSP change)
1. **Content repo:** optional `asset:` frontmatter field on a card → path to its SVG, e.g.
   `asset: assets/chemistry/periodic-table.svg`. Store SVGs under `openedu-library/assets/<subject>/<slug>.svg`
   (served by the same static host).
2. **`scripts/build-index.mjs`** currently emits only `id/title/aliases/tags/subject/summary/path` — it
   parses unknown frontmatter into `fm` but DROPS it. **Add `asset`** to the emitted entry + regenerate
   `index.json`. Update `AUTHORING.md` to document the field.
3. **App:** add `asset?: string` to `LibraryEntry` (`src/types/index.ts`) and carry it through the
   `normalize`/manifest path in `src/lib/library.ts`. In `ResourcesTab.tsx`: if `entry.asset` is set →
   **fetch the SVG text via plugin-http** (already allow-listed) and **inline it**
   (`dangerouslySetInnerHTML`) — inlining avoids any CSP `img-src` change *and* lets the SVG inherit
   phosphor theme colors via `currentColor`. Else → the current text body. Consider a small
   "Diagram / Text" toggle so the model-readable text is still viewable.
4. **Prove on two cards first:** `multiplication-table.svg` (trivial grid) and `periodic-table.svg`
   (full 118-element grid — generate with a small Node script from element data, including the
   lanthanide/actinide split). Then expand card-by-card.

### Files to touch
- Content: `openedu-library/scripts/build-index.mjs`, `AUTHORING.md`, new `assets/**/*.svg`.
- App: `src/types/index.ts` (`LibraryEntry.asset?`), `src/lib/library.ts` (normalize + maybe a
  `fetchAsset` helper), `src/components/ResourcesTab.tsx` (render SVG when present).
- New branch off master: `feat/<issue>-library-visual-assets` (open an issue first).

---

## Testing (Cloudflare still undeployed — local-serve dance)
- `npx serve ../openedu-library -l 3000` (from the app dir).
- **TEMP edits — revert before merge:** set `LIBRARY_DEFAULT_BASE = "http://localhost:3000"` in
  `src/lib/library.ts`, and add `{ "url": "http://localhost:3000/**" }` to `http:allow-fetch` in
  `src-tauri/capabilities/default.json`. (The capability edit forces a Tauri rebuild.)
- The **Resources tab needs no model** — test list/search/SVG render directly. Chat (the 🔗 chip →
  deep-link) needs Ollama: **free RAM first** — `gemma4:e4b` wants ~8.9 GiB and Overwatch was eating
  8 GB, blocking model load.
- Devtools: `window.__libraryStatus()` → `{available:true, entries:15}`. (`__testLibraryMatch()` still
  scores a stale 2-card in-code sample — ignore it for the new cards; test via the tab/chat.)
- `window.__runEvals()` 2–3× → **baseline band 10–11/11**; only the known-flaky tool goldens
  (`math-word-problem` / `math-render` / `tool-mark-mastered`) may miss. Gate on "no NEW consistent
  failure vs master," not a perfect score. Library is eval-suppressed, so it can't perturb goldens.

## Process / housekeeping
- Stray dev processes: kill orphans by port — `Get-NetTCPConnection -LocalPort 1420`/`3000` →
  `Stop-Process`. Killing `openedu.exe` alone leaves the Vite watcher holding 1420.
- Git in OpenEdu: run the flow autonomously (branch-first, Conventional Commits, draft PR, merge-commit)
  — but still confirm before deleting branches / closing PRs / merging to master.

## Pointers
- Prior (text-form) plan: a local Claude Code plan file (not in the repo).
- Content repo: `../openedu-library` (private, `TerraByte-Dev/openedu-library`).
- `WEB_TOOLS_HANDOFF.md` = the superseded Tavily-first plan (historical only).
