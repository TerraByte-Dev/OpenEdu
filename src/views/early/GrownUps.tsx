import { useEffect, useMemo, useState } from "react";
import { getActiveLearnerId, getEarlyAttempts } from "../../lib/db";
import type { AttemptRow } from "../../lib/early/engine";
import {
  CONFUSION_DAYS, CONFUSION_MIN, SESSION_GAP_MS, hardOnes, monthLabel, monthlyRecord, monthsWithAttempts,
  skillReports, skillTitle, weekSummary, type MonthRef, type SkillStatus,
} from "../../lib/early/report";
import { togetherIdeas } from "../../lib/early/together";
import { SHEETS, pageCount } from "../../lib/early/tracing";
import { gradeLabel, type Grade } from "../../lib/grade";
import { BookIcon } from "./pictures";
import PrintView, { recordPage, tracingPages } from "./PrintView";

// The grown-ups view for an early learner (#244 PR 2), behind the press-and-hold (and the teacher PIN in
// a class or school). Everything on it is counted from the learner's early_attempts rows by report.ts;
// the screen-free ideas are static data (together.ts). Prints go through PrintView.

const STATUS: Record<SkillStatus, { label: string; pill: string; bar: string }> = {
  "mastered": { label: "Mastered", pill: "bg-success-tint text-success", bar: "var(--success)" },
  "learning": { label: "Learning", pill: "bg-[var(--phosphor-dim)] text-phosphor", bar: "var(--phosphor)" },
  "not-yet": { label: "Not yet", pill: "bg-[var(--panel-lite)] text-[var(--ink-faint)]", bar: "var(--rule-strong)" },
};

type Printing = { kind: "sheet"; id: string } | { kind: "record"; month: MonthRef } | null;

function PrintIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--phosphor)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="2" /><path d="M7 14h10v7H7z" />
    </svg>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-[18px] py-4 rounded-[18px] bg-panel border border-[var(--rule)] flex flex-col gap-1">
      <span className="text-[28px] font-semibold text-ink">{value}</span>
      <span className="text-sm text-[var(--ink-faint)]">{label}</span>
    </div>
  );
}

