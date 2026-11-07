import { useState, useEffect, useCallback } from "react";
import type { Course, View, LLMProvider, QuizViewContext } from "./types";
import { getCourses, deleteCourse, listLearners, setActiveLearnerId, getActiveLearnerId, touchLearner } from "./lib/db";
import { autoPickLearner, type LearnerRow } from "./lib/learners";
import { getLLMProvider, getTourSeen, setTourSeen } from "./lib/store";
import { probeEnvironment, type SetupStatus } from "./lib/setup-check";
import SetupGate from "./components/SetupGate";
import TourOverlay, { TOUR_STEPS } from "./components/TourOverlay";
import CRTLayer from "./components/CRTLayer";
import BootSequence from "./components/BootSequence";
import Titlebar from "./components/Titlebar";
import LearnerPicker from "./components/LearnerPicker";
import LearnerMenu from "./components/LearnerMenu";
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
  // Learner profiles. `learners === null` = not loaded yet. `activeLearner === null` = the picker is
  // up and no learner data is loaded. learners.ts autoPickLearner decides when the picker is skipped.
  const [learners, setLearners] = useState<LearnerRow[] | null>(null);
  const [activeLearner, setActiveLearner] = useState<LearnerRow | null>(null);
  const [learnerMenuOpen, setLearnerMenuOpen] = useState(false);

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
  const enterOrPick = async () => {
    const list = await reloadLearners();
    const auto = autoPickLearner(list);
    if (auto) await enterLearner(auto);
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
    void enterOrPick();
    refreshProvider();
    void recheckSetup();
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
              onGoSettings={activeLearner ? () => setCurrentView("settings") : undefined}
              learnerName={activeLearner?.name}
              onOpenLearner={activeLearner ? () => setLearnerMenuOpen(true) : undefined}
            />
          )}

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
                  onOpenSettings={() => setCurrentView("settings")}
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
              {currentView === "settings" && <Settings onSaved={refreshProvider} />}
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

          {tourStep !== null && activeLearner && !isFullscreenView && setup?.ready && (
            <TourOverlay step={tourStep} onNext={advanceTour} onSkip={skipTour} />
          )}
        </>
      )}
    </div>
  );
}
