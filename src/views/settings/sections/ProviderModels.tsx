import { useEffect, useRef, useState } from "react";
import type { LLMProvider } from "../../../types";
import {
  getLLMProvider, setLLMProvider, setGenerationModel, setChatModel,
  setApiKey, setOllamaUrl, getApiKey, getGenerationConfig, getChatConfig,
  getEmbeddingConfig, setEmbeddingModel,
  getMaxContextTokens, setMaxContextTokens, CONTEXT_TOKEN_CHOICES,
} from "../../../lib/store";
import {
  PROVIDERS, GENERATION_MODELS, CHAT_MODELS,
  OLLAMA_GEN_SUGGESTIONS, OLLAMA_CHAT_SUGGESTIONS, type ModelOption,
} from "../../../lib/models";
import { getOllamaModels, callLLM } from "../../../lib/llm";
import { Section, SettingRow, SecretField, SegmentedControl, INPUT_CLS, useSettings } from "../primitives";
import type { SectionProps } from "../types";

export default function ProviderModels({ onProviderChanged }: SectionProps) {
  const { markSaved } = useSettings();
  const [provider, setProvider] = useState<LLMProvider>("ollama");
  const [genModel, setGenModel] = useState("llama3");
  const [chatModel, setChatModelState] = useState("llama3");
  const [embeddingModel, setEmbeddingModelState] = useState("nomic-embed-text");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [ollamaUrlValue, setOllamaUrlValue] = useState("http://127.0.0.1:11434");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [maxCtx, setMaxCtx] = useState<number>(8192);

  // Initial load probes Ollama exactly once with the persisted URL; the effect below re-probes only when the
  // PROVIDER changes — NOT on every keystroke in the URL field (that fired a network probe per character and
  // could turn the status dot green for a URL that was never saved). Intentional URL edits re-probe via the
  // explicit "Save & Check" button / Enter, which also persists.
  const didInit = useRef(false);
  useEffect(() => {
    (async () => {
      const base = await getLLMProvider();
      setProvider(base.provider);
      setOllamaUrlValue(base.ollamaUrl);
      setGenModel((await getGenerationConfig()).model);
      setChatModelState((await getChatConfig()).model);
      setEmbeddingModelState((await getEmbeddingConfig()).model);
      setMaxCtx(await getMaxContextTokens());
      if (base.provider !== "ollama") setApiKeyValue((await getApiKey(base.provider)) || "");
      if (base.provider === "ollama") void checkOllama(base.ollamaUrl);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!didInit.current) { didInit.current = true; return; } // initial probe handled by the load effect
    if (provider === "ollama") void checkOllama();
    else setOllamaStatus("disconnected");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const checkOllama = async (url: string = ollamaUrlValue) => {
    setOllamaStatus("checking");
    setOllamaError(null);
    const result = await getOllamaModels(url);
    if (result.models.length > 0) {
      setOllamaModels(result.models);
      setOllamaStatus("connected");
    } else {
      setOllamaModels([]);
      setOllamaStatus("disconnected");
      if (result.error) setOllamaError(result.error);
    }
  };

  // Persist the typed Ollama URL, then probe it. The green/red status only updates here (and on
  // provider/mount), so a connected dot always reflects a URL that was actually saved.
  const saveAndCheckOllama = async () => {
    await setOllamaUrl(ollamaUrlValue);
    markSaved();
    void checkOllama(ollamaUrlValue);
  };

  const pickProvider = async (p: LLMProvider) => {
    setProvider(p);
    await setLLMProvider(p);
    markSaved();
    onProviderChanged?.();
    setApiKeyValue(p === "ollama" ? "" : (await getApiKey(p)) || "");
  };

  const commitGen = async (m: string) => { setGenModel(m); await setGenerationModel(m); markSaved(); };
  const commitChat = async (m: string) => { setChatModelState(m); await setChatModel(m); markSaved(); };
  const commitEmbedding = async () => { await setEmbeddingModel(embeddingModel.trim() || "nomic-embed-text"); markSaved(); };

  const verifyKey = async (key: string) => {
    const testModel = provider === "anthropic" ? "claude-haiku-4-5-20251001" : "gpt-4o-mini";
    try {
      await callLLM([{ role: "user", content: "Reply with one word: ok" }], { provider, model: testModel, apiKey: key.trim() });
      return { ok: true, msg: `${provider === "anthropic" ? "Anthropic" : "OpenAI"} key is valid and working.` };
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : String(e) };
    }
  };

  return (
    <>
      <Section
        title="LLM Provider"
        description="Where the tutor's intelligence comes from. Ollama runs models locally and free; OpenAI and Anthropic are cloud, bring-your-own-key."
        keywords="provider ollama openai anthropic cloud local model llm engine api"
      >
        <div className="flex gap-2.5 flex-wrap">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => pickProvider(p.id)}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                provider === p.id ? "btn-primary btn" : "bg-panel-lite text-[var(--ink-dim)] hover:bg-lcd border border-[var(--rule)]"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </Section>

      {provider === "ollama" && (
        <Section
          title="Ollama Connection"
          description="The local Ollama server URL. The tutor discovers installed models from here."
          keywords="ollama connection url localhost 11434 server offline local discover models refresh"
        >
          <SettingRow label="Server URL" help="Default is http://127.0.0.1:11434. Change it if Ollama runs elsewhere, then Save & Check.">
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={ollamaUrlValue}
                onChange={(e) => setOllamaUrlValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void saveAndCheckOllama(); }}
                className={INPUT_CLS}
                spellCheck={false}
              />
              <button
                onClick={saveAndCheckOllama}
                className="btn shrink-0"
              >
                Save &amp; Check
              </button>
              <div className={`flex items-center gap-2 text-sm shrink-0 ${
                ollamaStatus === "connected" ? "text-emerald-400" :
                ollamaStatus === "disconnected" ? "text-red-400" : "text-[var(--ink-faint)]"
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  ollamaStatus === "connected" ? "bg-emerald-400" :
                  ollamaStatus === "disconnected" ? "bg-red-400" : "bg-[var(--ink-faint)] animate-pulse"
                }`} />
                {ollamaStatus === "connected" ? `${ollamaModels.length} models` :
                 ollamaStatus === "disconnected" ? "Offline" : "Checking…"}
              </div>
            </div>
            {ollamaStatus === "disconnected" && (
              <div className="mt-2.5 space-y-1">
                {ollamaError && <p className="text-xs text-red-400 font-mono bg-panel-lite px-2 py-1.5 rounded">{ollamaError}</p>}
                <p className="text-xs text-[var(--ink-faint)]">
                  Install from <strong>ollama.com</strong> and run a model: <code className="bg-panel-lite px-1 rounded">ollama run llama3</code>
                </p>
              </div>
            )}
          </SettingRow>
        </Section>
      )}

      {provider !== "ollama" && (
        <Section
          title="API Key"
          description="Stored locally on this device. Never sent anywhere except the provider's own API."
          keywords="api key secret openai anthropic credential token verify"
        >
          <SettingRow label={`${provider === "openai" ? "OpenAI" : "Anthropic"} API key`}>
            <SecretField
              value={apiKeyValue}
              placeholder={`Enter your ${provider === "openai" ? "OpenAI" : "Anthropic"} API key`}
              onSave={async (k) => { await setApiKey(provider, k); setApiKeyValue(k); markSaved(); }}
              onVerify={verifyKey}
              footnote="Stored locally. Use Verify to confirm the key works before you rely on it."
            />
          </SettingRow>
        </Section>
      )}

      <Section
        title="Models"
        description="Pick a model for each job. Generation builds curricula (bigger = better); chat is live tutoring (faster = snappier); embedding powers notebook search."
        keywords="model generation chat embedding notebook tier nomic minilm gpt claude llama qwen gemma"
      >
        <SettingRow label="Course generation model" help="Used for research & syllabus creation. Bigger models write better curricula." keywords="generation syllabus research">
          {provider === "ollama" ? (
            <OllamaModelPicker label="generation" value={genModel} onChange={setGenModel} onCommit={commitGen} discoveredModels={ollamaModels} suggestions={OLLAMA_GEN_SUGGESTIONS} ollamaStatus={ollamaStatus} />
          ) : (
            <CloudModelChips models={GENERATION_MODELS[provider as Exclude<LLMProvider, "ollama">]} value={genModel} onChange={commitGen} />
          )}
        </SettingRow>

        <SettingRow label="Tutor chat model" help="Used for live tutoring. Faster models give snappier responses." keywords="chat tutor live">
          {provider === "ollama" ? (
            <OllamaModelPicker label="chat" value={chatModel} onChange={setChatModelState} onCommit={commitChat} discoveredModels={ollamaModels} suggestions={OLLAMA_CHAT_SUGGESTIONS} ollamaStatus={ollamaStatus} />
          ) : (
            <CloudModelChips models={CHAT_MODELS[provider as Exclude<LLMProvider, "ollama">]} value={chatModel} onChange={commitChat} />
          )}
        </SettingRow>

        <SettingRow
          label="Embedding model (Notebook)"
          help={<>Embeds notebook documents so the tutor can search & cite them. Runs locally on Ollama — default <span className="text-phosphor-ink">nomic-embed-text</span> (~274MB); lighter: <span className="text-phosphor-ink">all-minilm</span>. Run <span className="text-phosphor-ink">ollama pull &lt;model&gt;</span> first.</>}
          keywords="embedding notebook rag vector nomic minilm search cite"
        >
          <input
            type="text"
            value={embeddingModel}
            onChange={(e) => setEmbeddingModelState(e.target.value)}
            onBlur={commitEmbedding}
            onKeyDown={(e) => { if (e.key === "Enter") void commitEmbedding(); }}
            placeholder="nomic-embed-text"
            className={INPUT_CLS}
            spellCheck={false}
          />
        </SettingRow>

        <SettingRow
          label="Context window"
          help={<>How much conversation the tutor can hold at once. <span className="text-phosphor-ink">Bigger is not better.</span> A larger window costs memory <em>and</em> tends to make small local models answer worse, because the relevant part of a long context gets lost among the rest. Raise it only if replies are getting cut off; lower it if the app is sluggish or a model fails to load. Applies to local (Ollama) models — and this setting <span className="text-phosphor-ink">overrides</span> whatever context length Ollama itself is configured with, so there is one place to change it. Cloud models manage their own.</>}
          keywords="context window num_ctx tokens memory ram history truncation length"
        >
          <div className="flex flex-col gap-1.5">
            <SegmentedControl
              options={CONTEXT_TOKEN_CHOICES.map((n) => ({ id: String(n), label: n >= 1024 ? `${n / 1024}k` : String(n) }))}
              value={String(maxCtx)}
              onChange={(next) => {
                const n = Number(next);
                setMaxCtx(n);
                void setMaxContextTokens(n).then(markSaved);
              }}
            />
            <span className="text-[11px] text-[var(--ink-faint)]">
              {maxCtx <= 2048
                ? "Minimum. Only for very low-memory machines — long answers will be cut short."
                : maxCtx === 4096
                  ? "Frugal. Roughly 19 messages of history; long conversations get trimmed sooner."
                  : maxCtx === 8192
                    ? "Recommended. Roughly 48 messages of history and room for a long reply."
                    : "Generous. More history than a small model reliably uses, and about 2GB of memory."}
            </span>
          </div>
        </SettingRow>
      </Section>
    </>
  );
}

