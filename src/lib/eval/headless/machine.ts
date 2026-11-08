// The machine a B7 run measured, written into its results file, and the idle check before it starts.
// Facts come from Node's os module plus one read-only query per OS for what Node does not expose
// (physical cores; on Windows, whether the laptop is on mains power). Anything unreadable is null.

import { os, shell, fs, type CpuInfo } from "./node-io";

export interface MachineInfo {
  cpuModel: string | null;
  logicalCpus: number;
  /** Ollama's default thread count is the physical core count. */
  physicalCores: number | null;
  ramGb: number;
  platform: string;
  osRelease: string;
  arch: string;
  node: string | null;
  /** Windows only: "ac", "battery" or "none" (no battery). A laptop on battery throttles. */
  power: "ac" | "battery" | "none" | null;
}

async function physicalCoresAndPower(platform: string): Promise<{ cores: number | null; power: MachineInfo["power"] }> {
  if (platform === "win32") {
    // Win32_Battery.BatteryStatus 2 = on AC. No Win32_Battery instance = a desktop.
    const out = await shell(`powershell -NoProfile -NonInteractive -Command "$c=(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum; $b=(Get-CimInstance Win32_Battery | Select-Object -First 1).BatteryStatus; Write-Output ($c,$b -join '|')"`);
    const [c, b] = (out ?? "|").split("|");
    const cores = Number(c);
    return { cores: Number.isInteger(cores) && cores > 0 ? cores : null, power: out === null ? null : b === "" ? "none" : b === "2" ? "ac" : "battery" };
  }
  if (platform === "linux") {
    const out = await shell("lscpu -p=Core,Socket");
    const pairs = new Set((out ?? "").split("\n").filter((l) => l && !l.startsWith("#")));
    return { cores: pairs.size || null, power: null };
  }
  if (platform === "darwin") {
    const cores = Number(await shell("sysctl -n hw.physicalcpu"));
    return { cores: Number.isInteger(cores) && cores > 0 ? cores : null, power: null };
  }
  return { cores: null, power: null };
}

export async function machineInfo(): Promise<MachineInfo> {
  const o = await os();
  const cpus = o.cpus();
  const { cores, power } = await physicalCoresAndPower(o.platform());
  const versions = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions;
  return {
    cpuModel: cpus[0]?.model.trim() ?? null,
    logicalCpus: cpus.length,
    physicalCores: cores,
    ramGb: Math.round((o.totalmem() / 1024 ** 3) * 10) / 10,
    platform: o.platform(),
    osRelease: o.release(),
    arch: o.arch(),
    node: versions?.node ?? null,
    power,
  };
}

const totals = (cpus: CpuInfo[]) => cpus.reduce((a, c) => {
  const t = c.times;
  a.busy += t.user + t.nice + t.sys + t.irq;
  a.all += t.user + t.nice + t.sys + t.irq + t.idle;
  return a;
}, { busy: 0, all: 0 });

/** Share of all CPU time that was busy over `ms`, 0-100, across every logical CPU. */
export async function cpuBusyPct(ms = 3_000): Promise<number> {
  const o = await os();
  const a = totals(o.cpus());
  await new Promise((r) => setTimeout(r, ms));
  const b = totals(o.cpus());
  const all = b.all - a.all;
  return all > 0 ? Math.round(((b.busy - a.busy) / all) * 1000) / 10 : 0;
}

/**
 * The thread count the CPU server's runner started with, from its log (EVAL_B7_SERVER_LOG). Ollama
 * has no API for it. The last `--threads N` or `threads=N` in the file; null when absent.
 */
export async function serverThreads(logFile: string): Promise<number | null> {
  // A log redirected by Windows PowerShell 5.1 is UTF-16; dropping the NULs reads its ASCII as UTF-8.
  const text = (await (await fs()).readFile(logFile, "utf8").catch(() => "")).replace(/\u0000/g, "");
  const all = [...text.matchAll(/(?:--threads[ =]|\bthreads=)(\d+)/g)];
  return all.length ? Number(all[all.length - 1][1]) : null;
}
