# Changelog

All notable changes to **OpenEdu** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
The section for each release is also what the app shows when you press Check for updates.

## [Unreleased]

### Added
- **Set up with no internet.** When Ollama is missing or stopped, the setup screen says which, in plain
  words, and how to fix it. If you have an OpenEdu kit on a USB stick, it can find Ollama's installer
  on it and show you where it is (OpenEdu never installs anything itself). When Ollama has no model,
  you can import one from a USB stick or folder, from the setup screen or Settings › Models: OpenEdu
  checks there's room, checks each file against its checksum (a kit without a checksum file still
  imports, but OpenEdu says it couldn't check it), copies it into Ollama with a progress bar you can
  cancel, and makes it your tutor model. It never replaces a model you already have. How to make a
  kit is in `docs/OFFLINE-KIT.md`.

### Security
- A picture in a tutor reply, a lesson or a library card that links to another website is no longer
  loaded. Loading it told that website when the learner opened the message, and its address could
  carry words from the conversation. Pictures built into OpenEdu still show.

### Changed
- Importing a model no longer warns that Google's Gemma Terms of Use must travel with a Gemma 4 model. Gemma 4 is Apache 2.0; the reminder (on the import screen and in `scripts/export-model.mjs`) now covers only Gemma 1 to 3.
- **OpenEdu is now for one learner.** Class and school modes, the "Who uses this computer?"
  question, the teacher PIN, the teacher view and its spreadsheet export, and adding learners are
  gone from OpenEdu. Features for families, classes and schools are in TerraTutor, a separate
  commercial edition by TerraByte Solutions. Nothing is deleted: if your computer has several
  learners, OpenEdu still asks who is learning when it starts, every learner keeps all of their
  courses, and a learner's PIN still guards them. Each learner can still change their name, and
  change or remove a PIN they already have after typing it. On a computer that was never set up for
  a class or school, a learner can also add a PIN or remove themselves until one is left; on a class
  or school computer they can't, since no teacher can undo it any more. Settings is no longer behind
  a teacher PIN, so a class computer's Settings, including the backup, are open to whoever is
  signed in.
- **Change your name in Settings.** Settings › **Name & grade** holds your name next to your grade
  (it replaces "Who uses this"). There is no "set a PIN" there: with one learner there is nobody to
  keep out, and a PIN that can't be reset could only lock you out.
- **A forgotten learner PIN cannot be cleared inside OpenEdu.** That learner's courses stay in the
  database file and in backups, but can't be opened in OpenEdu. PIN resets are a feature of
  TerraTutor, TerraByte Solutions' separate commercial edition.
- **Newer cloud models.** OpenAI now defaults to **GPT-6.1 Sol** for building courses and
  **GPT-6 Luna** for the tutor, with GPT-6 Astra on offer too. Anthropic's tutor default is now
  **Claude Haiku 5.5**; Claude Opus 4.6 stays the course-building default, because the newest Opus
  and Sonnet do not yet work with the way OpenEdu asks for structured answers. GPT-4.1, GPT-4.1 Mini,
  GPT-4o and GPT-4o Mini are gone from Settings: OpenAI switches them off on 14 January 2027, and
  from that day a saved choice of one of them moves to the new default by itself. Claude Haiku 4.5
  is gone from Settings too (Haiku 5.5 replaces it); it still works, so a saved choice of it is kept.
  A saved model that is no longer in the list now shows as its own selected chip, so Settings always
  shows the model OpenEdu will use. Checking an API key in Settings now uses the current default model.

## [0.4.0] - 2026-11-10

### Added
- **A new look: Notebook.** The black terminal look and its eleven colour themes are gone. OpenEdu is
  now warm paper and ink blue, with a calm navy dark mode. Pick **Light**, **Dark** or **Match my
  computer** in Settings, or flip between them with the sun/moon button in the title bar. Lexend is
  used everywhere, chosen because its letter spacing helps reading. Older theme choices carry over to
  Light or Dark.
- **A Home screen for learners.** It opens on one big **Continue** button that takes you to your
  latest course, on the right step. Below it are a **daily goal** (10, 15, 20 or 30 minutes a day,
  changeable in place) and cards for your courses.
- **Several learners on one computer.** Each learner gets their own courses, chats, notes, quizzes,
  flashcards and progress, with an optional PIN. On a fresh install OpenEdu asks who uses the
  computer: **just me**, **a class** (pick your name at every launch, with a teacher PIN guarding
  Settings) or **a school**. Existing installs start as "just me", with everything kept.
- **Back up your learner data.** Settings → **Learner data** saves a full copy of your data to a file
  you choose. The database is also more resistant to power cuts, and if it is ever damaged OpenEdu
  says so in plain words and shows how to restore a backup.
