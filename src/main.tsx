import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { registerBuiltinTools } from "./lib/tools";
import { loadBuiltinSkills } from "./lib/skills";
import { refreshManifest } from "./lib/library";
import "./index.css";

// Register the kernel's built-in tools + skills once, before anything renders (Phase 1 / Phase 2).
registerBuiltinTools();
loadBuiltinSkills();

// Warm the OpenEdu Library manifest in the background (non-blocking): hydrate the last-good cache,
// then attempt a network update. Until this resolves with a cached manifest, library.search stays
// hidden — so offline / first-run-offline simply means no library, app unchanged.
void refreshManifest();

// Dev-only harnesses — registered only in `tauri dev`, tree-shaken from production builds.
//   __runEvals()           — golden-conversation eval (src/lib/eval/runner.ts)
//   __testDsl()            — zod→JSON-Schema round-trip (src/lib/dsl/_roundTripCheck.ts)
//   __spikeToolStreaming() — streaming+tools floor-model probe (src/lib/spike/toolStreamSpike.ts)
//   __testLibraryMatch()   — offline lexical-match check + __libraryStatus() (src/lib/library.devcheck.ts)
if (import.meta.env.DEV) {
  void import("./lib/dsl/_roundTripCheck");
  void import("./lib/eval/runner");
  void import("./lib/spike/toolStreamSpike");
  void import("./lib/library.devcheck");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
