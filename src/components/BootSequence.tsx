import { useEffect, useRef } from "react";

const BOOT_LINES: Array<{ text: string; delay: number; cls: string }> = [
  { delay: 0,    cls: "dim",  text: "TERRABYTE BIOS v2.4.1 — 2026 TERRABYTE SOLUTIONS LLC" },
  { delay: 80,   cls: "dim",  text: "Detected: 16384MB RAM OK" },
  { delay: 140,  cls: "ok",   text: "POST... PASS" },
  { delay: 200,  cls: "dim",  text: "" },
  { delay: 250,  cls: "info", text: "Booting OPENEDU.SYS..." },
  { delay: 350,  cls: "dim",  text: "" },
  { delay: 380,  cls: "ok",   text: "[ OK ] Mounting filesystem           ./data" },
  { delay: 470,  cls: "ok",   text: "[ OK ] Loading SQLite driver         openedu.db" },
  { delay: 560,  cls: "ok",   text: "[ OK ] Initializing schema           migrations v6" },
  { delay: 650,  cls: "ok",   text: "[ OK ] Starting curriculum engine    READY" },
  { delay: 760,  cls: "ok",   text: "[ OK ] Loading knowledge graph       INIT" },
  { delay: 870,  cls: "ok",   text: "[ OK ] Mounting syllabus store       ALL LEVELS" },
  { delay: 960,  cls: "ok",   text: "[ OK ] Quiz subsystem                ONLINE" },
  { delay: 1040, cls: "ok",   text: "[ OK ] Promotion test engine         ARMED" },
  { delay: 1120, cls: "ok",   text: "[ OK ] Markdown renderer             ENABLED" },
  { delay: 1200, cls: "ok",   text: "[ OK ] Wiki-link processor           ENABLED" },
  { delay: 1280, cls: "ok",   text: "[ OK ] Web search (Tavily)           OPTIONAL" },
  { delay: 1360, cls: "dim",  text: "" },
  { delay: 1410, cls: "info", text: "Connecting LLM providers..." },
  { delay: 1510, cls: "ok",   text: "[ OK ] OpenAI                        CONFIGURED" },
  { delay: 1580, cls: "ok",   text: "[ OK ] Anthropic                     CONFIGURED" },
  { delay: 1650, cls: "ok",   text: "[ OK ] Ollama (local)                LISTENING :11434" },
  { delay: 1720, cls: "dim",  text: "" },
  { delay: 1760, cls: "ok",   text: "[ OK ] CRT display driver            LOADED" },
  { delay: 1820, cls: "ok",   text: "[ OK ] Phosphor calibration          COMPLETE" },
  { delay: 1880, cls: "dim",  text: "" },
  { delay: 1930, cls: "info", text: "All systems nominal. Launching..." },
  { delay: 2050, cls: "dim",  text: "" },
];

interface BootSequenceProps {
  onComplete: () => void;
}

export default function BootSequence({ onComplete }: BootSequenceProps) {
  const bootLogRef  = useRef<HTMLDivElement>(null);
  const splashRef   = useRef<HTMLDivElement>(null);
  const timersRef   = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const t = (ms: number, fn: () => void) => {
      const id = setTimeout(fn, ms);
      timersRef.current.push(id);
      return id;
    };

    const log = bootLogRef.current;
    const splash = splashRef.current;
    if (!log || !splash) return;

    // Render boot lines
    BOOT_LINES.forEach(({ text, delay, cls }) => {
      t(delay, () => {
        const line = document.createElement("div");
        line.className = `boot-line`;
        line.innerHTML = text
          ? `<span class="${cls}">${text}</span>`
          : "";
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
      });
    });

    const lastDelay = BOOT_LINES[BOOT_LINES.length - 1].delay;

    // Show splash
    t(lastDelay + 200, () => {
      splash.className = "boot-splash splash-in";
    });

    // Glitch
    t(lastDelay + 950, () => {
      splash.className = "boot-splash splash-glitch";
    });

    // Collapse
    t(lastDelay + 1180, () => {
      splash.className = "boot-splash splash-gone";
    });

    // Done
    t(lastDelay + 1680, () => {
      onComplete();
    });

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [onComplete]);

  return (
    <>
      {/* Boot log screen */}
      <div className="boot-screen" ref={bootLogRef} />

      {/* Splash overlay */}
      <div className="boot-splash" ref={splashRef}>
        <div className="splash-frame" />
        <div style={{ position: "relative" }}>
          <div className="splash-title splash-title-r" aria-hidden="true">OPENEDU.SYS</div>
          <div className="splash-title splash-title-g" aria-hidden="true">OPENEDU.SYS</div>
          <div className="splash-title crt-aberrate phosphor-glow-xl">OPENEDU.SYS</div>
        </div>
        <div className="splash-tag">EDUCATION OS — READY.</div>
        <div className="splash-collapse" />
      </div>
    </>
  );
}
