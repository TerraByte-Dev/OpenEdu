import { useState, useEffect } from "react";
import type { LLMProvider } from "../types";
import {
  getLLMProvider, setLLMProvider, setGenerationModel, setChatModel,
  setApiKey, setOllamaUrl, getApiKey, getGenerationConfig, getChatConfig,
} from "../lib/store";
import { getOllamaModels, callLLM } from "../lib/llm";

const PROVIDERS: { id: LLMProvider; name: string; needsKey: boolean }[] = [
  { id: "ollama", name: "Ollama (Local — Free)", needsKey: false },
  { id: "openai", name: "OpenAI", needsKey: true },
  { id: "anthropic", name: "Anthropic", needsKey: true },
];

const GENERATION_MODELS: Record<LLMProvider, Array<{ id: string; label: string; recommended?: boolean }>> = {
  ollama: [
    { id: "llama3:70b", label: "llama3:70b", recommended: true },
    { id: "qwen2.5:72b", label: "qwen2.5:72b" },
    { id: "mistral-large", label: "mistral-large" },
    { id: "llama3", label: "llama3" },
  ],
  openai: [
    { id: "gpt-5.4", label: "GPT-5.4", recommended: true },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4o", label: "GPT-4o" },
  ],
  anthropic: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", recommended: true },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
};

