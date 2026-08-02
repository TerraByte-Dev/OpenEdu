# Design notes — known rendering defects

Found while building the design system (`design/`, `scripts/build-design-system.mjs`). Recorded rather
than fixed: the design-system work is deliberately additive and touches no app code. Each of these is a
small, self-contained fix whenever someone wants to take them.

The design-system cards are authored **correctly**, so none of these are baked into what Claude Design
learns. That's the reason it was safe to leave them.

---

## 1. All four font utilities are tree-shaken — `src/index.css:295-298`

The `@theme` block declares the font aliases under the wrong Tailwind v4 namespace:

```css
@theme {
  --font-family-display: var(--font-display);   /* v4 namespace is --font-*, not --font-family-* */
  --font-family-mono:    var(--font-mono);
  --font-family-lcd:     var(--font-lcd);
  --font-family-body:    var(--font-body);
}
```

Tailwind v4 reads font families from `--font-*`. Because these are `--font-family-*`, no
`font-display` / `font-mono` / `font-lcd` / `font-body` utility is generated — grepping the production
bundle for `font-family-` returns nothing.

**Visible effect:** `ResourcesTab.tsx:186` uses `className="... font-display"` and renders in the body
font instead of Lexend. `Dashboard.tsx:431` does the same thing correctly via an inline style, which is
why it looks right there and wrong here.

**Why `font-mono` still appears to work:** by accident. The unlayered `:root` in `index.css` declares
`--font-mono`, which collides with the name Tailwind uses for its own default and beats it on cascade
precedence. 57 usages currently ride on that collision. Renaming the tokens to `--font-*` fixes the four
utilities *and* removes the accident.

**Fix:** rename the four keys inside `@theme` to `--font-display`, `--font-mono`, `--font-lcd`,
`--font-body`. Worth checking the 57 `font-mono` usages still render afterwards.

---

## 2. `btn-primary/20` is not a class — the user's own chat bubble has no background

`btn-primary` is a plain CSS class in `index.css`, not a Tailwind colour utility, so the `/N` opacity
modifier doesn't apply to it — `btn-primary/20` compiles to the literal string `btn-primary/20`, which
matches no CSS at all. The element renders with no background.

| Site | What's affected |
|---|---|
| `ChatTab.tsx:558` | **The user's own message bubble.** The one element meant to be visually distinct from the tutor's is transparent. |
| `ChatTab.tsx:490` | pending-mode chip |
| `ChatTab.tsx:786` | Allow button |
| `ChatTab.tsx:816` | `ask_user` choice buttons |
| `PromotionTestFullScreen.tsx:371` | test header badge |

**Fix:** use a real value — `bg-[rgb(var(--phosphor-rgb)/0.18)]` — or add the `btn-primary` background
as a proper theme colour. The design system's Buttons and Chips cards both use the explicit
`rgb(var(--phosphor-rgb) / …)` form.

---

## 3. Double-applied alpha makes the selected quiz answer invisible — `QuestionRenderer.tsx:139`

```
bg-[rgb(var(--phosphor-rgb)/0.14)]/10
```

The arbitrary value already carries `0.14`; the trailing `/10` multiplies it again, giving roughly
**1.4%** effective opacity. This is the *selected answer* highlight — the fill is invisible and only the
border communicates selection.

`Dashboard.tsx:53` has the same shape (`…/0.14)]/20` → ~2.8%) on the active pipeline-step icon.

**Fix:** drop the trailing modifier and let the arbitrary value stand.

---

## Not defects, but worth knowing

- **`--rule-dim` and `--rule-w` are dead** — zero uses. Deliberately excluded from the design-system
  cards so they don't get generated with.
- **`src/components/terminal/`** — five well-written primitives (`Window`, `Tag`, `Crumb`, `Lcd`,
  `GlowLine`) with zero importers. The CSS classes they wrap are excellent and in active use; only the
  React wrappers were abandoned. The design system documents the classes.
- **`src/views/settings/primitives.tsx`** is the best-written UI code in the repo and its own header
  says it's liftable into another app — but nothing outside `views/settings/` imports it. The Form
  Controls card mirrors it.
- **There are zero `focus-visible` rules in `src/`.** The design system's Interaction States card
  proposes one. This matters more than it looks for an app aimed at shared school hardware, where a
  broken or missing mouse is ordinary.
