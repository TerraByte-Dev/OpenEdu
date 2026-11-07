import { describe, it, expect } from "vitest";
import { persistedReply } from "./persistedReply";

describe("persistedReply", () => {
  it("saves a finished reply as is and an interrupted one with its marker", () => {
    expect(persistedReply("Done.", "complete")).toBe("Done.");
    expect(persistedReply("Done.", "max_iterations")).toBe("Done.");
    expect(persistedReply("Half", "length")).toBe("Half\n\n_[cut off at the length limit — ask the tutor to continue]_");
    expect(persistedReply("Half", "stalled")).toBe("Half\n\n_[the tutor stopped responding — ask again to continue]_");
    expect(persistedReply("Half", "aborted")).toBe("Half\n\n_[stopped]_");
  });

  it("saves nothing for an empty reply", () => {
    expect(persistedReply("  \n", "aborted")).toBeNull();
  });
});
