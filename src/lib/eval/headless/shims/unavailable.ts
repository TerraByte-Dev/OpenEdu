// Anything from @tauri-apps without a headless shim lands here and fails loudly at import. If this
// fires, the kernel picked up a new native dependency: shim it in vitest.eval.config.ts, or keep the
// dependency out of the kernel. The stack trace names the importer.
throw new Error("headless eval: a @tauri-apps module without a headless shim was imported (see vitest.eval.config.ts)");
