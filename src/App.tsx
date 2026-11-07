import { useState, useEffect, useCallback } from "react";
import type { Course, View, LLMProvider, QuizViewContext } from "./types";
import {
  getCourses, deleteCourse, checkDatabaseHealth, listLearners, setActiveLearnerId, getActiveLearnerId, touchLearner,
  getUsageConfig, setUsageMode as saveUsageMode, listGroups, type UsageConfig,
} from "./lib/db";
import { DEFAULT_LEARNER_ID, type LearnerRow } from "./lib/learners";
import {
  autoPickFor, resolveStartupMode, hasPriorUse, needsTeacherPin, showsLearnerChip, isProtected,
  type UsageMode, type GroupRow, type TeacherAction,
} from "./lib/usage-modes";
import type { PinRecord } from "./lib/learner-pin";
import type { DbHealth } from "./lib/db-resilience";
import { getLLMProvider, getTourSeen, setTourSeen } from "./lib/store";
import { probeEnvironment, type SetupStatus } from "./lib/setup-check";
import SetupGate from "./components/SetupGate";
import DataDamagedBanner from "./components/DataDamagedBanner";
import TourOverlay, { TOUR_STEPS } from "./components/TourOverlay";
import CRTLayer from "./components/CRTLayer";
import BootSequence from "./components/BootSequence";
import Titlebar from "./components/Titlebar";
import LearnerPicker from "./components/LearnerPicker";
import LearnerMenu from "./components/LearnerMenu";
import TeacherView from "./components/TeacherView";
import { UsageModeChooser, TeacherPinPrompt } from "./components/UsageMode";
import Sidebar from "./components/Sidebar";
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
  const [teacher, setTeacher] = useState<UsageConfig["teacher"]>({ pin_hash: null, pin_salt: null });
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [teacherPrompt, setTeacherPrompt] = useState<(() => void) | null>(null);

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
  };

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
    let m = await applyUsageConfig();
    if (!m) {
      const list = await listLearners();
      const tourSeen = await getTourSeen(DEFAULT_LEARNER_ID).catch(() => false);
      m = resolveStartupMode(null, hasPriorUse(list, tourSeen));
      if (m) { await saveUsageMode(m); setMode(m); }
    }
    setModeLoaded(true);
    await enterOrPick(m);
  };

  // First run answered. A class or school lands in the teacher view (the PIN was just set), so the
  // teacher can add learners before anyone picks.
  const onModeChosen = async (m: UsageMode, rec: PinRecord | null) => {
    await saveUsageMode(m, rec);
    await applyUsageConfig();
    if (isProtected(m)) { await reloadLearners(); setTeacherOpen(true); }
    else await enterOrPick(m);
  };

  // From Settings. The section has already set or checked the teacher PIN (modeChangeStep).
  const changeMode = async (to: UsageMode, rec: PinRecord | null | undefined) => {
    await saveUsageMode(to, rec);
    await applyUsageConfig();
  };

  // Run `then` now, or after the teacher PIN when this mode guards `action`.
  const withTeacher = (action: TeacherAction, then: () => void) => {
    if (mode && needsTeacherPin(mode, action)) setTeacherPrompt(() => then);
    else then();
  };

  const openSettings = () => withTeacher("open-settings", () => setCurrentView("settings"));

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

  const openCourse = (courseId: string) => {
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
    setCurrentView("dashboard");
  };

  const isFullscreenView = currentView === "quiz" || currentView === "promotion-test";

  return (
    <div
      className="flex flex-col h-screen w-screen bg-bg overflow-hidden"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Always-visible CRT overlay */}
      <CRTLayer />

      {/* Boot sequence — unmounts after splash */}
      {!booted && <BootSequence onComplete={handleBootComplete} />}

      {/* Main UI */}
      {booted && (
        <>
          {!isFullscreenView && (
            <Titlebar
              provider={activeProvider}
              onGoSettings={activeLearner ? openSettings : undefined}
              learnerName={activeLearner && mode && learners && showsLearnerChip(mode, learners) ? activeLearner.name : undefined}
              onOpenLearner={activeLearner ? () => setLearnerMenuOpen(true) : undefined}
            />
          )}

          {modeLoaded && mode === null && <UsageModeChooser onChosen={onModeChosen} />}

          {!activeLearner && learners && mode && !teacherOpen && (
            <LearnerPicker
              learners={learners}
              mode={mode}
              groups={groups}
              onEnter={(l) => { void enterLearner(l); void reloadLearners(); }}
              onTeacher={() => withTeacher("teacher-view", () => setTeacherOpen(true))}
            />
          )}

          {teacherOpen && mode && learners && (
            <TeacherView
              mode={mode}
              learners={learners}
              groups={groups}
              busyReason={craftingTopic ? `Wait for "${craftingTopic}" to finish building before removing learners.` : null}
              onClose={() => setTeacherOpen(false)}
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
            {!isFullscreenView && currentView !== "course" && (
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
                  onHowToRestore={() => { setSettingsSection("learner-data"); setCurrentView("settings"); }}
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

              {craftingTopic && currentView !== "dashboard" && !isFullscreenView && (
                <button
                  onClick={() => setCurrentView("dashboard")}
                  className="flex items-center gap-2.5 px-4 py-2 border-b border-[var(--rule)] text-sm text-phosphor-ink hover:bg-[rgb(var(--phosphor-rgb)/0.06)] transition-colors shrink-0"
                  style={{ background: "rgb(var(--phosphor-rgb)/0.04)" }}
                >
                  <span className="w-2 h-2 rounded-full bg-phosphor animate-pulse shrink-0" />
                  <span>Building <strong>{craftingTopic}</strong> — click to watch</span>
                </button>
              )}

              {currentView === "dashboard" && setup && (!setup.ready || (!setup.complete && !setupDismissed)) && (
                <SetupGate
                  status={setup}
                  ollamaUrl={ollamaUrl}
                  onRecheck={() => { void recheckSetup(); }}
                  onOpenSettings={openSettings}
                  onDismiss={() => setSetupDismissed(true)}
                />
              )}

              <div className={`flex-1 min-h-0 flex flex-col ${
                currentView !== "dashboard" || (setup && (!setup.ready || (!setup.complete && !setupDismissed))) ? "hidden" : ""
              }`}>
                <Dashboard
                  courses={courses}
                  onOpenCourse={openCourse}
                  onCourseCreated={onCourseCreated}
                  onCreationStart={(topic) => setCraftingTopic(topic)}
                  onCreationEnd={() => setCraftingTopic(null)}
                  resumeCourse={pendingResumeCourse}
                  onResumeConsumed={() => setPendingResumeCourse(null)}
                />
              </div>

              {currentView === "course" && selectedCourseId && (
                <CourseView
                  courseId={selectedCourseId}
                  onBack={() => setCurrentView("dashboard")}
                  onOpenQuiz={openQuiz}
                  onOpenPromotionTest={openPromotionTest}
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
                    changeMode,
                    openTeacher: () => setTeacherOpen(true),
                    openLearnerMenu: () => setLearnerMenuOpen(true),
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

          {tourStep !== null && activeLearner && !isFullscreenView && !teacherOpen && setup?.ready && (
            <TourOverlay step={tourStep} onNext={advanceTour} onSkip={skipTour} />
          )}
        </>
      )}
    </div>
  );
}
