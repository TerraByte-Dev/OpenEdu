import { describe, it, expect } from "vitest";
import { serverThreads, cpuBusyPct, machineInfo } from "./machine";
import { fs, os } from "./node-io";

describe("serverThreads", () => {
  it("reads the last thread count a runner started with, from a UTF-8 or a UTF-16 log", async () => {
    const f = await fs();
    const dir = await f.mkdtemp(`${(await os()).tmpdir()}/oe-b7-log-`);
    try {
      const log = [
        'time=2026-11-08T09:00:00 level=INFO msg="starting llama server" cmd="ollama.exe runner --model x --ctx-size 8192 --threads 8 --parallel 1"',
        'time=2026-11-08T09:05:00 level=INFO msg=system info="CPU : AVX2 = 1" threads=6',
        "",
      ].join("\n");
      await f.writeFile(`${dir}/utf8.log`, log, "utf8");
      expect(await serverThreads(`${dir}/utf8.log`)).toBe(6);
      // What Windows PowerShell 5.1's `2>` writes: UTF-16LE.
      const utf16 = log.split("").map((ch) => `${ch}\u0000`).join("");
      await f.writeFile(`${dir}/utf16.log`, utf16, "utf8");
      expect(await serverThreads(`${dir}/utf16.log`)).toBe(6);
      await f.writeFile(`${dir}/none.log`, "time=… msg=\"Listening on 127.0.0.1:11435\"\n", "utf8");
      expect(await serverThreads(`${dir}/none.log`)).toBeNull();
      expect(await serverThreads(`${dir}/missing.log`)).toBeNull();
    } finally {
      await f.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("machine facts", () => {
  it("samples CPU busy time as a share, and reads this machine's CPU and memory", async () => {
    const busy = await cpuBusyPct(50);
    expect(busy).toBeGreaterThanOrEqual(0);
    expect(busy).toBeLessThanOrEqual(100);
    const m = await machineInfo();
    expect(m.logicalCpus).toBeGreaterThan(0);
    expect(m.ramGb).toBeGreaterThan(0);
    expect(m.platform).toBe((await os()).platform());
    if (m.physicalCores !== null) expect(m.physicalCores).toBeLessThanOrEqual(m.logicalCpus);
  }, 30_000);
});
