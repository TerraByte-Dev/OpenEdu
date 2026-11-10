import { useEffect, useState } from "react";
import { getThemeChoice, getResolvedTheme, type ThemeChoice, type ThemeId } from "./theme";

// Subscribe to the live appearance. applyTheme() broadcasts `oe-theme-change` (also when "Match my
// computer" follows an OS switch); this hook keeps a component in sync. Used by the Titlebar toggle and
// the Appearance section. `choice` is what the user picked; `resolved` is the palette on screen.
export function useThemeState(): { choice: ThemeChoice; resolved: ThemeId } {
  const [state, setState] = useState(() => ({ choice: getThemeChoice(), resolved: getResolvedTheme() }));
  useEffect(() => {
    const onTheme = () => setState({ choice: getThemeChoice(), resolved: getResolvedTheme() });
    window.addEventListener("oe-theme-change", onTheme);
    return () => window.removeEventListener("oe-theme-change", onTheme);
  }, []);
  return state;
}
