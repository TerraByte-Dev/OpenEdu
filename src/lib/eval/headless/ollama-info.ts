// The Ollama server version and the digest of each model a run uses, written into the results JSON.
// Without them, "same Ollama, same digests" between two arms of an A/B cannot be checked from the
// files (PR #184 review). Recording never fails a run: anything Ollama does not answer is null.

export interface OllamaRunInfo {
  /** GET /api/version, or null when it did not answer. */
  version: string | null;
  /** Each model the run asked for → the tag Ollama lists for it and that tag's digest, or null when
   *  /api/tags does not list it. */
  models: Record<string, { name: string; digest: string | null } | null>;
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `models` are names as the run gives them; "x" also matches Ollama's "x:latest", as preflight does. */
export async function ollamaRunInfo(ollamaUrl: string, models: readonly string[]): Promise<OllamaRunInfo> {
  const base = ollamaUrl.replace(/\/+$/, "");
  const [v, tags] = await Promise.all([getJson(`${base}/api/version`), getJson(`${base}/api/tags`)]);
  const raw = tags?.models;
  const listed = Array.isArray(raw) ? (raw as Array<{ name?: unknown; digest?: unknown }>) : [];
  const info: OllamaRunInfo = { version: typeof v?.version === "string" ? v.version : null, models: {} };
  for (const want of models) {
    const hit = listed.find((m) => m.name === want) ?? listed.find((m) => m.name === `${want}:latest`);
    info.models[want] = hit && typeof hit.name === "string"
      ? { name: hit.name, digest: typeof hit.digest === "string" ? hit.digest : null }
      : null;
  }
  return info;
}
