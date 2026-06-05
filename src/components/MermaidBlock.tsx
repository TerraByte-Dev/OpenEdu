// Renders a diagram.render tool result as a Mermaid diagram, inline in the chat surface
// (docs/ARCHITECTURE.md). Mermaid is heavy (~500KB+), so it is LAZY-loaded via dynamic import on
// first use and the module is cached — it never enters the initial bundle chunk (the bundle is
// already ~1.2MB with CodeMirror). Theme tuned to the blue-phosphor CRT palette; securityLevel
// "strict" sanitizes the rendered SVG. Graceful: a Mermaid parse error falls back to the raw source.

import { useEffect, useRef, useState } from "react";

type MermaidApi = (typeof import("mermaid"))["default"];

let cached: MermaidApi | null = null;
let idCounter = 0;

async function getMermaid(): Promise<MermaidApi> {
  if (!cached) {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "strict",
      fontFamily: '"IBM Plex Mono", "Share Tech Mono", monospace',
      themeVariables: {
        primaryColor: "#040709",
        primaryBorderColor: "#00C6FF",
        primaryTextColor: "#6DD4EE",
        lineColor: "#00C6FF",
        secondaryColor: "#020409",
        tertiaryColor: "#020508",
      },
    });
    cached = mermaid;
  }
  return cached;
}

export default function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const idRef = useRef(`mmd-${++idCounter}`);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    (async () => {
      try {
        const mermaid = await getMermaid();
        const { svg } = await mermaid.render(idRef.current, code);
        if (!cancelled) setSvg(svg);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) {
    return (
      <div className="lcd rounded-lg px-3 py-2 text-[12px] font-mono text-phosphor-ink overflow-x-auto w-fit max-w-full whitespace-pre">
        <code>{code}</code>
      </div>
    );
  }

  if (svg === null) {
    return <div className="lcd rounded-lg px-3 py-2 text-[12px] text-[var(--ink-dim)]">rendering diagram…</div>;
  }

  return (
    <div
      className="rounded-lg p-2 bg-panel-lite border border-[var(--rule)] overflow-x-auto w-fit max-w-full"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
