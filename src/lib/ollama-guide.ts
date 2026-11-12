// Guided Ollama setup (#275): which of four states this computer is in, and what to tell the person.
//
// Pure, so the wording for each state is pinned by tests. The probe that gathers the facts is
// `probeEnvironment` in setup-check.ts; the screen is `src/components/OllamaGuide.tsx`.
//
// The people this is for may have no internet and no one technical nearby, so every state ends in one
// concrete next action, and nothing tells them to open a terminal unless there is no other way.

export type OllamaState = "not-installed" | "not-running" | "no-model" | "ready";
export type Platform = "windows" | "mac" | "linux";

export interface OllamaFacts {
  reachable: boolean;
  /** From the Rust probe. null when it could not be asked (vite in a browser) — read as "not running". */
  installed: boolean | null;
  models: string[];
  /** The configured chat model is among `models`. */
  chatModelInstalled: boolean;
}

export function ollamaState(f: OllamaFacts): OllamaState {
  if (!f.reachable) return f.installed === false ? "not-installed" : "not-running";
  return f.chatModelInstalled ? "ready" : "no-model";
}

export function platformOf(userAgent: string): Platform {
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "mac";
  return "linux";
}

/** True when the URL points at this computer, the only place the importer will send a model. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) && (u.port === "" || u.port === "11434");
  } catch {
    return false;
  }
}

export type GuideAction = "find-installer" | "recheck" | "import-model" | "download-model";

export interface Guidance {
  state: OllamaState;
  title: string;
  body: string;
  /** Numbered, in the order the person does them. */
  steps: string[];
  /** Buttons, the first one primary. */
  actions: GuideAction[];
}

const INSTALLER_NAME: Record<Platform, string> = {
  windows: "OllamaSetup.exe",
  mac: "Ollama.dmg (or Ollama-darwin.zip)",
  linux: "the ollama-linux archive",
};

export function ollamaGuidance(
  state: OllamaState,
  opts: { platform: Platform; chatModel: string; ollamaUrl: string; installedCount?: number },
): Guidance {
  const local = isLoopbackUrl(opts.ollamaUrl);
  const p = opts.platform;

  if (state === "ready") {
    return { state, title: "Ollama is ready", body: `${opts.chatModel} is installed and Ollama is running.`, steps: [], actions: [] };
  }

  if (!local && (state === "not-installed" || state === "not-running")) {
    return {
      state: "not-running",
      title: "Ollama isn't answering",
      body: `OpenEdu is set to use Ollama at ${opts.ollamaUrl}, on another computer, and it isn't answering.`,
      steps: ["Check that the other computer is on and Ollama is running there.", "Or open Settings and set the Ollama address back to http://127.0.0.1:11434."],
      actions: ["recheck"],
    };
  }

  if (state === "not-installed") {
    return {
      state,
      title: "Ollama isn't on this computer yet",
      body: "Ollama is the free program that runs the tutor's model on this computer, with no internet needed. OpenEdu can't install it for you, but it takes a minute.",
      steps: [
        `If you have an OpenEdu kit on a USB stick, plug it in and press "Find the Ollama installer". Otherwise, download Ollama from ollama.com on any computer.`,
        `Double-click ${INSTALLER_NAME[p]} and follow its steps.`,
        `When it's done, come back here and press "Check again".`,
      ],
      actions: ["find-installer", "recheck"],
    };
  }

  if (state === "not-running") {
    const start: Record<Platform, string> = {
      windows: "Open the Start menu, type Ollama, and open it. A small llama appears near the clock when it's running.",
      mac: "Open Ollama from your Applications folder. A small llama appears in the menu bar when it's running.",
      linux: "Start the Ollama service (or run ollama serve in a terminal).",
    };
    return {
      state,
      title: "Ollama is installed but not running",
      body: "OpenEdu needs Ollama running to think. It usually starts on its own when the computer starts; this time it hasn't.",
      steps: [start[p], `Come back here and press "Check again".`],
      actions: ["recheck", "find-installer"],
    };
  }

  // no-model
  const some = (opts.installedCount ?? 0) > 0;
  return {
    state,
    title: some ? `Ollama doesn't have ${opts.chatModel}` : "Ollama has no model yet",
    body: some
      ? `Ollama is running, but the tutor is set to use ${opts.chatModel}, which isn't on this computer.`
      : "Ollama is running, but it has no model to tutor with.",
    steps: [
      `With a USB stick or folder that has a model on it, press "Import from a folder". It works with no internet.`,
      `With internet, press "Download ${opts.chatModel}" instead.`,
    ],
    actions: ["import-model", "download-model"],
  };
}
