import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { registerBuiltinTools } from "./lib/tools";
import "./index.css";

// Register the kernel's built-in tools once, before anything renders (Phase 1).
registerBuiltinTools();

// Dev-only harnesses — registered only in `tauri dev`, tree-shaken from production builds.
//   __runEvals()           — golden-conversation eval (src/lib/eval/runner.ts)
//   __testDsl()            — zod→JSON-Schema round-trip (src/lib/dsl/_roundTripCheck.ts)
//   __spikeToolStreaming() — streaming+tools floor-model probe (src/lib/spike/toolStreamSpike.ts)
if (import.meta.env.DEV) {
  void import("./lib/dsl/_roundTripCheck");
  void import("./lib/eval/runner");
  void import("./lib/spike/toolStreamSpike");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
