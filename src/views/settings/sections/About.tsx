import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { appDataDir } from "@tauri-apps/api/path";
import { fetch } from "@tauri-apps/plugin-http";
import { Store } from "@tauri-apps/plugin-store";
import type { LLMProvider, ModelTier } from "../../../types";
import { getLLMProvider, getGenerationConfig, getChatConfig } from "../../../lib/store";
import { detectModelTier, getOllamaModels, preflightStructuredOutput } from "../../../lib/llm";
import { getManifest } from "../../../lib/library";
import { DEFAULT_PERMISSION_RULES, savePermissionRules } from "../../../lib/permissions";
import { applyTheme, setCrtOff, DEFAULT_THEME_ID } from "../../../lib/theme";
import {
  gatherSettings, downloadSettingsFile, serializeSettings, parseSettingsFile, applyImportedSettings,
} from "../../../lib/settings-io";
import { Section, SettingRow, ActionButton, Toggle, INPUT_CLS, useSettings } from "../primitives";
import type { SectionProps } from "../types";

const REPO = "TerraByte-Dev/OpenEdu";
const APP_IDENTIFIER = "com.terrabyte.openedu";

interface Diag {
  provider: LLMProvider;
  genModel: string;
  chatModel: string;
  tier: ModelTier | "—";
  ollama: string;
  library: string;
  dbPath: string;
}

