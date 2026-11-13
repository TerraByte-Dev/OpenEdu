// First-run environment checks (#92).
//
// The point of this module is that it TELLS THE TRUTH. `BootSequence` used to hardcode
// "[ OK ] Ollama (local) LISTENING :11434" with no probing at all, so a machine with no Ollama
// installed was told everything was fine. That is worse than an error: the person it misleads is
// precisely the one who cannot tell the difference, and they conclude the app is broken rather than
// unconfigured.
//
// The severity split is the load-bearing decision here and it is pure, so it is unit-tested:
//   blocking — the app genuinely cannot answer a question until this is fixed
//   optional — something works worse, and saying so is honest, but gating on it would be a lie of a
//              different kind. A missing embedder costs notebook grounding; the tutor still tutors.
//
// Only `probeEnvironment` does I/O.

import { getOllamaModels, log, warmOllamaModel } from "./llm";
import { getChatConfig, getEmbeddingConfig, getGenerationConfig, getLLMProvider } from "./store";
import { ollamaInstalled } from "./model-import";
import { ollamaState, type OllamaState } from "./ollama-guide";
import { APP_NAME } from "./product";

export type CheckId = "provider" | "ollama" | "chat-model" | "gen-model" | "embed-model";
export type Severity = "ok" | "blocking" | "optional";

export interface CheckResult {
  id: CheckId;
  label: string;
  severity: Severity;
  /** What is true right now, in plain language. Never reassurance the probe did not earn. */
  detail: string;
  /** The concrete next action, when there is one the user can take. */
  fix?: { label: string; kind: "download-model" | "open-settings" | "external"; arg?: string };
}

export interface SetupStatus {
  checks: CheckResult[];
  /** True when nothing blocks using the app. The setup gate shows only when this is false. */
  ready: boolean;
  /** True when everything, including the optional pieces, is configured. */
  complete: boolean;
  /** Which of the four Ollama states this is (#275). Absent for a cloud provider. */
  ollama?: OllamaState;
}

/**
 * Ollama tags are `name:tag`. A configured model of "gemma3:1b" should match an installed
 * "gemma3:1b", and a bare "gemma3" should match "gemma3:latest" — otherwise a perfectly working
 * install gets told its model is missing over a tag suffix.
 */
export function modelIsInstalled(configured: string, installed: string[]): boolean {
  const want = configured.trim().toLowerCase();
  if (!want) return false;
  return installed.some((m) => {
    const have = m.trim().toLowerCase();
    return have === want || have === `${want}:latest` || have.split(":")[0] === want.split(":")[0];
  });
}

/**
 * Turn raw probe facts into checks. Pure — this is where "blocking vs optional" is decided, and it is
 * the part worth testing, because getting it wrong either blocks a working install or waves through
 * a broken one.
 */
