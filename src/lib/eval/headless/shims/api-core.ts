// Headless stand-in for @tauri-apps/api/core. There is no Rust side, so every command fails, which is
// what each caller already handles when Tauri is absent (store.ts reads a failed
// system_memory_bytes as "unknown RAM").
export async function invoke<T>(cmd: string): Promise<T> {
  throw new Error(`headless eval: no Tauri command "${cmd}"`);
}

export const isTauri = (): boolean => false;
