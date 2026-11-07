import { describe, it, expect } from "vitest";
import {
  USAGE_MODES, parseUsageMode, resolveStartupMode, hasPriorUse, isProtected, needsTeacherPin,
  modeChangeStep, showsPicker, autoPickFor, showsLearnerChip, learnersManageLearners,
  pickerGroups, pickerAsksGroup, learnersInGroup, validateGroupName, NO_GROUP,
  TEACHER_ACTIONS, TEACHER_ENTRIES, ENTRY_ACTION, guardEntry, runGuarded, staysUnlocked, viewAfterTeacherDone,
  submitTeacherPin, saveThenRefresh,
  type TeacherAction, type TeacherEntry, type UsageMode,
} from "./usage-modes";
import { verifyPin } from "./learner-pin";

const one = [{ id: "default", pin_hash: null }];
const oneWithPin = [{ id: "default", pin_hash: "x" }];
const two = [{ id: "a", pin_hash: null }, { id: "b", pin_hash: null }];
const MODES: UsageMode[] = ["single", "class", "school"];

describe("the three modes", () => {
  it("offers exactly Just me, A class, A school or center, each with one sentence", () => {
    expect(USAGE_MODES.map((m) => m.title)).toEqual(["Just me", "A class", "A school or center"]);
    for (const m of USAGE_MODES) expect(m.sentence).toMatch(/^[^.]+\.$/);
  });

  it("parses only known modes", () => {
    for (const m of MODES) expect(parseUsageMode(m)).toBe(m);
    expect(parseUsageMode("teacher")).toBeNull();
    expect(parseUsageMode(null)).toBeNull();
    expect(parseUsageMode(undefined)).toBeNull();
  });
});

describe("startup", () => {
  it("a stored mode always wins", () => {
    expect(resolveStartupMode("class", false)).toBe("class");
    expect(resolveStartupMode("school", true)).toBe("school");
  });

  it("an install already in use starts as Just me without asking", () => {
    expect(resolveStartupMode(null, true)).toBe("single");
    expect(resolveStartupMode("garbage", true)).toBe("single");
  });

  it("only a fresh install is asked", () => {
    expect(resolveStartupMode(null, false)).toBeNull();
  });

  it("prior use = a finished tour, a second learner, or any PIN", () => {
    expect(hasPriorUse(one, false)).toBe(false);
    expect(hasPriorUse(one, true)).toBe(true);
    expect(hasPriorUse(two, false)).toBe(true);
    expect(hasPriorUse(oneWithPin, false)).toBe(true);
  });
});

describe("the teacher PIN", () => {
  // Only the actions App actually asks needsTeacherPin about (through ENTRY_ACTION). Adding, removing
  // and resetting learners and managing groups happen inside the teacher view, which is itself behind
  // "teacher-view"; the mode change has its own rule (modeChangeStep).
  it("lists exactly the actions the app checks", () => {
    expect([...TEACHER_ACTIONS].sort()).toEqual(["backup-all-data", "open-settings", "teacher-view"]);
    expect(new Set(Object.values(ENTRY_ACTION))).toEqual(new Set(TEACHER_ACTIONS));
  });

  it("guards nothing in Just me", () => {
    expect(isProtected("single")).toBe(false);
    expect(needsTeacherPin("single", "open-settings")).toBe(false);
    expect(needsTeacherPin("single", "teacher-view")).toBe(false);
    expect(needsTeacherPin("single", "backup-all-data")).toBe(false);
  });

  it("guards Settings, the teacher view and the all-learner backup in a class and in a school", () => {
    for (const m of ["class", "school"] as const) {
      expect(isProtected(m)).toBe(true);
      expect(needsTeacherPin(m, "open-settings")).toBe(true);
      expect(needsTeacherPin(m, "teacher-view")).toBe(true);
      expect(needsTeacherPin(m, "backup-all-data")).toBe(true);
    }
  });

  it("guards an action only when it is in the mode's list, not because the mode is protected", () => {
    // Not a TeacherAction: a learner's own action. Must not be guarded just because the mode is.
    expect(needsTeacherPin("class", "rename-self" as TeacherAction)).toBe(false);
    expect(needsTeacherPin("school", "rename-self" as TeacherAction)).toBe(false);
  });
});

