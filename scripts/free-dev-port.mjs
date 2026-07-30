// Free port 1420 before `vite` starts, if — and only if — it is held by an orphaned Vite from THIS
// project.
//
// The failure this fixes: `tauri dev` spawns Vite as a child. Kill the Tauri parent (Ctrl-C at the
// wrong moment, a closed terminal, an IDE stop button) and on Windows the child routinely survives,
// holding 1420. The next `tauri dev` then dies with "Port 1420 is already in use" — and confusingly,
// `cargo run` has usually already launched the app window against the dead server, so a window being
// open is not evidence the run worked.
//
// `strictPort: true` is deliberate and stays: tauri.conf.json pins devUrl to 1420, so a Vite that
// quietly moved to 1421 would leave the app pointing at nothing — a worse failure, because it looks
// like the app is broken rather than the port being taken.
//
// SAFETY: this kills a process only when all of these hold — it listens on 1420, it is node, and its
// command line names both this project directory and vite. Anything else is left alone and Vite
// reports the conflict exactly as it does today. Making a dev convenience able to kill an unrelated
// process would be a bad trade.

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 1420;
const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return ""; // a non-zero exit here just means "nothing found"
  }
};

/** PIDs listening on the port. */
function listeners() {
  if (process.platform === "win32") {
    return [...new Set(
      sh(`netstat -ano -p tcp`)
        .split("\n")
        .filter((l) => l.includes(`:${PORT} `) && l.includes("LISTENING"))
        .map((l) => l.trim().split(/\s+/).pop())
        .filter((p) => p && /^\d+$/.test(p)),
    )];
  }
  return [...new Set(sh(`lsof -ti tcp:${PORT} -sTCP:LISTEN`).split("\n").map((s) => s.trim()).filter(Boolean))];
}

/** The process's full command line, for identity checks. */
function commandLine(pid) {
  if (process.platform === "win32") {
    // -Raw keeps it on one line; a wrapped command line would fail the substring checks below.
    return sh(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId = ${pid}\\").CommandLine"`);
  }
  return sh(`ps -p ${pid} -o args=`);
}

let freed = 0;
for (const pid of listeners()) {
  const cmd = commandLine(pid).replace(/\s+/g, " ");
  if (!cmd) continue;

  const isOurs = cmd.includes(projectDir) || cmd.includes(projectDir.replace(/\\/g, "/"));
  const isVite = /\bvite(\.js)?\b/.test(cmd);
  if (!isOurs || !isVite) {
    console.log(`[free-dev-port] ${PORT} is held by PID ${pid}, which is not this project's Vite — leaving it alone.`);
    continue;
  }

  try {
    process.kill(Number(pid), "SIGKILL");
    freed++;
    console.log(`[free-dev-port] cleared an orphaned Vite (PID ${pid}) still holding ${PORT}.`);
  } catch (e) {
    console.log(`[free-dev-port] could not stop PID ${pid}: ${e instanceof Error ? e.message : e}`);
  }
}

// Give the OS a moment to actually release the socket, or Vite races us to bind it.
if (freed > 0) {
  const until = Date.now() + 1500;
  while (Date.now() < until) { /* spin briefly; this runs once, before a multi-second dev boot */ }
}
