# README screenshots — shot list & capture guide

The README's **Screenshots** grid pulls PNGs from this folder. Capture them live from the running
desktop app (`npm run tauri dev`) so they show real screens, including the app's own frameless titlebar.

## Capture settings (keep them consistent)

- **Separate data:** run the dev app under its own identifier so captures never touch a real install's
  learners or courses:
  `npm run tauri dev -- --config '{"identifier":"com.terrabytesolutions.openedu.uxdev"}'`.
  Use made-up demo courses, notes and learner names, never real student data.
- **Viewport:** **1280 × 800** CSS pixels at 1× scale, the whole app window *including* its titlebar.
- **Mode:** the Notebook look, **Light** (the default) unless the shot is meant to show **Dark**. Switch
  with the sun/moon button in the titlebar or **Settings → Appearance**. Each shot below says which.
- **Format:** PNG, under ~600 KB. Don't upscale — let the README size them.
- **Content:** use a finished course with some progress, a chat with a real tutor reply and a few
  linked notes — empty states photograph poorly.
- **Tip (Windows):** `Alt + PrintScreen` grabs just the focused window; or Snipping Tool → Window mode.
  For exact sizes, start the dev app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`
  and capture over the Chrome DevTools Protocol (`Emulation.setDeviceMetricsOverride` +
  `Page.captureScreenshot`).

## In the README now

| File | Mode | View | Shows |
|---|---|---|---|
| `home-light.png` | Light | Home | The learner's landing screen: Continue, today's goal, course cards. |
| `home-dark.png` | Dark | Home | The same screen in dark mode. |
| `chat.png` | Light | Course → Chat | A question and a tutor reply from a local model, with the follow-up chips. |
| `course-dark.png` | Dark | Course → Overview | The level's topics, what you know, progress. |
| `notebook.png` | Dark | Course → Notes → graph | The vault graph: note circles, folder squares, `#tag` diamonds, `[[link]]` edges. |
| `library.png` | Light | Course → Resources | Library cards recommended for the course. |
| `appearance.png` | Light | Settings → Appearance | Light / Dark / Match my computer. |

Once a PNG is in this folder with the right name, wiring it into the grid is a one-line change.
