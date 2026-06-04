# README brand assets

| File | Used by | How it's made |
|---|---|---|
| `openedu-wordmark.png` | README hero (black-bg CRT wordmark) | Generated (Images 2.0 / gpt-image). Prompt below. |
| `openedu-wordmark-transparent.png` | Alternate hero (transparent bg) — swap into the README `<img>` if preferred | Generated. Transparent variant of the hero. |
| `social-preview.png` | Repo **Settings → General → Social preview** (1280×640) | Generated. Not referenced by the README body. |
| `terrabyte-logo.png` | README "brought to you by" + footer | Existing TerraByte Solutions mark. |
| `screenshots/*.png` | README screenshots grid | Captured live — see [`screenshots/README.md`](screenshots/README.md). |

The hero must match the **in-app** wordmark (`src/views/Dashboard.tsx` + `.wordmark-glow` in
`src/index.css`): a VT323-style blocky pixel font, OpenEdu phosphor blue `#00C6FF`, on black, with a
cyan bloom. Brand tokens: phosphor `#00C6FF`, bright `#44D8FF`, ink `#6DD4EE`, background `#000000`.

## Image-gen prompt — `openedu-wordmark.png` (hero, wide, on black)

> Wide banner logotype reading "OPENEDU" in a single line. Blocky pixelated bitmap typeface — chunky,
> low-resolution pixel letterforms like the VT323 / classic CRT-terminal / DOS-BIOS font, monospaced,
> uppercase, slightly wide letter-spacing. The letters glow in phosphor cyan-blue (#00C6FF) with a
> brighter #44D8FF core and a soft outer bloom/halo, like illuminated text on an old CRT monitor.
> Pure black (#000000) background. Subtle horizontal CRT scanlines across the whole image, very faint
> screen vignette in the corners, and a slight red/cyan chromatic-aberration fringe on the letter
> edges. Crisp, legible, centered, with generous padding around the word. Retro-futuristic terminal
> aesthetic, flat 2D (no 3D bevel, no perspective), no reflections, no extra text or icons.
> Aspect ratio 3:1 (wide). High resolution.

**Variant — transparent background** (drop the black bg line, append): *"Transparent background (alpha),
keep only the glowing pixel letters and their bloom."* Save as the same filename if you prefer flexible placement.

## Optional — GitHub social-preview card (`social-preview.png`, 1280×640)

> A 1280×640 social card on a pure black (#000000) CRT screen. Centered, the blocky pixelated
> bitmap-font logotype "OPENEDU" glowing in phosphor cyan-blue (#00C6FF) with a #44D8FF core and soft
> bloom. Below it, in a smaller thin monospaced terminal font in dim cyan (#6DD4EE), the tagline:
> "AN AI TUTOR THAT RUNS ON YOUR MACHINE". Faint horizontal scanlines, subtle vignette, slight
> chromatic aberration on edges. Lots of negative space, balanced composition, flat 2D retro-terminal
> aesthetic, no other text or logos.

(If you make this one, set it under repo **Settings → Social preview** — it doesn't need to live in the README.)