// Compare two dotted numeric versions; +1 if a>b, -1 if a<b, 0 if equal.
function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export default function About({ onProviderChanged }: SectionProps) {
  const { markSaved } = useSettings();
  const [version, setVersion] = useState("…");
  const [update, setUpdate] = useState<{ kind: "idle" | "checking" | "current" | "available" | "error"; msg?: string; tag?: string; url?: string }>({ kind: "idle" });
  const [diag, setDiag] = useState<Diag | null>(null);
  const [selfCheck, setSelfCheck] = useState<{ ok: boolean; msg: string } | null>(null);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [importText, setImportText] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion("0.1.0"));
    void loadDiag();
  }, []);

  const loadDiag = async () => {
    const base = await getLLMProvider();
    const gen = await getGenerationConfig();
    const chat = await getChatConfig();
    const tier = await detectModelTier(gen).catch(() => undefined);
    let ollama = "n/a";
    if (base.provider === "ollama") {
      const r = await getOllamaModels(base.ollamaUrl);
      ollama = r.models.length > 0 ? `connected · ${r.models.length} models` : `offline${r.error ? ` (${r.error})` : ""}`;
    }
    let library = "unavailable";
    try { const m = await getManifest(); library = m.length > 0 ? `${m.length} entries` : "empty"; } catch { /* ignore */ }
    let dbPath = `…/${APP_IDENTIFIER}/openedu.db`;
    try { const dir = await appDataDir(); dbPath = `${dir.replace(/[\\/]$/, "")}/openedu.db`; } catch { /* ignore */ }
    setDiag({ provider: base.provider, genModel: gen.model, chatModel: chat.model, tier: tier ?? "—", ollama, library, dbPath });
  };

  const checkUpdates = async () => {
    setUpdate({ kind: "checking" });
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        method: "GET",
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 404) { setUpdate({ kind: "current", msg: "No published releases yet — you're on the latest build." }); return; }
      if (!res.ok) { setUpdate({ kind: "error", msg: `GitHub returned ${res.status}.` }); return; }
      const data = await res.json() as { tag_name?: string; html_url?: string };
      const tag = data.tag_name ?? "";
      if (!tag) { setUpdate({ kind: "error", msg: "No release tag found." }); return; }
      const current = await getVersion().catch(() => version);
      if (cmpVersion(tag, current) > 0) {
        setUpdate({ kind: "available", tag, url: data.html_url, msg: `Version ${tag.replace(/^v/, "")} is available (you have ${current}).` });
      } else {
        setUpdate({ kind: "current", msg: `You're up to date (${current}).` });
      }
    } catch (e) {
      setUpdate({ kind: "error", msg: e instanceof Error ? `Couldn't reach GitHub: ${e.message}` : "Update check failed." });
    }
  };

  const runSelfCheck = async () => {
    setSelfCheck(null);
    try {
      const cfg = await getGenerationConfig();
      const r = await preflightStructuredOutput(cfg);
      setSelfCheck({ ok: r.ok, msg: r.ok ? `Model is compatible${r.detectedTier ? ` · tier: ${r.detectedTier}` : ""}.` : `${r.reason ?? "Incompatible"}${r.suggestion ? ` — ${r.suggestion}` : ""}` });
    } catch (e) {
      setSelfCheck({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const doExportDownload = async () => { downloadSettingsFile(await gatherSettings(includeSecrets)); };
  const doExportCopy = async () => {
    try { await navigator.clipboard.writeText(serializeSettings(await gatherSettings(includeSecrets))); setImportMsg({ ok: true, msg: "Settings JSON copied to clipboard." }); }
    catch { setImportMsg({ ok: false, msg: "Couldn't access the clipboard — use Download instead." }); }
  };

  const applyImport = async (text: string) => {
    setImportMsg(null);
    try {
      const summary = await applyImportedSettings(parseSettingsFile(text));
      onProviderChanged?.();
      markSaved();
      setImportMsg({ ok: true, msg: `Imported ${summary.settingsApplied} setting(s)${summary.themeApplied ? " + theme" : ""}${summary.permissionsApplied ? " + permissions" : ""}. Reopen Settings to see every field refresh.` });
      void loadDiag();
    } catch (e) {
      setImportMsg({ ok: false, msg: e instanceof Error ? e.message : "Import failed." });
    }
  };

  const onImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => applyImport(String(reader.result ?? ""));
    reader.onerror = () => setImportMsg({ ok: false, msg: "Couldn't read that file." });
    reader.readAsText(file);
  };

  const resetDefaults = async () => {
    // Resets appearance, models & permissions to defaults — keeps the provider, API keys, and Tavily key.
    applyTheme(DEFAULT_THEME_ID);
    setCrtOff(false);
    await savePermissionRules({ ...DEFAULT_PERMISSION_RULES });
    try {
      const store = await Store.load("settings.json");
      for (const k of ["gen_model", "chat_model", "embedding_model", "embedding_provider", "library_url"]) await store.delete(k);
      await store.set("library_enabled", true);
      await store.save();
    } catch { /* ignore */ }
    onProviderChanged?.();
    markSaved();
    void loadDiag();
  };

  return (
    <>
      <Section title="OpenEdu" description="AI-powered personalized tutoring — bring-your-own-key, offline-first." keywords="about version build update release github">
        <SettingRow label="Version" help={`Identifier: ${APP_IDENTIFIER}`}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="lcd px-3 py-1.5 rounded-md text-sm">v{version}</span>
            <ActionButton onClick={checkUpdates} busyLabel="Checking…">Check for updates</ActionButton>
            {update.kind === "checking" && <span className="text-xs text-[var(--ink-faint)]">Checking GitHub…</span>}
            {update.kind === "current" && <span className="text-xs text-emerald-400">✓ {update.msg}</span>}
            {update.kind === "available" && (
              <span className="text-xs text-amber-400">
                ↑ {update.msg}{update.url ? <> · <span className="font-mono break-all select-all">{update.url}</span></> : null}
              </span>
            )}
            {update.kind === "error" && <span className="text-xs text-red-400">{update.msg}</span>}
          </div>
        </SettingRow>
      </Section>

      <Section title="Diagnostics" description="A snapshot of the active configuration — handy for troubleshooting." keywords="diagnostics status tier ollama library database path self check preflight troubleshoot">
        <SettingRow label="System status">
          {diag ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-[var(--ink-faint)]">Provider</dt><dd className="text-ink">{diag.provider}</dd>
              <dt className="text-[var(--ink-faint)]">Generation model</dt><dd className="text-ink font-mono">{diag.genModel} <span className="text-[var(--ink-faint)]">· {diag.tier}</span></dd>
              <dt className="text-[var(--ink-faint)]">Chat model</dt><dd className="text-ink font-mono">{diag.chatModel}</dd>
              <dt className="text-[var(--ink-faint)]">Ollama</dt><dd className="text-ink">{diag.ollama}</dd>
              <dt className="text-[var(--ink-faint)]">Library</dt><dd className="text-ink">{diag.library}</dd>
              <dt className="text-[var(--ink-faint)]">Database</dt><dd className="text-ink font-mono break-all select-all">{diag.dbPath}</dd>
            </dl>
          ) : (
            <p className="text-xs text-[var(--ink-faint)]">Loading…</p>
          )}
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <ActionButton onClick={runSelfCheck} busyLabel="Running…">Run self-check</ActionButton>
            <ActionButton onClick={loadDiag}>Refresh</ActionButton>
            {selfCheck && <span className={`text-xs ${selfCheck.ok ? "text-emerald-400" : "text-red-400"}`}>{selfCheck.ok ? "✓ " : "✗ "}{selfCheck.msg}</span>}
          </div>
        </SettingRow>
      </Section>

      <Section title="Backup & Reset" description="Carry your configuration between machines, or restore defaults." keywords="export import backup settings json reset defaults restore migrate portable">
        <SettingRow label="Export settings" help="Download a JSON file (or copy it) with your provider, models, library, theme, and permissions. API keys are excluded unless you opt in.">
          <div className="space-y-2.5">
            <Toggle checked={includeSecrets} onChange={setIncludeSecrets} labelOn="Including API keys (handle with care)" labelOff="Excluding API keys (safe to share)" />
            <div className="flex gap-2">
              <ActionButton onClick={doExportDownload} primary>Download .json</ActionButton>
              <ActionButton onClick={doExportCopy}>Copy JSON</ActionButton>
            </div>
          </div>
        </SettingRow>

        <SettingRow label="Import settings" help="Load a settings file, or paste the JSON below. Only recognized keys are applied.">
          <div className="space-y-2.5">
            <label className="btn cursor-pointer inline-flex">
              Choose file…
              <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ""; }} />
            </label>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='Paste exported settings JSON here…'
              rows={3}
              className={INPUT_CLS + " font-mono text-xs resize-y"}
              spellCheck={false}
            />
            <ActionButton onClick={() => applyImport(importText)} primary>Apply pasted JSON</ActionButton>
            {importMsg && <p className={`text-xs ${importMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{importMsg.ok ? "✓ " : "✗ "}{importMsg.msg}</p>}
          </div>
        </SettingRow>

        <SettingRow label="Reset to defaults" help="Restores theme, CRT, models, library, and permissions to their defaults. Keeps your provider, API keys, and Tavily key.">
          <ConfirmButton onConfirm={resetDefaults} label="Reset to defaults" confirmLabel="Click again to confirm" />
        </SettingRow>
      </Section>
    </>
  );
}

// A two-tap confirm button so a destructive reset isn't a single misclick.
function ConfirmButton({ onConfirm, label, confirmLabel }: { onConfirm: () => Promise<void> | void; label: string; confirmLabel: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      onClick={async () => { if (!armed) { setArmed(true); return; } setArmed(false); await onConfirm(); }}
      className={`btn ${armed ? "border-red-500/70 text-red-400" : ""}`}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
