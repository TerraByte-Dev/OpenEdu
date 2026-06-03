import { describe, it, expect } from "vitest";
import { compareVersions, isNewerVersion } from "./version";

describe("compareVersions", () => {
  it("orders by numeric core (not lexical)", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("0.2.0", "0.10.0")).toBe(-1); // 2 < 10 numerically
  });

  it("tolerates a leading v and missing segments", () => {
    expect(compareVersions("v1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("v2", "1.9.9")).toBe(1);
  });

  it("ranks a prerelease below its final release", () => {
    expect(compareVersions("1.2.0", "1.2.0-beta.1")).toBe(1);
    expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBe(-1);
    expect(compareVersions("1.2.0-beta.2", "1.2.0-beta.1")).toBe(1);
  });

  it("non-numeric / garbage tags parse to a 0.0.0 core", () => {
    expect(compareVersions("latest", "0.0.0")).toBe(0);
    expect(compareVersions("release-2", "0.1.0")).toBe(-1);
  });
});

describe("isNewerVersion", () => {
  it("is the strictly-greater decision used by the update check", () => {
    expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("v1.0.0", "0.9.9")).toBe(true);
  });
});