- **Try first, then the answer is one tap away.** After you have had a go at the tutor's question, a
  **Show me the answer** chip appears and gives the full worked answer. Before a try, you get hints.
- **The tutor checks before it praises.** When you answer a problem, the tutor is told to check your
  answer before it says it is right, and to say so when you have a correct step but not the final
  answer. When you post a new multiple-choice problem, it asks for your try before solving it.
- **A safety notice on health topics.** A course about health, first aid or medicine shows a short
  notice: the AI can get these facts wrong, call your local emergency number in an emergency, and
  check with a health worker. Nothing is ever blocked.
- **Questions in other scripts find your notes.** A question written mostly in a non-Latin script
  (Hindi, Amharic, Arabic and others) is glossed into English before the lookup. Non-Latin and
  accented words are now read as whole words everywhere the app matches text; before, such a question
  got no lookup at all.
- **Two new Library units: the body's systems**, for school health classes.
- **"Check if I've got this" is reachable.** It leads the chips once every subtopic at your level is
  mastered.

### Changed
- **Plain English everywhere.** Labels like `INIT NEW_COURSE`, `EXECUTE` and `LOADED COURSES` are now
  *Start a new course*, *Create course* and *Your courses*. Course building shows plain steps
  ("Writing Level 2"), and the 3.7-second fake boot log is a short splash.
- **The default model fits the computer.** On first run OpenEdu picks `gemma4:e4b` on machines with
  16 GB of RAM or more and `gemma4:e2b` below that. A model you chose yourself is never changed. The
  old `llama3` default, which was never tested with OpenEdu, is gone.
- **The citation chip says what it means.** It now reads **Quotes from: <note>**: the answer repeats
  wording from that passage, which is not the same as the passage answering your question.

### Fixed
- **Every equation in a reply renders**, not just the first one. Dollar amounts, unclosed `$`, `\( \)`
  and `\[ \]`, and bare `\frac` no longer break the ones after them.
- **A model that loops can no longer hold the computer.** Each reply is capped at the context window,
  so a runaway answer stops instead of running until someone restarts Ollama.
- **No more red "Ollama error 500" when a small model writes a broken tool call.** The tutor answers
  without tools instead.
- **List answers with commas are graded correctly.** "neck, armpits and groin" used to be marked wrong
  because the comma stuck to the word.
- **Library search no longer matches inside words.** The alias "pH" matched "paragraph" and "graph".
- **The Library address no longer points at openedu.app**, a domain OpenEdu no longer controls. The
  default install always used the bundled Library and was never affected.

### Security
- **Updated zod, mermaid, DOMPurify and lodash-es** past published advisories (one critical, two
  high, one moderate). zod checks the model's structured output and mermaid draws diagrams the model
  writes, so both handle untrusted text.

## [0.3.0] - 2026-10-08

### Added
- **The tutor reads your notes and the Library before it answers — every time.** Looking things up used
  to be the model's decision, and a small local model usually decided not to. Retrieval is now a step
  that runs before the model sees your question, so the passages are simply there. On `gemma4:e4b`, a test set of 12 questions whose answers
  live only in the notes, each asked three times, went from 6 of 36 answered from the notes to 36 of 36. It works with no embedding model installed too: the Library half needs no model at all.
- **A "Grounded in" chip you can trust.** It appears only when the answer actually reuses the retrieved
  text, so that chip can't be invented. When passages were found but the answer doesn't closely follow
  them, the tutor says it answered from general knowledge, not your notes. The check is strict: a short
  answer that paraphrases a note can be labelled general knowledge.
- **Conversation threads.** Each level used to hold one endless transcript, and an older topic
  eventually scrolled out of reach. Start a new thread whenever you like; they title themselves and sit
  in a list beside the chat. Your existing history is kept as a thread called "Earlier conversation".
- **Follow-up chips under the latest reply** — up to three, chosen from what just happened: "Give me a
  hint" and "Walk me through it" when the tutor asks you something, otherwise suggestions such as
  "Worked example", "Make me figure it out" and, when there is room, "Quiz me on this". They replace
  the mode bar (see Changed).
- **A first-run setup that tells the truth.** The boot screen used to print "Ollama LISTENING" and a RAM
  figure without checking anything. It now really probes: it tells you if Ollama isn't running or your
  tutor model isn't installed, downloads that model from inside the app, and then gives a short tour.
- **A "Context window" setting** for local (Ollama) models, defaulting to 8192 tokens (roughly 48
  messages of history). In tutor chat it overrides whatever Ollama is configured with, and is capped at
  what your model supports.
