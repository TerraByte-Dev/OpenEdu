// Plain-language copy for learner-facing surfaces. The pipeline and the tool layer speak in ids
// ("syllabus_L3", "notebook.search") because code needs stable names; a learner never should see
// them. Everything here is a pure map from an id to a sentence a parent or a kid can read. Pure
// module (no DOM, no Tauri) so the UI stays a thin shell and the copy is unit-tested.

// courses.generation_state → what is still being built. `null` and "completed" mean nothing is
// pending; callers already branch on that, so they get a neutral sentence here.
export function describeGenerationState(state: string | null | undefined): string {
  if (!state || state === "completed") return "Your course is ready.";
  if (state.startsWith("failed:")) return describeGenerationState(state.slice("failed:".length));
  const level = /^syllabus_L(\d)$/.exec(state);
  if (level) {
    const n = Number(level[1]);
    return n === 6 ? "Your course still needs its final exam." : `Your course still needs Level ${n}.`;
  }
  switch (state) {
    case "researching":  return "Your course is still being researched.";
    case "outlining":    return "Your course is still being planned.";
    case "instructions": return "Your tutor is still being set up.";
    case "mastery":      return "Your course still needs its final exam.";
    default:             return "Your course is not finished building yet.";
  }
}

// A tool id → what the tutor is asking to do with it, for the Allow / Don't allow card. Grouped by
// the id's namespace so a new tool in a known family reads correctly without a copy change.
export function describeToolRequest(toolName: string): string {
  const [family, action = ""] = toolName.split(".", 2);
  switch (family) {
    case "notebook":
      return action === "ingest" ? "Your tutor wants to add something to your notes."
                                 : "Your tutor wants to look through your notes.";
    case "library":    return "Your tutor wants to look something up in the library.";
    case "web":        return "Your tutor wants to look something up on the internet.";
    case "flashcard":  return "Your tutor wants to make you a flashcard.";
    case "progress":   return "Your tutor wants to mark a topic as learned.";
    case "knowledge":  return "Your tutor wants to update its notes about how you learn.";
    case "code":       return "Your tutor wants to run a small piece of code.";
    case "math":       return "Your tutor wants to work out some math.";
    case "diagram":    return "Your tutor wants to draw a diagram.";
    default:           return `Your tutor wants to use ${humanizeId(toolName)}.`;
  }
}

// "knowledge.update_map" → "knowledge update map": the last-resort reading of an unknown id.
function humanizeId(id: string): string {
  return id.replace(/[._]+/g, " ").trim();
}
