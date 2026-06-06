# Changelog

All notable changes to **OpenEdu** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Installed apps auto-update; the section for each release also shows up in the in-app update prompt.

## [Unreleased]

### Changed
- **Quizzes and tests grade at the end, not mid-test.** Written and fill-in-the-blank answers used to
  trigger a model call the moment you submitted each one, which made `gemma4:e4b` and the whole machine
  stutter during the test and again in a cascade at the finish. Now those answers are recorded as you go
  and graded together in one pass on a brief "Grading…" screen (exact / numeric answers settle instantly
  with no model call at all), results render immediately, and the heavier bookkeeping moves to the
  background. Multiple-choice and true/false still grade instantly as before.

### Removed
- **Dead promotion-test modal.** Removed an unused `PromotionTestModal` left over from the old half-level
  scheme (the app uses the full-screen promotion test); no behavior change.

### Fixed
- **Quiz/test answers can no longer contradict their own explanation.** The generator sometimes stored a
  "correct" answer that disagreed with the reasoning it wrote — e.g. an ion-charge question whose
  explanation worked out to 9 electrons but whose stored answer was 6 — which then marked your right
  answer wrong. Generation now checks each answer against the value its own explanation derives, makes the
  model commit to a worked answer, and (on capable models) independently re-solves and drops questions
  whose answer doesn't hold up.
- **Quizzes and promotion tests reliably reach their length.** A single timed-out or rejected batch used
  to silently drop a whole subtopic's worth of questions, leaving you with a short test (~10 when 20 were
  expected). Generation now tops up to target (quizzes 10–20, tests 30–45) and tells you honestly if your
  model still came up short.
- **A timed-out promotion test now scores the answers you actually gave** instead of counting everything
  wrong.
- **Settings "Provider & Models" icon renders cleanly.** Seven of the icon's chip "spoke" path segments
  were missing their SVG `moveto` (`M`) command, so the spokes silently failed and the dev console logged
  a `<path> attribute d` error for each on every launch. Prefixed them; no more console noise.

## [0.2.0] - 2026-06-05

_"Close the Learning Loop" — the pedagogy that turns a chat app into a tutor that makes learning stick:
spaced repetition, retrieval practice, readable lessons, a progress dashboard, and a course-completion
capstone, plus a notebook-import robustness fix._

### Added
- **Course-completion capstone.** Passing the Level 6 mastery exam now opens a proper finish screen —
  your final score, subtopics mastered across all six levels, and the synthesis skills you've earned —
  with an option to archive the course. Completed courses show a **COMPLETE ✓** badge.
- **Progress dashboard.** The course Overview now shows trends built from your own history — a study
  **streak**, quizzes taken, average score, time on task, a recent-scores sparkbar, and a per-subtopic
  accuracy heatmap for the current level. No new model calls; it visualizes data that was already being
  recorded (and lights up the streak counter that previously did nothing).
- **Lessons.** A new **Lessons** tab gives each subtopic a clean, readable walkthrough — the missing
  middle between the syllabus and chat. Lessons are written on demand (schema-enforced, small-model
  reliable), cached, and track read/unread; the Next-step card links you straight to one for an
  untouched subtopic.
- **Spaced repetition & flashcards.** A new **Review** tab runs a due-card queue with an SM-2-lite
  scheduler (Again / Hard / Good / Easy) — the most evidence-backed retention technique, running fully
  offline on your machine. The tutor can mint cards in Review mode ("make a card for this"), you can add
  your own, and missed promotion-test questions auto-become cards so the queue fills itself.
- **Retrieval practice in quizzes.** Study quizzes now interleave ~20% previously-missed questions
  (spaced review) with fresh ones, and offer an optional "in your own words, why is that the answer?"
  self-explanation prompt after each answer — two of the best-evidenced study techniques (the testing
  effect, Roediger & Karpicke 2006; the self-explanation effect, Chi 1989). A previously-mastered
  subtopic that slips is flagged for review and clears once you're solid again. A brand-new course with
  no history behaves exactly as before.

### Fixed
- **Notebook import no longer drops files when the embedder is offline.** Importing several notes
  while Ollama (the embedder) isn't running used to fail on the first file and silently drop the rest.
  Now every note is created regardless, and you get an honest message — "imported N, M couldn't be
  embedded for search; they'll re-index next time you open and save them" — instead of a raw error.

## [0.1.6] - 2026-06-04

### Changed
- **App data now lives under a domain-accurate identifier** (`com.terrabytesolutions.openedu`). Corrected
  now, while the app is brand new, to get it right before it matters. One-time note: this is a fresh start —
  data from an earlier install is not migrated to the new location.

## [0.1.5] - 2026-06-04

### Fixed
- **Notebook graph is airier, Obsidian-style.** Nodes now float apart (stronger repulsion + collision
  spacing) instead of clumping, nodes are smaller, and labels stay a readable size at any zoom — fixing
  the oversized labels that appeared when zooming in. The graph also auto-fits to the view once it settles.

## [0.1.4] - 2026-06-03

### Added
- **Note-free `#tags` in the notebook.** Click a `#tag` (in the editor or the sidebar) to open a
  filtered view of every note that carries it, and see tags as their own nodes in the vault graph.
  Tagging a note never creates a note.

### Changed
- **`[[links]]` to a missing note no longer auto-create a phantom note.** Clicking an unresolved link
  now offers an explicit "Create note" action; missing links render dashed until they exist.

## [0.1.3] - 2026-06-03

### Changed
- The main-page **OpenEdu wordmark now glows** in the active accent color across every theme.

## [0.1.2] - 2026-06-03

### Changed
- Adopted the **VT323 pixel font** for the OE monogram and the main-page wordmark.

## [0.1.1] - 2026-06-03

### Changed
- Restored the **VT323 pixel font** for the boot sequence.

## [0.1.0] - 2026-06-03

### Added
- **Initial public release.** Generate a focused 6-level course for any topic; tutor chat with rendered
  math and diagrams; an Obsidian-style notebook with local retrieval (`[[wiki-links]]`, embeddings, a
  vault graph); quizzes and promotion tests; a curated offline Library the tutor can cite; per-mode
  tutor permission presets; and the CRT "blue phosphor" theme system. Bring-your-own-key — runs free on
  local Ollama, with OpenAI / Anthropic as alternates.

[Unreleased]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.6...HEAD
[0.1.6]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/TerraByte-Dev/OpenEdu/releases/tag/v0.1.0
