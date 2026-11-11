import { useEffect, useMemo, useState } from "react";
import {
  createLearner, renameLearner, setLearnerPin, deleteLearner, setLearnerGroup, setLearnerGrade,
  createGroup, renameGroup, deleteGroup, getTeacherOverviewSource,
} from "../lib/db";
import { normalizeGrade, type Grade } from "../lib/grade";
import { GradeSelect } from "./GradeSelect";
import { clearLearnerStore } from "../lib/store";
import { validateLearnerName, canDeleteLearner, deleteConfirmMatches, LEARNER_NAME_MAX, type LearnerRow } from "../lib/learners";
import { usesGroups, validateGroupName, NO_GROUP, GROUP_NAME_MAX, type UsageMode, type GroupRow } from "../lib/usage-modes";
import { buildOverviewRows, filterOverviewRows, overviewCsv, type OverviewRow } from "../lib/teacher-overview";
import { saveCsvFile } from "../lib/export-file";

// The teacher's screen in a class or school, reached only through the teacher PIN (App owns the
// prompt). Overview of every learner x course with CSV export, learner management (add, rename,
// class, clear a forgotten PIN, remove) and, in a school, the classes themselves.

interface TeacherViewProps {
  mode: UsageMode;
  learners: LearnerRow[];
  groups: GroupRow[];
  /** Set while a course is building: removing learners waits, like in the learner menu. */
  busyReason: string | null;
  onClose: () => void;
  /** Learners or groups changed; App reloads both (and leaves a session whose learner was removed). */
  onChanged: () => Promise<void>;
}

type Tab = "overview" | "learners" | "groups";

const BTN: React.CSSProperties = { fontSize: "1rem", padding: "8px 16px" };
const SMALL: React.CSSProperties = { fontSize: "0.9rem", padding: "6px 12px" };
const INPUT: React.CSSProperties = { fontSize: "1.05rem" };

export default function TeacherView({ mode, learners, groups, busyReason, onClose, onChanged }: TeacherViewProps) {
  const [tab, setTab] = useState<Tab>("overview");
  const grouped = usesGroups(mode);
  const tabs: Array<[Tab, string]> = [["overview", "Overview"], ["learners", "Learners"], ...(grouped ? [["groups", "Classes"] as [Tab, string]] : [])];

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg">
      <div className="px-8 pt-6 pb-3 border-b border-[var(--rule)] shrink-0">
        <div className="max-w-5xl mx-auto w-full flex items-center gap-4 flex-wrap">
          <h1 className="text-2xl font-semibold text-ink" style={{ fontFamily: "var(--font-display)" }}>Teacher</h1>
          <div className="flex gap-2" role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "btn btn-primary" : "btn"} style={BTN} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <button className="btn ml-auto" style={BTN} onClick={onClose}>Done</button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
        <div className="max-w-5xl mx-auto w-full flex flex-col gap-4">
          {busyReason && <p className="text-base text-warning">{busyReason}</p>}
          {tab === "overview" && <Overview grouped={grouped} groups={groups} learners={learners} />}
          {tab === "learners" && <Learners grouped={grouped} learners={learners} groups={groups} busy={!!busyReason} onChanged={onChanged} />}
          {tab === "groups" && grouped && <Groups groups={groups} learners={learners} onChanged={onChanged} />}
        </div>
      </div>
    </div>
  );
}