export default function GrownUps({ learnerName, grade, onBack, onSettings }: {
  learnerName: string;
  grade: Grade | null;
  onBack: () => void;
  onSettings: () => void;
}) {
  const [rows, setRows] = useState<AttemptRow[] | null>(null);
  const [printing, setPrinting] = useState<Printing>(null);
  const [now] = useState(() => new Date());
  const name = learnerName.trim() || "Your learner";
  const [month, setMonth] = useState<MonthRef>({ year: now.getFullYear(), month: now.getMonth() });

  useEffect(() => {
    const learnerId = getActiveLearnerId();
    let alive = true;
    getEarlyAttempts()
      .then((r) => { if (alive && getActiveLearnerId() === learnerId) setRows(r); })
      .catch((e) => { console.warn("[early] could not read attempts", e); if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);

  const all = useMemo(() => rows ?? [], [rows]);
  const week = useMemo(() => weekSummary(all, now), [all, now]);
  const confusions = useMemo(() => hardOnes(all, now), [all, now]);
  const reports = useMemo(() => skillReports(all, confusions), [all, confusions]);
  const ideas = useMemo(() => togetherIdeas(reports, confusions, name), [reports, confusions, name]);
  // This month always, then every month with taps, newest first.
  const months = useMemo(() => {
    const list = monthsWithAttempts(all);
    const current = { year: now.getFullYear(), month: now.getMonth() };
    return list.some((m) => m.year === current.year && m.month === current.month) ? list : [current, ...list];
  }, [all, now]);

  if (printing?.kind === "sheet") {
    const sheet = SHEETS.find((s) => s.id === printing.id)!;
    return (
      <PrintView
        title={sheet.title}
        hint="Letter paper. Print at 100% (actual size) so each one comes out 1.5 inches tall."
        pages={tracingPages(sheet)}
        onBack={() => setPrinting(null)}
      />
    );
  }
  if (printing?.kind === "record") {
    const record = monthlyRecord(all, printing.month);
    return (
      <PrintView
        title={`${name}'s learning record: ${record.label}`}
        hint={'To keep it as a file, choose "Save as PDF" as the printer.'}
        pages={[recordPage(record, name, gradeLabel(grade), now)]}
        onBack={() => setPrinting(null)}
      />
    );
  }

  const monthName = monthLabel(month.year, month.month).split(" ")[0];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col bg-bg">
      <header className="flex flex-wrap items-center gap-4 px-12 py-[18px] border-b border-[var(--rule)]">
        <span className="flex items-center gap-2.5 text-[19px] font-semibold text-phosphor"><BookIcon />OpenEdu</span>
        <span className="text-[15px] text-[var(--ink-faint)] grow">Grown-ups</span>
        <button type="button" className="btn" onClick={onSettings}>Settings</button>
        <button type="button" className="btn btn-primary" onClick={onBack}>Back to {name}'s games</button>
      </header>

      <main className="box-border w-full max-w-[1120px] mx-auto px-12 pt-9 pb-12 flex flex-wrap gap-9">
        <div className="min-w-0 flex flex-col gap-[26px]" style={{ flex: "999 1 560px" }}>
          <div className="flex flex-wrap items-center gap-4">
            <span
              aria-hidden="true"
              className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-semibold"
              style={{ background: "var(--early-avatar)", color: "var(--early-avatar-ink)" }}
            >
              {name.charAt(0).toUpperCase()}
            </span>
            <div className="flex flex-col gap-0.5">
              <h1 className="m-0 text-[32px] font-medium tracking-[-0.02em] text-ink">{name}'s week</h1>
              <span className="text-[15px] text-[var(--ink-faint)]">{gradeLabel(grade)} · the last 7 days</span>
            </div>
          </div>

          {rows === null ? (
            <p className="m-0 text-[15px] text-[var(--ink-dim)]">Loading...</p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
                  <Stat value={String(week.daysPlayed)} label={week.daysPlayed === 1 ? "day played" : "days played"} />
                  <Stat value={`About ${week.minutes} min`} label={`in ${week.sittings} ${week.sittings === 1 ? "sitting" : "sittings"}`} />
                  <Stat
                    value={week.mastered.length ? `${week.mastered.length} new` : "0"}
                    label={week.mastered.length ? `mastered: ${week.mastered.map(skillTitle).join(", ")}` : "skills mastered"}
                  />
                </div>
                <p className="m-0 text-sm text-[var(--ink-faint)] leading-normal">
                  Minutes are approximate: the time from the first to the last tap of each sitting. A sitting ends
                  after {SESSION_GAP_MS / 60_000} minutes with no taps.
                </p>
              </div>

              <section className="flex flex-col gap-3" aria-labelledby="gu-knows">
                <h2 id="gu-knows" className="m-0 text-[21px] font-medium text-ink">What {name} knows</h2>
                <div className="rounded-[20px] bg-panel border border-[var(--rule)] flex flex-col">
                  {reports.map((s, i) => (
                    <div key={s.id} className="px-5 py-3.5 flex flex-wrap items-center gap-3.5" style={{ borderTop: i ? "1px solid var(--rule)" : undefined }}>
                      <div className="min-w-0 flex flex-col gap-0.5" style={{ flex: "1 1 240px" }}>
                        <span className="text-[17px] font-medium text-ink">{s.title}</span>
                        <span className="text-sm text-[var(--ink-faint)]">{s.detail}</span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`${s.title} progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={s.pct}
                        className="w-40 h-2.5 rounded-full overflow-hidden bg-[var(--rule)]"
                      >
                        <div className="h-2.5 rounded-full" style={{ width: `${s.pct}%`, background: STATUS[s.status].bar }} />
                      </div>
                      <span className={`min-w-[104px] text-center px-3 py-[5px] rounded-full text-sm font-medium ${STATUS[s.status].pill}`}>
                        {STATUS[s.status].label}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="flex flex-col gap-2" aria-labelledby="gu-hard">
                <h2 id="gu-hard" className="m-0 text-[21px] font-medium text-ink">Hard ones</h2>
                {confusions.length ? (
                  <ul className="m-0 pl-5 list-disc flex flex-col gap-1 text-[15px] text-ink">
                    {confusions.map((c) => (
                      <li key={`${c.skillId}-${c.a}-${c.b}`}>
                        <b className="font-medium">{c.a} and {c.b}</b>
                        <span className="text-[var(--ink-dim)]"> ({skillTitle(c.skillId).toLowerCase()}): mixed up {c.times} times</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-[15px] text-[var(--ink-dim)]">Nothing {name} keeps mixing up right now.</p>
                )}
                <p className="m-0 text-sm text-[var(--ink-faint)] leading-normal">
                  A pair shows here once {name} picks one for the other on a first try {CONFUSION_MIN} or more times in the
                  last {CONFUSION_DAYS} days.
                </p>
              </section>
            </>
          )}
        </div>

        <aside className="min-w-0 flex flex-col gap-[22px]" style={{ flex: "1 1 300px" }}>
          <section className="flex flex-col gap-3" aria-labelledby="gu-together">
            <h2 id="gu-together" className="m-0 text-[21px] font-medium text-ink">Try together, no screen</h2>
            {ideas.length ? ideas.map(({ skillId, idea }) => (
              <div key={`${skillId}-${idea.title}`} className="px-[18px] py-4 rounded-[18px] bg-[var(--panel-tint)] flex flex-col gap-1.5">
                <span className="text-base font-medium text-ink">{idea.title}</span>
                <span className="text-sm text-[var(--ink-dim)] leading-normal">{idea.how}</span>
              </div>
            )) : (
              <p className="m-0 text-[15px] text-[var(--ink-dim)] leading-normal">
                Ideas show up here for the skills {name} is learning. Nothing is in progress yet.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="gu-print">
            <h2 id="gu-print" className="m-0 text-[21px] font-medium text-ink">Print for handwriting</h2>
            {SHEETS.map((s) => {
              const n = pageCount(s);
              return (
                <button
                  key={s.id}
                  type="button"
                  className="flex items-center gap-3 min-h-[52px] px-4 rounded-2xl bg-panel border border-[var(--rule)] text-ink text-[15px] text-left hover:border-[var(--phosphor)]"
                  onClick={() => setPrinting({ kind: "sheet", id: s.id })}
                >
                  <PrintIcon />
                  <span className="grow">{s.title}</span>
                  <span className="text-sm text-[var(--ink-faint)] whitespace-nowrap">{n} {n === 1 ? "page" : "pages"}</span>
                </button>
              );
            })}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="gu-records">
            <h2 id="gu-records" className="m-0 text-[21px] font-medium text-ink">Records</h2>
            {months.length > 1 && (
              <label className="flex flex-col gap-1 text-sm text-[var(--ink-dim)]">
                Month
                <select
                  className="cf-input"
                  value={`${month.year}-${month.month}`}
                  onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); setMonth({ year: y, month: m }); }}
                >
                  {months.map((m) => <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>{monthLabel(m.year, m.month)}</option>)}
                </select>
              </label>
            )}
            <button
              type="button"
              className="flex items-center justify-center gap-2.5 min-h-[52px] px-[18px] rounded-full border-[1.5px] border-[var(--phosphor)] text-phosphor text-[15px] font-medium bg-transparent hover:bg-[var(--panel-tint)]"
              onClick={() => setPrinting({ kind: "record", month })}
            >
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" />
              </svg>
              Save {monthName}'s learning record
            </button>
            <span className="text-sm text-[var(--ink-faint)] leading-normal">
              A page of skills, dates and time spent for your homeschool portfolio. Print it, or choose "Save as
              PDF" as the printer.
            </span>
          </section>
        </aside>
      </main>
    </div>
  );
}
