import { describe, it, expect, vi } from "vitest";
import { retakeWaitLeft } from "./level-test";

// A failed level test can be taken again 24 hours later. completed_at is SQLite's datetime('now'), UTC
// with no zone; read as local time the wait ran 24 h plus the UTC offset (29 h in Eastern time).
vi.stubEnv("TZ", "America/New_York");

const FAILED_AT = "2026-11-18 14:00:00"; // 9:00 am Eastern
const at = (iso: string) => new Date(iso).getTime();

describe("retakeWaitLeft", () => {
  it("is 24 hours straight after the fail, whatever the computer's time zone", () => {
    expect(new Date(at("2026-11-18T14:00:00Z")).getHours()).toBe(9); // the zone is really pinned
    expect(retakeWaitLeft(FAILED_AT, at("2026-11-18T14:00:00Z"))).toBe("24h 0m");
  });
  it("counts down and ends 24 hours after the fail", () => {
    expect(retakeWaitLeft(FAILED_AT, at("2026-11-19T13:00:00Z"))).toBe("1h 0m");
    expect(retakeWaitLeft(FAILED_AT, at("2026-11-19T13:50:00Z"))).toBe("10m");
    expect(retakeWaitLeft(FAILED_AT, at("2026-11-19T14:00:00Z"))).toBe("");
    expect(retakeWaitLeft(FAILED_AT, at("2026-11-19T16:00:00Z"))).toBe("");
  });
});
