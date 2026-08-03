import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { registerBuiltinTools } from "./lib/tools";
import { loadBuiltinSkills } from "./lib/skills";
import { refreshManifest } from "./lib/library";
import { refreshDatasetManifest } from "./lib/library-datasets";
import { applyTheme, getThemeId } from "./lib/theme";
import "./index.css";

// Apply the saved color theme before first paint, so neither the default palette nor the scanlines flash
// for users on a recolor / universal theme. applyTheme() also reconciles the "CRT off" preference
// (universal themes force it off; CRT themes honor the titlebar toggle). CSS lives in index.css.
try {
  applyTheme(getThemeId());
} catch { /* ignore — falls back to the default :root (OpenEdu) theme */ }

// Register the kernel's built-in tools + skills once, before anything renders (Phase 1 / Phase 2).
registerBuiltinTools();
loadBuiltinSkills();

// Warm the OpenEdu Library manifest in the background (non-blocking): hydrate the last-good cache,
// then attempt a network update. Until this resolves with a cached manifest, library.search stays
// hidden — so offline / first-run-offline simply means no library, app unchanged.
void refreshManifest();
// Warm the lookup-dataset manifest the same way (non-blocking) — gates the library.lookup tool.
void refreshDatasetManifest();

// Dev-only harnesses — registered only in `tauri dev`, tree-shaken from production builds.
//   __runEvals()           — golden-conversation eval (src/lib/eval/runner.ts)
//   __runRagEval()         — RAG grounding rate + falsification bar (src/lib/eval/rag-runner.ts)
//   __testMathRender()     — deterministic chat math render-check (src/lib/eval/render-check.ts)
//   __testDsl()            — zod→JSON-Schema round-trip (src/lib/dsl/_roundTripCheck.ts)
//   __spikeToolStreaming() — streaming+tools floor-model probe (src/lib/spike/toolStreamSpike.ts)
//   __testLibraryMatch()   — offline lexical-match check + __libraryStatus() (src/lib/library.devcheck.ts)
//   __testLibraryLookup()  — deterministic lookup-engine self-test + __datasetStatus() (src/lib/library-datasets.devcheck.ts)
//   __testQuizValidate()   — quiz question-validator self-test (src/lib/quiz.selftest.ts)
if (import.meta.env.DEV) {
  void import("./lib/dsl/_roundTripCheck");
  void import("./lib/eval/runner");
  void import("./lib/eval/rag-runner");
  void import("./lib/eval/render-check");
  void import("./lib/spike/toolStreamSpike");
  void import("./lib/library.devcheck");
  void import("./lib/library-datasets.devcheck");
  void import("./lib/quiz.selftest");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
