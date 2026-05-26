import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { registerBuiltinTools } from "./lib/tools";
import { loadBuiltinSkills } from "./lib/skills";
import "./index.css";

// Register the kernel's built-in tools + skills once, before anything renders (Phase 1 / Phase 2).
registerBuiltinTools();
loadBuiltinSkills();

// Dev-only harnesses — registered only in `tauri dev`, tree-shaken from production builds.
//   __runEvals()           — golden-conversation eval (src/lib/eval/runner.ts)
//   __testDsl()            — zod→JSON-Schema round-trip (src/lib/dsl/_roundTripCheck.ts)
//   __spikeToolStreaming() — streaming+tools floor-model probe (src/lib/spike/toolStreamSpike.ts)
//   __testQuizValidate()   — quiz question-validator self-test (src/lib/quiz.selftest.ts)
if (import.meta.env.DEV) {
  void import("./lib/dsl/_roundTripCheck");
  void import("./lib/eval/runner");
  void import("./lib/spike/toolStreamSpike");
  void import("./lib/quiz.selftest");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
