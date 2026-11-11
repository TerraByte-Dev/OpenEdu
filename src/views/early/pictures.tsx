// Every picture in the early-learner screens (#244), drawn by code as inline SVG: apples, dots, color
// swatches, shapes and stars. No art assets, nothing to license. A picture that carries meaning has
// role="img" and an aria-label; icons are aria-hidden.

import type { ReactNode } from "react";
import { COLOR_HEX } from "../../lib/early/packs";
import type { Choice, ColorId, Picture, ShapeId } from "../../lib/early/types";

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// ── Apples ──────────────────────────────────────────────────────────────────────────────────────────

function AppleShape({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size * (120 / 110)} viewBox="0 0 110 120">
      <path d="M55 32c-8-8-22-10-33-4-14 8-18 28-10 50 7 19 20 34 33 34 4 0 7-2 10-2s6 2 10 2c13 0 26-15 33-34 8-22 4-42-10-50-11-6-25-4-33 4z" fill="#E5484D" />
      <path d="M55 32c0-10 2-18 8-24" stroke="#6B4A2B" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M62 16c8-6 18-6 24-2-6 8-16 10-24 2z" fill="#3E9B5C" />
      <ellipse cx="34" cy="56" rx="7" ry="12" fill="#FFFFFF" opacity="0.35" />
    </svg>
  );
}

