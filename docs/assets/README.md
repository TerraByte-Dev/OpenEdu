# README brand assets

| File | Used by | How it's made |
|---|---|---|
| `openedu-wordmark.png` | README hero | Generated. CRT-era art (pixel font, cyan on black); see below. |
| `openedu-wordmark-transparent.png` | Alternate hero (transparent bg) | Generated. Transparent variant of the CRT-era hero. |
| `social-preview.png` | Repo **Settings → General → Social preview** (1280×640) | Generated. CRT-era art. Not referenced by the README body. |
| `terrabyte-logo.png` | README "brought to you by" + footer | Existing TerraByte Solutions mark. |
| `screenshots/*.png` | README screenshots | Captured live — see [`screenshots/README.md`](screenshots/README.md). |

## The wordmark and social card are waiting on the product name

The app dropped the black CRT look for **Notebook** in 0.4.0. The wordmark, its transparent variant and the
social card still show the old look on purpose: they will be redrawn once the product-name decision is
made, so they are only redrawn once. Until then, leave them as they are, and don't generate new CRT-style
art for them.

When they are redrawn, match the app as it is now rather than the old art. In the app the word "OpenEdu"
is set in **Lexend** (`--font-display`: the new-course header in `src/views/Dashboard.tsx`, the titlebar in
`src/components/Titlebar.tsx`, the sidebar header in `src/components/Sidebar.tsx`), on warm paper
`#FBFAF6` in navy ink `#0F1730`/`#1B2440`, with the ink-blue accent `#1E3A8A`. The dark-mode equivalents
are background `#0E1626`, ink `#E6ECF5`, accent `#5B9BFF`. The one pixel-font holdover is the small "OE"
monogram in the sidebar header (VT323, in the accent colour). No scanlines or glows. The token table in
[`CLAUDE.md`](../../CLAUDE.md) › Design system is the source for every colour.
