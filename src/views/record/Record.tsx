import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  getActiveLearnerId, listLearners, renameLearner, saveMonthlyRecord, setCourseSubject, setLearnerGrade, setLearnerRecordVoice,
} from "../../lib/db";
import { type CourseStanding, type LearningRecord, type MasteredRow, type SkillStatus } from "../../lib/record/build";
import {
  RECORD_COPY, RECORD_DISCLAIMER, RECORD_DISCLAIMER_SHORT, RECORD_RULES, RECORD_SUBJECTS, fill, type PillKey,
} from "../../lib/record/copy";
import { recordVoice } from "../../lib/record/voice";
import { toStored } from "../../lib/record/time";
import type { RecordSavedMonth, RecordSource } from "../../lib/record/sources";
import {
  allTimeRecord, approxShown, approxTimeText, dayText, durationText, earlySignCount, evidenceText, groupByCourseAndLevel, localDayText,
  masteredCount, ownWordsNoneText, quizTimeText, rangeOptions, splitAtCount, whenText, withoutProofText, type Audience,
} from "../../lib/record/view";
import { gradeLabel, normalizeGrade, type Grade } from "../../lib/grade";
import { needsNameCheck, provenance, saveLabel } from "../../lib/record/print";
import { copyNeedsReplacing, needsSaving, shownDays, shownRecord, snapshotOf } from "../../lib/record/saved";
import { LEARNER_NAME_MAX, validateLearnerName } from "../../lib/learners";
import { GradeSelect } from "../../components/GradeSelect";
import { BookIcon } from "../early/pictures";
import PrintView from "../early/PrintView";
import { recordPrintPages } from "./RecordPrint";
import { recordCsvNames, recordDailyCsv, recordEventCsv, recordEvents } from "../../lib/record/csv";
import { saveCsvFile } from "../../lib/export-file";

// The learning record on screen (#258 PR 3, spec §3). One LearningRecord (record/build.ts) drives
// every number and label; this file only lays it out. The loader is a prop: App passes
// getRecordSource (the active learner, no id), TeacherView passes getLearnerRecordSource(id), so the
// teacher's copy can never fall back to whoever is signed in. Proof comes first, activity after it,
// and every number's rule is one tap away (the ⓘ buttons and the pills).
//
// Patterns copied from early/GrownUps.tsx (Stat, STATUS, the header), which stays unchanged.

const C = RECORD_COPY;
const V = RECORD_COPY.view;
const X = RECORD_COPY.csv;

const PILL: Record<PillKey, string> = {
  mastered: "bg-success-tint text-success",
  early_sign: "bg-[var(--phosphor-dim)] text-phosphor",
  review_again: "bg-warning-tint text-warning",
  learning: "bg-[var(--panel-tint)] text-phosphor border border-[var(--rule-strong)]",
  tutor: "bg-[var(--panel-lite)] text-[var(--ink-dim)] border border-dashed border-[var(--rule-strong)]",
  keyword: "bg-[var(--panel-lite)] text-[var(--ink-dim)] border border-dashed border-[var(--rule-strong)]",
  no_proof: "bg-[var(--panel-lite)] text-[var(--ink-dim)] border border-dashed border-[var(--rule-strong)]",
  not_yet: "bg-[var(--panel-lite)] text-[var(--ink-faint)]",
};

const BAR: Partial<Record<SkillStatus, string>> = {
  mastered: "var(--success)",
  early_sign: "var(--phosphor)",
  learning: "var(--rule-strong)",
};

export interface RecordProps {
  /** The learner this record is about. The loaded rows must be theirs, or nothing is shown. */
  learnerId: string;
  /** Reads that learner's rows: getRecordSource for their own record, getLearnerRecordSource in TeacherView. */
  load: () => Promise<RecordSource | null>;
  /** "own": the learner's own record (voice from recordVoice). "teacher": inside TeacherView, always third person. */
  audience: "own" | "teacher";
  onBack: () => void;
  /** The name check renamed the learner or set their grade: reload the learner list. */
  onLearnerChanged?: () => void;
  /**
   * Whether the name check may set the grade. False for a learner's own record when Settings is behind
   * the teacher PIN (a class or school): learners there cannot set their own grade. Default true.
   */
  canSetGrade?: boolean;
  /**
   * Whether "Rebuild from current data" is offered on a saved month. False for a learner's own record
   * when Settings is behind the teacher PIN, so a learner in a class cannot rewrite a saved month.
   * Default true.
   */
  canRebuild?: boolean;
}

/** The ⓘ / pill disclosure: which rules are open. */
function useOpen() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  return {
    isOpen: (k: string) => open.has(k),
    toggle: (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }),
  };
}
type Open = ReturnType<typeof useOpen>;

const ruleId = (k: string) => `rule-${k.replace(/[^\w-]/g, "_")}`;

function InfoGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9.5" /><path d="M12 11v6" /><path d="M12 7.5v.01" strokeWidth="2.6" />
    </svg>
  );
}

/** A 44px hit target around a small ⓘ. */
function InfoButton({ what, k, open }: { what: string; k: string; open: Open }) {
  return (
    <button
      type="button"
      aria-expanded={open.isOpen(k)}
      aria-controls={ruleId(k)}
      aria-label={fill(V.ruleButton, { what })}
      title={fill(V.ruleButton, { what })}
      onClick={() => open.toggle(k)}
      className={`shrink-0 w-11 h-11 -my-2.5 -mr-2.5 inline-flex items-center justify-center rounded-full hover:text-phosphor hover:bg-[var(--panel-tint)] ${open.isOpen(k) ? "text-phosphor" : "text-[var(--ink-faint)]"}`}
    >
      <InfoGlyph />
    </button>
  );
}

function RuleNote({ k, open, children }: { k: string; open: Open; children: ReactNode }) {
  if (!open.isOpen(k)) return null;
  return (
    <p id={ruleId(k)} role="note" className="m-0 text-sm leading-relaxed text-[var(--ink-dim)] bg-[var(--panel-lite)] rounded-xl px-3.5 py-2.5">
      {children}
    </p>
  );
}

/** A status pill that is also the button for its rule: a 44px-tall hit target around the pill. */
function Pill({ status, k, open }: { status: PillKey; k: string; open: Open }) {
  return (
    <button
      type="button"
      aria-expanded={open.isOpen(k)}
      aria-controls={ruleId(k)}
      onClick={() => open.toggle(k)}
      className="group inline-flex items-center min-h-[44px] -my-1.5 rounded-full"
    >
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-[5px] rounded-full text-sm font-medium group-hover:brightness-95 ${PILL[status]}`}>
        {C.pills[status]}
        <span className="opacity-70"><InfoGlyph size={14} /></span>
      </span>
    </button>
  );
}

/** A plain label pill (level state): no rule of its own. */
function Tag({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "accent" | "done" }) {
  const cls = tone === "accent" ? "bg-[var(--phosphor-dim)] text-phosphor" : tone === "done" ? "bg-success-tint text-success" : "bg-[var(--panel-lite)] text-[var(--ink-dim)]";
  return <span className={`inline-flex items-center whitespace-nowrap px-3 py-[5px] rounded-full text-sm font-medium ${cls}`}>{children}</span>;
}

/** Copied from GrownUps' Stat: a tile with its rule one tap away. */
function Tile({ k, head, what, open, rules, children }: { k: string; head: string; what: string; open: Open; rules: string[]; children: ReactNode }) {
  return (
    <div className="px-[18px] py-4 rounded-[18px] bg-panel border border-[var(--rule)] flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-medium text-[var(--ink-dim)]">{head}</span>
        <InfoButton what={what} k={k} open={open} />
      </div>
      <div className="flex flex-col gap-1 min-w-0">{children}</div>
      <RuleNote k={k} open={open}>{rules.join(" ")}</RuleNote>
    </div>
  );
}

function Section({ id, title, rule, open, children, aside }: {
  id: string; title: string; rule?: string; open: Open; children: ReactNode; aside?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`rec-${id}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 id={`rec-${id}`} className="m-0 text-[21px] font-medium text-ink">{title}</h2>
        {rule && <InfoButton what={title} k={`sec-${id}`} open={open} />}
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {rule && <RuleNote k={`sec-${id}`} open={open}>{rule}</RuleNote>}
      {children}
    </section>
  );
}

