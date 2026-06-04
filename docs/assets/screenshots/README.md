# README screenshots — shot list & capture guide

The README's **Screenshots** grid pulls these four files from this folder. Capture them live from the
running desktop app (`npm run tauri dev`) so they show real data and the app's own CRT window chrome.

## Capture settings (keep them consistent)

- **Window size:** resize the app to **1440 × 900** before capturing (a clean 16:10). Capture the whole
  app window *including* its frameless titlebar — that titlebar is part of the look.
- **Theme:** default **blue phosphor** (`#00C6FF`) for all four, so the set is cohesive. (A second
  theme can be shown once, in `course-chat`, if you like.)
- **Format:** PNG. Don't upscale — capture at native resolution and let the README size them.
- **Content:** use a real, finished course with a few notes — empty states photograph poorly.
- **Tip (Windows):** `Alt + PrintScreen` grabs just the focused window; or Snipping Tool → Window mode.

## The four shots

| File | View | What to show |
|---|---|---|
| `dashboard.png` | Dashboard | The glowing **OPENEDU** wordmark header + a couple of generated course cards (or the "INIT NEW_COURSE" panel mid-generation). |
| `course-chat.png` | Course → Chat | A tutoring exchange with **rendered math and/or a diagram**, ideally with a Library citation chip visible. |
| `notebook.png` | Course → Notebook | A note open in the live-preview editor showing `[[wiki-links]]` and `#tags`, **or** the vault graph view (note circles + amber tag diamonds). |
| `library.png` | Resources / Library | The curated Library browser — a subject open with a few reference cards. |

Optional extras (not referenced by the README yet — add rows if you want them):
`quiz.png` (a quiz / promotion test), `settings.png` (the themed Settings), `themes.png` (a theme montage).

Once the four PNGs are in this folder, the README grid renders automatically — no markup changes needed.