export function evaluateSetup(facts: {
  provider: string;
  ollamaReachable: boolean;
  ollamaError?: string;
  /** Whether Ollama's program is on this computer (#275). Only asked when it isn't reachable. */
  ollamaInstalled?: boolean | null;
  installed: string[];
  chatModel: string;
  /** The model that builds courses (Settings can set it apart from the chat model). */
  generationModel?: string;
  embedProvider: string;
  embedModel: string;
  /** False when the computer has no network at all (navigator.onLine). A download can't work then. */
  online?: boolean;
}): SetupStatus {
  const offline = facts.online === false;
  // Offline, a Download button can only fail, so it is not offered; the detail says why instead.
  const download = (model: string): CheckResult["fix"] =>
    offline ? undefined : { label: `Download ${model}`, kind: "download-model", arg: model };
  const needsInternet = offline ? " Downloading it needs the internet." : "";
  const checks: CheckResult[] = [];

  // A cloud provider sidesteps every local check — its own key is validated in Settings.
  if (facts.provider !== "ollama") {
    checks.push({
      id: "provider",
      label: "Provider",
      severity: "ok",
      detail: `Using ${facts.provider}. Local setup is not needed.`,
    });
    return { checks, ready: true, complete: true };
  }

  checks.push(
    facts.ollamaReachable
      ? { id: "ollama", label: "Ollama", severity: "ok", detail: `Running — ${facts.installed.length} model${facts.installed.length === 1 ? "" : "s"} installed.` }
      : {
          id: "ollama",
          label: "Ollama",
          severity: "blocking",
          // Naming the actual error beats "something went wrong" — a wrong URL and a stopped service
          // are different problems with different fixes, and the message should let them be told apart.
          detail: facts.ollamaInstalled === false
            ? `Not installed on this computer yet. ${APP_NAME} needs it to think.`
            : facts.ollamaError
              ? `Not reachable: ${facts.ollamaError}`
              : `Not running. ${APP_NAME} needs it to think.`,
          fix: { label: "How to start Ollama", kind: "external", arg: "https://ollama.com/download" },
        },
  );

  const hasChat = facts.ollamaReachable && modelIsInstalled(facts.chatModel, facts.installed);
  if (facts.ollamaReachable) {
    checks.push(
      hasChat
        ? { id: "chat-model", label: "Tutor model", severity: "ok", detail: `${facts.chatModel} is installed.` }
        : {
            id: "chat-model",
            label: "Tutor model",
            severity: "blocking",
            detail: `${facts.chatModel} is not installed. Without a model there is nothing to tutor with.${offline ? " Downloading it needs the internet, so import it from a USB stick below." : ""}`,
            fix: download(facts.chatModel),
          },
    );

    // Building a course uses its own model, which can differ from the chat model (Settings, or a model
    // imported under another name). "Ready" must mean Create course works, not only chat.
    const gen = facts.generationModel?.trim() ?? "";
    if (hasChat && gen && gen.toLowerCase() !== facts.chatModel.trim().toLowerCase() && !modelIsInstalled(gen, facts.installed)) {
      checks.push({
        id: "gen-model",
        label: "Course builder",
        severity: "blocking",
        detail: `${gen} builds new courses and is not installed. ${offline ? "Downloading it needs the internet, so open" : "Download it, or open"} Settings and pick ${facts.chatModel} for building courses too.`,
        fix: download(gen) ?? { label: "Open Settings", kind: "open-settings" },
      });
    }

    // Embeddings are OPTIONAL on purpose. Without one the notebook is not searched, so answers are
    // not grounded in the student's own material — a real loss, and worth saying. But the tutor still
    // teaches, and blocking first run on a second 274MB download would turn a degraded feature into a
    // closed door.
    if (facts.embedProvider === "ollama") {
      const hasEmbed = modelIsInstalled(facts.embedModel, facts.installed);
      checks.push(
        hasEmbed
          ? { id: "embed-model", label: "Notebook search", severity: "ok", detail: `${facts.embedModel} is installed.` }
          : {
              id: "embed-model",
              label: "Notebook search",
              severity: "optional",
              detail: `${facts.embedModel} is not installed. The tutor still works; it just cannot search your notes.${needsInternet}`,
              fix: download(facts.embedModel),
            },
      );
    }
  }

  return {
    checks,
    ready: !checks.some((c) => c.severity === "blocking"),
    complete: checks.every((c) => c.severity === "ok"),
    ollama: ollamaState({
      reachable: facts.ollamaReachable,
      installed: facts.ollamaInstalled ?? null,
      models: facts.installed,
      chatModelInstalled: hasChat,
    }),
  };
}

/** The I/O half: gather the facts, then hand them to the pure evaluator. */
export async function probeEnvironment(): Promise<SetupStatus> {
  const base = await getLLMProvider();
  if (base.provider !== "ollama") {
    return evaluateSetup({
      provider: base.provider,
      ollamaReachable: false,
      installed: [],
      chatModel: "",
      embedProvider: "",
      embedModel: "",
    });
  }

  const [chat, gen, embed, tags] = await Promise.all([
    getChatConfig(),
    getGenerationConfig(),
    getEmbeddingConfig(),
    getOllamaModels(base.ollamaUrl),
  ]);

  // Only worth asking when Ollama isn't answering: that is the one case "installed?" changes the advice.
  const installedOnDisk = tags.error ? await ollamaInstalled() : true;

  return evaluateSetup({
    provider: "ollama",
    ollamaInstalled: installedOnDisk,
    // `getOllamaModels` reports an empty list both when Ollama is down AND when it is up with nothing
    // installed. The error field is what distinguishes them, and conflating the two would tell a user
    // with a running server to go install Ollama.
    ollamaReachable: !tags.error,
    ollamaError: tags.error,
    installed: tags.models,
    chatModel: chat.model,
    generationModel: gen.model,
    embedProvider: embed.provider,
    embedModel: embed.model,
    online: typeof navigator === "undefined" ? true : navigator.onLine,
  });
}

/**
 * Start loading the course-building model as soon as setup is ready, without waiting for it, so the
 * first Create course of the day finds it in memory (llm.ts warmOllamaModel: 88 s on a CPU-only 8 GB
 * computer). Ollama only, and only when the model is installed; a model already loaded costs one
 * /api/ps request. The generation config is the one the course build sends, num_ctx included, so
 * the build reuses this load instead of replacing it.
 */
export async function warmTutorInBackground(status: SetupStatus): Promise<void> {
  if (!status.ready || status.ollama !== "ready") return;
  try {
    await warmOllamaModel(await getGenerationConfig(), { background: true });
  } catch (e) {
    log.warn("warmTutorInBackground", "could not start loading the model", e);
  }
}