function Card({ children, tint }: { children: ReactNode; tint?: boolean }) {
  return <div className={`rounded-[20px] border border-[var(--rule)] flex flex-col ${tint ? "bg-[var(--panel-tint)]" : "bg-panel"}`}>{children}</div>;
}

function Row({ first, children }: { first: boolean; children: ReactNode }) {
  return <div className="px-5 py-3.5 flex flex-col gap-2" style={{ borderTop: first ? undefined : "1px solid var(--rule)" }}>{children}</div>;
}

const Quiet = ({ children }: { children: ReactNode }) => <p className="m-0 text-[15px] text-[var(--ink-dim)] leading-normal">{children}</p>;
const Small = ({ children }: { children: ReactNode }) => <span className="text-sm text-[var(--ink-faint)] leading-normal">{children}</span>;

// ── The record ──────────────────────────────────────────────────────────────────────────────────────

export default function Record({ learnerId, load, audience: who, onBack, onLearnerChanged, canSetGrade = true, canRebuild = true }: RecordProps) {
  const [source, setSource] = useState<RecordSource | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [now] = useState(() => new Date());
  const [rangeKey, setRangeKey] = useState<string | null>(null);
  const [askVoice, setAskVoice] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  // Save: the name check (spec §1 rule 5) first when it is needed, then the print view, which opens
  // the print dialog by itself.
  const [checkingName, setCheckingName] = useState(false);
  const [printing, setPrinting] = useState(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const open = useOpen();

  useEffect(() => {
    let alive = true;
    setFailed(false);
    load()
      .then((src) => {
        if (!alive) return;
        // After the await: a learner switch may have landed, and the rows must be this learner's.
        if (who === "own" && getActiveLearnerId() !== learnerId) return;
        if (!src || src.learner.id !== learnerId) { setFailed(true); return; }
        setSource(src);
      })
      .catch((e) => { console.warn("[record] could not read the record", e); if (alive) setFailed(true); });
    return () => { alive = false; };
    // load is a fresh closure on every TeacherView render; the learner and a retry are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnerId, attempt, who]);

  const voice = source ? recordVoice({ stored: source.learner.record_voice, grade: source.learner.grade }) : null;
  const audience: Audience = who === "teacher" ? "teacher" : voice === "self" ? "self" : "guided";
  const options = useMemo(() => (source ? rangeOptions(source, audience, now) : []), [source, audience, now]);
  const picked = options.find((o) => o.key === rangeKey) ?? options[0];
  // An ended month shows its saved copy when there is one (record/saved.ts), else it is built from the rows on record now.
  const record = useMemo(() => (source && picked ? shownRecord(source, picked.range, now) : null), [source, picked, now]);
  const allTime = useMemo(() => (source ? allTimeRecord(source, now) : null), [source, now]);

  // After the voice question is answered (or kept), focus moves to the record's heading.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [focusHeading, setFocusHeading] = useState(false);
  useEffect(() => {
    if (focusHeading && headingRef.current) { headingRef.current.focus(); setFocusHeading(false); }
  }, [focusHeading, source]);

  const chooseVoice = async (v: "self" | "guided") => {
    if (!source) return;
    setVoiceError(null);
    try {
      await setLearnerRecordVoice(learnerId, v);
      setSource({ ...source, learner: { ...source.learner, record_voice: v } });
      setAskVoice(false);
      setFocusHeading(true);
    } catch {
      setVoiceError(V.voiceSaveFailed);
    }
  };

  const chooseSubject = async (courseId: string, subject: string | null) => {
    const was = source?.courses.find((c) => c.id === courseId)?.subject ?? null;
    const put = (value: string | null) =>
      setSource((s) => s && { ...s, courses: s.courses.map((c) => (c.id === courseId ? { ...c, subject: value } : c)) });
    setSubjectError(null);
    put(subject);
    try {
      await setCourseSubject(learnerId, courseId, subject);
    } catch {
      put(was); // only this course goes back; another course changed meanwhile keeps its choice
      setSubjectError(V.subjectSaveFailed);
    }
  };

  const withSaved = (src: RecordSource, row: RecordSavedMonth): RecordSource =>
    ({ ...src, savedMonths: [...src.savedMonths.filter((m) => m.month !== row.month), row].sort((a, b) => a.month.localeCompare(b.month)) });

  // Save and CSV of an ended month with no saved copy save one first (spec §7 v19), so what is printed
  // or downloaded is what stays. A failed save is not a failed print: the page then says "Built …".
  const keepMonth = async (): Promise<RecordSource | null> => {
    const at = new Date();
    if (!source || !record || !needsSaving(record, at)) return source;
    try {
      const snapshot = snapshotOf(source, record.range, at);
      if (!snapshot) return source;
      // A copy saved before its month ended, or missing activity newer than it saw, is replaced.
      const next = withSaved(source, await saveMonthlyRecord(source.learner.id, snapshot, copyNeedsReplacing(source, record.range)));
      setSource(next);
      return next;
    } catch (e) {
      console.warn("[record] could not save the month", e);
      return source;
    }
  };

  // "Rebuild from current data": a new copy from the rows on record now replaces the saved one. It
  // throws rather than do nothing, so the confirmation shows that it failed.
  const rebuild = async () => {
    if (!source || !record) throw new Error("the record is not loaded");
    const snapshot = snapshotOf(source, record.range, new Date());
    if (!snapshot) throw new Error("this month has not ended");
    const row = await saveMonthlyRecord(source.learner.id, snapshot, true);
    setSource((s) => s && withSaved(s, row));
  };

  const print = () => { void keepMonth().then(() => setPrinting(true)); };
  const save = () => {
    if (source && needsNameCheck(source.learner, canSetGrade)) setCheckingName(true);
    else print();
  };
  // A saved change lands in the record at once, so the page (and the learner chip) never shows a stale
  // name, even when a later step fails and the dialog stays open, or the user then picks Skip.
  const learnerSaved = (change: { name?: string; grade?: Grade | null }) => {
    setSource((s) => s && { ...s, learner: { ...s.learner, ...change } });
    onLearnerChanged?.();
  };
  const nameChecked = () => {
    setCheckingName(false);
    print();
  };
  const nameCheckCancelled = () => {
    setCheckingName(false);
    requestAnimationFrame(() => saveButton.current?.focus());
  };

  // The spreadsheets (spec §4b): the daily summary, then, when asked, the event log, each through its own
  // Save dialog (export_save_csv writes one file per click). Resolves to the line shown under the button.
  const saveSpreadsheet = async (withLog: boolean): Promise<string> => {
    if (!source || !record) return "";
    const src = (await keepMonth()) ?? source;
    const shown = shownRecord(src, record.range, now);
    const names = recordCsvNames(shown);
    const notes: string[] = [];
    try {
      const daily = await saveCsvFile(names.daily, recordDailyCsv(shown, shownDays(src, shown, now)), X.dialogDaily);
      if (!daily) return "";
      notes.push(fill(X.saved, { path: daily }));
      if (withLog) {
        const log = await saveCsvFile(names.events, recordEventCsv(shown, recordEvents(src, shown)), X.dialogLog);
        notes.push(log ? fill(X.savedLog, { path: log }) : X.logCancelled);
      }
    } catch (e) {
      notes.push(fill(X.failed, { error: e instanceof Error ? e.message : String(e) }));
    }
    return notes.join(" ");
  };

  const name = source?.learner.name.trim() || "Your learner";
  const title = audience === "self" ? V.myRecord : fill(V.namedRecord, { name });
  const asking = who === "own" && source !== null && (voice === "ask" || askVoice);

  const rangePicker = source && !asking && options.length > 0 && (
    <label className="flex items-center gap-2 text-sm text-[var(--ink-dim)]">
      {V.rangeLabel}
      <select className="cf-input" style={{ width: "auto" }} value={picked?.key} onChange={(e) => setRangeKey(e.target.value)}>
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </label>
  );
  const back = <button type="button" className="btn" onClick={onBack}>{who === "teacher" ? V.backTeacher : V.backHome}</button>;

  if (printing && record) {
    return (
      <PrintView
        title={fill(C.print.previewTitle, { name, period: record.period.label })}
        hint={C.print.hint}
        pages={recordPrintPages(record, audience, now)}
        onBack={() => setPrinting(false)}
        backLabel={C.print.back}
        autoPrint
      />
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col bg-bg">
      {/* Inside TeacherView its header is the page's header; the record adds a toolbar row, not a second header. */}
      {who === "own" && (
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 sm:px-12 py-[18px] border-b border-[var(--rule)]">
          <span className="flex items-center gap-2.5 text-[19px] font-semibold text-phosphor"><BookIcon />OpenEdu</span>
          <span className="text-[15px] text-[var(--ink-faint)] grow">Record</span>
          {rangePicker}
          {source && !asking && <button type="button" className="btn" onClick={() => setAskVoice(true)}>{V.whoReads}</button>}
          {back}
        </header>
      )}

      <main className="box-border w-full max-w-[1040px] mx-auto px-5 sm:px-12 pt-8 pb-16 flex flex-col gap-10">
        {who === "teacher" && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 -mb-4">
            {back}
            <span className="grow" />
            {rangePicker}
          </div>
        )}
        {failed ? (
          <div className="flex flex-col items-start gap-3">
            <Quiet>{V.loadFailed}</Quiet>
            <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>{V.tryAgain}</button>
          </div>
        ) : !source || !record ? (
          <Quiet>{V.loading}</Quiet>
        ) : asking ? (
          <VoiceQuestion
            current={source.learner.record_voice}
            forced={voice === "ask"}
            error={voiceError}
            onChoose={(v) => void chooseVoice(v)}
            onKeep={() => { setAskVoice(false); setFocusHeading(true); }}
          />
        ) : (
          <RecordBody
            record={record}
            allTime={allTime}
            audience={audience}
            name={name}
            title={title}
            open={open}
            subjectError={subjectError}
            onSubject={(id, s) => void chooseSubject(id, s)}
            now={now}
            headingRef={headingRef}
            headingLevel={who === "teacher" ? 2 : 1}
            onSave={save}
            saveRef={saveButton}
            onSaveSpreadsheet={saveSpreadsheet}
            onRebuild={canRebuild ? rebuild : null}
          />
        )}
      </main>
      {checkingName && source && (
        <NameCheck
          learnerId={learnerId}
          name={source.learner.name}
          grade={normalizeGrade(source.learner.grade)}
          canSetGrade={canSetGrade}
          onSaved={learnerSaved}
          onDone={nameChecked}
          onCancel={nameCheckCancelled}
        />
      )}
    </div>
  );
}

/** "Save as spreadsheet (CSV)", the detailed-log option, and how the files' rows were made. */
function SpreadsheetSave({ save }: { save: (withLog: boolean) => Promise<string> }) {
  const [withLog, setWithLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      setNote((await save(withLog)) || null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-start sm:items-end gap-1 pt-2">
      <button type="button" className="btn" disabled={busy} onClick={() => void run()}>{busy ? X.saving : X.save}</button>
      <label className="inline-flex items-center gap-2.5 min-h-[44px] text-[15px] text-[var(--ink-dim)] cursor-pointer">
        <input
          type="checkbox"
          checked={withLog}
          onChange={(e) => setWithLog(e.target.checked)}
          className="w-5 h-5 cursor-pointer"
          style={{ accentColor: "var(--phosphor)" }}
        />
        {X.alsoLog}
      </label>
      <span className="text-sm text-[var(--ink-faint)] sm:text-right leading-normal">{X.statementFile} {X.statementApp}</span>
      {/* Always rendered, so a screen reader announces the text when it changes. */}
      <span role="status" className="text-sm text-[var(--ink-dim)] sm:text-right leading-normal break-all">{note ?? ""}</span>
    </div>
  );
}

/** "Rebuild from current data", behind its confirmation: "This replaces the copy saved on Dec 1, 2026." */
function Rebuild({ savedAt, onRebuild }: { savedAt: string; onRebuild: () => Promise<void> }) {
  const R = C.rebuild;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) confirmRef.current?.focus(); }, [asking]);
  const close = () => { setAsking(false); requestAnimationFrame(() => buttonRef.current?.focus()); };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRebuild();
      close();
    } catch (e) {
      console.warn("[record] could not rebuild the month", e);
      setError(R.failed);
    } finally {
      setBusy(false);
    }
  };
  if (!asking) {
    return (
      <div className="flex flex-col items-start gap-1 pt-2 max-w-[420px]">
        <span className="text-sm text-[var(--ink-faint)] leading-normal">{R.help}</span>
        <button ref={buttonRef} type="button" className="btn" onClick={() => setAsking(true)}>{R.button}</button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2 pt-2 max-w-[420px]" role="group" aria-label={R.button}>
      <p ref={confirmRef} tabIndex={-1} className="m-0 text-[15px] text-ink leading-normal outline-none">{fill(R.confirm, { date: dayText(savedAt, true) })}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run()}>{busy ? R.busy : R.replace}</button>
        <button type="button" className="btn" disabled={busy} onClick={close}>{R.keep}</button>
      </div>
      {error && <p role="alert" className="m-0 text-[15px] text-danger">{error}</p>}
    </div>
  );
}

