// Renders a diagram.render tool result as a Mermaid diagram, inline in the chat surface
// (docs/ARCHITECTURE.md). Mermaid is heavy (~500KB+), so it is LAZY-loaded via dynamic import on
// first use and the module is cached — it never enters the initial bundle chunk (the bundle is
// already ~1.2MB with CodeMirror). Themed to the Notebook palette and re-rendered when light/dark
// changes; securityLevel "strict" sanitizes the rendered SVG. Graceful: source Mermaid cannot parse is
// retried with its node labels quoted, and if that fails too the child sees a plain sentence and the
// diagram's labels, never the source (mermaid-source.ts). Also draws ```mermaid fences in a reply.

import { useEffect, useRef, useState } from "react";
import type { ThemeId } from "../lib/theme";
import { useThemeState } from "../lib/useTheme";
import { drawableMermaid, diagramFallback } from "../lib/mermaid-source";

type MermaidApi = (typeof import("mermaid"))["default"];

let cached: MermaidApi | null = null;
let idCounter = 0;

// Mermaid can't read CSS vars, so these mirror the index.css tokens for each mode.
const MERMAID_THEME: Record<ThemeId, { theme: "neutral" | "dark"; themeVariables: Record<string, string> }> = {
  light: {
    theme: "neutral",
    themeVariables: {
      background: "#FFFFFF", primaryColor: "#EEF3FB", primaryBorderColor: "#1E3A8A",
      primaryTextColor: "#1B2440", textColor: "#1B2440", lineColor: "#3D465E",
      secondaryColor: "#F3F0E8", tertiaryColor: "#FFFFFF",
    },
  },
  dark: {
    theme: "dark",
    themeVariables: {
      background: "#16213A", primaryColor: "#1B2A47", primaryBorderColor: "#5B9BFF",
      primaryTextColor: "#E6ECF5", textColor: "#E6ECF5", lineColor: "#A3B1C6",
      secondaryColor: "#1A2742", tertiaryColor: "#16213A",
    },
  },
};

// initialize() is global, so it is re-run with the current mode before every render.
async function getMermaid(mode: ThemeId): Promise<MermaidApi> {
  if (!cached) cached = (await import("mermaid")).default;
  cached.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    fontFamily: '"Lexend", "Inter", system-ui, sans-serif',
    ...MERMAID_THEME[mode],
  });
  return cached;
}

export default function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mmd-${++idCounter}`);
  const { resolved } = useThemeState();

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    (async () => {
      try {
        const mermaid = await getMermaid(resolved);
        const source = await drawableMermaid(code, async (src) => (await mermaid.parse(src, { suppressErrors: true })) !== false);
        if (source === null) throw new Error("unparseable diagram");
        const { svg } = await mermaid.render(idRef.current, source);
        if (!cancelled) setSvg(svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, resolved]);

  if (failed) {
    const { message, parts } = diagramFallback(code);
    return (
      <div className="rounded-lg px-3 py-2 text-sm text-[var(--ink-dim)] bg-panel-lite border border-[var(--rule)] w-fit max-w-full">
        <p>{message}</p>
        {parts.length > 0 && (
          <ul className="list-disc pl-5 mt-1">
            {parts.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        )}
      </div>
    );
  }

  if (svg === null) {
    return <div className="lcd rounded-lg px-3 py-2 text-[12px] text-[var(--ink-dim)]">rendering diagram…</div>;
  }

  return (
    <div
      className="rounded-lg p-2 bg-panel border border-[var(--rule)] overflow-x-auto w-fit max-w-full"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
