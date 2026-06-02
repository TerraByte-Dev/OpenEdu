import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
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
      // src-tauri: Rust side, rebuilt by tauri, not Vite.
      // public/library: the bundled corpus is refreshed wholesale by `npm run sync:library`; watching it
      // makes a sync fire a full-page reload per file (a storm) and can corrupt Vite's publicDir view.
      // It's still SERVED (sirv) — just not watched; reload the app manually to pick up a fresh sync.
      ignored: ["**/src-tauri/**", "**/public/library/**"],
    },
  },
}));
