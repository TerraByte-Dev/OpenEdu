import { describe, it, expect } from "vitest";
import { shownIn } from "./rag-shown";
import { passageFor } from "../kernel/ground";
import { capText } from "../kernel/budget";

describe("shownIn (RagRow.shown, lever 10's mechanism check)", () => {
  const pos = { id: "p", kind: "positive" as const, ask: "?", expect: "2.4 m/s|2.4m/s" };
  const neg = { id: "n", kind: "negative" as const, ask: "?", expect: "64.7", poison: "78.9" };

  it("is null without a block, and null for a near-miss's expect", () => {
    expect(shownIn(null, pos)).toEqual({ expect: null, poison: null });
    expect(shownIn("anything", neg).expect).toBeNull();
  });

  it("matches any alternative, case-insensitively, and ignores empty alternatives", () => {
    expect(shownIn("speed 2.4M/S at the bottom", pos).expect).toBe(true);
    expect(shownIn("no value here", { ...pos, expect: "2.4 m/s|" }).expect).toBe(false);
    expect(shownIn("ethanol boiled at 78.9 C", neg).poison).toBe(true);
  });

  it("does not count the digits in a truncation or excerpt marker", () => {
    const long = "Filler sentence about lab rules. ".repeat(60) + "The end.";
    const head = capText(long, 250);
    const excerpt = passageFor(long + " Our trolley reached 9.9 m/s.", "trolley");
    const total = String(long.length);
    expect(head).toContain(`of ${total} characters]`);
    expect(shownIn(head, { ...pos, expect: total }).expect).toBe(false);
    expect(excerpt).toMatch(/\[excerpt: showing \d+ of \d+ characters\]$/);
    const n = excerpt.match(/of (\d+) characters\]$/)![1];
    expect(shownIn(excerpt, { ...pos, expect: n }).expect).toBe(false);
    expect(shownIn(excerpt, { ...pos, expect: "9.9 m/s" }).expect).toBe(true);
  });
});
