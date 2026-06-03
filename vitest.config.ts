import { defineConfig } from "vitest/config";

// Unit tests target the pure (Tauri-free, DOM-free) logic modules — version compare, settings import
// parse/sanitize, permission presets, the model catalog ↔ defaults contract, store-key scheme, search
// match, and theme CRT reconciliation. Node environment (no jsdom needed); DOM-coupled UI is verified in
// the live app instead.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
