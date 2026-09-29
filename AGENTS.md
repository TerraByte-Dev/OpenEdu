# AGENTS.md: OpenEdu

The rules for every coding agent (Claude Code, Codex, Cursor, and others) and every human contributing here.
Read this, then `CLAUDE.md` (architecture + the agent harness), then `docs/ARCHITECTURE.md` for depth.
`CONTRIBUTING.md` covers the same workflow for humans. If your change alters behavior one of them describes,
update that doc in the same PR.

## What this is

OpenEdu is an **off-the-grid AI tutor**: Tauri v2 + React 19 + TypeScript + SQLite, with a Rust backend in
`src-tauri/`. It has to teach with the network unplugged, on small local models through Ollama
(`qwen3.5:0.8b` is the smallest model the harness runs on; `gemma4:e4b` is verified end to end), from a
shipped offline library plus folders the user grants it. Cloud providers (OpenAI / Anthropic) are optional
alternates, never a requirement. MIT-licensed, owned and maintained by TerraByte Solutions LLC (@TerraByte-Dev).

## Setup and commands

Node 22 (CI uses 22), Rust stable, and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/).
Ollama with a small model pulled for anything that touches the harness or tutoring.

```bash
npm ci
npm run tauri dev                                  # desktop app, hot reload
npm test                                           # vitest, pure TS logic
npm run build                                      # tsc (includes test files) + vite bundle
cargo test --manifest-path src-tauri/Cargo.toml    # Rust unit tests
```

- CI runs `npm test` and `npm run build` only. **It does not build or test Rust.** If you touch
  `src-tauri/`, run `cargo test` and `npm run tauri dev` yourself and say so in the PR.
- Don't run `npm run tauri build`. Packaging, signing and publishing are maintainer-only.

## Architecture in one screen

- `src/lib/curriculum.ts` — course generation pipeline. `src/lib/kernel/` — the tutoring loop
  (`TutorEngine.ts`, context `budget.ts`, retrieval grounding `ground.ts`, `toolDispatch.ts`).
- `src/lib/tools/` — the agent's tool surface. Copy `_referenceExample.ts`; register in `registry.ts` /
  `builtins.ts`. Tools are gated by `src/lib/permissions/`. Skills are markdown in `src/skills/`.
- `src/lib/llm.ts` — providers, streaming, schema-enforced structured output, model tiers.
- `src/lib/steps/` — the item compiler: closed-book practice items whose answer keys are source data.
- `src-tauri/src/lib.rs` — migrations + plugins + commands. `corpus.rs` — read-only filesystem access
  scoped to folders the user picked this session.

**The process-boundary rule:** the webview never reads the disk directly. A new filesystem or native
capability is a `#[tauri::command]` in `src-tauri/src/`, registered in `invoke_handler` in `lib.rs`, and
wrapped by one typed TS function in `src/lib/` (see `src/lib/corpus.ts`). The Rust signature and the TS
wrapper are **not type-linked**; keep them in sync by hand.

## Tests

- Pure TS logic gets a `*.test.ts` beside it (vitest). No DOM, no Tauri imports in code under test —
  put the logic in a pure module and keep the Tauri/React shell thin.
- Rust logic gets `#[cfg(test)]` tests in the same file. Test against temp dirs, never the user's disk.
- **A test must go through the same code path production does.** A test of a helper the app doesn't
  call is not evidence. This repo has shipped a dead feature behind a green suite exactly that way.
- UI has no unit tests. Verify it in `npm run tauri dev` and show it in the PR with screenshots or a GIF.

## Invariants (don't break these)

- **Offline first.** No new runtime network dependency: no CDNs, remote fonts, analytics or telemetry.
  Anything network-backed (web search, library downloads, update checks) must fail fast and quietly
  when offline, and the tutor must still work.
- **Small-model first.** Every new model call is structured + validated (`callLLMStructured` in
  `llm.ts`), with small-tier behavior considered. Prefer code over a model call wherever code can decide.
- **Never modify a shipped migration** in `lib.rs`; `tauri-plugin-sql` hashes them and refuses to
  start. Add a new version, and call out any schema change in the PR.
- **Filesystem access is read-only and scoped** to user-granted roots, canonicalised, no symlink
  following. Never widen it to a blanket `fs` capability.
- **No secrets** in code, tests, fixtures, commits or PR text. API keys live in the plugin store.

## Contributor workflow

1. **Get the code.** Invited collaborators push branches to this repo. `master` is protected: every
   change lands through a PR that @TerraByte-Dev approves (CODEOWNERS + ruleset). Everyone else forks.
   ```bash
   gh repo clone TerraByte-Dev/OpenEdu && cd OpenEdu
   git switch -c feat/<N>-<slug> origin/master      # N = issue number; fix/<N>-<slug> for bugs
   ```
2. **One branch and one PR per issue**, cut from a freshly fetched `master`. Keep the diff to what the
   issue asks for. List unrelated problems you notice in the PR body instead of fixing them.
3. **Conventional Commits**, scoped like the history: `feat(tools): …`, `fix(corpus): …`, `test(kernel): …`.
4. **Open the PR early, as a draft,** into `master`, fill in the template, include `Closes #N`.
   **The work isn't handed off until this PR exists.** Finish with `gh pr create --draft`, not `git push`.
5. **Before Ready for review:** `npm test`, `npm run build` (and `cargo test` if you touched Rust) pass
   locally; UI changes include before/after screenshots; the human contributor has read the whole diff.
6. **Address review with new commits.** Don't force-push reviewed commits. Merge `master` in rather than rebasing.
7. **@TerraByte-Dev reviews and merges. Contributors never merge.**

**Don't:**
- bump `version` in `package.json`, `Cargo.toml` or `tauri.conf.json`, or edit `CHANGELOG.md` release sections.
- create, edit or delete **GitHub Releases** or tags. The in-app updater installs whatever the latest
  Release holds, so a touched Release ships to every user.
- touch release, packaging, signing or CI config: `.github/workflows/`, the `bundle`/`plugins.updater`
  blocks in `tauri.conf.json`, or anything referencing signing keys.
- push to, delete or force-push any branch you didn't create.
- commit build output or local state: `dist/`, `src-tauri/target/`, `.dev/`, `BLIP.md`, `.claude/`, `.env*`, `openedu.db`.
- commit an unrelated `package-lock.json` or `Cargo.lock` rewrite. Lockfiles change only with a justified dependency change.

**Agents:** the human contributor is accountable for every line. When the issue leaves a product or UX
question open, take the default the issue states (or the simplest option), and list the decision under
"Open questions" in the PR body. Leave the PR as a draft; the human marks it ready after reviewing it.