/** `count` apples in rows of five (ten above ten, with a gap after each five). `numbered` counts along. */
export function Apples({ count, numbered }: { count: number; numbered: boolean }) {
  const size = count <= 5 ? 110 : count <= 10 ? 80 : 52;
  const perRow = count <= 10 ? 5 : 10;
  const rows = chunk(Array.from({ length: count }, (_, i) => i + 1), perRow);
  const badge = count <= 10 ? 44 : 30;
  return (
    <div role="img" aria-label={`${count} ${count === 1 ? "apple" : "apples"}`} className="flex flex-col items-start gap-4">
      {/* Rows start at the left edge, like a ten frame: 7 reads as a full five and two more. */}
      {rows.map((row, r) => (
        <div key={r} className="flex" style={{ gap: count <= 5 ? 28 : 16 }}>
          {row.map((n) => (
            <div key={n} className="flex flex-col items-center gap-2" style={{ marginLeft: perRow === 10 && n % 10 === 6 ? 20 : 0 }}>
              <AppleShape size={size} />
              {numbered && (
                <span
                  aria-hidden="true"
                  className="rounded-full flex items-center justify-center font-semibold"
                  style={{ width: badge, height: badge, fontSize: badge * 0.55, background: "var(--phosphor-dim)", color: "var(--phosphor)" }}
                >
                  {n}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Dots ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * `n` dots in rows of five, so 7 reads as five and two; above ten, the ten sit apart from the rest.
 * `numbered` writes 1, 2, 3 ... in the dots: a "find N dots" retry counts along on dots, like its choices.
 */
export function Dots({ n, size = 14, label = true, numbered = false }: { n: number; size?: number; label?: boolean; numbered?: boolean }) {
  const gap = Math.round(size * 0.45);
  const rows = chunk(Array.from({ length: n }, (_, i) => i), 5);
  const tensGap = n > 10 ? size : 0; // extra space under the first ten
  const rowY = (r: number) => r * (size + gap) + (r >= 2 ? tensGap : 0);
  const width = Math.min(n, 5) * size + (Math.min(n, 5) - 1) * gap;
  const height = rowY(rows.length - 1) + size;
  return (
    <svg
      {...(label ? { role: "img", "aria-label": `${n} ${n === 1 ? "dot" : "dots"}` } : { "aria-hidden": true })}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {rows.map((row, r) => row.map((i, c) => (
        <g key={`${r}-${c}`}>
          <circle cx={c * (size + gap) + size / 2} cy={rowY(r) + size / 2} r={size / 2} fill="var(--ink-faint)" />
          {numbered && (
            <text x={c * (size + gap) + size / 2} y={rowY(r) + size / 2} textAnchor="middle" dominantBaseline="central"
              fontSize={size * 0.5} fontWeight={600} fill="var(--on-accent)">{i + 1}</text>
          )}
        </g>
      )))}
    </svg>
  );
}

// ── Colors ──────────────────────────────────────────────────────────────────────────────────────────

/** A round swatch of one color, outlined so dark colors still show on the dark theme. */
export function Swatch({ color, size = 112 }: { color: ColorId; size?: number }) {
  return (
    <svg role="img" aria-label={color} width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="45" fill={COLOR_HEX[color]} stroke="var(--rule-strong)" strokeWidth="2" />
    </svg>
  );
}

// ── Shapes ──────────────────────────────────────────────────────────────────────────────────────────

const SHAPE_PATH: Record<ShapeId, ReactNode> = {
  circle: <circle cx="50" cy="50" r="42" />,
  square: <rect x="12" y="12" width="76" height="76" rx="4" />,
  triangle: <path d="M50 8L94 88H6z" strokeLinejoin="round" />,
  rectangle: <rect x="2" y="26" width="96" height="48" rx="4" />,
  star: <path d="M50 6l11.8 31.6 33.3.6L69 59l9.2 32L50 72 21.8 91 31 59 4.9 38.2l33.3-.6z" strokeLinejoin="round" />,
  heart: <path d="M50 88C20 66 6 50 6 32 6 18 17 8 30 8c9 0 16 5 20 12 4-7 11-12 20-12 13 0 24 10 24 24 0 18-14 34-44 56z" />,
};

/** One shape, filled with the accent so only its outline tells it apart. */
export function Shape({ shape, size = 112 }: { shape: ShapeId; size?: number }) {
  return (
    <svg role="img" aria-label={`a ${shape}`} width={size} height={size} viewBox="0 0 100 100" fill="var(--phosphor)">
      {SHAPE_PATH[shape]}
    </svg>
  );
}

// ── A picture spec, a choice ────────────────────────────────────────────────────────────────────────

export function PictureView({ picture, numbered }: { picture: Picture; numbered: boolean }) {
  switch (picture.kind) {
    case "apples": return <Apples count={picture.count} numbered={numbered} />;
    case "dots": return <Dots n={picture.n} size={picture.n > 10 ? 40 : 52} numbered={numbered} />;
    case "numeral":
      return (
        <span role="img" aria-label={`the number ${picture.n}`} className="font-semibold leading-none" style={{ fontSize: 128, color: "var(--phosphor)" }}>
          {picture.n}
        </span>
      );
    case "color": return <Swatch color={picture.color} size={120} />;
    case "shape": return <Shape shape={picture.shape} size={120} />;
    case "none": return null;
  }
}

/** What goes inside a choice button. The button's own aria-label names it, so these are hidden. */
export function ChoiceFace({ choice }: { choice: Choice }) {
  switch (choice.kind) {
    case "numeral":
      return (
        <span aria-hidden="true" className="flex flex-col items-center gap-2.5">
          <span className="font-semibold leading-none" style={{ fontSize: 72 }}>{choice.n}</span>
          {choice.n <= 10 && <Dots n={choice.n} label={false} />}
        </span>
      );
    case "dots": return <span aria-hidden="true"><Dots n={choice.n} size={choice.n > 10 ? 15 : 18} label={false} /></span>;
    case "color": return <span aria-hidden="true"><Swatch color={choice.color} /></span>;
    case "shape": return <span aria-hidden="true"><Shape shape={choice.shape} /></span>;
  }
}

// ── Stars and icons ─────────────────────────────────────────────────────────────────────────────────

const STAR = "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z";

export function Star({ filled, size = 30 }: { filled: boolean; size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" strokeWidth="1.5" strokeLinejoin="round"
      fill={filled ? "var(--early-star)" : "none"} stroke={filled ? "var(--early-star-edge)" : "var(--early-star-empty)"}>
      <path d={STAR} />
    </svg>
  );
}

/** A row of `total` stars, the first `filled` gold. */
export function StarRow({ filled, total, label }: { filled: number; total: number; label: string }) {
  return (
    <div role="img" aria-label={label} className="flex gap-1.5 px-4 py-2.5 rounded-full bg-panel border border-[var(--rule)]">
      {Array.from({ length: total }, (_, i) => <Star key={i} filled={i < filled} />)}
    </div>
  );
}

const ICON = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function SpeakerIcon({ size, waves = 2 }: { size: number; waves?: 1 | 2 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" {...ICON}>
      <path d="M11 5L6 9H3v6h3l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 010 7" />
      {waves === 2 && <path d="M18.5 5.5a9 9 0 010 13" />}
    </svg>
  );
}

export function BackIcon() {
  return <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" {...ICON} strokeWidth={2.2}><path d="M15 18l-6-6 6-6" /></svg>;
}

export function NextIcon() {
  return <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" {...ICON} strokeWidth={2.4}><path d="M9 6l6 6-6 6" /></svg>;
}

export function LockIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" {...ICON}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>;
}

export function BookIcon() {
  return <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" {...ICON}><path d="M12 6c-2-1.5-5-2-8-1.5v14c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-14c-3-.5-6 0-8 1.5z" /><path d="M12 6v14" /></svg>;
}

export function PersonIcon() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" {...ICON}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1-4 4-6 7-6s6 2 7 6" /></svg>;
}

export function PlayIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z" /></svg>;
}

// ── Tile art on the home screen ─────────────────────────────────────────────────────────────────────

export function ColorsArt() {
  return (
    <svg role="img" aria-label="Three paint colors" width="140" height="110" viewBox="0 0 140 110">
      <circle cx="50" cy="42" r="32" fill={COLOR_HEX.red} />
      <circle cx="90" cy="42" r="32" fill={COLOR_HEX.yellow} opacity="0.92" />
      <circle cx="70" cy="74" r="32" fill={COLOR_HEX.blue} opacity="0.88" />
    </svg>
  );
}

export function CountingArt() {
  const dots: Array<[number, number]> = [[24, 56], [62, 40], [62, 74], [104, 28], [104, 56], [104, 84]];
  return (
    <svg role="img" aria-label="One, two, three dots" width="140" height="110" viewBox="0 0 140 110">
      {dots.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="14" fill="var(--phosphor)" />)}
    </svg>
  );
}

export function ShapesArt() {
  return (
    <svg role="img" aria-label="A circle, a square and a triangle" width="140" height="110" viewBox="0 0 140 110">
      <circle cx="30" cy="60" r="22" fill="#7C4DBF" />
      <rect x="58" y="38" width="42" height="42" rx="4" fill="#B48BE3" />
      <path d="M120 36l18 44h-36z" fill="#5A2E99" />
    </svg>
  );
}
