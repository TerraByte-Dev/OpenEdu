// Small, app-agnostic building blocks for the Settings view. Written generically (no OpenEdu-specific
// imports) so this folder is trivial to lift into another TerraByte app later. Styling is pure design-system
// tokens from src/index.css, so every primitive re-themes for free under the color themes.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { matchText } from "../../lib/text-match";

// ── Shared context: live search query + a "something just saved" pulse ──────────────────────────────────
export interface SettingsCtx {
  query: string;
  markSaved: () => void;
}
export const SettingsContext = createContext<SettingsCtx>({ query: "", markSaved: () => {} });

export function useSettings(): SettingsCtx {
  return useContext(SettingsContext);
}

// matchText (Settings search filter) lives in lib/text-match.ts as the single source; re-exported here so
// Section/SettingRow and the shell keep importing it from one place.
export { matchText };

// Shared input styling (text/password/url).
export const INPUT_CLS =
  "w-full px-3.5 py-2.5 rounded-lg bg-panel-lite border border-[var(--rule)] text-ink text-sm " +
  "focus:outline-none focus:border-phosphor transition-colors placeholder-[var(--ink-faint)]";

// ── Section: a titled group inside a tab. Self-hides when a search query matches neither it nor its keywords.
export function Section({
  title, description, keywords = "", children, right,
}: {
  title: string;
  description?: string;
  keywords?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  const { query } = useSettings();
  if (query && !matchText(`${title} ${description ?? ""} ${keywords}`, query)) return null;
  return (
    <section className="mb-9">
      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[11px] font-semibold text-[var(--ink-faint)] uppercase tracking-[0.18em]">{title}</h2>
          {description && <p className="text-xs text-[var(--ink-faint)] mt-1.5 max-w-prose leading-relaxed">{description}</p>}
        </div>
        {right}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// ── SettingRow: label + help on top, control below, inside a card. Self-hides on search miss.
export function SettingRow({
  label, help, keywords = "", children,
}: {
  label: string;
  help?: ReactNode;
  keywords?: string;
  children: ReactNode;
}) {
  const { query } = useSettings();
  const helpText = typeof help === "string" ? help : "";
  if (query && !matchText(`${label} ${helpText} ${keywords}`, query)) return null;
  return (
    <div className="rounded-lg border border-[var(--rule)] bg-panel-lite/60 px-4 py-3.5">
      <div className="mb-2.5">
        <div className="text-sm font-medium text-ink">{label}</div>
        {help && <div className="text-xs text-[var(--ink-faint)] mt-1 leading-relaxed max-w-prose">{help}</div>}
      </div>
      {children}
    </div>
  );
}

// ── Toggle: a phosphor switch ───────────────────────────────────────────────────────────────────────────
export function Toggle({
  checked, onChange, labelOn, labelOff,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  labelOn?: string;
  labelOff?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 group"
    >
      <span
        className={`relative w-10 h-[22px] rounded-full border transition-colors shrink-0 ${
          checked ? "bg-[rgb(var(--phosphor-rgb)/0.28)] border-phosphor" : "bg-panel border-[var(--rule)]"
        }`}
      >
        <span
          className={`absolute top-[2px] w-4 h-4 rounded-full transition-all ${
            checked ? "left-[20px] bg-phosphor shadow-[0_0_8px_var(--phosphor-faint)]" : "left-[2px] bg-[var(--ink-faint)]"
          }`}
        />
      </span>
      {(labelOn || labelOff) && (
        <span className="text-sm text-[var(--ink-dim)] group-hover:text-ink transition-colors">
          {checked ? labelOn : labelOff}
        </span>
      )}
    </button>
  );
}

// ── SegmentedControl: a row of mutually-exclusive pills ─────────────────────────────────────────────────
export function SegmentedControl<T extends string>({
  options, value, onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--rule)] bg-panel p-0.5 gap-0.5 flex-wrap">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors ${
            value === o.id ? "btn-primary" : "text-[var(--ink-dim)] hover:text-ink hover:bg-panel-lite"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── SecretField: masked input that never auto-persists. Explicit Save + optional Verify, reveal toggle.
export function SecretField({
  value, placeholder, onSave, onVerify, footnote,
}: {
  value: string;
  placeholder?: string;
  onSave: (next: string) => Promise<void> | void;
  onVerify?: (current: string) => Promise<{ ok: boolean; msg: string }>;
  footnote?: ReactNode;
}) {
  const [draft, setDraft] = useState(value);
  const [revealed, setRevealed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const lastValue = useRef(value);

  // Reseed the draft when the persisted value loads/changes — but don't clobber an in-progress edit.
  // Adopt the new value only if the draft was still showing the *previous* persisted value (untouched).
  // Also clear any stale verify result, so e.g. a "key is valid" message can't linger across a provider
  // switch where the same SecretField instance is reused with a different key.
  useEffect(() => {
    if (lastValue.current !== value) {
      const prev = lastValue.current;
      lastValue.current = value;
      setDraft((d) => (d === prev ? value : d));
      setResult(null);
    }
  }, [value]);

  // Compare on the trimmed draft: persisted secrets are stored trimmed, so surrounding whitespace must not
  // leave the field looking permanently unsaved.
  const dirty = draft.trim() !== value;

  const handleSave = async () => {
    const trimmed = draft.trim();
    await onSave(trimmed);
    setDraft(trimmed); // normalize the visible field to what was actually persisted
    setSaved(true);
    setResult(null);
    setTimeout(() => setSaved(false), 1800);
  };

  const handleVerify = async () => {
    if (!onVerify) return;
    const trimmed = draft.trim();
    setVerifying(true);
    setResult(null);
    try {
      // Persist first so the probe uses what the user typed.
      if (dirty) { await onSave(trimmed); setDraft(trimmed); }
      setResult(await onVerify(trimmed));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={revealed ? "text" : "password"}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setResult(null); }}
            placeholder={placeholder}
            className={INPUT_CLS + " pr-10"}
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setRevealed((r) => !r)}
            title={revealed ? "Hide" : "Reveal"}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--ink-faint)] hover:text-phosphor-ink transition-colors"
          >
            {revealed ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
            )}
          </button>
        </div>
        {onVerify && (
          <button
            type="button"
            onClick={handleVerify}
            disabled={verifying || !draft.trim()}
            className="btn shrink-0 disabled:opacity-50"
          >
            {verifying ? "Testing…" : "Verify"}
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty && !saved}
          className={`shrink-0 ${dirty ? "btn-primary btn" : "btn"} disabled:opacity-50`}
        >
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>
      {result && (
        <p className={`mt-2 text-xs font-medium ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
          {result.ok ? "✓ " : "✗ "}{result.msg}
        </p>
      )}
      {footnote && <p className="mt-2 text-xs text-[var(--ink-faint)]">{footnote}</p>}
    </div>
  );
}

// ── Disclosure: an "Advanced" expander ──────────────────────────────────────────────────────────────────
export function Disclosure({
  summary, children, defaultOpen = false,
}: {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-[var(--rule)] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--ink-dim)] hover:text-ink hover:bg-panel-lite/60 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`transition-transform ${open ? "rotate-90" : ""}`}><path d="M9 18l6-6-6-6"/></svg>
        {summary}
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}

// ── ActionButton: a labelled action with a transient done state ─────────────────────────────────────────
export function ActionButton({
  onClick, children, primary, busyLabel,
}: {
  onClick: () => Promise<void> | void;
  children: ReactNode;
  primary?: boolean;
  busyLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}
      className={`btn ${primary ? "btn-primary" : ""} disabled:opacity-50`}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