- **Your notes now know what links to them.** Open a note and the right-hand panel lists every note
  that links here, with the line it appears on — plus **unlinked mentions**, notes that say this note's
  title in prose without linking it. The two are counted separately on purpose: one is a fact about
  your vault, the other is only a suggestion.
- **An outline of the open note**, in the same panel. Click a heading to jump to it. Fenced code blocks
  are skipped, so a `# comment` in a shell snippet doesn't become a heading.
- **`[[` autocompletes note titles** as you type. It only offers notes that exist — a missing link still
  never creates anything on its own.
- **Quick switcher — `Ctrl`/`Cmd`+`O`.** Fuzzy jump to any note; `cvc` finds "Calvin cycle". It can't
  create notes either.
- **An assistant in the note panel.** Two actions, no prompt to write:
  **Review this note** marks it up in place — wrong, missing, worth checking, and what you got right —
  as coloured underlines over your own text. Fixing something the reviewer flagged makes its mark
  disappear. **Notes from last chat** turns your most recent tutor conversation on that level into
  markdown you can keep. Neither one edits your note: marks are an overlay, and the summary is a
  preview with an explicit Insert.
- **A keyboard focus ring.** There wasn't one anywhere, which made the app effectively unusable without
  a mouse — a real problem on shared or donated hardware.

### Changed
- **Updates happen only when you ask.** OpenEdu is offline-first, but it used to contact GitHub a few
  seconds after every launch to look for a new version. It no longer does. To update, open **Settings →
  About → Check for updates**.
- **Inside a course, the left column belongs to that course.** The course list is hidden while you're
  in one (the back arrow returns to it), and the column holds the course's tabs plus, on the Chat tab,
  your conversation threads.
- **The mode bar is gone.** Explain / Socratic / Quiz Me / Review / Hint / Assess asked you to classify
  your question before asking it. Plain typing explains; when a follow-up chip for hinting, Socratic
  questioning, quizzing or flashcard review is offered, it applies that mode for the one turn you tap
  it. There is no chip for Assess in this release.
- **The notebook looks like a notebook now.** Quieter chrome throughout: ghost icons instead of filled
  toolbar buttons, 24px rows, one hairline indent guide per nesting level, full-width selection instead
  of a border stripe, and no file icon on every row. Consistent line-art icons replaced the mixed
  `＋ ✎ ✕ ▾ ▸` text glyphs.
- **The note editor uses Lexend**, the face chosen for reading comprehension, instead of a hardcoded
  Inter. Notes are the most-read surface in the app and were the one place opting out of it.
- **Question generation now fits the model.** On a **local** model we generate **one question per call**
  (with a running "don't repeat these" ledger so coverage stays varied) — far more reliable than asking a
  4B model for a whole batch as one giant JSON object (which was timing out and truncating), and each
  question gets the model's full attention. On a **cloud** model we **batch** questions per subtopic to
  keep the call count and token use low (friendly to free-tier keys). Both show a live "N / M questions"
  progress count while generating.
- **Quizzes and tests grade at the end, not mid-test.** Written and fill-in-the-blank answers used to
  trigger a model call the moment you submitted each one, which made `gemma4:e4b` and the whole machine
  stutter during the test and again in a cascade at the finish. Now those answers are recorded as you go
  and graded together in one pass on a brief "Grading…" screen (exact / numeric answers settle instantly
  with no model call at all), results render immediately, and the heavier bookkeeping moves to the
  background. Multiple-choice and true/false still grade instantly as before.
- **The Library ranks cards better, and the tutor's automatic lookup stays quiet when it has nothing.**
  Common words like "rules", "types" and "point" used to count as much as the word that carried the
  meaning. Terms are now weighted by how rare they are, a card has to cover the question rather than
  one word of it, and key terms from each card's body are indexed alongside its title and aliases —
  "what is a lanthanide" used to return nothing at all and now finds the periodic table in Resources
  search. On the 154 bundled cards, for the eleven test questions the Library cannot answer, the lookup
  that runs before each answer now injects nothing (five of them cleared the bar before). Resources
  search, and the tutor's own library search when it chooses to call it, still list the closest cards
  for any query, in the new order.
- **Notebook search no longer pulls the text of every note to rank it.** Every search used to load the
  full text of every chunk alongside its vector just to score it and throw all but a handful away. It
  now ranks on the vectors alone and fetches text only for the winners, and newly indexed notes store
  their vectors in a format less than half the size. Existing notebooks keep working as they are —
  nothing is re-embedded on upgrade, so they keep the larger format until a note is re-indexed.

### Removed
- **The launch-time update banner**, along with the check behind it (see Changed).
- **Dead promotion-test modal.** Removed an unused `PromotionTestModal` left over from the old half-level
  scheme (the app uses the full-screen promotion test); no behavior change.
