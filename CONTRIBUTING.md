# Contributing to OpenEdu

Thanks for your interest in OpenEdu! It's a local-first AI tutor built to stay **reliable on small models**,
and contributions of all sizes are welcome — bug reports, docs, features, and curriculum/library content.

This guide gets you from clone to merged PR.

## Ground rules

- Be respectful and constructive. Assume good intent.
- By contributing, you agree your contributions are licensed under the project's [MIT License](LICENSE).
- **Never commit secrets** (API keys, tokens, `.env`, the local `openedu.db`). They're gitignored — keep it that way.

## Getting set up

See the [README quickstart](README.md#quickstart). In short:

```bash
git clone https://github.com/TerraByte-Dev/OpenEdu.git
cd OpenEdu
npm install
npm run tauri dev      # desktop app with hot reload
```

Requirements: Node 20.19+/22.12+, Rust + the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/),
and (for the free local path) [Ollama](https://ollama.com/) with a model pulled.

## Before you open a PR

Run these locally — CI runs the same on every PR:

```bash
npm test          # unit tests (vitest)
npm run build     # typecheck (tsc) + frontend bundle (vite)
```

If you touched the agent harness or tutoring flow, also smoke-test a real generation/chat turn in
`npm run tauri dev` against a local model.

## Workflow

1. **Open an issue first** for bugs, features, or anything non-trivial (skip it for typos / one-line fixes).
   Describe the problem, repro/spec, and acceptance criteria.
2. **Branch** off `master`: `type/short-desc` (e.g. `feat/142-apple-pay`, `fix/null-user`). Types:
   `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`.
3. **Commit** with [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): imperative subject`.
4. **Open a pull request** into `master` with a short summary and a test plan. Reference the issue
   (`Closes #N`). Keep PRs focused.
5. **CI must be green** (`Typecheck · test · build`) before merge.

## Code style & conventions

- **TypeScript**, strict. Match the surrounding code's style, naming, and comment density.
- **Add tests for pure logic.** New Tauri-free logic should get a `*.test.ts` next to it (see the
  existing suite under `src/lib/`).
- **Design system:** the UI is CSS-variable driven (CRT-phosphor aesthetic in `src/index.css`). Use the
  theme tokens (`--phosphor`, `--ink`, `--rule`, …) and existing classes — don't hardcode theme colors,
  so everything stays theme-aware. Settings has its own [architecture README](src/views/settings/README.md).
- **Small-model-first:** the generation pipeline (`src/lib/curriculum.ts`) is schema-enforced so it holds
  up on ~4B local models. Keep new model calls structured + validated; don't regress that reliability.
- **Don't modify a shipped `tauri-plugin-sql` migration** — add a new version instead.

A deeper tour of the codebase lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). [`CLAUDE.md`](CLAUDE.md)
has notes for AI-assisted development.

## Reporting bugs

Open an issue with: what you expected, what happened, steps to reproduce, your OS + provider/model, and
relevant logs. Minimal repros get fixed fastest.

## Reporting security issues

**Please don't open a public issue for vulnerabilities.** Use GitHub's private reporting:
**Security → Report a vulnerability** on the repo. We'll coordinate a fix and disclosure.

---

Built by [TerraByte Solutions LLC](https://github.com/TerraByte-Dev). Thanks for helping make learning free and local. 🌍
