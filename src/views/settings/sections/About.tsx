import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { appDataDir } from "@tauri-apps/api/path";
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
import { checkForUpdate, installUpdate, type Update } from "../../../lib/updater";
import { STORE_FILE, STORE_KEYS } from "../../../lib/store-keys";
import { Section, SettingRow, ActionButton, Toggle, INPUT_CLS, useSettings } from "../primitives";
import { BrandMark } from "../../../components/BrandMark";
import type { SectionProps } from "../types";

const APP_IDENTIFIER = "com.terrabytesolutions.openedu";

interface Diag {
  provider: LLMProvider;
  genModel: string;
  chatModel: string;
  tier: ModelTier | "—";
  ollama: string;
  library: string;
  dbPath: string;
}

type UpdateState = { kind: "idle" | "checking" | "current" | "available" | "installing" | "error"; msg?: string; version?: string; notes?: string; pct?: number | null };

export default function About({ onProviderChanged }: SectionProps) {
  const { markSaved } = useSettings();
  const [version, setVersion] = useState("…");
  const [update, setUpdate] = useState<UpdateState>({ kind: "idle" });
  const [diag, setDiag] = useState<Diag | null>(null);
  const [selfCheck, setSelfCheck] = useState<{ ok: boolean; msg: string } | null>(null);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; msg: string } | null>(null);
  const [importText, setImportText] = useState("");

  // Guard async setState against an unmount mid-flight (these probes can take seconds).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    getVersion().then((v) => { if (mounted.current) setVersion(v); }).catch(() => { if (mounted.current) setVersion("0.1.0"); });
    void loadDiag();
    return () => { mounted.current = false; };
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
    if (mounted.current) setDiag({ provider: base.provider, genModel: gen.model, chatModel: chat.model, tier: tier ?? "—", ollama, library, dbPath });
  };

  // The Tauri updater checks the signed GitHub release feed; if a newer version is found it's downloaded,
  // signature-verified, installed, and the app relaunches into it.
  const updateRef = useRef<Update | null>(null);

  const checkUpdates = async () => {
    const set = (u: UpdateState) => { if (mounted.current) setUpdate(u); };
    set({ kind: "checking" });
    try {
      const upd = await checkForUpdate();
      if (upd) {
        updateRef.current = upd;
        set({ kind: "available", version: upd.version, notes: upd.body });
      } else {
        set({ kind: "current", msg: `You're up to date (${version}).` });
      }
    } catch (e) {
      set({ kind: "error", msg: e instanceof Error ? e.message : "Update check failed." });
    }
  };

  const installNow = async () => {
    const upd = updateRef.current;
    if (!upd) return;
    const set = (u: UpdateState) => { if (mounted.current) setUpdate(u); };
    set({ kind: "installing", version: upd.version, pct: null });
    try {
      await installUpdate(upd, (pct) => set({ kind: "installing", version: upd.version, pct }));
      // On success the app relaunches into the new version; nothing more to do here.
    } catch (e) {
      set({ kind: "error", msg: e instanceof Error ? e.message : "Install failed." });
    }
  };

  const runSelfCheck = async () => {
    setSelfCheck(null);
    try {
      const cfg = await getGenerationConfig();
      const r = await preflightStructuredOutput(cfg);
      if (mounted.current) setSelfCheck({ ok: r.ok, msg: r.ok ? `Model is compatible${r.detectedTier ? ` · tier: ${r.detectedTier}` : ""}.` : `${r.reason ?? "Incompatible"}${r.suggestion ? ` — ${r.suggestion}` : ""}` });
    } catch (e) {
      if (mounted.current) setSelfCheck({ ok: false, msg: e instanceof Error ? e.message : String(e) });
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
      setImportMsg({ ok: true, msg: `Imported ${summary.settingsApplied} setting(s)${summary.themeApplied ? " + theme" : ""}${summary.permissionsApplied ? " + permissions" : ""}${summary.themeSkipped ? " (unknown theme in file — skipped)" : ""}. Reopen Settings to see every field refresh.` });
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
      const store = await Store.load(STORE_FILE);
      for (const k of [STORE_KEYS.genModel, STORE_KEYS.chatModel, STORE_KEYS.embeddingModel, STORE_KEYS.embeddingProvider, STORE_KEYS.libraryUrl]) await store.delete(k);
      await store.set(STORE_KEYS.libraryEnabled, true);
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
            {(update.kind === "idle" || update.kind === "current" || update.kind === "error") && (
              <ActionButton onClick={checkUpdates} busyLabel="Checking…">Check for updates</ActionButton>
            )}
            {update.kind === "checking" && <span className="text-xs text-[var(--ink-faint)]">Checking for updates…</span>}
            {update.kind === "current" && <span className="text-xs text-emerald-400">✓ {update.msg}</span>}
            {update.kind === "available" && (
              <ActionButton primary onClick={installNow} busyLabel="Starting…">Install v{update.version} &amp; restart</ActionButton>
            )}
            {update.kind === "installing" && (
              <span className="text-xs text-phosphor-bright">
                {update.pct == null ? "Downloading…" : update.pct < 100 ? `Downloading… ${update.pct}%` : "Installing &amp; restarting…"}
              </span>
            )}
            {update.kind === "error" && <span className="text-xs text-red-400">{update.msg}</span>}
          </div>
          {update.kind === "available" && update.notes && (
            <p className="mt-2 text-xs text-[var(--ink-faint)] whitespace-pre-wrap max-w-prose">{update.notes}</p>
          )}
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

      {/* Brand attribution — the emblem tints to the active theme via BrandMark. */}
      <div className="mt-10 pt-6 border-t border-[var(--rule)] flex items-center gap-3">
        <BrandMark size={40} glow title="TerraByte Solutions LLC" />
        <div className="min-w-0">
          <div className="text-sm text-ink font-medium leading-tight">OpenEdu</div>
          <div className="text-xs text-[var(--ink-faint)] leading-tight">by TerraByte Solutions LLC · free &amp; open source</div>
        </div>
        <span className="ml-auto text-xs font-mono text-[var(--ink-faint)] select-all shrink-0">github.com/TerraByte-Dev/OpenEdu</span>
      </div>
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