function GroupSelect({ groups, value, onChange, withAll }: {
  groups: GroupRow[];
  value: string;
  onChange: (v: string) => void;
  withAll?: boolean;
}) {
  return (
    <select className="cf-input" style={{ ...INPUT, width: "auto" }} value={value} onChange={(e) => onChange(e.target.value)}>
      {withAll && <option value="all">All classes</option>}
      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      <option value={NO_GROUP}>No class</option>
    </select>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function Overview({ grouped, groups, learners }: { grouped: boolean; groups: GroupRow[]; learners: LearnerRow[] }) {
  const [rows, setRows] = useState<OverviewRow[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [note, setNote] = useState<string | null>(null);

  // Reload when the learner or group list changes (a rename shows up straight away).
  useEffect(() => {
    let live = true;
    getTeacherOverviewSource()
      .then((src) => { if (live) setRows(buildOverviewRows(src)); })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [learners, groups]);

  const shown = useMemo(() => (rows ? filterOverviewRows(rows, grouped ? filter : "all") : []), [rows, filter, grouped]);

  const exportCsv = async () => {
    setNote(null);
    const stamp = new Date().toISOString().slice(0, 10);
    const groupName = grouped && filter !== "all" ? `-${groups.find((g) => g.id === filter)?.name ?? "no-class"}` : "";
    try {
      const path = await saveCsvFile(`openedu-overview${groupName}-${stamp}.csv`, overviewCsv(shown, grouped));
      if (path) setNote(`Saved to ${path}`);
    } catch (e) {
      setNote(`Could not save the file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        {grouped && <GroupSelect groups={groups} value={filter} onChange={setFilter} withAll />}
        <button className="btn btn-primary ml-auto" style={BTN} disabled={!rows || shown.length === 0} onClick={() => void exportCsv()}>
          Save as spreadsheet (CSV)
        </button>
      </div>
      {note && <p className="text-base text-[var(--ink-dim)] break-all">{note}</p>}
      {rows === null ? (
        <p className="text-base text-[var(--ink-dim)]">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-base text-[var(--ink-dim)]">Nobody here yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--rule)]">
          <table className="w-full text-left text-base">
            <thead className="bg-panel text-[var(--ink-dim)]">
              <tr>
                {grouped && <th className="px-3 py-2 font-normal">Class</th>}
                <th className="px-3 py-2 font-normal">Learner</th>
                <th className="px-3 py-2 font-normal">Course</th>
                <th className="px-3 py-2 font-normal">Level</th>
                <th className="px-3 py-2 font-normal">Mastered</th>
                <th className="px-3 py-2 font-normal">Last active</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={`${r.learnerId}-${i}`} className="border-t border-[var(--rule)] text-ink">
                  {grouped && <td className="px-3 py-2">{r.groupName || "—"}</td>}
                  <td className="px-3 py-2">{r.learnerName}</td>
                  <td className="px-3 py-2">{r.courseTitle ?? <span className="text-[var(--ink-dim)]">No courses yet</span>}</td>
                  <td className="px-3 py-2">{r.level ?? "—"}</td>
                  <td className="px-3 py-2">{r.courseTitle ? `${r.mastered} of ${r.subtopics}` : "—"}</td>
                  <td className="px-3 py-2">{r.lastActive ? r.lastActive.slice(0, 10) : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── Learners ──────────────────────────────────────────────────────────────────

function Learners({ grouped, learners, groups, busy, onChanged }: {
  grouped: boolean;
  learners: LearnerRow[];
  groups: GroupRow[];
  busy: boolean;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState(NO_GROUP);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const err = validateLearnerName(name, learners);
    if (err) { setError(err); return; }
    try {
      await createLearner(name, grouped && groupId !== NO_GROUP ? groupId : null, grade);
      setName("");
      await onChanged();
    } catch {
      setError("Could not add that learner. Try again.");
    }
  };

  return (
    <>
      <form className="flex items-end gap-3 flex-wrap" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
          <span className="text-base text-ink">Add a learner</span>
          <input className="cf-input" style={INPUT} maxLength={LEARNER_NAME_MAX} value={name} placeholder="Name"
            onChange={(e) => { setName(e.target.value); setError(null); }} />
        </label>
        {grouped && <GroupSelect groups={groups} value={groupId} onChange={setGroupId} />}
        <GradeSelect value={grade} onChange={setGrade} style={INPUT} ariaLabel="Grade" />
        <button type="submit" className="btn btn-primary" style={BTN}>Add</button>
      </form>
      {error && <p className="text-base text-danger">{error}</p>}
      <div className="flex flex-col divide-y divide-[var(--rule)] border border-[var(--rule)] rounded-lg">
        {learners.map((l) => (
          <LearnerRowItem key={l.id} learner={l} learners={learners} groups={groups} grouped={grouped} busy={busy} onChanged={onChanged} />
        ))}
      </div>
    </>
  );
}

function LearnerRowItem({ learner, learners, groups, grouped, busy, onChanged }: {
  learner: LearnerRow;
  learners: LearnerRow[];
  groups: GroupRow[];
  grouped: boolean;
  busy: boolean;
  onChanged: () => Promise<void>;
}) {
  const [mode, setMode] = useState<null | "rename" | "remove">(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const known = groups.some((g) => g.id === learner.group_id);

  const run = async (fn: () => Promise<void>, fail: string) => {
    try { await fn(); setMode(null); setError(null); await onChanged(); }
    catch { setError(fail); }
  };

  const rename = () => {
    const err = validateLearnerName(text, learners, learner.id);
    if (err) { setError(err); return; }
    void run(() => renameLearner(learner.id, text), "Could not save the name.");
  };

  const remove = () => {
    if (!deleteConfirmMatches(text, learner.name)) { setError(`Type ${learner.name} to confirm.`); return; }
    void run(async () => {
      await deleteLearner(learner.id);
      await clearLearnerStore(learner.id).catch(() => { /* a leftover tour flag is harmless */ });
    }, "Could not remove everything. Try again.");
  };

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-lg text-ink flex-1 min-w-[140px] break-words">{learner.name}</span>
        {grouped && (
          <GroupSelect groups={groups} value={known ? learner.group_id! : NO_GROUP}
            onChange={(v) => void run(() => setLearnerGroup(learner.id, v === NO_GROUP ? null : v), "Could not move this learner.")} />
        )}
        <GradeSelect value={normalizeGrade(learner.grade)} style={INPUT} ariaLabel={`${learner.name}'s grade`}
          onChange={(g) => void run(() => setLearnerGrade(learner.id, g), "Could not save the grade.")} />
        <button className="btn" style={SMALL} onClick={() => { setMode("rename"); setText(learner.name); setError(null); }}>Rename</button>
        {learner.pin_hash && (
          <button className="btn" style={SMALL} title="For a learner who forgot their PIN. They can set a new one."
            onClick={() => void run(() => setLearnerPin(learner.id, null, null), "Could not clear the PIN.")}>
            Clear PIN
          </button>
        )}
        <button className="btn" style={SMALL} disabled={busy || !canDeleteLearner(learners)}
          title={canDeleteLearner(learners) ? undefined : "The last learner cannot be removed."}
          onClick={() => { setMode("remove"); setText(""); setError(null); }}>
          Remove
        </button>
      </div>
      {mode && (
        <form className="flex items-end gap-3 flex-wrap" onSubmit={(e) => { e.preventDefault(); if (mode === "rename") rename(); else remove(); }}>
          <label className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
            <span className="text-base text-ink">
              {mode === "rename" ? "New name" : `Removing deletes all of ${learner.name}'s courses, chats, notes and quizzes. Type ${learner.name} to confirm.`}
            </span>
            <input autoFocus className="cf-input" style={INPUT} maxLength={LEARNER_NAME_MAX} value={text}
              onChange={(e) => { setText(e.target.value); setError(null); }} />
          </label>
          <button type="button" className="btn" style={SMALL} onClick={() => { setMode(null); setError(null); }}>Back</button>
          <button type="submit" className="btn" style={mode === "remove" ? { ...SMALL, borderColor: "var(--danger)", color: "var(--danger)" } : SMALL}>
            {mode === "rename" ? "Save" : "Remove forever"}
          </button>
        </form>
      )}
      {error && <p className="text-base text-danger">{error}</p>}
    </div>
  );
}

// ── Classes (school mode) ─────────────────────────────────────────────────────

function Groups({ groups, learners, onChanged }: { groups: GroupRow[]; learners: LearnerRow[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const add = async () => {
    const err = validateGroupName(name, groups);
    if (err) { setError(err); return; }
    try { await createGroup(name); setName(""); await onChanged(); }
    catch { setError("Could not add that class. Try again."); }
  };

  const rename = async (id: string) => {
    const err = validateGroupName(draft, groups, id);
    if (err) { setError(err); return; }
    try { await renameGroup(id, draft); setEditing(null); setError(null); await onChanged(); }
    catch { setError("Could not save the name."); }
  };

  const remove = async (g: GroupRow) => {
    try { await deleteGroup(g.id); setError(null); await onChanged(); }
    catch { setError("Could not remove that class."); }
  };

  return (
    <>
      <form className="flex items-end gap-3 flex-wrap" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
          <span className="text-base text-ink">Add a class</span>
          <input className="cf-input" style={INPUT} maxLength={GROUP_NAME_MAX} value={name} placeholder="For example: Grade 5"
            onChange={(e) => { setName(e.target.value); setError(null); }} />
        </label>
        <button type="submit" className="btn btn-primary" style={BTN}>Add</button>
      </form>
      <p className="text-base text-[var(--ink-dim)]">
        Learners pick their class first, then their name. Removing a class keeps its learners and their work; they move to "No class".
      </p>
      {error && <p className="text-base text-danger">{error}</p>}
      {groups.length > 0 && (
        <div className="flex flex-col divide-y divide-[var(--rule)] border border-[var(--rule)] rounded-lg">
          {groups.map((g) => {
            const n = learners.filter((l) => l.group_id === g.id).length;
            return (
              <div key={g.id} className="flex items-center gap-3 flex-wrap px-4 py-3">
                {editing === g.id ? (
                  <form className="flex items-center gap-3 flex-1 flex-wrap" onSubmit={(e) => { e.preventDefault(); void rename(g.id); }}>
                    <input autoFocus className="cf-input flex-1 min-w-[160px]" style={INPUT} maxLength={GROUP_NAME_MAX} value={draft}
                      onChange={(e) => { setDraft(e.target.value); setError(null); }} />
                    <button type="button" className="btn" style={SMALL} onClick={() => setEditing(null)}>Back</button>
                    <button type="submit" className="btn btn-primary" style={SMALL}>Save</button>
                  </form>
                ) : (
                  <>
                    <span className="text-lg text-ink flex-1 min-w-[140px] break-words">{g.name}</span>
                    <span className="text-base text-[var(--ink-dim)]">{n} {n === 1 ? "learner" : "learners"}</span>
                    <button className="btn" style={SMALL} onClick={() => { setEditing(g.id); setDraft(g.name); setError(null); }}>Rename</button>
                    <button className="btn" style={SMALL} onClick={() => void remove(g)}>Remove class</button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
