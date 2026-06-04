# README screenshots — shot list & capture guide

The README's **Screenshots** grid pulls PNGs from this folder. Capture them live from the running
desktop app (`npm run tauri dev`) so they show real data and the app's own CRT window chrome.

## Capture settings (keep them consistent)

- **Window size:** resize the app to **1440 × 900** before capturing (a clean 16:10). Capture the whole
  app window *including* its frameless titlebar — that titlebar is part of the look.
- **Theme:** default **blue phosphor** (`#00C6FF`) so the set is cohesive (the `themes` shot is the
  intentional exception — it shows the picker).
- **Format:** PNG. Don't upscale — capture at native resolution and let the README size them.
- **Content:** use a real, finished course with a few notes — empty states photograph poorly.
- **Tip (Windows):** `Alt + PrintScreen` grabs just the focused window; or Snipping Tool → Window mode.

## In the README now

| File | View | Shows |
|---|---|---|
| `course.png` | Course → Overview | A generated 6-level curriculum with mastery tracking. |
| `library.png` | Resources / Library | The curated, offline reference library. |
| `themes.png` | Settings → Appearance | The CRT theme picker (recolors + Dark/Light). |
| `settings.png` | Settings → Provider & Models | Bring-your-own-key provider/model selection. |

## Wanted next (the two showpieces still missing)

Capture these at 1440 × 900, default blue-phosphor theme, then drop them in — the README will be
expanded to feature them:

| File | View | Shows |
|---|---|---|
| `notebook.png` | Course → Notebook → graph | The airy vault graph: note circles + amber `#tag` diamonds + folders, with `[[link]]` edges. (Import the sample Chemistry vault first.) |
| `course-chat.png` | Course → Chat | A tutoring exchange with **rendered math and/or a diagram**, ideally with a Library citation chip visible. |

Once a PNG is in this folder with the right name, wiring it into the grid is a one-line change.
