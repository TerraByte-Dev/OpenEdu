import { useState, useEffect, useCallback, useRef } from "react";
import type { Course, View, LLMProvider, QuizViewContext } from "./types";
import {
  getCourses, deleteCourse, checkDatabaseHealth, listLearners, setActiveLearnerId, getActiveLearnerId, touchLearner,
  getUsageConfig, setUsageMode as saveUsageMode, listGroups, setLearnerGrade, recordActiveMinute, getRecordSource, type UsageConfig,
} from "./lib/db";
import { DEFAULT_LEARNER_ID, type LearnerRow } from "./lib/learners";
import { normalizeGrade, hasEarlyScreens, earlyScreensOn } from "./lib/grade";
import {
  autoPickFor, resolveStartupMode, hasPriorUse, runGuarded, staysUnlocked, viewAfterTeacherDone, showsLearnerChip,
  isProtected, saveThenRefresh, type UsageMode, type GroupRow, type TeacherEntry,
} from "./lib/usage-modes";
import type { PinRecord } from "./lib/learner-pin";
import type { DbHealth } from "./lib/db-resilience";
import {
  getLLMProvider, getTourSeen, setTourSeen, getDailyGoal, setDailyGoal, getActiveMinutes, setActiveMinutes, getEarlyScreens,
  setEarlyScreens,
} from "./lib/store";
import { minutesToday, tickActiveMinutes, localDayKey, type ActiveMinutes } from "./lib/daily-goal";
import { isActiveMinute, ACTIVITY_EVENTS } from "./lib/record/active-minute";
import type { NextStepAction } from "./lib/next-step";
import { probeEnvironment, type SetupStatus } from "./lib/setup-check";
import SetupGate from "./components/SetupGate";
import DataDamagedBanner from "./components/DataDamagedBanner";
import TourOverlay, { TOUR_STEPS } from "./components/TourOverlay";
import BootSequence from "./components/BootSequence";
import Titlebar from "./components/Titlebar";
import LearnerPicker from "./components/LearnerPicker";
import LearnerMenu from "./components/LearnerMenu";
import TeacherView from "./components/TeacherView";
import { UsageModeChooser, TeacherPinPrompt } from "./components/UsageMode";
import StartupFailed from "./components/StartupFailed";
import Sidebar from "./components/Sidebar";
import Home from "./views/Home";
import EarlyLearner from "./views/early/EarlyLearner";
import GrownUps from "./views/early/GrownUps";
import Record from "./views/record/Record";
import Dashboard from "./views/Dashboard";
import CourseView from "./views/CourseView";
import Settings from "./views/settings/Settings";
import QuizFullScreen from "./views/QuizFullScreen";
import PromotionTestFullScreen from "./views/PromotionTestFullScreen";

