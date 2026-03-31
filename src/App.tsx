import { useState, useEffect } from "react";
import type { Course, View, LLMProvider, QuizViewContext } from "./types";
import { getCourses, deleteCourse } from "./lib/db";
import { getLLMProvider } from "./lib/store";
import Sidebar from "./components/Sidebar";
import Dashboard from "./views/Dashboard";
import CourseView from "./views/CourseView";
import Settings from "./views/Settings";
import QuizFullScreen from "./views/QuizFullScreen";
import PromotionTestFullScreen from "./views/PromotionTestFullScreen";

// Disable browser/OS default context menu app-wide
if (typeof document !== "undefined") {
  document.addEventListener("contextmenu", (e) => e.preventDefault(), { capture: true });
}

export default function App() {
  const [currentView, setCurrentView] = useState<View>("dashboard");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeProvider, setActiveProvider] = useState<LLMProvider>("ollama");
  // Track in-progress course creation so the banner persists when navigating away
  const [craftingTopic, setCraftingTopic] = useState<string | null>(null);
  const [quizContext, setQuizContext] = useState<QuizViewContext | null>(null);

  const refreshCourses = async () => {
    const c = await getCourses();
    setCourses(c);
  };

  const refreshProvider = async () => {
    const cfg = await getLLMProvider();
    setActiveProvider(cfg.provider);
  };

  useEffect(() => {
    refreshCourses();
    refreshProvider();
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

  const isFullscreenView = currentView === "quiz" || currentView === "promotion-test";

  return (
    <div
      className="flex h-screen w-screen bg-surface-900"
      onContextMenu={(e) => e.preventDefault()}
    >
      {!isFullscreenView && (
        <Sidebar
          courses={courses}
          selectedCourseId={selectedCourseId}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
          onSelectCourse={openCourse}
          onDeleteCourse={handleDeleteCourse}
          provider={activeProvider}
          onGoHome={() => { setCurrentView("dashboard"); refreshProvider(); }}
          onGoSettings={() => setCurrentView("settings")}
        />
      )}
      <main className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* Persistent "course crafting" banner — shown when building and you navigate away */}
        {craftingTopic && currentView !== "dashboard" && !isFullscreenView && (
          <button
            onClick={() => setCurrentView("dashboard")}
            className="flex items-center gap-2.5 px-4 py-2 bg-terra-700/30 border-b border-terra-600/30 text-sm text-terra-200 hover:bg-terra-700/50 transition-colors shrink-0"
          >
            <span className="w-2 h-2 rounded-full bg-terra-400 animate-pulse shrink-0" />
            <span>
              Building <strong>{craftingTopic}</strong> course in the background — click to watch
            </span>
          </button>
        )}

        {/* Dashboard always stays mounted so async creation survives navigation */}
        <div className={`flex-1 min-h-0 flex flex-col ${currentView !== "dashboard" ? "hidden" : ""}`}>
          <Dashboard
            courses={courses}
            onOpenCourse={openCourse}
            onCourseCreated={onCourseCreated}
            onCreationStart={(topic) => setCraftingTopic(topic)}
            onCreationEnd={() => setCraftingTopic(null)}
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
            onPassed={() => { refreshCourses(); closeQuiz(); }}
          />
        )}
      </main>
    </div>
  );
}
