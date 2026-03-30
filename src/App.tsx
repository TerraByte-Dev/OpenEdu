import { useState, useEffect } from "react";
import type { Course, View } from "./types";
import { getCourses, deleteCourse } from "./lib/db";
import Sidebar from "./components/Sidebar";
import Dashboard from "./views/Dashboard";
import CourseView from "./views/CourseView";
import Settings from "./views/Settings";

// Disable browser/OS default context menu app-wide
if (typeof document !== "undefined") {
  document.addEventListener("contextmenu", (e) => e.preventDefault(), { capture: true });
}

export default function App() {
  const [currentView, setCurrentView] = useState<View>("dashboard");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const refreshCourses = async () => {
    const c = await getCourses();
    setCourses(c);
  };

  useEffect(() => {
    refreshCourses();
  }, []);

  const openCourse = (courseId: string) => {
    setSelectedCourseId(courseId);
    setCurrentView("course");
  };

  const onCourseCreated = async (courseId: string) => {
    await refreshCourses(); // Re-fetch from DB so we get accurate data
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

  return (
    <div
      className="flex h-screen w-screen bg-surface-900"
      onContextMenu={(e) => e.preventDefault()}
    >
      <Sidebar
        courses={courses}
        selectedCourseId={selectedCourseId}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        onSelectCourse={openCourse}
        onDeleteCourse={handleDeleteCourse}
        onGoHome={() => setCurrentView("dashboard")}
        onGoSettings={() => setCurrentView("settings")}
      />
      <main className="flex-1 flex flex-col overflow-hidden min-h-0">
        {currentView === "dashboard" && (
          <Dashboard
            courses={courses}
            onOpenCourse={openCourse}
            onCourseCreated={onCourseCreated}
          />
        )}
        {currentView === "course" && selectedCourseId && (
          <CourseView
            courseId={selectedCourseId}
            onBack={() => setCurrentView("dashboard")}
          />
        )}
        {currentView === "settings" && <Settings />}
      </main>
    </div>
  );
}
