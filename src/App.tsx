import { useState, useEffect, useCallback } from "react";
import type { Course, View, LLMProvider, QuizViewContext } from "./types";
import {
  getCourses, deleteCourse, checkDatabaseHealth, listLearners, setActiveLearnerId, getActiveLearnerId, touchLearner,
  setLearnerGrade, renameLearner, getLegacyUsageMode,
} from "./lib/db";
import { autoPickLearner, needsPicker, type LearnerRow } from "./lib/learners";
import { normalizeGrade } from "./lib/grade";
import type { DbHealth } from "./lib/db-resilience";
import {
  getLLMProvider, getTourSeen, setTourSeen, getDailyGoal, setDailyGoal, getActiveMinutes, setActiveMinutes,
} from "./lib/store";
import { minutesToday, tickActiveMinutes, type ActiveMinutes } from "./lib/daily-goal";
import type { NextStepAction } from "./lib/next-step";
import { probeEnvironment, type SetupStatus } from "./lib/setup-check";
import SetupGate from "./components/SetupGate";
import DataDamagedBanner from "./components/DataDamagedBanner";
import TourOverlay, { TOUR_STEPS } from "./components/TourOverlay";
import BootSequence from "./components/BootSequence";
import Titlebar from "./components/Titlebar";
import LearnerPicker from "./components/LearnerPicker";
import LearnerMenu from "./components/LearnerMenu";
import StartupFailed from "./components/StartupFailed";
import Sidebar from "./components/Sidebar";
import Home from "./views/Home";
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
  // Learners. `learners === null` = not loaded yet. `activeLearner === null` = the picker is up and no
  // learner data is loaded. learners.ts autoPickLearner skips the picker only for one learner with no PIN
  // (every new install); several learners or a PIN always get it.
  const [learners, setLearners] = useState<LearnerRow[] | null>(null);
  const [activeLearner, setActiveLearner] = useState<LearnerRow | null>(null);
  const [learnerMenuOpen, setLearnerMenuOpen] = useState(false);
  // The usage mode an earlier version stored, read only: a former class or school limits each learner's
  // own menu (learners.ts learnerMenuActions). OpenEdu never writes it.
  const [legacyUsageMode, setLegacyUsageMode] = useState<string | null>(null);
  // The learner list could not be read at launch (a damaged file, #171). Without this the app would sit
  // blank with no picker and no way to the restore steps.
  const [startupFailed, setStartupFailed] = useState(false);

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

  const leaveLearner = () => {
    setActiveLearnerId(null);
    setActiveLearner(null);
    resetSession();
  };

  // Launch, and after a delete (which may leave one learner with no PIN): one learner with no PIN is
  // entered straight away; otherwise the picker lists everyone and asks each PIN.
  const enterOrPick = async () => {
    const list = await reloadLearners();
    const auto = autoPickLearner(list);
    if (auto) await enterLearner(auto);
  };

  const startUp = async () => {
    setStartupFailed(false);
    try {
      setLegacyUsageMode(await getLegacyUsageMode());
      await enterOrPick();
    } catch (e) {
      console.error("startup failed", e);
      setStartupFailed(true);
    }
  };

  const openSettings = (section?: string) => { setSettingsSection(section); setCurrentView("settings"); };

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
              ollama={setup?.ollama}
              onGoSettings={activeLearner ? () => openSettings() : undefined}
              learnerName={activeLearner && learners && needsPicker(learners) ? activeLearner.name : undefined}
              onOpenLearner={activeLearner ? () => setLearnerMenuOpen(true) : undefined}
            />
          )}

          {startupFailed && <StartupFailed onRetry={() => { void startUp(); }} />}

          {!activeLearner && learners && (
            <LearnerPicker learners={learners} onEnter={(l) => { void enterLearner(l); void reloadLearners(); }} />
          )}

          {activeLearner && (
          <div key={activeLearner.id} className="flex flex-1 min-h-0">
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
                  onHowToRestore={() => openSettings("learner-data")}
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

              {currentView === "dashboard" && setup && (!setup.ready || (!setup.complete && !setupDismissed)) && (
                <SetupGate
                  status={setup}
                  ollamaUrl={ollamaUrl}
                  onRecheck={() => { void recheckSetup(); }}
                  onOpenSettings={() => openSettings()}
                  onDismiss={() => setSetupDismissed(true)}
                />
              )}

              {currentView === "dashboard" && !(setup && (!setup.ready || (!setup.complete && !setupDismissed))) && (
                <Home
                  learnerName={activeLearner.name}
                  courses={courses}
                  dailyGoal={dailyGoal}
                  onChooseGoal={chooseDailyGoal}
                  minutesToday={minutesToday(activeMinutes, new Date())}
                  onContinue={openCourse}
                  onOpenCourse={openCourse}
                  onResumeCourse={handleResumeCourse}
                  onStartNew={() => setCurrentView("create")}
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
                  onSaved={() => { void refreshProvider(); void recheckSetup(); }}
                  learner={{
                    id: activeLearner.id,
                    name: activeLearner.name,
                    learners: learners ?? [],
                    grade: normalizeGrade(activeLearner.grade),
                    setGrade: async (grade) => {
                      await setLearnerGrade(activeLearner.id, grade);
                      const list = await reloadLearners();
                      const me = list.find((l) => l.id === activeLearner.id);
                      if (me) setActiveLearner(me);
                    },
                    rename: async (name) => {
                      await renameLearner(activeLearner.id, name);
                      const list = await reloadLearners();
                      const me = list.find((l) => l.id === activeLearner.id);
                      if (me) setActiveLearner(me);
                    },
                  }}
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
              legacyUsageMode={legacyUsageMode}
              busyReason={craftingTopic ? `Wait for "${craftingTopic}" to finish building before switching or deleting learners.` : null}
              onClose={() => setLearnerMenuOpen(false)}
              onSwitch={() => { leaveLearner(); void reloadLearners(); }}
              onChanged={async () => {
                const list = await reloadLearners();
                const me = list.find((l) => l.id === activeLearner.id);
                if (me) setActiveLearner(me);
              }}
              onDeleted={() => { leaveLearner(); void enterOrPick(); }}
            />
          )}

          {tourStep !== null && activeLearner && !isFullscreenView && setup?.ready && (
            <TourOverlay step={tourStep} onNext={advanceTour} onSkip={skipTour} />
          )}
        </>
      )}
    </div>
  );
}
