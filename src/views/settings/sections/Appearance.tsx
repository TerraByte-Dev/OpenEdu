import { THEMES, applyTheme, setCrtOff, themeSupportsCrt } from "../../../lib/theme";
import { useThemeState } from "../../../lib/useTheme";
import { Section, SettingRow, Toggle, useSettings } from "../primitives";

export default function Appearance() {
  const { markSaved } = useSettings();
  // Live theme/CRT state via the shared hook (stays in sync when the titlebar toggles CRT, etc.).
  const { themeId, crtOff } = useThemeState();

  const pickTheme = (id: string) => {
    applyTheme(id); // dispatches oe-theme-change → useThemeState updates themeId
    markSaved();
  };

  const crtTheme = themeSupportsCrt(themeId);

  return (
    <>
      <Section
        title="Theme"
        description="Recolor the CRT look, or switch to a clean Dark/Light theme that drops the scanlines entirely. Applies instantly and is remembered."
        keywords="theme color appearance crt amber green synthwave dark light phosphor scanlines look skin"
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {THEMES.map((t) => {
            const active = themeId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => pickTheme(t.id)}
                className={`text-left rounded-xl border p-3 transition-colors ${
                  active ? "border-phosphor bg-[rgb(var(--phosphor-rgb)/0.08)]" : "border-[var(--rule)] bg-panel-lite/60 hover:border-[var(--ink-faint)]"
                }`}
              >
                {/* Swatch preview */}
                <div className="rounded-lg overflow-hidden border border-[var(--rule)] mb-2.5" style={{ background: t.swatch.bg }}>
                  <div className="h-16 flex items-center gap-2 px-3">
                    <span className="w-7 h-7 rounded-full shrink-0" style={{ background: t.swatch.accent, boxShadow: `0 0 10px ${t.swatch.accent}` }} />
                    <div className="flex-1 space-y-1.5">
                      <span className="block h-2 rounded-full" style={{ background: t.swatch.accent, opacity: 0.85, width: "70%" }} />
                      <span className="block h-2 rounded-full" style={{ background: t.swatch.ink, opacity: 0.55, width: "90%" }} />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? "border-phosphor" : "border-[var(--rule)]"}`}>
                    {active && <span className="w-1.5 h-1.5 rounded-full bg-phosphor" />}
                  </span>
                  <span className={`text-sm font-semibold ${active ? "text-phosphor-bright" : "text-ink"}`}>{t.name}</span>
                  <span className="ml-auto text-[9px] uppercase tracking-wider text-[var(--ink-faint)] border border-[var(--rule)] rounded px-1.5 py-0.5">
                    {t.family === "crt" ? "CRT" : "Clean"}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--ink-faint)] mt-1.5 leading-relaxed">{t.blurb}</p>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="CRT Effect"
        description="The scanlines, glow, and vignette overlay. Available on CRT themes; the Dark/Light themes turn it off automatically."
        keywords="crt scanlines glow vignette effect overlay motion retro"
      >
        <SettingRow label="Scanline overlay" help={crtTheme ? "Toggle the retro CRT overlay for the current theme." : "The current theme is a clean theme — the CRT overlay is off."}>
          <Toggle
            checked={crtTheme ? !crtOff : false}
            onChange={(on) => { if (!crtTheme) return; setCrtOff(!on); markSaved(); }}
            labelOn="On — full scanlines + glow"
            labelOff={crtTheme ? "Off — flat, maximum readability" : "Off (clean theme)"}
          />
        </SettingRow>
      </Section>
    </>
  );
}