function VoiceQuestion({ current, forced, error, onChoose, onKeep }: {
  current: "self" | "guided" | null;
  forced: boolean;
  error: string | null;
  onChoose: (v: "self" | "guided") => void;
  onKeep: () => void;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <section className="max-w-[560px] flex flex-col gap-5 px-7 py-7 rounded-[20px] bg-panel border border-[var(--rule)]" aria-labelledby="rec-voice" style={{ boxShadow: "var(--shadow-soft)" }}>
      <span className="glow-line" />
      <h1 id="rec-voice" ref={ref} tabIndex={-1} className="m-0 text-[28px] font-medium tracking-[-0.01em] text-ink outline-none">{V.voiceQuestion}</h1>
      <div className="flex flex-wrap gap-3" role="group" aria-labelledby="rec-voice">
        <button type="button" className={`btn ${current === "self" ? "btn-primary" : ""}`} style={{ minWidth: 120 }} onClick={() => onChoose("self")}>{V.voiceMe}</button>
        <button type="button" className={`btn ${current === "guided" ? "btn-primary" : ""}`} onClick={() => onChoose("guided")}>{V.voiceGrownUp}</button>
      </div>
      <Quiet>{V.voiceHelp}</Quiet>
      {error && <p className="m-0 text-[15px] text-danger">{error}</p>}
      {!forced && <div><button type="button" className="btn" onClick={onKeep}>{V.voiceKeep}</button></div>}
    </section>
  );
}

