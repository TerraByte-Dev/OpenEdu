import { describe, it, expect } from "vitest";
import { ollamaState, ollamaStatusLabel, OLLAMA_NO_MODELS_HINT, ollamaDiagnostics } from "./ollama-status";
import providerModels from "../views/settings/sections/ProviderModels.tsx?raw";
import about from "../views/settings/sections/About.tsx?raw";

// The three answers llm.ts getOllamaModels gives: models, an empty list from a running Ollama (a fresh
// install before a pull or an import), and an error when Ollama does not answer.
const running = { models: ["gemma4:e2b", "nomic-embed-text:latest"] };
const empty = { models: [] as string[] };
const down = { models: [] as string[], error: "Connection refused — is Ollama running? Try: ollama serve" };

describe("Ollama's state in Settings and Diagnostics", () => {
  it("an empty list from a running Ollama is 'no models', never offline", () => {
    expect(ollamaState(running)).toBe("connected");
    expect(ollamaState(empty)).toBe("no-models");
    expect(ollamaState(down)).toBe("offline");
  });

  it("the dot's label says which", () => {
    expect(ollamaStatusLabel("connected", 2)).toBe("2 models");
    expect(ollamaStatusLabel("connected", 1)).toBe("1 model");
    expect(ollamaStatusLabel("no-models", 0)).toBe("Running, no models yet");
    expect(ollamaStatusLabel("offline", 0)).toBe("Offline");
  });

  it("with no models it points to the import, not to installing Ollama", () => {
    expect(OLLAMA_NO_MODELS_HINT).toContain("running but has no models yet");
    expect(OLLAMA_NO_MODELS_HINT).toContain("Import a model from a USB stick or folder");
    expect(OLLAMA_NO_MODELS_HINT).not.toMatch(/install from|ollama\.com/i);
  });

  it("About › Diagnostics says the same", () => {
    expect(ollamaDiagnostics(running)).toBe("connected · 2 models");
    expect(ollamaDiagnostics(empty)).toBe("running, no models yet");
    expect(ollamaDiagnostics(down)).toBe(`offline (${down.error})`);
  });

  it("both screens take their state from these, and only offline shows the install-from-ollama.com line", () => {
    expect(providerModels).toContain("setOllamaStatus(ollamaState(result))");
    expect(providerModels).toContain("ollamaStatusLabel(ollamaStatus, ollamaModels.length)");
    expect(providerModels).toContain("{OLLAMA_NO_MODELS_HINT}");
    expect(providerModels).not.toContain("\"disconnected\"");
    // The hint's "further down this page" holds: the import row is on the page whenever the hint is.
    expect(providerModels).toContain("label=\"Import a model from a USB stick or folder\"");
    const install = providerModels.indexOf("Install from <strong>ollama.com</strong>");
    expect(providerModels.lastIndexOf("{ollamaStatus === \"offline\" && (", install)).toBeGreaterThan(providerModels.lastIndexOf("{ollamaStatus === \"no-models\" && (", install));
    expect(about).toContain("ollama = ollamaDiagnostics(r);");
  });
});
