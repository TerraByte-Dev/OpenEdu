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
      // src-tauri is the Rust side — rebuilt by tauri, not Vite. (public/library IS watched, so a
      // `sync:library` refresh is picked up live; the sync is incremental, so only changed files reload.)
      ignored: ["**/src-tauri/**"],
    },
  },
}));
