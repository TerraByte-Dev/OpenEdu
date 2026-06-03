# Settings architecture

A tabbed, left-rail Settings view built from a **declarative section registry** and a set of small,
app-agnostic **primitives**. The goal: adding or changing a settings area is a local, low-risk edit, and the
bug-prone logic lives in pure, unit-tested modules rather than inside components.

```
App.tsx ──renders──▶ views/settings/Settings.tsx     (the shell)
                       │
                       ├─ registry.tsx   SECTIONS: SectionDef[]   ← add a tab = add one entry
                       ├─ primitives.tsx Section / SettingRow / Toggle / SegmentedControl /
                       │                 SecretField / Disclosure / ActionButton + SettingsContext
                       └─ sections/*.tsx ProviderModels · WebLibrary · Permissions · Appearance · About
```

## The shell — `Settings.tsx`

Renders the left rail from `SECTIONS`, routes to the active section, owns the **search box** and the footer
**save indicator**, and provides `SettingsContext` (`{ query, markSaved }`). It takes one prop, `onSaved`,
which it passes to sections as `onProviderChanged` (so e.g. switching provider refreshes the titlebar dot).

## Save model

- **Non-secret controls autosave.** A change writes through its `store.ts` setter immediately and calls
  `ctx.markSaved()` to flash the footer. Free-text fields commit on **blur and Enter** (not per keystroke).
- **Secrets are explicit.** `SecretField` (API keys, Tavily key) never persists on keystroke — it has its own
  draft, a reveal toggle, and **Save** / **Verify** buttons. The Ollama URL uses the same explicit pattern
  via **Save & Check** (so a "connected" status always reflects a URL that was actually saved).

## Search

`SettingsContext.query` flows to `Section` / `SettingRow`, which self-hide when they don't match
(`matchText`, AND over whitespace-separated terms). The rail filters tabs by each `SectionDef.keywords` and
auto-jumps to the first match.

## Adding a section

1. Create `sections/MySection.tsx` exporting a default React component (use `useSettings()` for
   `markSaved`, and the primitives for layout).
2. Add one entry to `SECTIONS` in `registry.tsx`: `{ id, label, keywords, icon, Component }`.
   `keywords` should cover the section's rows so search can find them.

## Pure logic (Tauri-free, unit-tested in `*.test.ts`)

The decisions most likely to harbor bugs are factored out of the components so they can be tested in node:

| Module | Responsibility |
|---|---|
| `lib/store-keys.ts` | Single source of truth for plugin-store key names + the secret predicate + the import allow-list. Consumed by `store.ts` **and** `settings-io.ts` so the two can't drift. |
| `lib/models.ts` | Model catalog + `defaultGeneration/Chat/EmbeddingModel` (derived from the `recommended` flag) — one source for the pickers and the store defaults. |
| `lib/version.ts` | `compareVersions` / `isNewerVersion` for the About → Check-for-updates flow (SemVer core + prerelease aware). |
| `lib/text-match.ts` | `matchText` — the search filter. |
| `lib/settings-schema.ts` | `parseSettingsExport`, `sanitizeImportedPermissions` (drops garbage so the kernel never reads bad rules), `isKnownThemeId` — the import-validation core. |
| `lib/theme.ts` | Theme registry + `resolveCrtOff` (universal themes force the CRT overlay off; CRT themes honor the manual toggle). `useTheme.ts` is the React subscription used by the titlebar + Appearance tab. |
| `lib/permissions/presets.ts` | Standard / Cautious / Trusting presets + `detectPreset`. The **exam column is identical across presets** (integrity invariant — presets only change `default`/`study`). |

## Invariants — don't break these

- The **`PermissionRules` shape and `evaluate.ts` contract are fixed**; presets/import only ever produce
  valid rules over the known tool × mode × decision space.
- **`store.ts` keys are stable** (existing users have persisted values) — change them only via `store-keys.ts`
  (and add a migration if a rename is ever needed).
- **Themes are CSS-variable only.** A theme is a `[data-theme="…"]` block in `index.css` plus a `THEMES`
  entry; never special-case a theme in component code.
