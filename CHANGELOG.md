# Changelog

All notable changes to **OpenEdu** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Installed apps auto-update; the section for each release also shows up in the in-app update prompt.

## [Unreleased]

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

[Unreleased]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/TerraByte-Dev/OpenEdu/releases/tag/v0.1.0
