import { describe, it, expect } from "vitest";
import { onlyAnnouncesLookup } from "./lookupAnnouncement";

describe("onlyAnnouncesLookup", () => {
  it.each([
    "I can look that up for you.",
    "Let me look that up!",
    "Sure! Let me check that for you.",
    "I'll search the library for you.",
    "Okay, let me find out.",
    "Let me work that out.",
    "I’m going to look it up.",
  ])("%j", (text) => expect(onlyAnnouncesLookup(text)).toBe(true));

  it.each([
    "",
    "Let me check: 7 x 8 is 56.",
    "I can look that up for you. 7 x 8 is 56.",
    "7 x 8 is 56. Let me check that for you.",
    "Let me look up 7 x 8 in the times table.",
    "Cats purr when they are happy.",
    "Let me show you a picture.",
  ])("%j is a reply", (text) => expect(onlyAnnouncesLookup(text)).toBe(false));
});