describe("every way into a teacher-only screen goes through one guard", () => {
  // The App entry points. Each one calls guardEntry with its own name; none opens the screen itself.
  const EXPECTED: Record<TeacherEntry, TeacherAction> = {
    "gear": "open-settings",
    "setup-gate-settings": "open-settings",
    "damaged-banner-restore": "open-settings",
    "picker-teacher-tile": "teacher-view",
    "settings-teacher-view": "teacher-view",
    "learner-data-backup": "backup-all-data",
  };

  it("knows every entry point and what each one opens", () => {
    expect([...TEACHER_ENTRIES].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const e of TEACHER_ENTRIES) expect(ENTRY_ACTION[e]).toBe(EXPECTED[e]);
  });

  for (const e of Object.keys(EXPECTED) as TeacherEntry[]) {
    it(`${e}: goes straight in for Just me`, () => {
      expect(guardEntry("single", e, false)).toBe("go");
    });
    it(`${e}: asks the teacher PIN in a class and in a school`, () => {
      expect(guardEntry("class", e, false)).toBe("ask-teacher-pin");
      expect(guardEntry("school", e, false)).toBe("ask-teacher-pin");
    });
    it(`${e}: does not ask again while the teacher is already in`, () => {
      expect(guardEntry("class", e, true)).toBe("go");
      expect(guardEntry("school", e, true)).toBe("go");
    });
  }
});

describe("running a guarded entry (App's guarded)", () => {
  it("goes straight in and hands back what the action returns, so a busy button waits for it", async () => {
    let asked = false;
    let done = false;
    const out = runGuarded("single", "learner-data-backup", false, async () => { done = true; }, () => { asked = true; });
    expect(out).toBeInstanceOf(Promise);
    await out;
    expect(done).toBe(true);
    expect(asked).toBe(false);
    expect(runGuarded("class", "learner-data-backup", true, () => 7, () => { asked = true; })).toBe(7);
    expect(asked).toBe(false);
  });

  it("when locked, asks for the PIN first and runs the action only after it", () => {
    let ran = 0;
    let afterPin: (() => void) | null = null;
    const out = runGuarded("school", "gear", false, () => { ran++; }, (after) => { afterPin = after; });
    expect(out).toBeUndefined();
    expect(ran).toBe(0);
    afterPin!();
    expect(ran).toBe(1);
  });
});

describe("the teacher is locked out again on leaving", () => {
  it("stays in only while Settings or the teacher view is on screen", () => {
    expect(staysUnlocked("settings", false)).toBe(true);
    expect(staysUnlocked("dashboard", true)).toBe(true);
    expect(staysUnlocked("settings", true)).toBe(true);
    for (const v of ["dashboard", "course", "quiz", "promotion-test"]) expect(staysUnlocked(v, false)).toBe(false);
  });

  it("Done in a teacher view opened from Settings goes to the dashboard, not back to an open Settings", () => {
    expect(viewAfterTeacherDone("settings")).toBe("dashboard");
    expect(viewAfterTeacherDone("picker")).toBeNull();
  });
});

describe("saving a new teacher PIN", () => {
  const recorder = () => {
    const calls: boolean[] = [];
    return { calls, setBusy: (b: boolean) => { calls.push(b); } };
  };

  it("checks the two entries before doing anything", async () => {
    const r = recorder();
    expect(await submitTeacherPin("12", "12", async () => {}, r.setBusy)).toMatch(/4 to 6/);
    expect(await submitTeacherPin("1234", "1235", async () => {}, r.setBusy)).toMatch(/different/);
    expect(r.calls).toEqual([]);
  });

  it("hands over a real PIN record and is no longer busy", async () => {
    const r = recorder();
    let saved: { pin_hash: string; pin_salt: string } | null = null;
    expect(await submitTeacherPin("2468", "2468", async (rec) => { saved = rec; }, r.setBusy)).toBeNull();
    expect(await verifyPin("2468", saved!)).toBe(true);
    expect(r.calls).toEqual([true, false]);
  });

  it("a failed save says so and the button works again", async () => {
    const r = recorder();
    const err = await submitTeacherPin("2468", "2468", async () => { throw new Error("db locked"); }, r.setBusy);
    expect(err).toMatch(/Could not save/);
    expect(r.calls).toEqual([true, false]);
  });

  it("a refresh that fails after a good save is not reported as a failed save", async () => {
    const r = recorder();
    let saved = false;
    const err = await submitTeacherPin("2468", "2468", () => saveThenRefresh(
      async () => { saved = true; },
      async () => { throw new Error("database disk image is malformed"); },
    ), r.setBusy);
    expect(saved).toBe(true);
    expect(err).toBeNull();
  });

  it("a failed save still fails, and nothing is refreshed", async () => {
    let refreshed = false;
    await expect(saveThenRefresh(async () => { throw new Error("db locked"); }, async () => { refreshed = true; }))
      .rejects.toThrow("db locked");
    expect(refreshed).toBe(false);
  });
});

