<!--
Title: a Conventional Commit, e.g. `feat(tools): read a passage from a granted folder`.
Open as a draft. Mark it Ready for review only after the checklist is done. The maintainer merges; contributors never do.
Full rules: AGENTS.md
-->

## Summary
<!-- What changed and why, in 2–5 lines. Name any schema change (new migration version), new tool, new Tauri command or new dependency (with the reason). -->

Closes #<!-- issue number -->

## How to test
<!-- Steps a reviewer can follow in `npm run tauri dev`, including which model/provider you used. -->
1.

## Screenshots / GIF
<!-- Required for any UI change: before and after. Delete this section if nothing visible changed. -->

## Open questions
<!-- Decisions you made where the issue left room. Write "None" if there are none. -->

## Checklist
- [ ] `npm test` and `npm run build` pass locally
- [ ] Touched `src-tauri/`? `cargo test --manifest-path src-tauri/Cargo.toml` passes and I ran `npm run tauri dev` (CI doesn't build Rust)
- [ ] New logic has tests that go through the same code path production uses
- [ ] Works with the network unplugged; no new runtime network dependency
- [ ] New model calls are structured + validated and considered on a small model
- [ ] No edits to a shipped migration; any schema change is a new version and named in the Summary
- [ ] No version bumps, and no release, packaging, signing or CI config changes
- [ ] Either no new dependencies, or each one is justified in the Summary
- [ ] I, the human contributor, have read and understood every line of this diff, including code my agent wrote
