import { describe, it, expect, afterEach } from "vitest";
import { ollamaRunInfo } from "./ollama-info";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "Content-Type": "application/json" } });

function serve(routes: Record<string, () => Response>): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    const route = routes[url.pathname];
    if (!route) return new Response("not found", { status: 404 });
    return route();
  }) as typeof fetch;
  return seen;
}

describe("ollamaRunInfo", () => {
  it("records the server version and each model's tag and digest, matching x to x:latest", async () => {
    const seen = serve({
      "/api/version": () => json({ version: "0.40.15" }),
      "/api/tags": () => json({ models: [
        { name: "gemma4:e2b", digest: "b37049369adf0000" },
        { name: "nomic-embed-text:latest", digest: "0a109f422b470000" },
        { name: "other:latest", digest: "ffff" },
      ] }),
    });
    const info = await ollamaRunInfo("http://127.0.0.1:11434/", ["gemma4:e2b", "nomic-embed-text"]);
    expect(info).toEqual({
      version: "0.40.15",
      models: {
        "gemma4:e2b": { name: "gemma4:e2b", digest: "b37049369adf0000" },
        "nomic-embed-text": { name: "nomic-embed-text:latest", digest: "0a109f422b470000" },
      },
    });
    expect(seen.sort()).toEqual(["/api/tags", "/api/version"]);
  });

  it("prefers the exact tag over :latest", async () => {
    serve({ "/api/tags": () => json({ models: [{ name: "m:latest", digest: "aa" }, { name: "m", digest: "bb" }] }) });
    expect((await ollamaRunInfo("http://x", ["m"])).models.m).toEqual({ name: "m", digest: "bb" });
  });

  it("writes null for what Ollama does not answer, and never throws", async () => {
    serve({ "/api/tags": () => json({ models: [{ name: "gemma4:e2b" }] }) });
    expect(await ollamaRunInfo("http://x", ["gemma4:e2b", "missing"])).toEqual({
      version: null,
      models: { "gemma4:e2b": { name: "gemma4:e2b", digest: null }, missing: null },
    });
    globalThis.fetch = (async () => { throw new Error("connection refused"); }) as typeof fetch;
    expect(await ollamaRunInfo("http://x", ["a"])).toEqual({ version: null, models: { a: null } });
  });
});
