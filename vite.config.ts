import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        // Dedupe KaTeX into ONE shared lazy chunk: both MathBlock (import katex) and
        // marked-katex-extension reach it via dynamic import(), so without this it gets duplicated
        // (~258 KB each). Grouping CodeMirror keeps the notes-editor chunk tidy too. We deliberately
        // do NOT group mermaid/cytoscape — they rely on their own per-diagram-type code-splitting.
        manualChunks(id: string) {
          if (id.includes("node_modules")) {
            if (id.includes("/katex") || id.includes("marked-katex-extension")) return "katex";
            if (id.includes("@codemirror") || id.includes("@lezer")) return "codemirror";
          }
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // src-tauri is the Rust side — rebuilt by tauri, not Vite. (public/library IS watched, so a
      // `sync:library` refresh is picked up live; the sync is incremental, so only changed files reload.)
      ignored: ["**/src-tauri/**"],
    },
  },
}));
