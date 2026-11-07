import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// `npm run eval`: OpenEdu's benchmarks from a terminal, against a real local Ollama, through the same
// kernel code ChatTab uses, without the Tauri app. Only *.eval.ts files run here, so `npm test` and CI
// never start an eval. Options are EVAL_* environment variables: src/lib/eval/headless/README.md.
//
// The kernel's four native imports are swapped for headless stand-ins. Any other @tauri-apps module
// fails loudly at import, so a new native dependency in the kernel cannot slip in unnoticed.
const shim = (file: string) => fileURLToPath(new URL(`./src/lib/eval/headless/shims/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@tauri-apps\/plugin-sql$/, replacement: shim("plugin-sql.ts") },
      { find: /^@tauri-apps\/plugin-http$/, replacement: shim("plugin-http.ts") },
      { find: /^@tauri-apps\/plugin-store$/, replacement: shim("plugin-store.ts") },
      { find: /^@tauri-apps\/api\/core$/, replacement: shim("api-core.ts") },
      { find: /^@tauri-apps\/.*$/, replacement: shim("unavailable.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.eval.ts"],
    fileParallelism: false,
    testTimeout: 0, // a full run is hours on a laptop; the runner has its own stall handling
    hookTimeout: 0,
  },
});