describe("changing mode", () => {
  const solo = [{ id: "a", name: "Amina", pin_hash: null }];
  const amina = { id: "a", name: "Amina", pin_hash: null };
  const bilalPin = { id: "b", name: "Bilal", pin_hash: "x" };
  const aminaPin = { id: "a", name: "Amina", pin_hash: "y" };

  it("moving up from Just me sets a new teacher PIN", () => {
    expect(modeChangeStep("single", "class", solo, "a", false)).toEqual({ step: "set-teacher-pin" });
    expect(modeChangeStep("single", "school", solo, "a", false)).toEqual({ step: "set-teacher-pin" });
    expect(modeChangeStep("single", "class", [amina, { id: "b", name: "Bilal", pin_hash: null }], "a", false)).toEqual({ step: "set-teacher-pin" });
  });

  it("with no teacher PIN kept, moving up is refused while another learner has a PIN, so nobody can take over someone else's PIN", () => {
    for (const to of ["class", "school"] as const) {
      expect(modeChangeStep("single", to, [amina, bilalPin], "a", false)).toEqual({
        step: "refused",
        reason: "Bilal has a PIN; they must remove it first, or sign in as them.",
      });
    }
  });

  it("the learner signed in may have their own PIN; it is theirs to hand to the teacher", () => {
    expect(modeChangeStep("single", "class", [aminaPin, { id: "b", name: "Bilal", pin_hash: null }], "a", false)).toEqual({ step: "set-teacher-pin" });
  });

  it("with nobody signed in, any PIN refuses the move up", () => {
    expect(modeChangeStep("single", "class", [aminaPin], null, false).step).toBe("refused");
  });

  it("leaving a protected mode always needs the teacher PIN, so only the teacher can lower protection", () => {
    const all = [amina, bilalPin];
    expect(modeChangeStep("class", "single", all, "a", true)).toEqual({ step: "verify-teacher-pin" });
    expect(modeChangeStep("school", "single", all, "a", true)).toEqual({ step: "verify-teacher-pin" });
    expect(modeChangeStep("school", "class", all, "a", true)).toEqual({ step: "verify-teacher-pin" });
    expect(modeChangeStep("class", "school", all, "a", true)).toEqual({ step: "verify-teacher-pin" });
  });

  it("no change asks for nothing", () => {
    for (const m of MODES) expect(modeChangeStep(m, m, [amina, bilalPin], "a", true)).toEqual({ step: "none" });
  });

  it("a school that went to Just me can come back with its kept teacher PIN, whoever has a PIN", () => {
    // Lowering keeps the teacher PIN. Coming back asks for that same PIN instead of refusing, so a
    // learner who forgot their PIN cannot lock the school out of going back up.
    for (const to of ["class", "school"] as const) {
      expect(modeChangeStep("single", to, [amina, bilalPin], "a", true)).toEqual({ step: "verify-teacher-pin" });
      expect(modeChangeStep("single", to, [aminaPin, bilalPin], null, true)).toEqual({ step: "verify-teacher-pin" });
    }
  });

  it("with a kept teacher PIN and no one else's PIN at stake, a new teacher PIN may still be set", () => {
    expect(modeChangeStep("single", "class", [amina, { id: "b", name: "Bilal", pin_hash: null }], "a", true)).toEqual({ step: "set-teacher-pin" });
  });
});

describe("picker and learner chip", () => {
  it("Just me keeps #173's rule: one learner with no PIN opens straight in", () => {
    expect(showsPicker("single", one)).toBe(false);
    expect(autoPickFor("single", one)).toBe(one[0]);
    expect(showsLearnerChip("single", one)).toBe(false);
  });

  it("Just me still shows the picker when there is someone to pick or a PIN", () => {
    expect(showsPicker("single", two)).toBe(true);
    expect(showsPicker("single", oneWithPin)).toBe(true);
    expect(autoPickFor("single", two)).toBeNull();
  });

  it("a class or school always asks who is learning, even with one learner", () => {
    for (const m of ["class", "school"] as const) {
      expect(showsPicker(m, one)).toBe(true);
      expect(autoPickFor(m, one)).toBeNull();
      expect(showsLearnerChip(m, one)).toBe(true);
    }
  });

  it("learners add and delete learners only in Just me", () => {
    expect(learnersManageLearners("single")).toBe(true);
    expect(learnersManageLearners("class")).toBe(false);
    expect(learnersManageLearners("school")).toBe(false);
  });
});