// Disable browser/OS default context menu app-wide
if (typeof document !== "undefined") {
  document.addEventListener("contextmenu", (e) => e.preventDefault(), { capture: true });
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const [currentView, setCurrentView] = useState<View>("dashboard");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  // Where the course view lands when opened from Home's Continue button (next-step.ts). Consumed by
  // CourseView's initial state; cleared on every other way into a course.
  const [courseInitialAction, setCourseInitialAction] = useState<NextStepAction | undefined>(undefined);
  // Learner Home: the daily goal (null = not chosen yet) and today's active minutes, both per learner
  // in the plugin store. Minutes tick once a minute while a learner's session is on screen.
  const [dailyGoal, setDailyGoalState] = useState<number | null>(null);
  const [activeMinutes, setActiveMinutesState] = useState<ActiveMinutes | null>(null);
  // A K-1 learner's "Early learner screens" choice (grade.ts earlyScreensOn), per learner in the plugin
  // store. undefined = not read yet, null = never chosen (on).
  const [earlyChoice, setEarlyChoice] = useState<boolean | null | undefined>(undefined);
  const [courses, setCourses] = useState<Course[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeProvider, setActiveProvider] = useState<LLMProvider>("ollama");
  const [craftingTopic, setCraftingTopic] = useState<string | null>(null);
  const [quizContext, setQuizContext] = useState<QuizViewContext | null>(null);
  const [promotionBanner, setPromotionBanner] = useState<number | null>(null);
  // Course whose generation needs to resume — Dashboard consumes this once on mount.
  const [pendingResumeCourse, setPendingResumeCourse] = useState<Course | null>(null);
  // First-run (#92). `null` = not probed yet; the gate renders only when something BLOCKS use, so a
  // working install never sees it. `setupDismissed` covers the ready-but-incomplete case, where the
  // user has been told the embedder is missing and chosen to carry on.
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [tourStep, setTourStep] = useState<number | null>(null);
  // Boot-time integrity check (power cuts are routine where OpenEdu runs). Only "damaged" shows a warning.
  const [dbHealth, setDbHealth] = useState<DbHealth | null>(null);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);
  // Learner profiles. `learners === null` = not loaded yet. `activeLearner === null` = the picker is
  // up and no learner data is loaded. learners.ts autoPickLearner decides when the picker is skipped.
  const [learners, setLearners] = useState<LearnerRow[] | null>(null);
  const [activeLearner, setActiveLearner] = useState<LearnerRow | null>(null);
  const [learnerMenuOpen, setLearnerMenuOpen] = useState(false);
  // Usage mode (usage-modes.ts). `modeLoaded && mode === null` = a fresh install that has not been
  // asked "Who uses this computer?" yet. `teacherPrompt` holds what to do once the teacher PIN is
  // typed; `teacherOpen` shows the teacher view over the picker or the (still mounted) session.
  const [mode, setMode] = useState<UsageMode | null>(null);
  const [modeLoaded, setModeLoaded] = useState(false);
  // The mode or the learner list could not be read at launch (a damaged file, #171). Without this the
  // app would sit blank with no picker and no way to the restore steps.
  const [startupFailed, setStartupFailed] = useState(false);
  const [teacher, setTeacher] = useState<UsageConfig["teacher"]>({ pin_hash: null, pin_salt: null });
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [teacherPrompt, setTeacherPrompt] = useState<(() => void) | null>(null);
  // True once the teacher PIN is typed (or a new one set), and only while Settings or the teacher view
  // stays on screen: leaving either re-locks (staysUnlocked), so the next learner never inherits it.
  const [teacherUnlocked, setTeacherUnlocked] = useState(false);
  const [teacherFrom, setTeacherFrom] = useState<"settings" | "picker">("picker");

  const refreshCourses = async () => {
    const learnerId = getActiveLearnerId();
    const c = await getCourses();
    // A switch can land while this was in flight; never show one learner's list to the next.
    if (getActiveLearnerId() === learnerId) setCourses(c);
  };

  const reloadLearners = async (): Promise<LearnerRow[]> => {
    const list = await listLearners();
    setLearners(list);
    return list;
  };

  // Everything below is per-session state that must not survive a learner switch. The main area is
  // also keyed by learner id, so every view under it remounts with empty state.
  const resetSession = () => {
    setLearnerMenuOpen(false);
    setCurrentView("dashboard");
    setSelectedCourseId(null);
    setCourseInitialAction(undefined);
    setDailyGoalState(null);
    setActiveMinutesState(null);
    setEarlyChoice(undefined);
    setQuizContext(null);
    setPendingResumeCourse(null);
    setPromotionBanner(null);
    setTourStep(null);
    setCourses([]);
  };

  const enterLearner = async (learner: LearnerRow) => {
    resetSession();
    setActiveLearnerId(learner.id);
    setActiveLearner(learner);
    void touchLearner(learner.id);
    await refreshCourses();
    void getTourSeen(learner.id).then((seen) => {
      if (!seen && getActiveLearnerId() === learner.id) setTourStep(0);
    });
    void Promise.all([getDailyGoal(learner.id), getActiveMinutes(learner.id)]).then(([goal, mins]) => {
      if (getActiveLearnerId() !== learner.id) return;
      setDailyGoalState(goal);
      setActiveMinutesState(mins);
    }).catch(() => { /* the store is a convenience here; Home renders without it */ });
    void getEarlyScreens(learner.id)
      .catch(() => null) // unreadable = never chosen = the default
      .then((on) => { if (getActiveLearnerId() === learner.id) setEarlyChoice(on); });
  };

  const chooseDailyGoal = (minutes: number) => {
    if (!activeLearner) return;
    setDailyGoalState(minutes);
    void setDailyGoal(activeLearner.id, minutes).catch(() => { /* keep the in-memory choice */ });
  };

  // One active minute per minute the window is visible with a learner in. Read-modify-write through
  // the store so a second window or a restart never loses the count; the UI shows the result.
  useEffect(() => {
    if (!activeLearner) return;
    const learnerId = activeLearner.id;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible" || getActiveLearnerId() !== learnerId) return;
      void getActiveMinutes(learnerId).then(async (rec) => {
        const next = tickActiveMinutes(rec, new Date());
        await setActiveMinutes(learnerId, next);
        if (getActiveLearnerId() === learnerId) setActiveMinutesState(next);
      }).catch(() => { /* a failed tick costs one minute of credit, nothing else */ });
    }, 60_000);
    return () => clearInterval(id);
  }, [activeLearner]);

  // Counted minutes for the learning record (#258), kept apart from the daily goal above, which is
  // unchanged. A minute counts only with recent input on a learning screen (record/active-minute.ts).
  // The view and teacher flag are read through refs so the timer is not restarted on every navigation.
  const lastInputRef = useRef<number | null>(null);
  const viewRef = useRef<View>(currentView);
  const teacherOpenRef = useRef(teacherOpen);
  useEffect(() => { viewRef.current = currentView; }, [currentView]);
  useEffect(() => { teacherOpenRef.current = teacherOpen; }, [teacherOpen]);
  useEffect(() => {
    const mark = () => { lastInputRef.current = Date.now(); };
    // Capture phase: scroll does not bubble, and a handler that stops propagation must not hide input.
    const opts = { capture: true, passive: true } as const;
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, mark, opts);
    return () => { for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, mark, opts); };
  }, []);
  useEffect(() => {
    if (!activeLearner) return;
    const learnerId = activeLearner.id;
    const id = setInterval(() => {
      if (getActiveLearnerId() !== learnerId) return;
      const now = Date.now();
      const active = isActiveMinute({
        visible: document.visibilityState === "visible",
        lastInputMs: lastInputRef.current,
        nowMs: now,
        view: viewRef.current,
        teacherOpen: teacherOpenRef.current,
      });
      if (active) void recordActiveMinute(learnerId, localDayKey(new Date(now))).catch(() => { /* one minute lost */ });
    }, 60_000);
    return () => clearInterval(id);
  }, [activeLearner]);

  const leaveLearner = () => {
    setActiveLearnerId(null);
    setActiveLearner(null);
    resetSession();
  };

  // After a delete (or anything that may leave one learner with no PIN), apply the launch rule again.
  const enterOrPick = async (m: UsageMode | null = mode) => {
    const list = await reloadLearners();
    const auto = m ? autoPickFor(m, list) : null;
    if (auto) await enterLearner(auto);
  };

  const applyUsageConfig = async (): Promise<UsageMode | null> => {
    const cfg = await getUsageConfig();
    setTeacher(cfg.teacher);
    setMode(cfg.mode);
    setGroups(await listGroups());
    return cfg.mode;
  };

  // Launch: read the mode; an install already in use becomes "Just me" silently (resolveStartupMode),
  // a fresh one is asked. Then the usual picker-or-straight-in rule, now per mode.
  const startUp = async () => {
    setStartupFailed(false);
    try {
      let m = await applyUsageConfig();
      if (!m) {
        const list = await listLearners();
        const tourSeen = await getTourSeen(DEFAULT_LEARNER_ID).catch(() => false);
        m = resolveStartupMode(null, hasPriorUse(list, tourSeen));
        if (m) { await saveUsageMode(m); setMode(m); }
      }
      setModeLoaded(true);
      await enterOrPick(m);
    } catch (e) {
      console.error("startup failed", e);
      setStartupFailed(true);
    }
  };

  // The mode (and teacher PIN) just saved, shown at once. A re-read that fails after this is not a
  // failed save (saveThenRefresh), so the screen must not wait for it.
  const showSavedMode = (to: UsageMode, rec: PinRecord | null | undefined) => {
    setMode(to);
    if (rec !== undefined) setTeacher(rec ?? { pin_hash: null, pin_salt: null });
  };

  // First run answered. A class or school lands in the teacher view (the PIN was just set), so the
  // teacher can add learners before anyone picks.
  const onModeChosen = async (m: UsageMode, rec: PinRecord | null) => {
    await saveThenRefresh(async () => { await saveUsageMode(m, rec); showSavedMode(m, rec); }, applyUsageConfig);
    if (isProtected(m)) { await reloadLearners(); setTeacherUnlocked(true); openTeacherView("picker"); }
    else await enterOrPick(m);
  };

  // From Settings. The section has already set or checked the teacher PIN (modeChangeStep), so the
  // teacher is in; that keeps Settings open after moving up from Just me. Throws only if the save fails.
  const changeMode = async (to: UsageMode, rec: PinRecord | null | undefined) => {
    await saveThenRefresh(async () => {
      await saveUsageMode(to, rec);
      showSavedMode(to, rec);
      if (isProtected(to)) setTeacherUnlocked(true);
    }, applyUsageConfig);
  };

  // Every teacher-only entry point comes through here under its own name (usage-modes.ts guardEntry):
  // run `then` now and return its result (a backup's promise), or run it after the teacher PIN.
  const guarded = <T,>(entry: TeacherEntry, then: () => T): T | undefined =>
    mode ? runGuarded(mode, entry, teacherUnlocked, then, (afterPin) =>
      setTeacherPrompt(() => () => { setTeacherUnlocked(true); afterPin(); })) : undefined;

  const openSettings = (entry: TeacherEntry, section?: string) =>
    guarded(entry, () => { setSettingsSection(section); setCurrentView("settings"); });

  const openTeacherView = (from: "settings" | "picker") => { setTeacherFrom(from); setTeacherOpen(true); };

  const closeTeacherView = () => {
    setTeacherOpen(false);
    const next = viewAfterTeacherDone(teacherFrom);
    if (next) setCurrentView(next);
  };

  // Leaving Settings or the teacher view locks the teacher out again.
  useEffect(() => {
    if (!staysUnlocked(currentView, teacherOpen)) setTeacherUnlocked(false);
  }, [currentView, teacherOpen]);

  // The teacher added, renamed, moved or removed someone. If the learner whose session is open was
  // removed, leave it (db.ts already cleared the active learner).
  const onTeacherChanged = async () => {
    const list = await reloadLearners();
    setGroups(await listGroups());
    if (activeLearner) {
      const me = list.find((l) => l.id === activeLearner.id);
      if (me) setActiveLearner(me);
      else leaveLearner();
    }
  };

  const refreshProvider = async () => {
    const cfg = await getLLMProvider();
    setActiveProvider(cfg.provider);
    setOllamaUrl(cfg.ollamaUrl);
  };

  // Probe on launch and after any settings change — a user who fixes the provider should not have to
  // restart to be believed.
  const recheckSetup = async () => {
    try { setSetup(await probeEnvironment()); }
    catch { setSetup(null); } // a failed probe must never gate the app; that would be the old lie inverted
  };

  useEffect(() => {
    void startUp();
    refreshProvider();
    void recheckSetup();
    void checkDatabaseHealth().then(setDbHealth);
  }, []);

  const advanceTour = () => {
    setTourStep((s) => {
      const next = (s ?? 0) + 1;
      if (next >= TOUR_STEPS.length) { if (activeLearner) void setTourSeen(activeLearner.id, true); return null; }
      return next;
    });
  };
  const skipTour = () => { if (activeLearner) void setTourSeen(activeLearner.id, true); setTourStep(null); };

  const handleBootComplete = useCallback(() => {
    setBooted(true);
  }, []);

  const openCourse = (courseId: string, initialAction?: NextStepAction) => {
    setCourseInitialAction(initialAction);
    setSelectedCourseId(courseId);
    setCurrentView("course");
  };

  const openQuiz = (ctx: QuizViewContext) => {
    setQuizContext(ctx);
    setCurrentView("quiz");
  };

  const openPromotionTest = (ctx: QuizViewContext) => {
    setQuizContext(ctx);
    setCurrentView("promotion-test");
  };

  const closeQuiz = () => {
    setQuizContext(null);
    setCurrentView("course");
  };

  const handlePromotionPassed = (nextLevel: number | null) => {
    refreshCourses();
    closeQuiz();
    // null = course completed (the capstone already celebrated) — skip the level-up banner.
    if (nextLevel !== null) {
      setPromotionBanner(nextLevel);
      setTimeout(() => setPromotionBanner(null), 6000);
    }
  };

  const onCourseCreated = async (courseId: string) => {
    await refreshCourses();
    openCourse(courseId);
  };

  const handleDeleteCourse = async (courseId: string) => {
    await deleteCourse(courseId);
    await refreshCourses();
    if (selectedCourseId === courseId) {
      setSelectedCourseId(null);
      setCurrentView("dashboard");
    }
  };

  const handleResumeCourse = (courseId: string) => {
    const course = courses.find((c) => c.id === courseId);
    if (!course) return;
    setPendingResumeCourse(course);
    setCurrentView("create");
  };

  const isFullscreenView = currentView === "quiz" || currentView === "promotion-test";
  // K-1 learners open on the early-learner screens instead of Home (#244). Nothing changes for any
  // other grade or no grade. Until a K-1 learner's choice is read, the main area waits rather than
  // flashing the wrong home.
  const activeGrade = normalizeGrade(activeLearner?.grade);
  const earlyPending = currentView === "dashboard" && hasEarlyScreens(activeGrade) && earlyChoice === undefined;
  const earlyHome = currentView === "dashboard" && earlyChoice !== undefined && earlyScreensOn(activeGrade, earlyChoice);
  const childScreen = earlyHome || earlyPending;
  // The grown-ups view of an early learner's progress (#244), behind the press-and-hold.
  const grownUpsView = currentView === "grownups" && activeLearner !== null;
  // The learner's own learning record (#258). Never guarded: it is not a teacher action.
  const recordView = currentView === "record" && activeLearner !== null;
  // A learner on the early-learner screens never gets the product tour: it explains Home and courses,
  // which they do not use, and it would land over Settings or the grown-ups view (#249). It waits, not
  // marked seen, in case the family switches back to the regular Home.
  const onEarlyScreens = hasEarlyScreens(activeGrade) && (earlyChoice === undefined || earlyScreensOn(activeGrade, earlyChoice));

  return (
    <div
      className="flex flex-col h-screen w-screen bg-bg overflow-hidden"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Boot sequence — unmounts after splash */}
      {!booted && <BootSequence onComplete={handleBootComplete} />}

      {/* Main UI */}
      {booted && (
        <>
          {!isFullscreenView && (
            <Titlebar
              provider={activeProvider}
              onGoSettings={activeLearner && !childScreen ? () => openSettings("gear") : undefined}
              learnerName={activeLearner && mode && learners && showsLearnerChip(mode, learners) ? activeLearner.name : undefined}
              onOpenLearner={activeLearner ? () => setLearnerMenuOpen(true) : undefined}
            />
          )}

          {startupFailed && <StartupFailed onRetry={() => { void startUp(); }} />}

          {modeLoaded && mode === null && <UsageModeChooser onChosen={onModeChosen} />}

          {!activeLearner && learners && mode && !teacherOpen && (
            <LearnerPicker
              learners={learners}
              mode={mode}
              groups={groups}
              onEnter={(l) => { void enterLearner(l); void reloadLearners(); }}
              onTeacher={() => guarded("picker-teacher-tile", () => openTeacherView("picker"))}
            />
          )}

          {teacherOpen && mode && learners && (
            <TeacherView
              mode={mode}
              learners={learners}
              groups={groups}
              busyReason={craftingTopic ? `Wait for "${craftingTopic}" to finish building before removing learners.` : null}
              onClose={closeTeacherView}
              onChanged={onTeacherChanged}
            />
          )}

          {/* Hidden, not unmounted, under the teacher view: a course build in progress keeps running. */}
          {activeLearner && (
          <div key={activeLearner.id} className={`flex flex-1 min-h-0 ${teacherOpen ? "hidden" : ""}`}>
            {/* The course list owns the left column everywhere EXCEPT inside a course, where it is
                the one list you do not need — you are already in the thing it selects. In course
                view CourseView takes the column for its own navigation (tabs, threads, notes), and
                the way back to the list is the header's back arrow. */}
            {!isFullscreenView && currentView !== "course" && !childScreen && !grownUpsView && !recordView && (
              <Sidebar
                courses={courses}
                selectedCourseId={selectedCourseId}
                collapsed={sidebarCollapsed}
                onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
                onSelectCourse={openCourse}
                onDeleteCourse={handleDeleteCourse}
                onResumeCourse={handleResumeCourse}
                onGoHome={() => { setCurrentView("dashboard"); refreshProvider(); }}
              />
            )}

            <main className="flex-1 flex flex-col overflow-hidden min-h-0">
              {dbHealth?.status === "damaged" && (
                <DataDamagedBanner
                  onHowToRestore={() => openSettings("damaged-banner-restore", "learner-data")}
                  onDismiss={() => setDbHealth(null)}
                />
              )}

              {promotionBanner !== null && (
                <div className="flex items-center justify-between px-4 py-2 border-b text-sm text-phosphor-ink shrink-0" style={{ background: "rgb(var(--phosphor-rgb)/0.10)", borderColor: "rgb(var(--phosphor-rgb)/0.30)" }}>
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-phosphor animate-pulse shrink-0" />
                    <span>Level up! Advanced to <strong>Level {promotionBanner}</strong> — keep going.</span>
                  </span>
                  <button onClick={() => setPromotionBanner(null)} className="text-phosphor-bright hover:text-phosphor text-lg leading-none">✕</button>
                </div>
              )}

              {craftingTopic && currentView !== "create" && !isFullscreenView && (
                <button
                  onClick={() => setCurrentView("create")}
                  className="flex items-center gap-2.5 px-4 py-2 border-b border-[var(--rule)] text-sm text-phosphor-ink hover:bg-[rgb(var(--phosphor-rgb)/0.06)] transition-colors shrink-0"
                  style={{ background: "rgb(var(--phosphor-rgb)/0.04)" }}
                >
                  <span className="w-2 h-2 rounded-full bg-phosphor animate-pulse shrink-0" />
                  <span>Building <strong>{craftingTopic}</strong> — click to watch</span>
                </button>
              )}

              {/* The early-learner screens need no model, so the setup gate never stands in front of them. */}
              {earlyHome && (
                <EarlyLearner
                  learnerName={activeLearner.name}
                  onGrownUps={() => guarded("early-grownups", () => setCurrentView("grownups"))}
                />
              )}

              {grownUpsView && (
                <GrownUps
                  learnerName={activeLearner.name}
                  grade={activeGrade}
                  onBack={() => setCurrentView("dashboard")}
                  onSettings={() => openSettings("grownups-settings", "usage")}
                />
              )}

              {recordView && (
                <Record
                  learnerId={activeLearner.id}
                  load={getRecordSource}
                  audience="own"
                  onBack={() => setCurrentView("dashboard")}
                />
              )}

              {currentView === "dashboard" && !childScreen && setup && (!setup.ready || (!setup.complete && !setupDismissed)) && (
                <SetupGate
                  status={setup}
                  ollamaUrl={ollamaUrl}
                  onRecheck={() => { void recheckSetup(); }}
                  onOpenSettings={() => openSettings("setup-gate-settings")}
                  onDismiss={() => setSetupDismissed(true)}
                />
              )}

              {currentView === "dashboard" && !childScreen && !(setup && (!setup.ready || (!setup.complete && !setupDismissed))) && (
                <Home
                  learnerId={activeLearner.id}
                  learnerName={activeLearner.name}
                  courses={courses}
                  dailyGoal={dailyGoal}
                  onChooseGoal={chooseDailyGoal}
                  minutesToday={minutesToday(activeMinutes, new Date())}
                  onContinue={openCourse}
                  onOpenCourse={openCourse}
                  onResumeCourse={handleResumeCourse}
                  onStartNew={() => setCurrentView("create")}
                  onOpenRecord={() => setCurrentView("record")}
                />
              )}

              {/* The new-course flow stays mounted (hidden) off its view so a build in progress keeps running. */}
              <div className={`flex-1 min-h-0 flex flex-col ${currentView !== "create" ? "hidden" : ""}`}>
                <Dashboard
                  onCancel={() => setCurrentView("dashboard")}
                  onCourseCreated={onCourseCreated}
                  onCreationStart={(topic) => setCraftingTopic(topic)}
                  onCreationEnd={() => setCraftingTopic(null)}
                  resumeCourse={pendingResumeCourse}
                  onResumeConsumed={() => setPendingResumeCourse(null)}
                />
              </div>

              {currentView === "course" && selectedCourseId && (
                <CourseView
                  key={selectedCourseId}
                  courseId={selectedCourseId}
                  initialAction={courseInitialAction}
                  onBack={() => setCurrentView("dashboard")}
                  onOpenQuiz={openQuiz}
                  onOpenPromotionTest={openPromotionTest}
                  learnerId={activeLearner.id}
                  grade={normalizeGrade(activeLearner.grade)}
                />
              )}
              {currentView === "settings" && (
                <Settings
                  key={settingsSection ?? "default"}
                  initialSectionId={settingsSection}
                  onSaved={refreshProvider}
                  usage={mode ? {
                    mode,
                    teacher,
                    learners: learners ?? [],
                    activeLearnerId: activeLearner?.id ?? null,
                    activeGrade,
                    setActiveGrade: async (grade) => {
                      if (!activeLearner) return;
                      await setLearnerGrade(activeLearner.id, grade);
                      const list = await reloadLearners();
                      const me = list.find((l) => l.id === activeLearner.id);
                      if (me) setActiveLearner(me);
                    },
                    earlyScreens: earlyChoice ?? null,
                    setEarlyScreens: async (on) => {
                      if (!activeLearner) return;
                      await setEarlyScreens(activeLearner.id, on);
                      setEarlyChoice(on);
                    },
                    changeMode,
                    openTeacher: () => openTeacherView("settings"),
                    openLearnerMenu: () => setLearnerMenuOpen(true),
                    guard: guarded,
                  } : undefined}
                />
              )}
              {currentView === "quiz" && quizContext && (
                <QuizFullScreen context={quizContext} onClose={closeQuiz} />
              )}
              {currentView === "promotion-test" && quizContext && (
                <PromotionTestFullScreen
                  context={quizContext}
                  onClose={closeQuiz}
                  onPassed={handlePromotionPassed}
                />
              )}
            </main>
          </div>
          )}

          {learnerMenuOpen && activeLearner && learners && (
            <LearnerMenu
              learner={activeLearner}
              learners={learners}
              mode={mode ?? "single"}
              busyReason={craftingTopic ? `Wait for "${craftingTopic}" to finish building before switching, adding or deleting learners.` : null}
              onClose={() => setLearnerMenuOpen(false)}
              // K-1 learners on the early screens have the grown-ups view instead (#244), unchanged.
              onOpenRecord={onEarlyScreens ? undefined : () => { setLearnerMenuOpen(false); setCurrentView("record"); }}
              onSwitch={() => { leaveLearner(); void reloadLearners(); }}
              onAdded={(l) => { void reloadLearners(); void enterLearner(l); }}
              onChanged={async () => {
                const list = await reloadLearners();
                const me = list.find((l) => l.id === activeLearner.id);
                if (me) setActiveLearner(me);
              }}
              onDeleted={() => { leaveLearner(); void enterOrPick(); }}
            />
          )}

          {teacherPrompt && (
            <TeacherPinPrompt
              record={teacher}
              onCancel={() => setTeacherPrompt(null)}
              onOk={() => { const then = teacherPrompt; setTeacherPrompt(null); then(); }}
            />
          )}

          {tourStep !== null && activeLearner && !isFullscreenView && !teacherOpen && !childScreen && !onEarlyScreens && setup?.ready && (
            <TourOverlay step={tourStep} onNext={advanceTour} onSkip={skipTour} />
          )}
        </>
      )}
    </div>
  );
}
