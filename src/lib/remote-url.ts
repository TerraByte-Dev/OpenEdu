// Does a URL or a piece of CSS load something from another host? Shared by sanitize-html.ts (HTML and
// SVG) and mermaid-source.ts (diagram source), #284. Kept apart from sanitize-html.ts so importing it
// never loads DOMPurify: a Node caller (an eval) can load mermaid-source before a DOM exists, and
// DOMPurify's shared instance, which Mermaid also uses, binds to whatever window it first sees.

// data:, blob:, fragment-only (#id) and same-origin URLs load nothing from the network. Unparseable
// counts as remote. Same origin is compared as protocol + host, not URL.origin: on macOS/Linux the app
// is served from tauri://localhost, a non-special scheme whose URL.origin is "null".
// `pageUrl` is only overridden by tests (jsdom can't run at an opaque origin).
export function isLocalUrl(value: string, pageUrl: string = window.location.href): boolean {
  const v = value.trim();
  if (v.startsWith("#")) return true;
  try {
    const here = new URL(pageUrl);
    const url = new URL(v, here);
    return url.protocol === "data:" || url.protocol === "blob:" || (url.protocol === here.protocol && url.host === here.host);
  } catch {
    return false;
  }
}

// True when CSS text would fetch from another host. CSS escapes (\75 rl( is url() and comments are
// undone first; image-set(), src() and @import can load without url(), so they always count.
export function cssLoadsRemote(css: string): boolean {
  const text = css
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, "")
    .replace(/\\(\r\n|[\n\r\f])/g, "")
    .replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?/gi, (_, hex: string) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "\ufffd";
    })
    .replace(/\\([\s\S])/g, "$1")
    .toLowerCase();
  if (/@import|image-set\(|src\(/.test(text)) return true;
  for (const m of text.matchAll(/url\(\s*["']?([^"')]*)/g)) if (!isLocalUrl(m[1])) return true;
  return false;
}