const CHAT_MODELS: Record<LLMProvider, Array<{ id: string; label: string; recommended?: boolean }>> = {
  ollama: [
    { id: "llama3", label: "llama3", recommended: true },
    { id: "phi3", label: "phi3" },
    { id: "gemma2", label: "gemma2" },
    { id: "mistral", label: "mistral" },
  ],
  openai: [
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", recommended: true },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
    { id: "gpt-4o", label: "GPT-4o" },
  ],
  anthropic: [
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", recommended: true },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  ],
};

export default function Settings() {
  const [provider, setProvider] = useState<LLMProvider>("ollama");
  const [genModel, setGenModel] = useState("llama3");
  const [chatModel, setChatModelState] = useState("llama3");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [ollamaUrlValue, setOllamaUrlValue] = useState("http://localhost:11434");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [saved, setSaved] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    (async () => {
      const base = await getLLMProvider();
      setProvider(base.provider);
      setOllamaUrlValue(base.ollamaUrl);
      const gc = await getGenerationConfig();
      setGenModel(gc.model);
      const cc = await getChatConfig();
      setChatModelState(cc.model);
      if (base.provider !== "ollama") {
        const key = await getApiKey(base.provider);
        setApiKeyValue(key || "");
      }
    })();
  }, []);

  useEffect(() => {
    if (provider === "ollama") checkOllama();
    else setOllamaStatus("disconnected");
  }, [provider, ollamaUrlValue]);

  useEffect(() => {
    if (provider !== "ollama") {
      (async () => {
        const key = await getApiKey(provider);
        setApiKeyValue(key || "");
      })();
    } else {
      setApiKeyValue("");
    }
  }, [provider]);

  const checkOllama = async () => {
    setOllamaStatus("checking");
    const models = await getOllamaModels(ollamaUrlValue);
    if (models.length > 0) {
      setOllamaModels(models);
      setOllamaStatus("connected");
    } else {
      setOllamaModels([]);
      setOllamaStatus("disconnected");
    }
  };

  const handleVerify = async () => {
    if (!apiKeyValue.trim()) {
      setVerifyResult({ ok: false, msg: "Enter an API key first." });
      return;
    }
    setVerifying(true);
    setVerifyResult(null);
    try {
      // Save the key first so it persists before we test it
      await setApiKey(provider, apiKeyValue);
      const config = provider === "anthropic"
        ? { provider: "anthropic" as const, model: "claude-haiku-4-5-20251001", apiKey: apiKeyValue.trim() }
        : { provider: "openai" as const, model: "gpt-4o-mini", apiKey: apiKeyValue.trim() };
      await callLLM([{ role: "user", content: "Reply with exactly: ok" }], config);
      setVerifyResult({ ok: true, msg: `${provider === "anthropic" ? "Anthropic" : "OpenAI"} key is valid and working.` });
    } catch (e) {
      setVerifyResult({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setVerifying(false);
    }
  };

  const handleSave = async () => {
    await setLLMProvider(provider);
    await setGenerationModel(genModel);
    await setChatModel(chatModel);
    if (provider !== "ollama" && apiKeyValue) {
      await setApiKey(provider, apiKeyValue);
    }
    if (provider === "ollama") {
      await setOllamaUrl(ollamaUrlValue);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // If Ollama is connected, mix in discovered models with the list
  const getModelList = (baseList: Array<{ id: string; label: string; recommended?: boolean }>) => {
    if (provider !== "ollama" || ollamaModels.length === 0) return baseList;
    const discovered = ollamaModels
      .filter((m) => !baseList.find((b) => b.id === m))
      .map((m) => ({ id: m, label: m, recommended: false as const }));
    return [...baseList, ...discovered];
  };

  const genModels = getModelList(GENERATION_MODELS[provider]);
  const chatModels = getModelList(CHAT_MODELS[provider]);

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-100 mb-6">Settings</h1>

        {/* Provider */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">LLM Provider</h2>
          <div className="flex gap-3 flex-wrap">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => setProvider(p.id)}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  provider === p.id ? "bg-terra-600 text-white" : "bg-surface-700 text-zinc-300 hover:bg-surface-600"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </section>

        {/* Ollama */}
        {provider === "ollama" && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Ollama Connection</h2>
            <div className="flex gap-3 items-center">
              <input
                type="text"
                value={ollamaUrlValue}
                onChange={(e) => setOllamaUrlValue(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-surface-700 border border-surface-500 text-zinc-100 text-sm focus:outline-none focus:border-terra-500"
              />
              <div className={`flex items-center gap-2 text-sm shrink-0 ${
                ollamaStatus === "connected" ? "text-green-400" :
                ollamaStatus === "disconnected" ? "text-red-400" : "text-zinc-500"
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  ollamaStatus === "connected" ? "bg-green-400" :
                  ollamaStatus === "disconnected" ? "bg-red-400" : "bg-zinc-500 animate-pulse"
                }`} />
                {ollamaStatus === "connected" ? `Connected (${ollamaModels.length} models)` :
                 ollamaStatus === "disconnected" ? "Not connected" : "Checking..."}
              </div>
            </div>
            {ollamaStatus === "disconnected" && (
              <p className="mt-2 text-xs text-zinc-500">
                Install from <strong>ollama.com</strong> and run a model: <code className="bg-surface-700 px-1 rounded">ollama run llama3</code>
              </p>
            )}
          </section>
        )}

        {/* API Key */}
        {provider !== "ollama" && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">API Key</h2>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKeyValue}
                onChange={(e) => { setApiKeyValue(e.target.value); setVerifyResult(null); }}
                className="flex-1 px-4 py-2.5 rounded-lg bg-surface-700 border border-surface-500 text-zinc-100 text-sm focus:outline-none focus:border-terra-500"
                placeholder={`Enter your ${provider === "openai" ? "OpenAI" : "Anthropic"} API key`}
              />
              <button
                onClick={handleVerify}
                disabled={verifying || !apiKeyValue.trim()}
                className="px-4 py-2.5 rounded-lg bg-surface-600 hover:bg-surface-500 text-zinc-200 text-sm font-medium disabled:opacity-50 transition-colors shrink-0"
              >
                {verifying ? "Testing..." : "Verify Key"}
              </button>
            </div>
            {verifyResult && (
              <p className={`mt-2 text-xs font-medium ${verifyResult.ok ? "text-green-400" : "text-red-400"}`}>
                {verifyResult.ok ? "✓ " : "✗ "}{verifyResult.msg}
              </p>
            )}
            <p className="mt-2 text-xs text-zinc-500">
              Stored locally on your machine. Never sent anywhere except the provider's API.
            </p>
          </section>
        )}

        {/* Model pickers side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-8">
          {/* Generation model */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Course Generation Model</h2>
            <p className="text-xs text-zinc-600 mb-3">Used for research and syllabus creation. A capable model gives better curricula.</p>
            <div className="flex flex-col gap-2">
              {genModels.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setGenModel(m.id)}
                  className={`px-3 py-2 rounded-lg text-sm text-left flex items-center gap-2 transition-colors ${
                    genModel === m.id
                      ? "bg-terra-600 text-white"
                      : "bg-surface-700 text-zinc-300 hover:bg-surface-600"
                  }`}
                >
                  <span className="flex-1">{m.label}</span>
                  {m.recommended && (
                    <span className="text-[10px] font-semibold bg-terra-400/20 text-terra-300 px-1.5 py-0.5 rounded">
                      RECOMMENDED
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Chat model */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-1">Tutor Chat Model</h2>
            <p className="text-xs text-zinc-600 mb-3">Used for live tutoring chat. A fast, cheap model keeps response times low.</p>
            <div className="flex flex-col gap-2">
              {chatModels.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setChatModelState(m.id)}
                  className={`px-3 py-2 rounded-lg text-sm text-left flex items-center gap-2 transition-colors ${
                    chatModel === m.id
                      ? "bg-terra-600 text-white"
                      : "bg-surface-700 text-zinc-300 hover:bg-surface-600"
                  }`}
                >
                  <span className="flex-1">{m.label}</span>
                  {m.recommended && (
                    <span className="text-[10px] font-semibold bg-terra-400/20 text-terra-300 px-1.5 py-0.5 rounded">
                      RECOMMENDED
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={handleSave}
          className="px-6 py-2.5 rounded-lg bg-terra-600 hover:bg-terra-500 text-white text-sm font-medium transition-colors"
        >
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
