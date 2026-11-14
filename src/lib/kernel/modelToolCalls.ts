// The tool calls the MODEL made: every call but the ones the app made itself (`byApp`, the flashcard
// stage in flashcardRequest.ts). The eval runners count these, so they keep measuring the model's own
// tool choice. Pure, with no imports, so the graders can use it without loading the kernel.
export function modelToolCalls<T extends { byApp?: boolean }>(calls: readonly T[]): T[] {
  return calls.filter((c) => !c.byApp);
}
