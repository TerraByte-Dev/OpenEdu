import { THEME_CHOICES, applyTheme, type ThemeChoice } from "../../../lib/theme";
import { useThemeState } from "../../../lib/useTheme";
import { Section, SegmentedControl, useSettings } from "../primitives";

export default function Appearance() {
  const { markSaved } = useSettings();
  // Live choice via the shared hook (stays in sync when the titlebar toggle flips light/dark).
  const { choice } = useThemeState();

  const pick = (id: ThemeChoice) => {
    applyTheme(id); // dispatches oe-theme-change → useThemeState updates
    markSaved();
  };

  return (
    <Section
      title="Theme"
      description="Light or dark. Match my computer follows your system setting and switches when it does. Applies instantly and is remembered."
      keywords="theme color appearance dark light mode system night look"
    >
      <SegmentedControl options={[...THEME_CHOICES]} value={choice} onChange={pick} />
    </Section>
  );
}
