// The app origin, headless. In the webview the bundled library is fetched same-origin from /library/…
// (library.ts BUNDLED_BASE). Node has no origin, so a relative URL is served from public/ on disk,
// which is the folder Vite serves and copies into the build. Everything else goes to the real fetch.

import { fs, path, cwd } from "./node-io";

/** A Response for a same-origin path ("/library/index.json"), read from `<root>/public`. */
export async function serveAppAsset(url: string, root = cwd()): Promise<Response> {
  const [f, p] = await Promise.all([fs(), path()]);
  const pub = p.resolve(root, "public");
  const file = p.resolve(pub, "." + decodeURIComponent(url.split(/[?#]/)[0]));
  if (p.relative(pub, file).startsWith("..")) return new Response("forbidden", { status: 403 });
  try {
    return new Response(await f.readFile(file, "utf8"), { status: 200 });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

const isAppPath = (input: unknown): input is string => typeof input === "string" && input.startsWith("/") && !input.startsWith("//");

const INSTALLED = Symbol.for("openedu.headless.appOrigin");

/** Wrap globalThis.fetch so app-origin paths are served from public/. Installing twice is a no-op. */
export function installAppOrigin(root = cwd()): void {
  const real = globalThis.fetch as typeof fetch & { [INSTALLED]?: true };
  if (real[INSTALLED]) return;
  const wrapped = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    isAppPath(input) ? serveAppAsset(input, root) : real(input, init)) as typeof fetch & { [INSTALLED]?: true };
  wrapped[INSTALLED] = true;
  globalThis.fetch = wrapped;
}