- **24 dead `text-white` classes.** They never applied — `.btn-primary` wins that cascade — so removing
  them changes nothing on screen. Documented here because an earlier note claimed they were breaking the
  Light theme, and that was wrong.
- **The Study and Exam columns in Settings → Permissions.** Nothing in the app ever switched into
  those modes, so two of the three columns were settings you could tune to no effect — under a heading
  that claimed Exam mode applied during promotion tests. The editor now shows the one column that does
  something. Saved Study/Exam values are kept, and still survive a settings export and import.

### Fixed
- **Long conversations no longer make the tutor forget who it is.** OpenEdu never told Ollama how big a
  context window to use, so Ollama used its own default and silently dropped the oldest text — which is
  where the tutor's instructions and its list of tools live. The app now sets the window explicitly and
  trims old history itself, never the instructions or your question. On Ollama setups that capped replies at about a hundred words, replies are no longer cut off: the
  app now sets the reply limit itself too.
- **Your own chat messages had no background.** The class meant to tint them wasn't a real class, so the
  one bubble that's supposed to look different from the tutor's was transparent. Four other controls had
  the same problem.
- **A stray `[[` no longer invents a link across your whole note.** An unclosed bracket used to swallow
  everything up to the next `]]` anywhere later in the document — inventing a link whose title spanned
  paragraphs, which then showed up as a real edge in the graph and as an underline running across the
  page.
- **The selected quiz answer is visible again.** Its highlight had opacity applied twice, landing at
  about 1.4% — only the border said anything was selected. Five other places had the same bug.
- **Primary buttons are readable on the Light theme.** The label sat on a wash of its own accent and
  measured 4.01 contrast — below WCAG AA. Now 4.88, and every one of the eleven themes improved.
- **Headings in the Resources tab render in the right font.** All four font utilities were being
  tree-shaken away because of a namespace typo, so `font-display` silently did nothing.
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
- **Small "reasoning" models no longer fail as if they were broken.** Newer local models think out
  loud by default, and on OpenEdu's structured calls they spent their whole context window reasoning
  and returned nothing — so the pre-flight check reported a working model as incompatible and told you to switch to a different one. OpenEdu now asks Ollama not to reason on these calls. The same gap meant
  course generation could save an **empty** tutor instruction with no error, leaving a course that
  looked generated and wasn't; that path is fixed too, and a model that reasons but never answers now
  gets a named error instead of a silent blank.
- **Models without tool support can chat again.** If your local model's Ollama template has no tool
  support, every tutor turn in Explain, Socratic, Review and Assess — and every math, code or music
  course — failed outright. OpenEdu now checks whether the model supports tools before offering any. Those models now get a plain
  grounded chat: no tools, but citations still work.
- **The tutor can no longer mark the wrong subtopic as mastered.** A blank or vague reference from the
  model used to resolve to the first subtopic that loosely matched — one that was only spaces matched subtopic 1
  every time — quietly dropping the wrong topic out of your gaps. An unclear reference now changes
  nothing, and the tutor is told which subtopics it could have meant.
- **The tutor can only run tools it was actually offered that turn.** A small model that named a tool
  outside its current mode still got it run — a stray "mark mastered" confirmation could pop up in
  Explain, where that tool was never on offer. Those calls are now refused before anything runs.
- **Courses stopped picking up the wrong subject helper.** Subject matching looked for keywords
  anywhere inside the course title, so "Animal Husbandry" and "First Aid: Bandaging Wounds" got the
  music tutor, and "Aftermath of World War I" got the math one. Keywords now match whole words only.

### Internal
- **A browsable design system** (`design/`, `npm run design`) — the palette, all eleven themes, type,
  the CRT overlay, and the component set, built into self-contained HTML cards and pushed to Claude
  Design so future work inherits the aesthetic. Foundations are generated from `src/index.css` so they
  can't drift; components are authored.
- **CI runs on every pull request**, not only those targeting `master`. PRs here are stacked, and
  filtering on the base branch meant only the bottom PR of a stack was ever checked — eleven of twelve
  open PRs had no checks at all.
- **Groundwork for studying from a folder on your disk** — read-only, limited to folders you pick,
  forgotten on restart. Nothing in the app uses it yet; this release adds only the plumbing and the
  folder-picker permission.
- **Groundwork for practice items compiled straight from source material**, with two sample units
  bundled. Not surfaced in the app yet.
- **The bundled Library now ships its content licence and attribution files.**

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

[Unreleased]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.6...v0.2.0
[0.1.6]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/TerraByte-Dev/OpenEdu/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/TerraByte-Dev/OpenEdu/releases/tag/v0.1.0
