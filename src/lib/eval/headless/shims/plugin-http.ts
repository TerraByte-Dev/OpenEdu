// Headless stand-in for @tauri-apps/plugin-http: Node's own fetch. Looked up on every call, so a test
// that replaces globalThis.fetch sees every request the kernel makes.
export const fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);