function RecordBody({ record: r, allTime, audience, name, title, open, subjectError, onSubject, now, headingRef, headingLevel, onSave, saveRef, onSaveSpreadsheet, onRebuild }: {
  onSave: () => void;
  /** Null when this reader may not replace a saved month. */
  onRebuild: (() => Promise<void>) | null;
  onSaveSpreadsheet: (withLog: boolean) => Promise<string>;
  saveRef: RefObject<HTMLButtonElement | null>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** 1 on the record's own screen; 2 inside TeacherView, whose "Teacher / parent" is the page's h1. */
  headingLevel: 1 | 2;
  record: LearningRecord;
  allTime: LearningRecord | null;
  audience: Audience;
  name: string;
  title: string;
  open: Open;
  subjectError: string | null;
  onSubject: (courseId: string, subject: string | null) => void;
  now: Date;
}) {
  const self = audience === "self";
  const who = self ? V.you : name;
  const when = whenText(r);
  const grade = normalizeGrade(r.learner.grade);
  const checked = masteredCount(r);
  const early = earlySignCount(r);
  const everything = allTime?.mastered ?? [];
  const approx = approxShown(r.time);
  // A self reader's "Since you started" range already is this list.
  const showEverything = self && r.range.kind !== "since";

  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <>
      {/* The page's heading first; in the self voice, everything mastered so far comes straight after
          it, so a quiet month never opens on zeros. Then the range's three tiles. */}
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <span
            aria-hidden="true"
            className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-semibold shrink-0"
            style={{ background: "var(--early-avatar)", color: "var(--early-avatar-ink)" }}
          >
            {name.charAt(0).toUpperCase()}
          </span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <Heading ref={headingRef} tabIndex={-1} className="m-0 text-[32px] font-medium tracking-[-0.02em] text-ink break-words outline-none">{title}</Heading>
            <span className="text-[15px] text-[var(--ink-faint)]">
              {self ? r.period.label : `${grade === null ? C.gradeNotSet : gradeLabel(grade)} · ${r.period.label}`}
              {r.period.span ? ` · ${r.period.span}` : ""}
            </span>
            {/* H4: a saved month says when it was saved; a past month without a saved copy says it was built now. */}
            {provenance(r) && <Small>{provenance(r)}</Small>}
            {r.saved?.examplesGone && <Small>{C.examplesGone}</Small>}
            {r.saved && onRebuild && <Rebuild key={r.period.label} savedAt={r.saved.at} onRebuild={onRebuild} />}
            {/* K-1 work on the early-learner screens is kept apart (#244); say where it is, without guessing the choice. */}
            {(grade === 0 || grade === 1) && <span className="text-[15px] text-[var(--ink-dim)]">{V.earlyNote}</span>}
          </div>
          {/* Save prints the record. The helper speaks to a grown-up keeping a portfolio, so not in the self voice. */}
          <div className="ml-auto flex flex-col items-start sm:items-end gap-1.5 max-w-[340px]">
            <button ref={saveRef} type="button" className="btn btn-primary" onClick={onSave}>{saveLabel(r, audience)}</button>
            {!self && <span className="text-sm text-[var(--ink-faint)] sm:text-right leading-normal">{C.saveHelper}</span>}
            <SpreadsheetSave save={onSaveSpreadsheet} />
          </div>
        </div>

        {showEverything && <Everything rows={everything} open={open} />}

        <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
          <Tile k="t-days" head={V.tileHeads.days} what={V.what.days} open={open} rules={[RECORD_RULES.tiles.days]}>
            <Big template={C.tiles.days} n={r.days} />
          </Tile>
          <Tile
            k="t-time"
            head={V.tileHeads.time}
            what={V.what.time}
            open={open}
            rules={[...(approx ? [RECORD_RULES.tiles.time_approx] : []), ...(r.time.counted ? [RECORD_RULES.tiles.time_counted] : [])]}
          >
            {approx && (
              <div className="flex flex-col gap-1">
                <span className="text-[24px] font-semibold text-ink leading-tight">{approxTimeText(approx).split(" · ")[0]}</span>
                <span className="flex flex-wrap items-center gap-2 text-sm text-[var(--ink-faint)]">
                  {approxTimeText(approx).split(" · ")[1]}
                  <Tag>{V.approxPill}</Tag>
                </span>
              </div>
            )}
            {r.time.counted && (
              <div className={`flex flex-col gap-1 ${approx ? "pt-2 border-t border-[var(--rule)]" : ""}`}>
                <Big template={C.tiles.time_counted} n={r.time.counted.minutes} />
              </div>
            )}
          </Tile>
          <Tile k="t-mastered" head={V.tileHeads.mastered} what={V.what.mastered} open={open} rules={[RECORD_RULES.tiles.mastered]}>
            <span className="text-[28px] font-semibold text-ink leading-tight">{checked}</span>
            <span className="text-sm text-[var(--ink-faint)]">{C.tiles.mastered}</span>
            {early > 0 && <span className="text-sm text-[var(--ink-dim)]">{fill(C.tiles.earlySigns, { n: early })}</span>}
          </Tile>
        </div>
      </div>

      {/* 4. A1: what was mastered, proof on every row. */}
      <Section id="a1" title={fill(V.masteredHead, { who, when })} rule={RECORD_RULES.tiles.mastered} open={open}>
        {r.mastered.length ? (
          <Card>
            {r.mastered.map((m, i) => <MasteredLine key={`${m.courseId}-${m.level}-${m.skillId}`} m={m} first={i === 0} open={open} prefix="a1" />)}
          </Card>
        ) : <Quiet>{V.masteredNone}</Quiet>}
      </Section>

      {/* ── Below the fold ── */}
      {!self && (r.talkAboutIt.explain.length > 0 || r.talkAboutIt.nextUp.length > 0) && (
        <Section id="b4" title={V.talkAboutIt} open={open}>
          <div className="flex flex-col gap-3">
            {r.talkAboutIt.explain.map((t) => (
              <div key={`${t.courseId}-${t.level}-${t.skillId}`} className="px-[18px] py-4 rounded-[18px] bg-[var(--panel-tint)] flex flex-col gap-2">
                <span className="text-base font-medium text-ink">{fill(C.talkAboutIt.explain, { name, skill: t.skill })}</span>
                {t.selfExplanation && (
                  <>
                    <blockquote className="m-0 pl-3.5 border-l-[3px] border-[var(--phosphor)] text-[15px] text-ink italic leading-relaxed">{t.selfExplanation}</blockquote>
                    <span className="text-sm text-[var(--ink-dim)]">{fill(C.talkAboutIt.readTogether, { name })}</span>
                  </>
                )}
              </div>
            ))}
            {r.talkAboutIt.nextUp.length > 0 && (
              <ul className="m-0 pl-5 list-disc flex flex-col gap-1 text-[15px] text-ink">
                {r.talkAboutIt.nextUp.map((l) => (
                  <li key={`${l.courseId}-${l.level}-${l.skillId}`}>{fill(C.talkAboutIt.nextUp, { skill: l.skill, correct: l.correct, total: l.total })}</li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      )}

      <Section id="a3" title={V.recheckedHead} rule={RECORD_RULES.sections.rechecked} open={open}>
        {r.rechecked.held.length + r.rechecked.slipped.length ? (
          <div className="flex flex-col gap-1">
            <p className="m-0 text-base text-ink">
              {fill(C.rechecked, {
                n: r.rechecked.held.length + r.rechecked.slipped.length, held: r.rechecked.held.length, slipped: r.rechecked.slipped.length,
              })}
            </p>
            {r.rechecked.slipped.length > 0 && (
              <Quiet>{fill(V.slipped, { skills: r.rechecked.slipped.map((s) => s.skill).join(", ") })}</Quiet>
            )}
          </div>
        ) : <Quiet>{V.recheckedNone}</Quiet>}
      </Section>

      <Standing record={r} allTime={allTime} open={open} subjectError={subjectError} onSubject={onSubject} now={now} />

      <Section id="a4" title={V.levelsHead} open={open}>
        {r.levelsPassed.length ? (
          <Card>
            {r.levelsPassed.map((p, i) => (
              <Row key={`${p.courseId}-${p.level}`} first={i === 0}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-base text-ink grow">{fill(V.levelRow, { level: p.level, course: p.course })}</span>
                  <Tag tone="done">{p.date ? fill(C.levels.passed, { date: dayText(p.date) }) : C.levels.passedUndated}</Tag>
                </div>
              </Row>
            ))}
          </Card>
        ) : <Quiet>{V.levelsNone}</Quiet>}
      </Section>

      <Section id="b3" title={V.hardHead} rule={RECORD_RULES.sections.hard_ones} open={open}>
        {r.hardOnes.length ? (
          <div className="flex flex-col gap-3">
            {r.hardOnes.map((h) => (
              <Card key={`${h.courseId}-${h.level}-${h.skillId}`}>
                <div className="px-5 py-4 flex flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[17px] font-medium text-ink">{h.skill}</span>
                    <Small>{`${h.course} · ${fill(V.levelOnly, { level: h.level })} · ${fill(V.hardLine, { correct: h.correct, total: h.total })}`}</Small>
                  </div>
                  {h.missed.map((q, i) => (
                    <dl key={i} className="m-0 grid gap-x-3 gap-y-1 rounded-xl bg-[var(--lcd)] px-4 py-3 text-[15px]" style={{ gridTemplateColumns: "minmax(0,auto) minmax(0,1fr)" }}>
                      <dt className="text-[var(--ink-faint)]">{C.hardOnes.question}</dt><dd className="m-0 text-ink">{q.question}</dd>
                      <dt className="text-[var(--ink-faint)]">{C.hardOnes.answered}</dt><dd className="m-0 text-ink">{q.answered}</dd>
                      <dt className="text-[var(--ink-faint)]">{C.hardOnes.key}</dt><dd className="m-0 text-ink">{q.key}</dd>
                    </dl>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        ) : <Quiet>{V.hardNone}</Quiet>}
      </Section>

      <Quizzes record={r} open={open} />

      <Section id="c2" title={self ? V.ownWordsSelf : fill(V.ownWordsNamed, { name })} open={open}>
        {r.ownWords.length ? (
          <div className="flex flex-col gap-3">
            {r.ownWords.map((w, i) => (
              <figure key={i} className="m-0 px-5 py-4 rounded-[18px] bg-panel border border-[var(--rule)] flex flex-col gap-2">
                <blockquote className="m-0 text-[15px] text-ink leading-relaxed whitespace-pre-wrap break-words">{w.text}</blockquote>
                <figcaption className="text-sm text-[var(--ink-faint)]">
                  {w.kind === "note"
                    ? `${w.title ? `${w.title} · ` : ""}${w.course} · ${fill(C.ownWords.noteStarted, { date: dayText(w.date) })}`
                    : `${w.skill ? `${fill(V.explanationOn, { skill: w.skill })} · ` : ""}${w.course} · ${dayText(w.date)}`}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : <Quiet>{ownWordsNoneText(r)}</Quiet>}
      </Section>

      <Section id="c3" title={V.activityHead} open={open}>
        <Card>
          <div className="px-5 py-4 flex flex-col gap-2 text-[15px] text-ink">
            <div className="flex items-center gap-2">
              <span className="grow">{fill(C.activity.lessons, { n: r.activity.lessonsOpened })}</span>
              <InfoButton what={V.what.lessons} k="c3-lessons" open={open} />
            </div>
            <RuleNote k="c3-lessons" open={open}>{RECORD_RULES.sections.lessons}</RuleNote>
            <span>{fill(C.activity.tutor, { messages: r.activity.tutorMessages, conversations: r.activity.tutorConversations })}</span>
            <span>
              {fill(C.activity.flashcards, { n: r.activity.flashcardsMade })}
              {r.activity.flashcardsMadeByApp > 0 && <span className="text-[var(--ink-dim)]">{`, ${fill(C.activity.flashcardsByApp, { n: r.activity.flashcardsMadeByApp })}`}</span>}
            </span>
            {r.activity.flashcardsReviewed !== null && <span>{fill(C.activity.reviewed, { n: r.activity.flashcardsReviewed })}</span>}
            {r.activity.notesStarted !== null && <span>{fill(C.activity.notes, { n: r.activity.notesStarted })}</span>}
            {r.activity.coursesStarted.length
              ? r.activity.coursesStarted.map((c) => <span key={c.courseId}>{fill(C.activity.courseStarted, { title: c.course, date: dayText(c.date) })}</span>)
              : <span className="text-[var(--ink-dim)]">{V.coursesStartedNone}</span>}
          </div>
        </Card>
      </Section>

      <Section id="c4" title={V.timeHead} rule={RECORD_RULES.tiles.time_approx} open={open}>
        {r.timeBySubject.length ? (
          <Card>
            {r.timeBySubject.map((g, i) => (
              <Row key={g.subject ?? "none"} first={i === 0}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[17px] font-medium text-ink grow">{g.subject ?? C.noSubject}</span>
                  <span className="text-[15px] text-ink">{fill(V.about, { time: durationText(g.minutes) })}</span>
                  <Tag>{V.approxPill}</Tag>
                </div>
                {g.courses.map((c) => (
                  <div key={c.courseId} className="flex flex-wrap gap-x-3 text-sm text-[var(--ink-dim)] pl-3 border-l-2 border-[var(--rule)]">
                    <span className="grow">{c.course}</span>
                    <span>{approxTimeText({ minutes: c.minutes, sittings: c.sittings })}</span>
                  </div>
                ))}
              </Row>
            ))}
          </Card>
        ) : <Quiet>{V.timeNone}</Quiet>}
      </Section>

      <Section id="a2" title={V.withoutHead} open={open}>
        {r.withoutProof.length ? (
          <Card>
            {r.withoutProof.map((w, i) => {
              const k = `a2-${w.courseId}-${w.level}-${w.skillId}`;
              const { pill, why } = withoutProofText(w);
              return (
                <Row key={k} first={i === 0}>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex flex-col gap-0.5" style={{ flex: "1 1 240px" }}>
                      <span className="text-base font-medium text-ink">{w.skill}</span>
                      <Small>{`${w.course} · ${fill(V.levelOnly, { level: w.level })}${w.date ? ` · ${dayText(w.date)}` : ""}`}</Small>
                    </div>
                    <Pill status={pill} k={k} open={open} />
                  </div>
                  <span className="text-sm text-[var(--ink-dim)] leading-normal">{why}</span>
                  <RuleNote k={k} open={open}>{RECORD_RULES.pills[pill]}</RuleNote>
                </Row>
              );
            })}
          </Card>
        ) : <Quiet>{V.withoutNone}</Quiet>}
      </Section>

      <HowCounted audience={audience} />
    </>
  );
}

/** "At least {n} days with learning": "At least 12" set large, the rest of the sentence small under it. */
function Big({ template, n }: { template: string; n: number }) {
  const { big, rest } = splitAtCount(fill(template, { n }), n);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[28px] font-semibold text-ink leading-tight">{big}</span>
      <span className="text-sm text-[var(--ink-faint)]">{rest}</span>
    </div>
  );
}

function MasteredLine({ m, first, open, prefix }: { m: MasteredRow; first: boolean; open: Open; prefix: string }) {
  const k = `${prefix}-${m.courseId}-${m.level}-${m.skillId}`;
  return (
    <Row first={first}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex flex-col gap-0.5" style={{ flex: "1 1 260px" }}>
          <span className="text-[17px] font-medium text-ink">{m.skill}</span>
          <Small>{`${m.course} · ${fill(V.levelOnly, { level: m.level })} · ${dayText(m.date)}`}</Small>
          <Small>{evidenceText(m.evidence)}</Small>
        </div>
        <Pill status={m.earlySign ? "early_sign" : "mastered"} k={k} open={open} />
      </div>
      <RuleNote k={k} open={open}>{RECORD_RULES.pills[m.earlySign ? "early_sign" : "mastered"]}</RuleNote>
    </Row>
  );
}

function Everything({ rows, open }: { rows: MasteredRow[]; open: Open }) {
  const total = rows.filter((m) => !m.earlySign).length;
  return (
    <section className="flex flex-col gap-4 px-6 py-6 rounded-[20px] bg-[var(--panel-tint)] border border-[var(--rule)]" aria-labelledby="rec-everything">
      <div className="flex flex-col gap-1">
        <h2 id="rec-everything" className="m-0 text-[24px] font-medium tracking-[-0.01em] text-ink">{V.everything}</h2>
        <span className="text-[15px] text-[var(--ink-dim)]">{rows.length ? fill(V.everythingTotal, { n: total }) : V.everythingEmpty}</span>
      </div>
      {groupByCourseAndLevel(rows).map((c) => (
        <div key={c.courseId} className="flex flex-col gap-2">
          <h3 className="m-0 text-[17px] font-medium text-ink">{c.course}</h3>
          {c.levels.map((l) => (
            <div key={l.level} className="flex flex-col gap-1.5 pl-3.5 border-l-2 border-[var(--rule-strong)]">
              <span className="text-sm text-[var(--ink-faint)]">{fill(V.levelOnly, { level: l.level })}</span>
              <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
                {l.rows.map((m) => {
                  const k = `all-${m.courseId}-${m.level}-${m.skillId}`;
                  return (
                    <li key={k} className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        aria-expanded={open.isOpen(k)}
                        aria-controls={ruleId(k)}
                        onClick={() => open.toggle(k)}
                        className={`inline-flex items-center gap-2 min-h-[44px] px-3.5 py-2 rounded-full bg-panel border text-[15px] text-ink text-left hover:border-[var(--phosphor)] ${m.earlySign ? "border-dashed border-[var(--rule-strong)]" : "border-[var(--rule)]"}`}
                      >
                        <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0" style={{ background: m.earlySign ? "var(--phosphor)" : "var(--success)" }} />
                        <span>{m.skill}</span>
                        <span className="text-sm text-[var(--ink-faint)]">{m.earlySign ? `${C.pills.early_sign} · ${dayText(m.date)}` : dayText(m.date, true)}</span>
                      </button>
                      <RuleNote k={k} open={open}>{`${evidenceText(m.evidence)}. ${RECORD_RULES.pills[m.earlySign ? "early_sign" : "mastered"]}`}</RuleNote>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function Standing({ record: r, allTime, open, subjectError, onSubject, now }: {
  now: Date;
  record: LearningRecord;
  allTime: LearningRecord | null;
  open: Open;
  subjectError: string | null;
  onSubject: (courseId: string, subject: string | null) => void;
}) {
  // B1/B2, grouped by subject (the builder already orders courses by subject, then title).
  const groups: Array<{ subject: string | null; courses: CourseStanding[] }> = [];
  for (const c of r.courses) {
    const g = groups.find((x) => x.subject === c.subject);
    if (g) g.courses.push(c);
    else groups.push({ subject: c.subject, courses: [c] });
  }
  return (
    <Section id="b1" title={V.standHead} open={open}>
      {/* Judged at the range end; for a range that runs to today, that is today. */}
      <Small>{fill(V.standAsOf, { date: r.current ? dayText(toStored(now), true) : localDayText(r.period.to) })}</Small>
      {subjectError && <p className="m-0 text-[15px] text-danger">{subjectError}</p>}
      {groups.map((g) => (
        <div key={g.subject ?? "none"} className="flex flex-col gap-3">
          <h3 className="m-0 text-[15px] font-medium text-[var(--ink-dim)]">{g.subject ?? C.noSubject}</h3>
          {g.courses.map((c) => (
            <CourseCard key={c.courseId} c={c} record={r} allTime={allTime} open={open} onSubject={onSubject} />
          ))}
        </div>
      ))}
    </Section>
  );
}

function CourseCard({ c, record: r, allTime, open, onSubject }: {
  c: CourseStanding;
  record: LearningRecord;
  allTime: LearningRecord | null;
  open: Open;
  onSubject: (courseId: string, subject: string | null) => void;
}) {
  const finished = c.status === "completed" || c.status === "archived";
  const upTo = c.level ?? 0;
  const shown = c.skills.filter((s) => s.level <= upTo);
  const count = (st: SkillStatus) => shown.filter((s) => s.status === st).length;
  const current = shown.filter((s) => s.level === upTo);
  const earlier = shown.filter((s) => s.level < upTo);
  const learning = r.learning.filter((l) => l.courseId === c.courseId);
  const passDate = (level: number): string | null | undefined => {
    const p = (allTime?.levelsPassed ?? []).find((x) => x.courseId === c.courseId && x.level === level);
    return p ? p.date : undefined;
  };
  const subjectId = `subject-${c.courseId}`;

  return (
    <div className="rounded-[20px] bg-panel border border-[var(--rule)] flex flex-col">
      <div className="px-5 py-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex flex-col gap-0.5" style={{ flex: "1 1 260px" }}>
            <span className="text-[19px] font-medium text-ink break-words">{c.course}</span>
            {c.legacy ? <Small>{C.levels.legacy}</Small>
              : c.level === null ? <Small>{C.levels.notRecorded}</Small>
              : <span className="text-[15px] text-[var(--ink-dim)]">{c.levelTitle ? fill(V.levelLine, { level: c.level, title: c.levelTitle }) : fill(V.levelOnly, { level: c.level })}</span>}
          </div>
          {finished ? <Tag tone="done">{C.levels.finished}</Tag> : c.level !== null && !c.legacy && <Tag tone="accent">{C.levels.current}</Tag>}
        </div>

        <label htmlFor={subjectId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-[var(--ink-dim)]">
          {V.subject}
          <select
            id={subjectId}
            className="cf-input"
            style={{ width: "auto", minWidth: 200 }}
            value={c.subject ?? ""}
            onChange={(e) => onSubject(c.courseId, e.target.value || null)}
          >
            <option value="">{C.noSubject}</option>
            {RECORD_SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        {!c.legacy && c.level !== null && shown.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[15px] text-ink">
              {[
                fill(V.skillsLine, { mastered: count("mastered"), total: shown.length }),
                ...(count("early_sign") ? [fill(V.earlySigns, { n: count("early_sign") })] : []),
                ...(count("learning") ? [fill(V.learningCount, { n: count("learning") })] : []),
              ].join(" · ")}
            </span>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-[var(--rule)]" role="img" aria-label={fill(V.skillsLine, { mastered: count("mastered"), total: shown.length })}>
              {(["mastered", "early_sign", "learning"] as const).map((st) => (
                count(st) ? <div key={st} style={{ width: `${(count(st) / shown.length) * 100}%`, background: BAR[st] }} /> : null
              ))}
            </div>
            {c.reconciliation && c.reconciliation.shown > 0 && c.reconciliation.shown !== c.reconciliation.checked && (
              <Small>{fill(C.reconciliation, c.reconciliation)}</Small>
            )}
          </div>
        )}

        {c.objectives.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-sm text-[var(--ink-faint)]">{C.levels.objectives}</span>
            <ul className="m-0 pl-5 list-disc flex flex-col gap-0.5 text-[15px] text-ink">
              {c.objectives.map((o, i) => <li key={i}>{o}</li>)}
            </ul>
          </div>
        )}
      </div>

      {current.length > 0 && (
        <div className="flex flex-col border-t border-[var(--rule)]">
          {current.map((s, i) => <SkillLineRow key={s.skillId} courseId={c.courseId} s={s} first={i === 0} open={open} />)}
        </div>
      )}

      {learning.length > 0 && (
        <div className="px-5 py-3.5 flex flex-col gap-2 border-t border-[var(--rule)]">
          <span className="text-sm text-[var(--ink-faint)]">{V.learningHead}</span>
          {learning.map((l) => (
            <div key={`${l.level}-${l.skillId}`} className="flex flex-wrap items-center gap-3">
              <span className="text-[15px] text-ink" style={{ flex: "1 1 220px" }}>{fill(C.learning, { skill: l.skill, correct: l.correct, total: l.total })}</span>
              <div role="img" aria-label={`${l.correct} of ${l.total}`} className="w-32 h-2 rounded-full overflow-hidden bg-[var(--rule)]">
                <div className="h-2 rounded-full" style={{ width: `${l.total ? (l.correct / l.total) * 100 : 0}%`, background: "var(--phosphor)" }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!c.legacy && c.level !== null && (earlier.length > 0 || c.level < 6) && (
        <div className="px-5 py-3.5 flex flex-col gap-2 border-t border-[var(--rule)]">
          {upTo > 1 && (
            <details className="group">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-[15px] text-phosphor min-h-[44px] flex items-center gap-2 flex-wrap">
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 transition-transform group-open:rotate-90">
                  <path d="M9 6l6 6-6 6" />
                </svg>
                {V.earlierLevels}
                {Array.from({ length: upTo - 1 }, (_, i) => i + 1).map((lv) => {
                  const d = passDate(lv);
                  return <Tag key={lv} tone="done">{`${fill(V.levelOnly, { level: lv })} · ${d ? fill(C.levels.passed, { date: dayText(d) }) : C.levels.passedUndated}`}</Tag>;
                })}
              </summary>
              <div className="flex flex-col mt-1 rounded-xl border border-[var(--rule)]">
                {earlier.map((s, i) => <SkillLineRow key={`${s.level}-${s.skillId}`} courseId={c.courseId} s={s} first={i === 0} open={open} showLevel />)}
              </div>
            </details>
          )}
          {c.level < 6 && !finished && (
            <Small>{c.level === 5 ? fill(V.laterOne, { n: 6 }) : fill(C.levels.later, { from: c.level + 1, to: 6 })}</Small>
          )}
        </div>
      )}
    </div>
  );
}

function SkillLineRow({ courseId, s, first, open, showLevel }: {
  courseId: string;
  s: CourseStanding["skills"][number];
  first: boolean;
  open: Open;
  showLevel?: boolean;
}) {
  const k = `b1-${courseId}-${s.level}-${s.skillId}`;
  const kr = `${k}-review`;
  return (
    <div className="px-5 py-3 flex flex-col gap-2" style={{ borderTop: first ? undefined : "1px solid var(--rule)" }}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[15px] text-ink" style={{ flex: "1 1 220px" }}>
          {s.skill}
          {showLevel && <span className="text-sm text-[var(--ink-faint)]">{` · ${fill(V.levelOnly, { level: s.level })}`}</span>}
        </span>
        {s.reviewAgain && <Pill status="review_again" k={kr} open={open} />}
        <Pill status={s.status} k={k} open={open} />
      </div>
      <RuleNote k={k} open={open}>{RECORD_RULES.pills[s.status]}</RuleNote>
      {s.reviewAgain && <RuleNote k={kr} open={open}>{RECORD_RULES.pills.review_again}</RuleNote>}
    </div>
  );
}

function Quizzes({ record: r, open }: { record: LearningRecord; open: Open }) {
  const Q = C.quizzes;
  return (
    <Section id="c1" title={V.quizzesHead} open={open}>
      <Small>{Q.header}</Small>
      {r.quizzes.length ? (
        <div className="overflow-x-auto rounded-[20px] border border-[var(--rule)] bg-panel">
          <table className="w-full text-left text-[15px] border-collapse">
            <thead className="text-sm text-[var(--ink-faint)]">
              <tr>
                {Object.values(V.columns).map((h) => <th key={h} scope="col" className="px-4 py-3 font-normal whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {r.quizzes.map((q) => (
                <tr key={q.attemptId} className="border-t border-[var(--rule)] text-ink align-top">
                  <td className="px-4 py-3 whitespace-nowrap">{dayText(q.date)}</td>
                  <td className="px-4 py-3 min-w-[140px]">{q.course}</td>
                  <td className="px-4 py-3">{q.level}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {q.levelTest ? Q.levelTest : Q.quiz}
                    {q.passed !== null && <span className={`block text-sm ${q.passed ? "text-success" : "text-[var(--ink-dim)]"}`}>{q.passed ? Q.passed : Q.notPassed}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="whitespace-nowrap">
                      {q.score === null ? fill(V.resultCell, { correct: q.correct, total: q.total }) : fill(V.resultScore, { correct: q.correct, total: q.total, score: Math.round(q.score) })}
                    </span>
                    {q.timedOutUnstored && <span className="block text-sm text-[var(--ink-dim)]">{Q.timedOutUnstored}</span>}
                    {q.unanswered > 0 && <span className="block text-sm text-[var(--ink-dim)]">{fill(V.unansweredNote, { n: q.unanswered })}</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{quizTimeText(q.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Quiet>{V.quizzesNone}</Quiet>}
      {r.startedNotFinished > 0 && <span className="text-[15px] text-ink">{fill(Q.startedNotFinished, { n: r.startedNotFinished })}</span>}
      <Small>{Q.repeatFootnote}</Small>
    </Section>
  );
}

function HowCounted({ audience }: { audience: Audience }) {
  const T = RECORD_RULES.tiles;
  const S = RECORD_RULES.sections;
  const rules: Array<[string, string]> = [
    [C.tiles.mastered, T.mastered],
    [V.howDays, T.days],
    [V.howTimeApprox, T.time_approx],
    [V.howTimeCounted, T.time_counted],
    [V.recheckedHead, S.rechecked],
    [V.hardHead, S.hard_ones],
    [V.howLessons, S.lessons],
  ];
  return (
    <section className="flex flex-col gap-4 pt-8 border-t border-[var(--rule)]" aria-labelledby="rec-how">
      <h2 id="rec-how" className="m-0 text-[21px] font-medium text-ink">{V.howHead}</h2>
      <dl className="m-0 flex flex-col gap-3">
        {rules.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="text-[15px] font-medium text-ink">{k}</dt>
            <dd className="m-0 text-[15px] text-[var(--ink-dim)] leading-relaxed">{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="m-0 mt-2 text-[17px] font-medium text-ink">{V.labelsHead}</h3>
      <dl className="m-0 flex flex-col gap-2.5">
        {(Object.keys(C.pills) as PillKey[]).map((p) => (
          <div key={p} className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <dt className="shrink-0"><span className={`inline-flex whitespace-nowrap px-3 py-[5px] rounded-full text-sm font-medium ${PILL[p]}`}>{C.pills[p]}</span></dt>
            <dd className="m-0 text-[15px] text-[var(--ink-dim)] leading-relaxed" style={{ flex: "1 1 260px" }}>{RECORD_RULES.pills[p]}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-[15px] text-[var(--ink-dim)] leading-relaxed">{C.authorship}</p>
      <div className="px-5 py-4 rounded-[18px] bg-[var(--panel-lite)] flex flex-col gap-1.5" role="note" aria-labelledby="rec-about">
        <h3 id="rec-about" className="m-0 text-[15px] font-medium text-ink">{V.disclaimerHead}</h3>
        <p className="m-0 text-[15px] text-ink leading-relaxed">{audience === "self" ? RECORD_DISCLAIMER_SHORT : RECORD_DISCLAIMER}</p>
      </div>
    </section>
  );
}

/**
 * Spec §1 rule 5: before a record still named 'Learner 1', or with no grade, is saved, ask for both.
 * Either can stay as it is; Skip goes straight on to the print. Saved through the same setters as the
 * learner menu and Settings. The grade field is left out where the reader may not set a grade (a
 * learner's own record in a class or school). While a save is running, nothing closes the dialog.
 */
function NameCheck({ learnerId, name: initialName, grade: initialGrade, canSetGrade, onSaved, onDone, onCancel }: {
  learnerId: string;
  name: string;
  grade: Grade | null;
  canSetGrade: boolean;
  /** Each change as soon as it is stored, even if a later one fails. */
  onSaved: (change: { name?: string; grade?: Grade | null }) => void;
  /** Saved or skipped: go on to the print. */
  onDone: () => void;
  /** Esc, a click outside: no print. */
  onCancel: () => void;
}) {
  const N = C.print.nameCheck;
  const [name, setName] = useState(initialName);
  const [grade, setGrade] = useState<Grade | null>(initialGrade);
  // What is stored now: a retry after a failed grade does not rename again.
  const [stored, setStored] = useState({ name: initialName.trim(), grade: initialGrade });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const cancel = () => { if (!busy) onCancel(); };

  const saveAndContinue = async () => {
    setBusy(true);
    setError(null);
    const trimmed = name.trim();
    try {
      if (trimmed !== stored.name) {
        const problem = validateLearnerName(trimmed, await listLearners(), learnerId);
        if (problem) { setError(problem); setBusy(false); return; }
        await renameLearner(learnerId, trimmed);
        setStored((s) => ({ ...s, name: trimmed }));
        onSaved({ name: trimmed });
      }
      if (canSetGrade && grade !== stored.grade) {
        await setLearnerGrade(learnerId, grade);
        setStored((s) => ({ ...s, grade }));
        onSaved({ grade });
      }
      onDone();
    } catch {
      setError(N.failed);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4" onMouseDown={cancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="rec-name-check"
        aria-busy={busy}
        className="bg-panel border border-[var(--rule)] rounded-[20px] p-7 w-[min(480px,94vw)] max-h-[90vh] overflow-y-auto flex flex-col gap-5"
        style={{ boxShadow: "var(--shadow-soft)" }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}
        onSubmit={(e) => { e.preventDefault(); if (!busy) void saveAndContinue(); }}
      >
        <span className="glow-line" />
        <div className="flex flex-col gap-2">
          <h2 id="rec-name-check" className="m-0 text-[24px] font-medium tracking-[-0.01em] text-ink">{N.head}</h2>
          <Quiet>{canSetGrade ? N.body : N.bodyNameOnly}</Quiet>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[15px] text-ink">{N.name}</span>
          <input ref={input} className="cf-input" value={name} maxLength={LEARNER_NAME_MAX} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </label>
        {canSetGrade && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[15px] text-ink">{N.grade}</span>
            <GradeSelect value={grade} onChange={setGrade} style={{ width: "100%" }} />
          </label>
        )}
        {error && <p className="m-0 text-[15px] text-danger" role="alert">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>{N.saveAndContinue}</button>
          <button type="button" className="btn" disabled={busy} onClick={onDone}>{N.skip}</button>
        </div>
      </form>
    </div>
  );
}