describe("groups in the picker", () => {
  const groups = [{ id: "g1", name: "Grade 5" }, { id: "g2", name: "Grade 6" }, { id: "g3", name: "Empty" }];
  const learners = [
    { id: "a", group_id: "g1" },
    { id: "b", group_id: "g1" },
    { id: "c", group_id: "g2" },
    { id: "d", group_id: null },
    { id: "e", group_id: "deleted-group" },
  ];

  it("shows groups with learners, skips empty ones, and puts the rest under Everyone else", () => {
    expect(pickerGroups(groups, learners)).toEqual([
      { id: "g1", name: "Grade 5", count: 2 },
      { id: "g2", name: "Grade 6", count: 1 },
      { id: NO_GROUP, name: "Everyone else", count: 2 },
    ]);
  });

  it("with no groups at all, everyone is one bucket and the group step is skipped", () => {
    const buckets = pickerGroups([], learners);
    expect(buckets).toEqual([{ id: NO_GROUP, name: "Everyone", count: 5 }]);
    expect(pickerAsksGroup("school", buckets)).toBe(false);
  });

  it("asks for the group only in school mode with more than one bucket", () => {
    const buckets = pickerGroups(groups, learners);
    expect(pickerAsksGroup("school", buckets)).toBe(true);
    expect(pickerAsksGroup("class", buckets)).toBe(false);
    expect(pickerAsksGroup("single", buckets)).toBe(false);
  });

  it("filters learners by bucket; a deleted group's learners count as in no group", () => {
    expect(learnersInGroup(learners, "g1", groups).map((l) => l.id)).toEqual(["a", "b"]);
    expect(learnersInGroup(learners, NO_GROUP, groups).map((l) => l.id)).toEqual(["d", "e"]);
    expect(learnersInGroup(learners, "g3", groups)).toEqual([]);
  });

  it("validates group names like learner names", () => {
    expect(validateGroupName("  ", groups)).toMatch(/name/);
    expect(validateGroupName("x".repeat(41), groups)).toMatch(/under/);
    expect(validateGroupName("grade 5", groups)).toMatch(/already/);
    expect(validateGroupName("Grade 5", groups, "g1")).toBeNull();
    expect(validateGroupName("Grade 7", groups)).toBeNull();
  });
});

// Static checks on the real UI source: guardEntry and runGuarded are only evidence if App and the
// Settings sections actually send every way into a teacher-only screen through them. A new raw
// setCurrentView("settings") or setTeacherOpen(true) anywhere would bypass the guard and fail here.
describe("the app sends every teacher entry through the guard", () => {
  const sources = import.meta.glob("../**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  const app = sources["../App.tsx"];
  const occurrences = (needle: string) =>
    Object.entries(sources).flatMap(([file, src]) =>
      src.split("\n").filter((line) => line.includes(needle)).map((line) => `${file}: ${line.trim()}`));

  it("reads the UI source", () => {
    expect(app).toContain("export default function App");
    expect(Object.keys(sources).length).toBeGreaterThan(10);
  });

  it("only openSettings opens Settings, and it is guarded", () => {
    expect(occurrences('setCurrentView("settings")')).toEqual([
      '../App.tsx: guarded(entry, () => { setSettingsSection(section); setCurrentView("settings"); });',
    ]);
    expect(app).toMatch(/const openSettings = \(entry: TeacherEntry, section\?: string\) =>\s*\n\s*guarded\(entry,/);
  });

  it("only openTeacherView opens the teacher view, and every call is guarded or follows a new PIN", () => {
    expect(occurrences("setTeacherOpen(true)")).toEqual([
      '../App.tsx: const openTeacherView = (from: "settings" | "picker") => { setTeacherFrom(from); setTeacherOpen(true); };',
    ]);
    const calls = occurrences("openTeacherView(").filter((l) => !l.includes("const openTeacherView ="));
    expect(calls).toEqual([
      // First run: the teacher PIN was set on this very screen.
      '../App.tsx: if (isProtected(m)) { await reloadLearners(); setTeacherUnlocked(true); openTeacherView("picker"); }',
      '../App.tsx: onTeacher={() => guarded("picker-teacher-tile", () => openTeacherView("picker"))}',
      // Handed to Settings as usage.openTeacher, which is only ever run through usage.guard.
      '../App.tsx: openTeacher: () => openTeacherView("settings"),',
    ]);
    expect(occurrences("usage.openTeacher")).toEqual([
      '../views/settings/sections/UsageMode.tsx: <button className="btn btn-primary" onClick={() => usage.guard("settings-teacher-view", usage.openTeacher)}>Open the teacher view</button>',
    ]);
  });

  it("every entry point is wired under its own name", () => {
    const all = Object.values(sources).join("\n");
    for (const e of TEACHER_ENTRIES) {
      const wired = ["openSettings", "guarded", "usage.guard"].some((fn) => all.includes(`${fn}("${e}"`));
      expect(wired, e).toBe(true);
    }
  });

  it("App's guard is runGuarded, and leaving Settings or the teacher view locks again", () => {
    expect(app).toMatch(/const guarded = [^\n]*\n[^\n]*runGuarded\(mode, entry, teacherUnlocked,/);
    expect(app).toContain("if (!staysUnlocked(currentView, teacherOpen)) setTeacherUnlocked(false);");
  });
});
