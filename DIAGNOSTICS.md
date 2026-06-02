# OpenEdu — App Diagnostics (size + smoothness)

Goal 2 of the 2026-06 session: make sure the app isn't larger than it needs to be and runs smooth.

## Web bundle — eager main chunk shrunk 63%

The startup-blocking `dist/assets/index-*.js` was **1.55 MB**. Lazy-loading the three heaviest
view-gated dependencies and deduping KaTeX cut it to **0.58 MB**.

| Eager `index.js` | size | gzip |
|---|---|---|
| **Before** | 1,554.98 KB | 489.14 KB |
| After lazy CodeMirror + react-force-graph | 870.22 KB | 254.62 KB |
| **After + lazy KaTeX (final)** | **577.81 KB** | **169.16 KB** |
| **Δ** | **−977 KB (−63%)** | **−320 KB (−65%)** |

These libraries now ship as **on-demand chunks** (fetched only when their feature is used), not at startup:

| Lazy chunk | size | gzip | loads when… |
|---|---|---|---|
| `katex` (deduped, shared) | 552 KB | 163 KB | chat/resource prose or a math.render card contains math |
| `codemirror` | 492 KB | 171 KB | the notes/vault editor opens |
| `react-force-graph-2d` | 138 KB | 45 KB | the vault-graph view opens |
| `cytoscape` + the mermaid per-diagram chunks | ~0.9 MB total | — | a diagram.render Mermaid card renders (already lazy; left as-is) |

### What changed
- **`src/components/NotesTab.tsx`** — `MarkdownEditor` (CodeMirror) and `ForceGraph2D` converted to `React.lazy` behind `<Suspense>`; both are view-gated, so they leave the eager bundle.
- **`src/lib/chat-markdown.ts`** — KaTeX + `marked-katex-extension` + mhchem + stylesheet moved behind an idempotent async `ensureChatKatex()`. The relaxed parsing (issue #23: `nonStandard` boundaries + mhchem) is preserved exactly. `renderChatMarkdown` kicks off the load on first use; `ChatTab`/`ResourcesTab` re-render once it resolves; `render-check`'s `__testMathRender` awaits it.
- **`src/components/ChatTab.tsx`** — `MathBlock` (the other static KaTeX importer) converted to `React.lazy`; without this KaTeX stayed eager.
- **`vite.config.ts`** — `manualChunks` dedupes KaTeX into one shared lazy chunk (it was duplicated ~258 KB×2 across the MathBlock and marked-katex import graphs) and groups CodeMirror. Mermaid/cytoscape are intentionally left ungrouped so their own per-diagram-type code-splitting keeps working.

## Tauri binary — size-optimized release profile

`src-tauri/Cargo.toml` had **no `[profile.release]`** (Cargo defaults). Added:

```toml
[profile.release]
opt-level = "z"      # optimize for binary size
lto = true           # link-time optimization across crates
codegen-units = 1    # maximize optimization
strip = true         # strip debug symbols
panic = "abort"      # drop unwinding tables
```

→ **measure with `npm run tauri build`** (a heavy Rust release compile — run with the user present);
report the `.exe` + `.msi` sizes before/after.

## Dependency audit

`npx depcheck` → **no unused production dependencies**; no missing dependencies. The single flagged
devDependency (`tailwindcss`) is a **false positive** — it's consumed by the `@tailwindcss/vite`
plugin, not imported directly. Nothing to remove.

## Library bundle
`public/library` grew to **154 cards (~2.1 MB of assets)** after batch 6 — the 4 vendored maps are the
largest SVGs (~150–175 KB each). All library assets load **on-demand per card** (never in the JS
bundle), so this does not affect startup. Optional future win: an SVG whitespace/precision minify pass
in `build-assets.mjs` (low priority).

## Pending verification (needs the app running — user at the keyboard)
- `npm run tauri dev` (restart once to pick up the new `spanish`/`french`/`visual-art`/`health-pe` folders), then in DevTools:
  - `__libraryStatus()` → expect **154** cards.
  - `__testLibraryLookup()` → resolves new cards (e.g. "ser vs estar", "MyPlate", "world map").
  - `await __testMathRender()` → all render cases green (confirms the lazy-KaTeX path didn't regress issue #23).
  - `__runEvals()` → no NEW consistent failure vs master (baseline is flaky ~10–11/11).
  - Smoke: open a course chat (inline math typesets a beat after load), open a note (CodeMirror editor loads), open the vault graph (force-graph loads), open a Resources card with a diagram/map.
- `npm run tauri build` → record `.exe` + installer sizes (validates the release profile).
