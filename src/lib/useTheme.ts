import { useEffect, useState } from "react";
import { getThemeId, getCrtOff } from "./theme";

// Subscribe to live theme + CRT state. applyTheme()/setCrtOff() broadcast `oe-theme-change` / `oe-crt-change`
// CustomEvents; this hook keeps a component in sync with them. Used by the Titlebar and the Appearance tab
// so neither hand-rolls the same add/removeEventListener block.
export function useThemeState(): { themeId: string; crtOff: boolean } {
  const [themeId, setThemeIdState] = useState(getThemeId);
  const [crtOff, setCrtOffState] = useState(getCrtOff);
  useEffect(() => {
    const onTheme = () => setThemeIdState(getThemeId());
    const onCrt = () => setCrtOffState(getCrtOff());
    window.addEventListener("oe-theme-change", onTheme);
    window.addEventListener("oe-crt-change", onCrt);
    return () => {
      window.removeEventListener("oe-theme-change", onTheme);
      window.removeEventListener("oe-crt-change", onCrt);
    };
  }, []);
  return { themeId, crtOff };
}
