import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  GLYPH_H, MARGIN, PAGE_H, PAGE_W, layoutSheet, strokeStart, type Placed, type Sheet,
} from "../../lib/early/tracing";
import { SESSION_GAP_MS, shortDate, type MonthlyRecord } from "../../lib/early/report";
import { MASTERY_STREAK } from "../../lib/early/engine";

// The print views of the grown-ups area (#244 PR 2): tracing sheets and the monthly learning record.
// Each page is a US Letter sheet. On screen the pages are a preview with a Print button; printing goes
// through window.print() (the WebView2 print dialog, which also offers "Save as PDF"). For the printer,
// the same pages are rendered once more into a .print-root under <body>, and the print stylesheet in
// index.css hides everything else. No PDF library, nothing over the network. Paper is paper: these
// pages use fixed ink colours in both themes.

export default function PrintView({ title, hint, pages, onBack }: {
  title: string;
  hint: string;
  pages: ReactNode[];
  onBack: () => void;
}) {
  return (

    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-4 px-10 py-4 border-b border-[var(--rule)]">
        <button type="button" className="btn" onClick={onBack}>Back to grown-ups</button>
        <div className="flex flex-col grow min-w-0">
          <h1 className="m-0 text-[21px] font-medium text-ink">{title}</h1>
          <span className="text-sm text-[var(--ink-faint)]">{hint}</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print</button>
      </header>
      <div className="print-preview flex flex-col items-center gap-8 px-6 py-8">
        {pages.map((p, i) => <div key={i} className="print-page" aria-label={`Page ${i + 1} of ${pages.length}`}>{p}</div>)}
      </div>
      {createPortal(
        <div className="print-root" aria-hidden="true">
          {pages.map((p, i) => <div key={i} className="print-page">{p}</div>)}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Tracing sheets ──────────────────────────────────────────────────────────────────────────────────

const INK = "#1B2440";
const TRACE = "#9AA3B5";
const GUIDE = "#C9D3E6";
const START = "#1E3A8A";

function PlacedGlyph({ p }: { p: Placed }) {
  const [x0, y0] = p.glyph.box;
  const s = p.scale;
  const multi = p.glyph.strokes.length > 1;
  return (
    <g transform={`translate(${p.x} ${p.y}) scale(${s}) translate(${-x0} ${-y0})`}>
      {p.glyph.strokes.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={p.model ? INK : TRACE}
          strokeWidth={(p.model ? 7 : 6) / s}
          strokeDasharray={p.model ? undefined : `${9 / s} ${8 / s}`}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {p.glyph.strokes.map((d, i) => {
        const [x, y] = strokeStart(d);
        return (
          <g key={`s${i}`}>
            <circle cx={x} cy={y} r={8 / s} fill={START} />
            {/* Stroke order: 1 to the left of its dot, 2 to the right, so a 5 (both strokes start at one
                point) still reads 1, 2. */}
            {multi && (
              <text x={i === 0 ? x - 14 / s : x + 13 / s} y={y - 10 / s} textAnchor={i === 0 ? "end" : "start"}
                fontSize={18 / s} fontWeight={600} fill={START}>{i + 1}</text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function tracingPages(sheet: Sheet): ReactNode[] {
  const pages = layoutSheet(sheet);
  return pages.map((page, n) => (
    <svg key={n} width="8.5in" height="11in" viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} fontFamily="Lexend, system-ui, sans-serif">
      <rect width={PAGE_W} height={PAGE_H} fill="#FFFFFF" />
      {/* Name and date, on every page: pages get separated. */}
      <text x={MARGIN} y={MARGIN + 30} fontSize={20} fill={INK}>Name</text>
      <line x1={MARGIN + 62} y1={MARGIN + 32} x2={MARGIN + 450} y2={MARGIN + 32} stroke={INK} strokeWidth={1.5} />
      <text x={MARGIN + 480} y={MARGIN + 30} fontSize={20} fill={INK}>Date</text>
      <line x1={MARGIN + 535} y1={MARGIN + 32} x2={PAGE_W - MARGIN} y2={MARGIN + 32} stroke={INK} strokeWidth={1.5} />
      <text x={MARGIN} y={MARGIN + 88} fontSize={28} fontWeight={600} fill={INK}>{sheet.title}</text>
      <text x={MARGIN} y={MARGIN + 116} fontSize={16} fill="#3D465E">
        Start at the blue dot. Trace the gray lines. {pages.length > 1 ? `Page ${n + 1} of ${pages.length}.` : ""}
      </text>
      {page.rows.map((row, r) => (
        <g key={r}>
          <line x1={MARGIN} y1={row.y} x2={PAGE_W - MARGIN} y2={row.y} stroke={GUIDE} strokeWidth={1.5} />
          <line x1={MARGIN} y1={row.y + GLYPH_H / 2} x2={PAGE_W - MARGIN} y2={row.y + GLYPH_H / 2} stroke={GUIDE} strokeWidth={1.5} strokeDasharray="8 8" />
          <line x1={MARGIN} y1={row.y + GLYPH_H} x2={PAGE_W - MARGIN} y2={row.y + GLYPH_H} stroke={TRACE} strokeWidth={2} />
          {row.placed.map((p, i) => <PlacedGlyph key={i} p={p} />)}
        </g>
      ))}
    </svg>
  ));
}

// ── The monthly learning record ─────────────────────────────────────────────────────────────────────

export function recordPage(record: MonthlyRecord, learnerName: string, grade: string, printedOn: Date): ReactNode {
  const hours = record.minutes >= 60 ? ` (${Math.floor(record.minutes / 60)} h ${record.minutes % 60} min)` : "";
  return (
    <div className="print-record">
      <div className="print-record-kicker">Learning record</div>
      <h1>{learnerName}</h1>
      <div className="print-record-sub">{grade} · {record.label}</div>

      <div className="print-record-stats">
        <div><b>{record.daysPlayed}</b><span>{record.daysPlayed === 1 ? "day" : "days"} with activities</span></div>
        <div><b>About {record.minutes} min{hours}</b><span>in {record.sittings} {record.sittings === 1 ? "sitting" : "sittings"}</span></div>
        <div><b>{record.mastered.length}</b><span>{record.mastered.length === 1 ? "skill" : "skills"} mastered</span></div>
      </div>

      <h2>Skills mastered in {record.label}</h2>
      {record.mastered.length ? (
        <table>
          <thead><tr><th>Skill</th><th>Mastered on</th></tr></thead>
          <tbody>{record.mastered.map((m) => <tr key={m.id}><td>{m.title}</td><td>{shortDate(m.on)}, {m.on.getFullYear()}</td></tr>)}</tbody>
        </table>
      ) : <p>None this month.</p>}

      <h2>Skills in progress</h2>
      {record.inProgress.length ? (
        <ul>{record.inProgress.map((p) => <li key={p.id}><b>{p.title}</b>: {p.detail}</li>)}</ul>
      ) : <p>None this month.</p>}

      {record.masteredBefore.length > 0 && (
        <>
          <h2>Mastered earlier</h2>
          <p>{record.masteredBefore.map((m) => `${m.title} (${shortDate(m.on)}, ${m.on.getFullYear()})`).join("; ")}</p>
        </>
      )}

      <footer>
        Made by OpenEdu from {learnerName}'s activity taps on this computer; nothing here is estimated except
        time. Time is approximate: it runs from the first to the last tap of each sitting, and a sitting ends
        after {SESSION_GAP_MS / 60_000} minutes with no taps. Mastered means {MASTERY_STREAK} answers in a row
        right on the first try. Printed {shortDate(printedOn)}, {printedOn.getFullYear()}.
      </footer>
    </div>
  );
}
