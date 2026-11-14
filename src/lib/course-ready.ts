// What the app does when a course build finishes (App.tsx onCourseCreated). A build runs for minutes
// and keeps running while the learner goes elsewhere. Opening the course from wherever they are pulled
// them out of it: in the click test of 2026-11-14 it closed Settings and the cloud notice open in it.
// So the course opens only when the learner is still on the build screen; anywhere else they get a
// notice with an Open button and stay where they are.

import type { View } from "../types";

/** True when a finished build opens its course: the learner is still watching the build. */
export function opensWhenBuilt(currentView: View): boolean {
  return currentView === "create";
}

/** The notice's sentence. */
export function readyNotice(title: string | undefined): string {
  const t = title?.trim();
  return t ? `Your course ${t} is ready.` : "Your course is ready.";
}