// ── Cloud model chips ───────────────────────────────────────────────────────────────────────────────────
function CloudModelChips({ models, value, onChange }: { models: ModelOption[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {models.map((m) => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          className={`px-3 py-2 rounded-lg text-sm text-left flex items-center gap-2 transition-colors ${
            value === m.id ? "btn-primary btn" : "bg-panel-lite text-[var(--ink-dim)] hover:bg-lcd border border-[var(--rule)]"
          }`}
        >
          <span className="flex-1">{m.label}</span>
          {m.recommended && <span className="text-[10px] font-semibold bg-[rgb(var(--phosphor-rgb)/0.20)] text-phosphor-bright px-1.5 py-0.5 rounded">RECOMMENDED</span>}
        </button>
      ))}
    </div>
  );
}

// ── Ollama model picker (free-text + discovered/suggested chips) ────────────────────────────────────────
interface OllamaModelPickerProps {
  label: string;
  value: string;
  onChange: (model: string) => void;          // local edit
  onCommit: (model: string) => void;           // persist (chip click or input blur)
  discoveredModels: string[];
  suggestions: string[];
  ollamaStatus: "checking" | "connected" | "disconnected";
}

function OllamaModelPicker({ label, value, onChange, onCommit, discoveredModels, suggestions, ollamaStatus }: OllamaModelPickerProps) {
  const chips = discoveredModels.length > 0 ? discoveredModels : suggestions;
  const isDiscovered = discoveredModels.length > 0;
  return (
    <div className="space-y-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit(value)}
        onKeyDown={(e) => { if (e.key === "Enter") onCommit(value); }}
        placeholder="e.g. llama3, qwen2.5:7b, phi3:mini"
        className={INPUT_CLS}
        spellCheck={false}
      />
      <div className="flex flex-wrap gap-1.5">
        {chips.map((m) => (
          <button
            key={m}
            onClick={() => onCommit(m)}
            title={isDiscovered ? `Use ${m}` : `Not installed — run: ollama pull ${m}`}
            className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
              value === m ? "btn-primary btn" : isDiscovered ? "bg-lcd text-[var(--ink-dim)] hover:bg-panel" : "bg-panel-lite text-[var(--ink-faint)] border border-[var(--rule)]"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      {ollamaStatus === "connected" && (
        <p className="text-[10px] text-[var(--ink-faint)]">{discoveredModels.length} installed model{discoveredModels.length !== 1 ? "s" : ""} · type any name or click a chip</p>
      )}
      {ollamaStatus === "disconnected" && (
        <p className="text-[10px] text-[var(--ink-faint)]">Suggestions shown — connect Ollama to see installed models</p>
      )}
      {!value.trim() && <p className="text-[10px] text-amber-500/70">Enter a model name for {label}</p>}
    </div>
  );
}
