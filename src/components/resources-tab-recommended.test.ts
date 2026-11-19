// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import manifestJson from "../../public/library/index.json";
import { normalizeManifest } from "../lib/library-rank";
import type { Course, Syllabus } from "../types";

// The Resources tab rendered for real over the Library the app ships: only getManifest is a stand-in (it
// would fetch). The landing list is courseResources' cards, or the whole Library A to Z when there are
// none, and the caption says which (port of TerraTutor #249).

const manifest = normalizeManifest(manifestJson);
vi.mock("../lib/library", async (orig) => ({
  ...(await orig<typeof import("../lib/library")>()),
  getManifest: vi.fn(async () => manifest),
}));

import ResourcesTab from "./ResourcesTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const course = (topic: string): Course => ({
  id: "c1", title: topic, topic, current_level: 1, status: "active", generation_state: null,
  created_at: "2026-11-19", updated_at: "2026-11-19",
});
const syllabus = (subtopics: { title: string; key_concepts: string[] }[]): Syllabus => ({
  id: "s1", course_id: "c1", level: 1, title: "Level 1", description: "", learning_objectives: [],
  subtopics: subtopics.map((s, i) => ({ id: `t${i}`, practice_type: "quiz", mastered: false, ...s })),
  assessment_criteria: [], estimated_hours: 1, generated_at: "2026-11-19",
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function render(c: Course, s: Syllabus | null) {
  await act(async () => { root.render(createElement(ResourcesTab, { course: c, currentSyllabus: s })); });
  await act(async () => {});
  return host.textContent ?? "";
}

describe("ResourcesTab: the landing list for a course", () => {
  it("lists the whole Library A to Z, not 'recommended', for a course no card is about", async () => {
    const text = await render(course("fractions"), syllabus([
      { title: "What is a Fraction? Whole and Parts", key_concepts: ["Part: A piece of the whole object or amount."] },
      { title: "Defining Equal Parts", key_concepts: ["Whole vs. Part", "Equal Parts", "Numerator", "Denominator"] },
    ]));
    expect(text).toContain(`${manifest.length} resources`);
    expect(text).not.toContain("recommended for this course");
    expect(text).not.toContain("Parts of Speech");
  });

  it("shows the cards about the course under 'recommended for this course'", async () => {
    const text = await render(course("cells"), syllabus([
      { title: "What is a Cell? Defining Life and Non-Life", key_concepts: ["Definition of a cell", "The Cell Theory"] },
    ]));
    expect(text).toMatch(/\d+ recommended for this course/);
    expect(text).toContain("Animal vs Plant Cell");
  });
});
