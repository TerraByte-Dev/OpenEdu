import { describe, it, expect } from "vitest";
import { hashPin, verifyPin, isValidPin, PIN_ITERATIONS } from "./learner-pin";

describe("learner PIN", () => {
  it("accepts 4 to 6 digits only", () => {
    for (const ok of ["1234", "00000", "987654"]) expect(isValidPin(ok)).toBe(true);
    for (const bad of ["123", "1234567", "12a4", " 1234", "", "١٢٣٤"]) expect(isValidPin(bad)).toBe(false);
  });

  it("verifies the right PIN and rejects a wrong one", async () => {
    const rec = await hashPin("4821");
    expect(await verifyPin("4821", rec)).toBe(true);
    expect(await verifyPin("4822", rec)).toBe(false);
    expect(await verifyPin("48210", rec)).toBe(false);
    expect(await verifyPin("", rec)).toBe(false);
  });

  it("uses PBKDF2-SHA256 with at least 100k iterations and a 16-byte random salt", async () => {
    expect(PIN_ITERATIONS).toBeGreaterThanOrEqual(100_000);
    const a = await hashPin("4821");
    const b = await hashPin("4821");
    expect(a.pin_hash.startsWith(`pbkdf2-sha256$${PIN_ITERATIONS}$`)).toBe(true);
    expect(atob(a.pin_salt)).toHaveLength(16);
    expect(a.pin_salt).not.toBe(b.pin_salt);
    expect(a.pin_hash).not.toBe(b.pin_hash);
  });

  it("never stores the PIN itself", async () => {
    const rec = await hashPin("135790");
    expect(JSON.stringify(rec)).not.toContain("135790");
  });

  it("refuses to hash an invalid PIN or with too few iterations", async () => {
    await expect(hashPin("12")).rejects.toThrow();
    await expect(hashPin("1234", 1000)).rejects.toThrow();
  });

  it("a missing or malformed record never verifies", async () => {
    const good = await hashPin("4821");
    expect(await verifyPin("4821", { pin_hash: null, pin_salt: null })).toBe(false);
    expect(await verifyPin("4821", { ...good, pin_salt: null })).toBe(false);
    expect(await verifyPin("4821", { ...good, pin_hash: "plain$4821" })).toBe(false);
    expect(await verifyPin("4821", { ...good, pin_hash: good.pin_hash.replace(`$${PIN_ITERATIONS}$`, "$10$") })).toBe(false);
    expect(await verifyPin("4821", { ...good, pin_salt: "!!not base64!!" })).toBe(false);
  });
});
